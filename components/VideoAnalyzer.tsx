// components/VideoAnalyzer.tsx
'use client';

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { PoseEngine, type PoseResult } from '@/lib/pose/poseEngine';
import { scoreFromPose, type AnalyzeScore } from '@/lib/analyze/scoring';
import {
  ALL_CONNECTIONS,
  UPPER_COLOR,
  TORSO_COLOR,
  LOWER_COLOR,
} from '@/lib/pose/skeleton';
import { RadarChart } from '@/components/RadarChart';

// 1) 这一版我们自己在前端里放一个“绝对安全”的初始评分
const INITIAL_SCORE: AnalyzeScore = {
  total: 0,
  lower: {
    score: 0,
    squat: { score: 0, value: '未检测' },
    kneeExt: { score: 0, value: '未检测' },
  },
  upper: {
    score: 0,
    releaseAngle: { score: 0, value: '未检测' },
    armPower: { score: 0, value: '未检测' },
    follow: { score: 0, value: '未检测' },
    elbowTight: { score: 0, value: '未检测' },
  },
  balance: {
    score: 0,
    center: { score: 0, value: '未检测' },
    align: { score: 0, value: '未检测' },
  },
};

// 2) 这一版只走 CDN，不去读 window 上的本地路径
//    用三个最常见的 mediapipe 源，依次尝试
const MP_CDN_CANDIDATES = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404',
  'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5',
  'https://cdnjs.cloudflare.com/ajax/libs/mediapipe/0.5.1675469404/pose',
];

// 简单的脚本加载器
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('no document'));
      return;
    }
    const existed = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existed) {
      existed.addEventListener('load', () => resolve());
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('load error: ' + src));
    document.head.appendChild(s);
  });
}

// 让 mediapipe 的 Pose 实例真正创建出来
async function createMediapipePose(): Promise<any | null> {
  if (typeof window === 'undefined') return null;

  // 已经建过就直接复用
  if ((window as any).__mpPoseInstance) {
    return (window as any).__mpPoseInstance;
  }

  let lastError: unknown = null;

  for (const base of MP_CDN_CANDIDATES) {
    try {
      // 1. 先把 pose.js 拉进来
      await loadScript(`${base}/pose.js`);

      const MPose = (window as any).Pose;
      if (!MPose) {
        lastError = new Error('Mediapipe Pose not found on window after load');
        continue;
      }

      // 2. 真正 new 一个出来
      const pose = new MPose({
        locateFile: (file: string) => `${base}/${file}`,
      });

      // 粗暴点直接给你想要的参数
      pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      (window as any).__mpPoseInstance = pose;
      return pose;
    } catch (err) {
      lastError = err;
      // 换下一个 CDN
    }
  }

  console.warn('[pose] all cdn failed', lastError);
  return null;
}

export default function VideoAnalyzer() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<PoseEngine | null>(null);
  const mpPoseRef = useRef<any | null>(null);
  const lastPoseRef = useRef<PoseResult | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [scores, setScores] = useState<AnalyzeScore>(INITIAL_SCORE);
  const [videoSize, setVideoSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [poseReady, setPoseReady] = useState(false);

  // 初始化姿态引擎（我们这里直接用固定的 one-euro 数值，避免再次 type 报错）
  useEffect(() => {
    engineRef.current = new PoseEngine({
      smooth: {
        minCutoff: 1.15,
        beta: 0.05,
        dCutoff: 1.0,
      },
    } as any);
  }, []);

  // 页面挂上来就去拉 Mediapipe
  useEffect(() => {
    let alive = true;
    (async () => {
      const pose = await createMediapipePose();
      if (!alive) return;
      if (pose) {
        // 注册回调：每来一帧，跑我们自己的 poseEngine，然后画，然后评分
        pose.onResults((res: any) => {
          const cam = canvasRef.current;
          const eng = engineRef.current;
          if (!cam || !eng) return;

          // mediapipe 返回在 res.poseLandmarks 里，是 33 个点（0~1）
          if (!res.poseLandmarks || !Array.isArray(res.poseLandmarks)) {
            // 清画布 + 记个 null
            const ctx = cam.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, cam.width, cam.height);
            lastPoseRef.current = null;
            setScores(INITIAL_SCORE);
            return;
          }

          // 把 mp 的结果转成我们 engine 吃的格式（单人）
          const mpPoints = res.poseLandmarks as Array<{
            x: number;
            y: number;
            z?: number;
            visibility?: number;
          }>;
          const w = cam.width;
          const h = cam.height;
          const person = eng.process({
            persons: [
              {
                keypoints: mpPoints.map((p, idx) => ({
                  name: eng.nameFromIndex(idx),
                  x: p.x * w,
                  y: p.y * h,
                  score: typeof p.visibility === 'number' ? p.visibility : 1,
                })),
                score: 1,
              },
            ],
            ts: performance.now(),
          });

          // 清画布
          const ctx = cam.getContext('2d');
          if (!ctx) return;
          ctx.clearRect(0, 0, w, h);

          if (!person) {
            lastPoseRef.current = null;
            setScores(INITIAL_SCORE);
            return;
          }

          // 画骨架
          const minScore = 0.28;
          const radius = 3;

          // 先画点
          for (const kp of person.keypoints) {
            if (!kp) continue;
            if ((kp.score ?? 0) < minScore) continue;

            let color = UPPER_COLOR;

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
            }

            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(kp.x, kp.y, radius, 0, Math.PI * 2);
            ctx.fill();
          }

          // 再画线
          for (const { pair, color } of ALL_CONNECTIONS) {
            const [aName, bName] = pair;
            const a = person.keypoints.find((k) => k.name === aName);
            const b = person.keypoints.find((k) => k.name === bName);
            if (!a || !b) continue;
            if ((a.score ?? 0) < minScore || (b.score ?? 0) < minScore) continue;
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            const maxLen = Math.min(w, h) * 0.6;
            if (dist > maxLen) continue;

            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }

          // 打分
          const score = scoreFromPose(person);
          lastPoseRef.current = person;
          setScores(score);
        });

        mpPoseRef.current = pose;
        setPoseReady(true);
      } else {
        setPoseReady(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // 选择文件
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    setFile(f);
    setVideoUrl(url);
    setScores(INITIAL_SCORE);
    setIsAnalyzing(false);
  };

  // 视频元数据加载完
  const handleLoadedMetadata = () => {
    const vid = videoRef.current;
    const cvs = canvasRef.current;
    if (!vid || !cvs) return;
    const vw = vid.videoWidth;
    const vh = vid.videoHeight;
    cvs.width = vw;
    cvs.height = vh;
    setVideoSize({ w: vw, h: vh });
  };

  // 点击“开始分析”
  const handleStart = async () => {
    if (!videoRef.current) return;
    if (!poseReady || !mpPoseRef.current) {
      alert('Mediapipe Pose 还没加载好，再点一次即可');
      return;
    }

    // 把视频回到开头
    videoRef.current.currentTime = 0;
    await videoRef.current.play();
    setIsAnalyzing(true);

    // 开始跑“每一帧送给 mediapipe”
    const vid = videoRef.current;
    const pose = mpPoseRef.current as any;

    const loop = async () => {
      if (!vid || vid.ended || vid.paused) return;
      // mediapipe 的 send 要求同步一帧
      await pose.send({ image: vid });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };

  return (
    <div className="space-y-4">
      {/* 顶部标题 */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">开始分析你的投篮</h1>
        <p className="text-slate-400 text-sm mt-1">
          BUILD: <span className="font-mono">coach-v3.9-release+wrist+color</span>
        </p>
      </div>

      {/* 上传 & 按钮 */}
      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex-1 flex items-center gap-2 bg-slate-900 border border-slate-700 px-4 py-2 rounded cursor-pointer text-slate-100">
          选取文件
          <input type="file" accept="video/*" className="hidden" onChange={handleFileChange} />
          {file ? (
            <span className="text-xs text-slate-300 max-w-[160px] truncate">{file.name}</span>
          ) : null}
        </label>
        <button
          onClick={() => setIsConfigOpen((p) => !p)}
          className="px-6 py-2 rounded bg-emerald-500 text-white text-sm"
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

      {/* 视频 + 姿态覆盖层 */}
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
      <div className="bg-slate-900/50 rounded-lg p-4">
        <h2 className="text-slate-100 mb-2 text-sm">投篮姿态评分雷达图</h2>
        {/* 注意：这里的雷达图仅用 下肢、上肢、平衡 三个维度，不再含总分 */}
        <RadarChart
          labels={['下肢', '上肢', '平衡']}
          data={[
            scores.lower.score ?? 0,
            scores.upper.score ?? 0,
            scores.balance.score ?? 0,
          ]}
        />
        <p className="text-xs text-slate-500 mt-2">
          下肢：{scores.lower.score}，上肢：{scores.upper.score}，平衡：{scores.balance.score}
        </p>
      </div>

      {/* 评分区域 */}
      <div className="space-y-4">
        <div className="text-slate-100 text-lg font-medium">总分：{scores.total}</div>

        {/* 下肢 */}
        <div className="bg-slate-900/60 rounded-lg p-4">
          <div className="flex justify-between items-center">
            <div className="text-slate-100 font-medium">下肢动力链</div>
            <div className="text-cyan-300 text-xl font-semibold">{scores.lower.score}</div>
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
            <div className="text-cyan-300 text-xl font-semibold">{scores.upper.score}</div>
          </div>
          <div className="mt-2 space-y-1 text-sm text-slate-200">
            <div className="flex justify-between">
              <span>出手角</span>
              <span>
                {scores.upper.releaseAngle.score}{' '}
                <span className="text-slate-400">({scores.upper.releaseAngle.value})</span>
              </span>
            </div>
            <div className="flex justify-between">
              <span>腕部发力</span>
              <span>
                {scores.upper.armPower.score}{' '}
                <span className="text-slate-400">({scores.upper.armPower.value})</span>
              </span>
            </div>
            <div className="flex justify-between">
              <span>随挥保持</span>
              <span>
                {scores.upper.follow.score}{' '}
                <span className="text-slate-400">({scores.upper.follow.value})</span>
              </span>
            </div>
            <div className="flex justify-between">
              <span>肘部路径紧凑</span>
              <span>
                {scores.upper.elbowTight.score}{' '}
                <span className="text-slate-400">({scores.upper.elbowTight.value})</span>
              </span>
            </div>
          </div>
        </div>

        {/* 对齐与平衡 */}
        <div className="bg-slate-900/60 rounded-lg p-4">
          <div className="flex justify-between items-center">
            <div className="text-slate-100 font-medium">对齐与平衡</div>
            <div className="text-cyan-300 text-xl font-semibold">{scores.balance.score}</div>
          </div>
          <div className="mt-2 space-y-1 text-sm text-slate-200">
            <div className="flex justify-between">
              <span>重心稳定（横摆）</span>
              <span>
                {scores.balance.center.score}{' '}
                <span className="text-slate-400">({scores.balance.center.value})</span>
              </span>
            </div>
            <div className="flex justify-between">
              <span>对齐</span>
              <span>
                {scores.balance.align.score}{' '}
                <span className="text-slate-400">({scores.balance.align.value})</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 配置弹层 */}
      {isConfigOpen ? (
        <div className="fixed z-20 left-0 right-0 bottom-0 bg-slate-900/95 border-t border-slate-700 px-4 py-4 rounded-t-xl space-y-3 max-h-[60vh] overflow-y-auto">
          <div className="flex justify-between items-center">
            <div className="text-slate-100 font-medium text-sm">分析配置</div>
            <button
              onClick={() => setIsConfigOpen(false)}
              className="text-slate-300 hover:text-white text-sm"
            >
              关闭
            </button>
          </div>
          <div className="text-slate-400 text-xs">
            模型复杂度：Mediapipe Pose full
            <br />
            平滑强度：OneEuro (1.15 / 0.05)
            <br />
            姿态阈值：0.35
            <br />
            这些先写死在前端，如果你后面要做「后端配置」或者「按球员自动配置」，再把这里接成接口即可。
          </div>
        </div>
      ) : null}
    </div>
  );
}
