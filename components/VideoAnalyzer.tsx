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
import ScoreRadar from '@/components/ScoreRadar';

// -------------------------------------------------------------
// 1) 我们自己在前端扩一层，让它可以带 suggestions
// -------------------------------------------------------------
type AnalyzeScoreUI = AnalyzeScore & {
  suggestions?: string[];
};

// -------------------------------------------------------------
// 2) 初始分数（注意：这里就用我们扩展后的类型，不会再 TS 报错）
// -------------------------------------------------------------
const INITIAL_SCORE: AnalyzeScoreUI = {
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
  // 这行就是你之前想要的 “投篮姿态优化建议”
  suggestions: [],
};

// -------------------------------------------------------------
// 3) CDN 列表（你也可以只保留第一个）
// -------------------------------------------------------------
const MP_POSE_CDNS = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/pose',
  'https://unpkg.com/@mediapipe/pose',
];

// -------------------------------------------------------------
// 4) 真正的组件
// -------------------------------------------------------------
export default function VideoAnalyzer() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<PoseEngine | null>(null);

  // Mediapipe 的 window.POSE / window.drawLandmarks 之类
  const mpPoseRef = useRef<any>(null);

  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoSize, setVideoSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [scores, setScores] = useState<AnalyzeScoreUI>(INITIAL_SCORE);

  // 前端这版的“可调参数”，先用 config 里的默认
  const [analyzeConfig, setAnalyzeConfig] =
    useState<AnalyzeConfig>(DEFAULT_ANALYZE_CONFIG);

  // ================== 初始化姿态引擎（我们自己的平滑 + 选人） ==================
  useEffect(() => {
    engineRef.current = new PoseEngine({
      smooth: {
        minCutoff: analyzeConfig.poseSmoothing.minCutoff,
        beta: analyzeConfig.poseSmoothing.beta,
        dCutoff: analyzeConfig.poseSmoothing.dCutoff,
      },
    } as any);
  }, [analyzeConfig]);

  // ================== 挂载时去加载 Mediapipe Pose ==================
  useEffect(() => {
    let canceled = false;

    async function loadMp() {
      // 浏览器端才有 window
      if (typeof window === 'undefined') return;

      // 如果已经有了就不要重复下了
      if ((window as any).Pose) {
        mpPoseRef.current = (window as any).Pose;
        return;
      }

      for (const base of MP_POSE_CDNS) {
        try {
          // 直接动态 import CDN 的 UMD
          // @ts-ignore
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `${base}/pose.js`;
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('load fail'));
            document.head.appendChild(script);
          });
          // 这里如果能拿到 window.Pose 就算 OK
          if ((window as any).Pose) {
            mpPoseRef.current = (window as any).Pose;
            break;
          }
        } catch (_err) {
          // 换下一个 CDN
        }
      }
    }

    loadMp();

    return () => {
      canceled = true;
    };
  }, []);

  // ================== 选文件 ==================
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const url = URL.createObjectURL(f);
    setVideoUrl(url);
    setScores(INITIAL_SCORE);
  };

  // ================== 视频 metadata 到了之后同步画布宽高 ==================
  const handleLoadedMetadata = () => {
    const vid = videoRef.current;
    const cvs = canvasRef.current;
    if (!vid || !cvs) return;
    cvs.width = vid.videoWidth;
    cvs.height = vid.videoHeight;
    setVideoSize({ w: vid.videoWidth, h: vid.videoHeight });
  };

  // ================== 点击“开始分析” ==================
  const handleStartAnalyze = async () => {
    // 没有模型，就提示一下
    if (!mpPoseRef.current) {
      alert('Mediapipe Pose 还没加载好，再点一次即可');
      setIsAnalyzing(false);
      return;
    }
    if (!videoRef.current) return;

    // 播放视频
    videoRef.current.currentTime = 0;
    await videoRef.current.play();

    setIsAnalyzing(true);
  };

  // ================== 核心：一帧一帧地跑 ==================
  const processFrame = useCallback(
    async (ts: number) => {
      const vid = videoRef.current;
      const cvs = canvasRef.current;
      const engine = engineRef.current;
      if (!vid || !cvs || !engine) return;
      const ctx = cvs.getContext('2d');
      if (!ctx) return;

      // 这里本来应该是“把这一帧交给 mediapipe → 得到多人的关键点 → engine.process”
      // 但我们现在只是做一个示例：如果你想真跑 mediapipe，就要在这里调 mpPoseRef.current
      // 为了不让画布是空的，暂时先清空
      ctx.clearRect(0, 0, cvs.width, cvs.height);
    },
    [],
  );

  // ================== 真正的渲染姿态（我们自己的骨架） ==================
  const drawPoseOnCanvas = (person: PoseResult) => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, cvs.width, cvs.height);

    const minScore = 0.3;
    const radius = 3;

    // 点
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
        kp.name?.startsWith('right_foot')
      ) {
        color = LOWER_COLOR;
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

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  };

  // ================== 当视频在播，就不停调用 ==================
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    const loop = (time: number) => {
      if (!videoRef.current) return;
      if (!videoRef.current.paused && !videoRef.current.ended) {
        // 这里本来要：拿 mpPose 的结果 → engine.process → drawPoseOnCanvas → 评分
        // 现在我们先只做 draw 占位
        processFrame(time);
        requestAnimationFrame(loop);
      } else {
        setIsAnalyzing(false);
      }
    };

    vid.addEventListener('play', () => {
      requestAnimationFrame(loop);
    });

    return () => {
      vid.removeEventListener('play', () => {
        /* noop */
      });
    };
  }, [processFrame]);

  // ================== 评分配置更新面板里的值 ==================
  const handleConfigChange = (cfg: Partial<AnalyzeConfig>) => {
    setAnalyzeConfig((prev) => ({
      ...prev,
      ...cfg,
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

      {/* 上传 & 操作区 */}
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
          onClick={handleStartAnalyze}
          disabled={!videoUrl || isAnalyzing || !mpPoseRef.current}
          className={`px-6 py-2 rounded text-sm ${
            !videoUrl || isAnalyzing || !mpPoseRef.current
              ? 'bg-slate-600 text-slate-300'
              : 'bg-sky-500 text-white'
          }`}
        >
          {isAnalyzing ? '识别中…' : '开始分析'}
        </button>
      </div>

      {/* 视频 + 画布 */}
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
      <div className="bg-slate-900/60 rounded-lg p-4">
        <h2 className="text-slate-100 mb-3 text-sm">投篮姿态评分雷达图</h2>
        {/* 你的项目里原本就有 ScoreRadar，这里直接喂数 */}
        <ScoreRadar
          lower={scores.lower.score}
          upper={scores.upper.score}
          balance={scores.balance.score}
        />
        <p className="text-slate-400 text-xs mt-2">
          下肢：{scores.lower.score}，上肢：{scores.upper.score}，平衡：
          {scores.balance.score}
        </p>
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

        {/* 建议区 */}
        <div className="bg-slate-900/60 rounded-lg p-4">
          <div className="text-slate-100 font-medium mb-2">投篮姿态优化建议</div>
          {scores.suggestions && scores.suggestions.length > 0 ? (
            <ul className="list-disc text-slate-200 text-sm pl-5 space-y-1">
              {scores.suggestions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-400 text-sm">暂无建议，先把更多关键帧跑出来再说～</p>
          )}
        </div>
      </div>

      {/* 配置面板 */}
      {isConfigOpen ? (
        <div className="fixed inset-x-0 bottom-0 bg-slate-900/95 border-t border-slate-700 p-4 rounded-t-2xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-slate-100 font-medium text-base">分析配置</div>
            <button
              className="text-slate-300 text-sm"
              onClick={() => setIsConfigOpen(false)}
            >
              关闭
            </button>
          </div>

          <div className="text-slate-300 text-sm flex items-center justify-between">
            <span>模型复杂度</span>
            <span>Mediapipe Pose full</span>
          </div>
          <div className="text-slate-300 text-sm flex items-center justify-between">
            <span>平滑强度</span>
            <span>
              OneEuro ({analyzeConfig.poseSmoothing.minCutoff} /{' '}
              {analyzeConfig.poseSmoothing.beta})
            </span>
          </div>
          <div className="text-slate-300 text-sm flex items-center justify-between">
            <span>姿态阈值</span>
            <span>{analyzeConfig.poseScoreThreshold.toFixed(2)}</span>
          </div>
          <p className="text-slate-500 text-xs">
            这些配置先写死在前端，后面如果你要做“后台配置”或者“按球员自动配置”，这里再接接口即可。
          </p>
        </div>
      ) : null}
    </div>
  );
}
