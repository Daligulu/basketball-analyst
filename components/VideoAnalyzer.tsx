// components/VideoAnalyzer.tsx
'use client';

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { PoseEngine, type PoseResult } from '@/lib/pose/poseEngine';
import {
  ALL_CONNECTIONS,
  UPPER_COLOR,
  TORSO_COLOR,
  LOWER_COLOR,
} from '@/lib/pose/skeleton';
import {
  DEFAULT_ANALYZE_CONFIG,
  type AnalyzeConfig,
} from '@/lib/analyze/config';
import {
  scoreFromPose,
  EMPTY_SCORE,
  type AnalyzeScore,
} from '@/lib/analyze/scoring';
import RadarChart from '@/components/RadarChart';

declare global {
  interface Window {
    Pose?: any;
    pose?: any;
    __mpPosePromise?: Promise<any>;
  }
}

const MP_LOCAL_BASES = ['/mp/pose', '/mediapipe/pose', '/vendor/mediapipe/pose'];
const MP_CDN_BASES = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404',
  'https://unpkg.com/@mediapipe/pose@0.5.1675469404',
];

async function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existed = document.querySelector(`script[data-mp="${src}"]`);
    if (existed) {
      existed.addEventListener('load', () => resolve());
      existed.addEventListener('error', () => reject(new Error('fail')));
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.dataset.mp = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('fail'));
    document.head.appendChild(s);
  });
}

// 找到能用的 mediapipe Pose 构造函数
async function ensureMediapipePose(): Promise<any | null> {
  if (typeof window === 'undefined') return null;
  if (window.Pose || window.pose) {
    return window.Pose || window.pose;
  }
  if (window.__mpPosePromise) {
    return window.__mpPosePromise;
  }

  window.__mpPosePromise = (async () => {
    const tryBases = [...MP_LOCAL_BASES, ...MP_CDN_BASES];
    for (const base of tryBases) {
      try {
        await loadScriptOnce(`${base}/pose.js`);
        const Ctor = (window as any).Pose || (window as any).pose;
        if (Ctor) {
          return (file: string) => `${base}/${file}`;
        }
      } catch {
        // 下一个
      }
    }
    return null;
  })();

  const locateFile = await window.__mpPosePromise;
  if (!locateFile) return null;

  // 这里再返回真正的 Pose 类
  const Ctor = (window as any).Pose || (window as any).pose;
  if (!Ctor) return null;
  // 我们需要把 locateFile 固定进去
  return class WrappedPose extends Ctor {
    constructor(opts: any = {}) {
      super({
        ...opts,
        locateFile,
      });
    }
  };
}

export default function VideoAnalyzer() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  const engineRef = useRef<PoseEngine | null>(null);
  const mpPoseRef = useRef<any | null>(null);
  const loopRef = useRef<number | null>(null);
  const lastPoseRef = useRef<PoseResult | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [scores, setScores] = useState<AnalyzeScore>(EMPTY_SCORE);
  const [analyzeConfig] = useState<AnalyzeConfig>(DEFAULT_ANALYZE_CONFIG);
  const [mpReady, setMpReady] = useState(false);
  const [mpTried, setMpTried] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [videoSize, setVideoSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // 1) init pose engine
  useEffect(() => {
    engineRef.current = new PoseEngine({
      smooth: {
        minCutoff: analyzeConfig.poseSmoothing.minCutoff,
        beta: analyzeConfig.poseSmoothing.beta,
        dCutoff: analyzeConfig.poseSmoothing.dCutoff,
      },
    } as any);
  }, [analyzeConfig.poseSmoothing]);

  // 2) 预加载 mediapipe
  useEffect(() => {
    if (typeof window === 'undefined') return;
    (async () => {
      const PoseCtorOrNull = await ensureMediapipePose();
      setMpTried(true);
      if (!PoseCtorOrNull) {
        setMpReady(false);
        return;
      }
      const pose = new PoseCtorOrNull({
        modelComplexity: analyzeConfig.model === 'mediapipe-full' ? 2 : 1,
        enableSegmentation: false,
        smoothLandmarks: false,
      });
      mpPoseRef.current = pose;
      setMpReady(true);
    })();
  }, [analyzeConfig.model]);

  // 3) 选文件
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    setFile(f);
    setVideoUrl(url);
    setScores(EMPTY_SCORE);
    setIsAnalyzing(false);
  };

  // 4) 视频真正知道尺寸了，把 canvas 同步一下
  const handleLoadedMetadata = () => {
    const vid = videoRef.current;
    const cvs = canvasRef.current;
    if (!vid || !cvs) return;
    cvs.width = vid.videoWidth;
    cvs.height = vid.videoHeight;
    setVideoSize({ w: vid.videoWidth, h: vid.videoHeight });

    // 准备一个离屏 canvas 给 mediapipe
    const off = document.createElement('canvas');
    off.width = vid.videoWidth;
    off.height = vid.videoHeight;
    offscreenRef.current = off;
  };

  // 5) 画骨架
  const drawPoseOnCanvas = useCallback((person: PoseResult) => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, cvs.width, cvs.height);

    const minScore = 0.28;
    const radius = 3;

    // 点
    for (const kp of person.keypoints) {
      if (!kp) continue;
      if ((kp.score ?? 0) < minScore) continue;

      let color = LOWER_COLOR;
      if (
        kp.name === 'left_shoulder' ||
        kp.name === 'right_shoulder' ||
        kp.name === 'left_hip' ||
        kp.name === 'right_hip'
      ) {
        color = TORSO_COLOR;
      } else if (
        kp.name?.startsWith('left_knee') ||
        kp.name?.startsWith('right_knee') ||
        kp.name?.startsWith('left_ankle') ||
        kp.name?.startsWith('right_ankle') ||
        kp.name?.startsWith('left_foot') ||
        kp.name?.startsWith('right_foot') ||
        kp.name?.startsWith('left_heel') ||
        kp.name?.startsWith('right_heel')
      ) {
        color = LOWER_COLOR;
      } else {
        color = UPPER_COLOR;
      }

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(kp.x, kp.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 线
    for (const { pair, color } of ALL_CONNECTIONS) {
      const [aName, bName] = pair;
      const a = person.keypoints.find((k) => k.name === aName);
      const b = person.keypoints.find((k) => k.name === bName);
      if (!a || !b) continue;
      if ((a.score ?? 0) < minScore || (b.score ?? 0) < minScore) continue;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const maxLen = Math.min(cvs.width, cvs.height) * 0.6;
      if (dist > maxLen) continue;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }, []);

  // 6) 点击开始分析
  const handleStart = useCallback(async () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (!mpReady) {
      alert('Mediapipe Pose 还没加载好，再点一次即可');
      // 再主动拉一次
      ensureMediapipePose().then(() => {
        // nothing
      });
      return;
    }
    // 播放视频
    vid.currentTime = 0;
    await vid.play();
    setIsAnalyzing(true);

    const pose = mpPoseRef.current;
    const engine = engineRef.current;
    const off = offscreenRef.current;

    if (!pose || !engine || !off) return;

    const ctx = off.getContext('2d');
    if (!ctx) return;

    const loop = async () => {
      if (!videoRef.current) return;
      if (videoRef.current.paused || videoRef.current.ended) {
        setIsAnalyzing(false);
        return;
      }
      // 把当前帧画到离屏 canvas 再给 mediapipe
      ctx.drawImage(videoRef.current, 0, 0, off.width, off.height);
      // mediapipe 的 send 是异步的
      await pose.send({ image: off });

      // 我们在 onResults 里会更新 lastPoseRef，这里只要继续 loop 就行
      loopRef.current = requestAnimationFrame(loop);
    };

    // 挂上结果回调（要先挂，不然第一帧回调不到）
    pose.onResults((res: any) => {
      // res.poseLandmarks 是 33 个关键点
      if (!res || !res.poseLandmarks) {
        return;
      }
      const kps = res.poseLandmarks.map((lm: any, idx: number) => ({
        name: res.poseLandmarks[idx]?.name || res.poseLandmarks[idx]?.visibility
          ? `kp_${idx}`
          : `kp_${idx}`,
        // mediapipe 是 0~1，要转成像素
        x: lm.x * off.width,
        y: lm.y * off.height,
        z: lm.z,
        score: lm.visibility ?? 1,
      }));

      // 填成我们的结构，注意 id 用字符串
      const frame = {
        persons: [
          {
            id: '0',
            keypoints: kps,
          },
        ],
        ts: performance.now(),
      };

      const person = engine.process(frame);
      if (!person) return;

      lastPoseRef.current = person;
      drawPoseOnCanvas(person);
      const sc = scoreFromPose(person, analyzeConfig);
      setScores(sc);
    });

    // 进循环
    loop();
  }, [analyzeConfig, drawPoseOnCanvas, mpReady]);

  // 清掉 RAF
  useEffect(() => {
    return () => {
      if (loopRef.current) cancelAnimationFrame(loopRef.current);
    };
  }, []);

  return (
    <div className="space-y-4">
      {/* 顶部 */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">开始分析你的投篮</h1>
        <p className="text-slate-400 text-sm mt-1">
          BUILD: <span className="font-mono">coach-v3.9-release+wrist+color</span>
        </p>
      </div>

      {/* 上传 + 按钮 */}
      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex-1 flex items-center gap-2 bg-slate-900 border border-slate-700 px-4 py-2 rounded text-slate-100">
          选取文件
          <input
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleFileChange}
          />
          {file ? (
            <span className="text-xs text-slate-300 truncate">{file.name}</span>
          ) : null}
        </label>
        <button
          onClick={() => setShowConfig((p) => !p)}
          className="px-4 py-2 bg-emerald-500 rounded text-white text-sm"
        >
          配置
        </button>
        <button
          onClick={handleStart}
          disabled={!videoUrl}
          className={`px-6 py-2 rounded text-sm ${
            videoUrl ? 'bg-sky-500 text-white' : 'bg-slate-600 text-slate-300'
          }`}
        >
          {isAnalyzing ? '识别中…' : '开始分析'}
        </button>
      </div>

      {/* 视频 + 骨架 */}
      <div
        className="relative bg-black rounded-lg overflow-hidden"
        style={{
          width: '100%',
          maxWidth: '720px',
          aspectRatio: videoSize.w && videoSize.h ? `${videoSize.w} / ${videoSize.h}` : '9 / 16',
        }}
      >
        {videoUrl ? (
          <>
            <video
              ref={videoRef}
              src={videoUrl}
              onLoadedMetadata={handleLoadedMetadata}
              controls
              className="w-full h-full object-contain bg-black"
              playsInline
            />
            <canvas
              ref={canvasRef}
              className="pointer-events-none absolute inset-0 w-full h-full"
            />
          </>
        ) : (
          <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
            请先上传视频
          </div>
        )}
      </div>

      {/* 雷达图 */}
      <div className="bg-slate-900/40 rounded-lg p-4">
        <RadarChart
          lower={scores.lower.score}
          upper={scores.upper.score}
          balance={scores.balance.score}
        />
        <p className="text-slate-400 text-xs mt-2">
          下肢：{scores.lower.score}，上肢：{scores.upper.score}，平衡：{scores.balance.score}
        </p>
      </div>

      {/* 分数明细 */}
      <div className="space-y-4">
        <div className="text-slate-100 text-lg font-medium">总分：{scores.total}</div>

        {/* 下肢 */}
        <div className="bg-slate-900/60 rounded-lg p-4">
          <div className="flex justify-between items-center">
            <div className="text-slate-100 font-medium">下肢动力链</div>
            <div className="text-cyan-300 text-xl font-semibold">
              {scores.lower.score}
            </div>
          </div>
          <div className="mt-2 space-y-1 text-sm text-slate-200">
            <div className="flex justify-between">
              <span>下蹲深度（膝角）</span>
              <span>
                {scores.lower.squat.score}{' '}
                <span className="text-slate-400">({scores.lower.squat.value})</span>
              </span>
            </div>
            <div className="flex justify-between">
              <span>伸膝速度</span>
              <span>
                {scores.lower.kneeExt.score}{' '}
                <span className="text-slate-400">({scores.lower.kneeExt.value})</span>
              </span>
            </div>
          </div>
        </div>

        {/* 上肢 */}
        <div className="bg-slate-900/60 rounded-lg p-4">
          <div className="flex justify-between items-center">
            <div className="text-slate-100 font-medium">上肢出手</div>
            <div className="text-cyan-300 text-xl font-semibold">
              {scores.upper.score}
            </div>
          </div>
          <div className="mt-2 space-y-1 text-sm text-slate-200">
            <div className="flex justify-between">
              <span>出手角</span>
              <span>
                {scores.upper.releaseAngle.score}{' '}
                <span className="text-slate-400">
                  ({scores.upper.releaseAngle.value})
                </span>
              </span>
            </div>
            <div className="flex justify-between">
              <span>腕部发力</span>
              <span>
                {scores.upper.armPower.score}{' '}
                <span className="text-slate-400">
                  ({scores.upper.armPower.value})
                </span>
              </span>
            </div>
            <div className="flex justify-between">
              <span>随挥保持</span>
              <span>
                {scores.upper.follow.score}{' '}
                <span className="text-slate-400">
                  ({scores.upper.follow.value})
                </span>
              </span>
            </div>
            <div className="flex justify-between">
              <span>肘部路径紧凑</span>
              <span>
                {scores.upper.elbowTight.score}{' '}
                <span className="text-slate-400">
                  ({scores.upper.elbowTight.value})
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* 平衡 */}
        <div className="bg-slate-900/60 rounded-lg p-4">
          <div className="flex justify-between items-center">
            <div className="text-slate-100 font-medium">对齐与平衡</div>
            <div className="text-cyan-300 text-xl font-semibold">
              {scores.balance.score}
            </div>
          </div>
          <div className="mt-2 space-y-1 text-sm text-slate-200">
            <div className="flex justify-between">
              <span>重心稳定（横摆）</span>
              <span>
                {scores.balance.center.score}{' '}
                <span className="text-slate-400">
                  ({scores.balance.center.value})
                </span>
              </span>
            </div>
            <div className="flex justify-between">
              <span>对齐</span>
              <span>
                {scores.balance.align.score}{' '}
                <span className="text-slate-400">
                  ({scores.balance.align.value})
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* 建议 */}
        {scores.suggestions.length ? (
          <div className="bg-slate-900/40 rounded-lg p-4">
            <div className="text-slate-100 font-medium mb-2">投篮姿态优化建议</div>
            <ul className="list-disc pl-5 space-y-1 text-slate-200 text-sm">
              {scores.suggestions.map((sug, i) => (
                <li key={i}>{sug}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* 配置面板 */}
      {showConfig ? (
        <div className="fixed inset-x-0 bottom-0 bg-slate-900/95 border-t border-slate-700 p-4 rounded-t-lg space-y-3">
          <div className="flex justify-between items-center">
            <div className="text-slate-100 font-medium text-base">分析配置</div>
            <button
              onClick={() => setShowConfig(false)}
              className="text-slate-300 text-sm"
            >
              关闭
            </button>
          </div>
          <div className="text-slate-200 text-sm">
            <div className="flex justify-between py-1">
              <span>模型复杂度</span>
              <span>{analyzeConfig.model === 'mediapipe-full' ? 'Mediapipe Pose full' : 'Mediapipe Pose lite'}</span>
            </div>
            <div className="flex justify-between py-1">
              <span>平滑强度</span>
              <span>
                OneEuro ({analyzeConfig.poseSmoothing.minCutoff} / {analyzeConfig.poseSmoothing.beta})
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span>姿态阈值</span>
              <span>{analyzeConfig.poseThreshold}</span>
            </div>
            <p className="text-slate-500 text-xs mt-2">
              这些配置先写死在前端，如果你要做“后台配置”或者“按球员自动配置”，这里再接接口即可。
            </p>
          </div>
        </div>
      ) : null}

      {/* 如果 CDN 拉不到给个提示 */}
      {!mpReady && mpTried ? (
        <p className="text-amber-400 text-xs">
          ⚠️ 当前没能从本地/CDN 加载 Mediapipe Pose，你可以把官方的 pose.js 放到
          <code className="mx-1">/public/mp/pose/</code>
          下面再试一次。
        </p>
      ) : null}
    </div>
  );
}
