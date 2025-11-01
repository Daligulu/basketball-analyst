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
import { scoreFromPose, type AnalyzeScore } from '@/lib/analyze/scoring';
import { DEFAULT_ANALYZE_CONFIG, type AnalyzeConfig } from '@/lib/analyze/config';

// 本地初始化用的分数（你原来 UI 那套）
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
  // 建议这块在 scoring 里有就会出来
  suggestions: [],
};

// 这里列出我们「按顺序尝试」的 Mediapipe 地址
// 前三个是你项目自己可以托管在 public/ 下的，不依赖任何 CDN
const MP_CANDIDATES = [
  '/mediapipe/pose.js',
  '/mediapipe/pose/pose.js',
  '/pose/pose.js',
  // 真都没有才走 CDN
  'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5/pose.js',
  'https://cdn.jsdelivr.net/npm/@mediapipe/pose@latest/pose.js',
];

// ---------- 工具：按顺序往 <head> 里插 script ----------
function loadScriptSequential(urls: string[]): Promise<{ ok: boolean; base?: string }> {
  if (typeof window === 'undefined') {
    return Promise.resolve({ ok: false });
  }

  return new Promise((resolve) => {
    const tryOne = (index: number) => {
      if (index >= urls.length) {
        resolve({ ok: false });
        return;
      }

      const full = urls[index];
      // 为了后面 locateFile 能拿到「不带文件名的 base」
      const base = full.replace(/\/pose\.js$/, '').replace(/\/$/, '');

      const s = document.createElement('script');
      s.src = full;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.onload = () => {
        // 成功了就记住这个 base，后面 locateFile 用
        (window as any).__mpPoseBase = base;
        resolve({ ok: true, base });
      };
      s.onerror = () => {
        s.remove();
        tryOne(index + 1);
      };
      document.head.appendChild(s);
    };

    tryOne(0);
  });
}

// ---------- 主组件 ----------
export default function VideoAnalyzer() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 我们自己写的“前景过滤 + 平滑”的小引擎
  const engineRef = useRef<PoseEngine | null>(null);

  // 真正的 mediapipe pose 实例
  const mpPoseRef = useRef<any>(null);
  // 上一帧的姿态（给打分 / 稳定用）
  const lastPoseRef = useRef<PoseResult | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [scores, setScores] = useState<AnalyzeScore>(INITIAL_SCORE);
  const [videoSize, setVideoSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // 评分相关的前端配置（你说要能在面板里改 100 分对应值，这里先塞进 state）
  const [analyzeConfig, setAnalyzeConfig] = useState<AnalyzeConfig>({
    ...DEFAULT_ANALYZE_CONFIG,
  });

  // ---------------- 初始化 PoseEngine（我们自己的 2D 一阶滤波） ----------------
  useEffect(() => {
    engineRef.current = new PoseEngine({
      smooth: {
        minCutoff: 1.15,
        beta: 0.05,
        dCutoff: 1.0,
      },
    } as any);
  }, []);

  // ---------------- 选择视频 ----------------
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const url = URL.createObjectURL(f);
    setVideoUrl(url);
    setScores(INITIAL_SCORE);
    setIsAnalyzing(false);
  };

  // ---------------- 视频加载完之后，拿到宽高，给 canvas 对齐 ----------------
  const handleLoadedMetadata = () => {
    const vid = videoRef.current;
    const cvs = canvasRef.current;
    if (!vid || !cvs) return;
    const vw = vid.videoWidth;
    const vh = vid.videoHeight;
    setVideoSize({ w: vw, h: vh });
    cvs.width = vw;
    cvs.height = vh;
  };

  // ---------------- 关键：保证 mediapipe 已经加载 ----------------
  const ensureMediapipePose = useCallback(async () => {
    if (typeof window === 'undefined') return null;

    // 已经有了就直接用
    const g = window as any;
    if (g.pose?.Pose || g.Pose) {
      return g.pose?.Pose || g.Pose;
    }

    // 如果我们之前加载成功过，会在 window 上留个 base
    const memoBase = (g as any).__mpPoseBase as string | undefined;
    if (memoBase) {
      // 再插一次 pose.js 就行
      const { ok } = await loadScriptSequential([`${memoBase}/pose.js`]);
      if (ok && (g.pose?.Pose || g.Pose)) {
        return g.pose?.Pose || g.Pose;
      }
    }

    // 否则就整套跑一遍
    const { ok } = await loadScriptSequential(MP_CANDIDATES);
    if (!ok) {
      return null;
    }
    return (g.pose?.Pose || g.Pose) ?? null;
  }, []);

  // ---------------- 画姿态到 canvas ----------------
  const drawPoseOnCanvas = useCallback((person: PoseResult | null) => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, cvs.width, cvs.height);

    if (!person) return;

    const minScore = 0.28;
    const radius = 3;

    // 先画点
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

    // 再画线
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

  // ---------------- 点击“开始分析” ----------------
  const handleStart = useCallback(async () => {
    const vid = videoRef.current;
    if (!vid) return;

    // 1) 保证 mediapipe 有了
    const MP_Pose_Ctor = await ensureMediapipePose();
    if (!MP_Pose_Ctor) {
      alert('Mediapipe Pose 还是没加载好，这说明你的 /public 里没有 pose.js，或者外网 CDN 被屏蔽了。可以再点一次，或者把 mediapipe 放到 /public/mediapipe 下。');
      return;
    }

    // 2) 如果还没真正 new 过，就 new 一个
    if (!mpPoseRef.current) {
      const base =
        (typeof window !== 'undefined' && (window as any).__mpPoseBase) ||
        'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5';
      const pose = new MP_Pose_Ctor({
        locateFile: (file: string) => `${base}/${file}`,
      });
      // 最简单的一档配置，避免手机上太卡
      pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      // 关键：这里绑 onResults，一旦识别出一帧，我们就：
      // - 交给我们的 PoseEngine 做人选 + 平滑
      // - 画出来
      // - 做评分
      pose.onResults((res: any) => {
        const engine = engineRef.current;
        const cvs = canvasRef.current;
        if (!engine || !cvs) return;

        const mpPersons =
          res?.poseLandmarks && Array.isArray(res.poseLandmarks)
            ? [
                {
                  keypoints: res.poseLandmarks.map((l: any, idx: number) => ({
                    name: res.poseLandmarks.length > 33 ? `kp_${idx}` : undefined,
                    x: l.x * cvs.width,
                    y: l.y * cvs.height,
                    score: l.visibility ?? 1,
                  })),
                  score: res.poseWorldLandmarks ? 1 : 0.9,
                },
              ]
            : [];

        const person = engine.process({
          persons: mpPersons as any,
          ts: performance.now(),
        });

        lastPoseRef.current = person;

        drawPoseOnCanvas(person);

        // 注意：你库里的 scoreFromPose 只收 1 个参数
        const s = scoreFromPose(person);
        setScores(s);
      });

      mpPoseRef.current = pose;
    }

    // 3) 播放视频，并且把每一帧喂给 mediapipe
    await vid.play();
    setIsAnalyzing(true);

    const loop = async () => {
      const pose = mpPoseRef.current;
      const v = videoRef.current;
      if (!pose || !v) return;

      if (v.paused || v.ended) {
        setIsAnalyzing(false);
        return;
      }

      await pose.send({ image: v });
      requestAnimationFrame(loop);
    };

    loop();
  }, [drawPoseOnCanvas, ensureMediapipePose]);

  // 播放时如果没开识别，也要把当前帧画上（避免空白）
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    const handleTime = () => {
      if (lastPoseRef.current) {
        drawPoseOnCanvas(lastPoseRef.current);
      }
    };

    vid.addEventListener('timeupdate', handleTime);
    vid.addEventListener('seeked', handleTime);

    return () => {
      vid.removeEventListener('timeupdate', handleTime);
      vid.removeEventListener('seeked', handleTime);
    };
  }, [drawPoseOnCanvas]);

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
        <label className="flex items-center gap-2 bg-slate-900 border border-slate-700 px-4 py-2 rounded cursor-pointer text-slate-100">
          选取文件
          <input type="file" accept="video/*" className="hidden" onChange={handleFileChange} />
          {file ? (
            <span className="text-xs text-slate-300 max-w-[140px] truncate">{file.name}</span>
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

      {/* 视频 + 覆盖的姿态 */}
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

      {/* 雷达图（你项目里应该已经有一个 RadarChart / ScoreRadar，保持原结构） */}
      <div className="bg-slate-900/60 rounded-lg p-4">
        <h2 className="text-slate-100 text-sm mb-2">投篮姿态评分雷达图</h2>
        {/* 原生项目里是用 canvas 画的，你可以直接替换成你自己的组件，这里只是示意 */}
        <div className="h-40 flex items-center justify-center text-slate-500 text-xs">
          {/* 你自己的雷达组件可以拿到 scores.lower.score / scores.upper.score / scores.balance.score */}
          下肢：{scores.lower.score}，上肢：{scores.upper.score}，平衡：{scores.balance.score}
        </div>
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

        {/* 优化建议（要看你 scoring.ts 里怎么返回的） */}
        {scores.suggestions && scores.suggestions.length > 0 ? (
          <div className="bg-slate-900/60 rounded-lg p-4">
            <div className="text-slate-100 font-medium mb-2">投篮姿态优化建议</div>
            <ul className="space-y-1 text-sm text-slate-200 list-disc pl-4">
              {scores.suggestions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* 配置面板 */}
      {isConfigOpen ? (
        <div className="fixed inset-x-3 bottom-3 z-50 rounded-lg bg-slate-900/95 border border-slate-700 p-4 space-y-3">
          <div className="flex justify-between items-center">
            <div className="text-slate-100 font-medium text-sm">分析配置</div>
            <button
              onClick={() => setIsConfigOpen(false)}
              className="text-slate-300 hover:text-white text-sm"
            >
              关闭
            </button>
          </div>

          <div className="space-y-2 text-sm text-slate-200">
            <div className="flex justify-between items-center gap-2">
              <span>模型复杂度</span>
              <span className="text-slate-300 text-xs">Mediapipe Pose full</span>
            </div>
            <div className="flex justify-between items-center gap-2">
              <span>平滑强度</span>
              <span className="text-slate-300 text-xs">
                OneEuro ({analyzeConfig.filter.minCutoff} / {analyzeConfig.filter.beta})
              </span>
            </div>
            <div className="flex justify-between items-center gap-2">
              <span>姿态阈值</span>
              <span className="text-slate-300 text-xs">
                {analyzeConfig.minScore.toFixed(2)}
              </span>
            </div>
            <p className="text-slate-500 text-xs">
              这些配置现在先存在前端；你要做「每个子项 100 分对应哪一个实际值」，
              只要把这里的值传给你的 scoring.ts，在计算分数的时候用上就行。
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
