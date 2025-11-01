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
  DEFAULT_ANALYZE_CONFIG,
  type AnalyzeConfig,
} from '@/lib/analyze/config';
import {
  scoreFromPose,
  EMPTY_SCORE,
  type AnalyzeScore,
} from '@/lib/analyze/scoring';
import {
  ALL_CONNECTIONS,
  UPPER_COLOR,
  TORSO_COLOR,
  LOWER_COLOR,
} from '@/lib/pose/skeleton';

// 本地 / 回源地址，先本地、再 /pose、最后 CDN
const MP_BASES = [
  '/mediapipe/pose',
  '/mediapipe',
  'https://cdn.jsdelivr.net/npm/@mediapipe/pose',
];

type MPose = any;

function resolveMP(file: string): string {
  if (typeof window === 'undefined') return '';
  for (const base of MP_BASES) {
    // 不写 @ts-expect-error 了，直接跑
    return `${base}/${file}`;
  }
  return '';
}

// 画到 canvas 上
function drawPoseOnCanvas(
  pose: PoseResult,
  cfg: AnalyzeConfig,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const minScore = cfg.poseScoreThreshold ?? 0.35;
  ctx.clearRect(0, 0, width, height);

  const radius = 3;

  // 画点
  for (const kp of pose.keypoints) {
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

  // 画线
  for (const { pair, color } of ALL_CONNECTIONS) {
    const [aName, bName] = pair;
    const a = pose.keypoints.find((k) => k.name === aName);
    const b = pose.keypoints.find((k) => k.name === bName);
    if (!a || !b) continue;
    if ((a.score ?? 0) < minScore || (b.score ?? 0) < minScore) continue;

    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const maxLen = Math.min(width, height) * 0.65;
    if (dist > maxLen) continue;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

export default function VideoAnalyzer() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<PoseEngine | null>(null);
  const mpPoseRef = useRef<MPose | null>(null);
  const lastPoseRef = useRef<PoseResult | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [scores, setScores] = useState<AnalyzeScore>(EMPTY_SCORE);
  const [cfg, setCfg] = useState<AnalyzeConfig>(DEFAULT_ANALYZE_CONFIG);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [videoSize, setVideoSize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });

  // 1) 初始化引擎
  useEffect(() => {
    engineRef.current = new PoseEngine({
      smooth: cfg.smooth,
    } as any);

    // 浏览器端再去加载 mediapipe
    let cancelled = false;
    (async () => {
      if (typeof window === 'undefined') return;

      // 动态加载 @mediapipe/pose
      const baseJs = resolveMP('pose.js');
      const baseWasm = resolveMP('pose.wasm'); // 这个不一定会用到，但先留着

      // 如果前两个是本地的，其实就是 404 也没关系，我们兜底 CDN
      // 这里不用 ts-ignore，直接用原生 script
      const script = document.createElement('script');
      script.src = baseJs;
      script.async = true;
      script.onload = () => {
        if (cancelled) return;
        const mp = (window as any).Pose;
        const cam = (window as any).Camera;
        const mpNamespace = (window as any).POSE || (window as any).pose;

        // 新版的全局是 window.pose.Pose
        const PoseCtor =
          (window as any).pose?.Pose ||
          (window as any).Pose ||
          mp;

        if (!PoseCtor) {
          console.warn('Mediapipe Pose 没有挂到 window 上');
          return;
        }

        const pose = new PoseCtor({
          locateFile: (file: string) => resolveMP(file),
        });

        // 用最全的模式
        pose.setOptions({
          modelComplexity: 1,
          smoothLandmarks: true,
          enableSegmentation: false,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        mpPoseRef.current = pose;
      };
      script.onerror = () => {
        console.warn('加载 Mediapipe Pose 失败');
      };
      document.body.appendChild(script);
    })();

    return () => {
      cancelled = true;
    };
  }, [cfg.smooth]);

  // 2) 选择文件
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const url = URL.createObjectURL(f);
    setVideoUrl(url);
    setScores(EMPTY_SCORE);
    setIsAnalyzing(false);
  };

  // 3) 视频信息出来后，设置 canvas 尺寸
  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    setVideoSize({ w: v.videoWidth, h: v.videoHeight });
  };

  // 4) 真正开始分析
  const handleStart = async () => {
    const v = videoRef.current;
    const pose = mpPoseRef.current;
    if (!v) return;
    if (!pose) {
      alert('Mediapipe Pose 还没加载好，再点一次即可');
      return;
    }

    v.currentTime = 0;
    await v.play();
    setIsAnalyzing(true);

    // 每帧让 mediapipe 跑一次
    const runFrame = async () => {
      if (!videoRef.current || videoRef.current.paused) {
        setIsAnalyzing(false);
        return;
      }
      await pose.send({ image: videoRef.current });
      requestAnimationFrame(runFrame);
    };

    // 绑定结果
    pose.onResults((res: any) => {
      const engine = engineRef.current;
      const c = canvasRef.current;
      if (!engine || !c) return;
      const ctx = c.getContext('2d');
      if (!ctx) return;

      // mediapipe 的点名字和我们引擎的名字可能不完全一样，
      // 这里假设你已经在 poseEngine 里做了转换，这里只要把 points 塞进去
      const persons = res.poseLandmarks
        ? [
            {
              keypoints: res.poseLandmarks.map((lm: any, idx: number) => ({
                name: lm.name || `p-${idx}`,
                x: lm.x * c.width,
                y: lm.y * c.height,
                score: lm.visibility ?? 0.9,
              })),
              bbox: null,
              score: 1,
            },
          ]
        : [];

      const person = engine.process({
        persons,
        ts: performance.now(),
      });

      if (!person) {
        ctx.clearRect(0, 0, c.width, c.height);
        setScores(EMPTY_SCORE);
        return;
      }

      // 这里做一帧的“附加指标”计算
      // 简单做：用髋部的左右差值估一个横向偏移；用肩髋夹角估一个对齐
      const leftHip = person.keypoints.find((k) => k.name === 'left_hip');
      const rightHip = person.keypoints.find((k) => k.name === 'right_hip');
      const leftShoulder = person.keypoints.find((k) => k.name === 'left_shoulder');
      const rightShoulder = person.keypoints.find((k) => k.name === 'right_shoulder');

      const metrics: any = (person as any).metrics || {};

      // 横向偏移：髋部中心到画面中心的百分比
      if (leftHip && rightHip) {
        const centerX = (leftHip.x + rightHip.x) / 2;
        const frameCenterX = c.width / 2;
        const offsetPx = Math.abs(centerX - frameCenterX);
        const pct = (offsetPx / c.width) * 100;
        metrics.centerOffsetPct = pct;
      }

      // 对齐：肩线和髋线的夹角
      if (leftHip && rightHip && leftShoulder && rightShoulder) {
        const hipDx = rightHip.x - leftHip.x;
        const hipDy = rightHip.y - leftHip.y;
        const shoulderDx = rightShoulder.x - leftShoulder.x;
        const shoulderDy = rightShoulder.y - leftShoulder.y;

        // 两条线之间的角度
        const hipAngle = Math.atan2(hipDy, hipDx);
        const shoulderAngle = Math.atan2(shoulderDy, shoulderDx);
        const diffRad = Math.abs(hipAngle - shoulderAngle);
        const diffDeg = (diffRad * 180) / Math.PI;
        metrics.alignDeg = diffDeg;
      }

      (person as any).metrics = metrics;

      lastPoseRef.current = person;
      drawPoseOnCanvas(person, cfg, ctx, c.width, c.height);
      setScores(scoreFromPose(person, cfg));
    });

    // 开始第一帧
    requestAnimationFrame(runFrame);
  };

  // 配置面板里改配置
  const handleCfgChange = (patch: Partial<AnalyzeConfig>) => {
    setCfg((prev) => ({
      ...prev,
      ...patch,
      targets: {
        ...prev.targets,
        ...(patch as any).targets,
      },
    }));
  };

  return (
    <div className="space-y-4">
      {/* 标题 */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">开始分析你的投篮</h1>
        <p className="text-slate-400 text-sm mt-1">
          BUILD: <span className="font-mono">coach-v3.9-release+wrist+color</span>
        </p>
      </div>

      {/* 上传 + 按钮 */}
      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-2 bg-slate-900 border border-slate-700 px-4 py-2 rounded cursor-pointer text-slate-100">
          选取文件
          <input type="file" accept="video/*" className="hidden" onChange={handleFileChange} />
          {file ? (
            <span className="text-xs text-slate-300 max-w-[140px] truncate">
              {file.name}
            </span>
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

      {/* 视频 + 覆盖层 */}
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
        <h2 className="text-slate-100 text-sm mb-3">投篮姿态评分雷达图</h2>
        {/* 这里保持你原来项目的简单 SVG/Canvas 实现就行，我只把“总分”拿掉 */}
        <div className="relative h-40">
          {/* 你项目里应该有一个 RadarChart 组件，如果有就换成它 */}
          <p className="text-slate-500 text-xs">下肢：{scores.lower.score}，上肢：{scores.upper.score}，平衡：{scores.balance.score}</p>
        </div>
      </div>

      {/* 分数详情 */}
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

        {/* 平衡 */}
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

      {/* 配置面板 */}
      {isConfigOpen ? (
        <div className="bg-slate-900/90 rounded-lg p-4 border border-slate-700 space-y-4">
          <div className="flex justify-between items-center">
            <div className="text-slate-100 font-medium">分析配置</div>
            <button
              onClick={() => setIsConfigOpen(false)}
              className="text-slate-300 hover:text-white text-sm"
            >
              关闭
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-slate-100">
            {/* 下肢 */}
            <div>
              <div className="font-semibold mb-1">下肢</div>
              <label className="flex items-center justify-between gap-2 mb-1">
                <span>下蹲膝角(100分)</span>
                <input
                  type="number"
                  value={cfg.targets.squatKneeAngle}
                  onChange={(e) =>
                    handleCfgChange({
                      targets: {
                        ...cfg.targets,
                        squatKneeAngle: Number(e.target.value),
                      },
                    })
                  }
                  className="bg-slate-800 rounded px-2 py-1 w-20 text-right"
                />
              </label>
              <label className="flex items-center justify-between gap-2 mb-1">
                <span>伸膝速度(100分)</span>
                <input
                  type="number"
                  value={cfg.targets.kneeExtSpeed}
                  onChange={(e) =>
                    handleCfgChange({
                      targets: {
                        ...cfg.targets,
                        kneeExtSpeed: Number(e.target.value),
                      },
                    })
                  }
                  className="bg-slate-800 rounded px-2 py-1 w-20 text-right"
                />
              </label>
            </div>

            {/* 上肢 */}
            <div>
              <div className="font-semibold mb-1">上肢</div>
              <label className="flex items-center justify-between gap-2 mb-1">
                <span>出手角(100分)</span>
                <input
                  type="number"
                  value={cfg.targets.releaseAngle}
                  onChange={(e) =>
                    handleCfgChange({
                      targets: {
                        ...cfg.targets,
                        releaseAngle: Number(e.target.value),
                      },
                    })
                  }
                  className="bg-slate-800 rounded px-2 py-1 w-20 text-right"
                />
              </label>
              <label className="flex items-center justify-between gap-2 mb-1">
                <span>腕部发力角(100分)</span>
                <input
                  type="number"
                  value={cfg.targets.armPower}
                  onChange={(e) =>
                    handleCfgChange({
                      targets: {
                        ...cfg.targets,
                        armPower: Number(e.target.value),
                      },
                    })
                  }
                  className="bg-slate-800 rounded px-2 py-1 w-20 text-right"
                />
              </label>
              <label className="flex items-center justify-between gap-2 mb-1">
                <span>随挥保持(s)</span>
                <input
                  type="number"
                  value={cfg.targets.followDuration}
                  onChange={(e) =>
                    handleCfgChange({
                      targets: {
                        ...cfg.targets,
                        followDuration: Number(e.target.value),
                      },
                    })
                  }
                  className="bg-slate-800 rounded px-2 py-1 w-20 text-right"
                />
              </label>
              <label className="flex items-center justify-between gap-2 mb-1">
                <span>肘部路径紧凑(≤%给满)</span>
                <input
                  type="number"
                  value={cfg.targets.elbowCompactPct}
                  onChange={(e) =>
                    handleCfgChange({
                      targets: {
                        ...cfg.targets,
                        elbowCompactPct: Number(e.target.value),
                      },
                    })
                  }
                  className="bg-slate-800 rounded px-2 py-1 w-20 text-right"
                />
              </label>
            </div>

            {/* 平衡 */}
            <div>
              <div className="font-semibold mb-1">平衡</div>
              <label className="flex items-center justify-between gap-2 mb-1">
                <span>重心偏移 % (100分)</span>
                <input
                  type="number"
                  value={cfg.targets.centerOffsetPct}
                  onChange={(e) =>
                    handleCfgChange({
                      targets: {
                        ...cfg.targets,
                        centerOffsetPct: Number(e.target.value),
                      },
                    })
                  }
                  className="bg-slate-800 rounded px-2 py-1 w-20 text-right"
                />
              </label>
              <label className="flex items-center justify-between gap-2 mb-1">
                <span>重心偏移 % (0分)</span>
                <input
                  type="number"
                  value={cfg.targets.centerOffsetMaxPct}
                  onChange={(e) =>
                    handleCfgChange({
                      targets: {
                        ...cfg.targets,
                        centerOffsetMaxPct: Number(e.target.value),
                      },
                    })
                  }
                  className="bg-slate-800 rounded px-2 py-1 w-20 text-right"
                />
              </label>
              <label className="flex items-center justify-between gap-2 mb-1">
                <span>对齐角度° (100分)</span>
                <input
                  type="number"
                  value={cfg.targets.alignDeg}
                  onChange={(e) =>
                    handleCfgChange({
                      targets: {
                        ...cfg.targets,
                        alignDeg: Number(e.target.value),
                      },
                    })
                  }
                  className="bg-slate-800 rounded px-2 py-1 w-20 text-right"
                />
              </label>
              <label className="flex items-center justify-between gap-2 mb-1">
                <span>对齐角度° (0分)</span>
                <input
                  type="number"
                  value={cfg.targets.alignMaxDeg}
                  onChange={(e) =>
                    handleCfgChange({
                      targets: {
                        ...cfg.targets,
                        alignMaxDeg: Number(e.target.value),
                      },
                    })
                  }
                  className="bg-slate-800 rounded px-2 py-1 w-20 text-right"
                />
              </label>
            </div>
          </div>

          <p className="text-slate-500 text-xs mt-3">
            这些配置现在是在前端生效的，调完立刻影响下一帧的评分；以后你要做“按人保存配置”再把这个对象发回后端即可。
          </p>
        </div>
      ) : null}
    </div>
  );
}
