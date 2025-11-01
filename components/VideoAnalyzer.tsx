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
import RadarChart from '@/components/RadarChart';

// 和原 scoring.ts 返回的结构保持一致
const EMPTY_SCORE: AnalyzeScore = {
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

// 统一写这里，浏览器里随便加
const MP_CDN_BASES = [
  // 官方
  'https://cdn.jsdelivr.net/npm/@mediapipe/pose',
  // 你的国内镜像可以放这里
  'https://fastly.jsdelivr.net/npm/@mediapipe/pose',
];

// 注入 <script> 的小工具
function injectScript(src: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  return new Promise((resolve, reject) => {
    // 浏览器已经有了就不再加
    const existed = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existed) {
      existed.addEventListener('load', () => resolve());
      existed.addEventListener('error', () => reject());
      // 有可能已经是 loaded
      if ((existed as any).readyState === 'complete') resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject();
    document.head.appendChild(s);
  });
}

export default function VideoAnalyzer() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<PoseEngine | null>(null);
  const mpPoseRef = useRef<any>(null);
  const lastPoseRef = useRef<PoseResult | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [scores, setScores] = useState<AnalyzeScore>(EMPTY_SCORE);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [videoSize, setVideoSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // 可配置评分基线（你可以在页面里改）
  const [scoringBase, setScoringBase] = useState({
    squatKneeDeg: 165, // 下蹲 100 分对应角度
    kneeExtSpeed: 260, // 伸膝 100 分对应度/秒
    releaseDeg: 158,   // 出手角
    followSec: 0.4,    // 随挥保持时间
    elbowTightPct: 2,  // 肘路径紧凑百分比
    balanceCenterPct: 1,
    balanceAlignDeg: 2,
  });

  // 1. 初始化我们自己的 PoseEngine（只是做 keypoint 选人 + one-euro）
  useEffect(() => {
    // 这里不能访问 scoring 里的结构，因此只用 one-euro 的默认
    engineRef.current = new PoseEngine({
      smooth: {
        minCutoff: 1.15,
        beta: 0.05,
        dCutoff: 1.0,
      },
    } as any);
  }, []);

  // 2. 浏览器端挂 Mediapipe Pose（CDN）
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 如果已经有了就算了
    if ((window as any).mpPoseReady) return;

    (async () => {
      for (const base of MP_CDN_BASES) {
        try {
          // 关键：先加载 core，再加载 pose
          await injectScript(`${base}/@mediapipe_pose.js`)
            .catch(() => injectScript(`${base}/pose.js`));

          // 部分版本要一起加载的
          await injectScript(`${base}/pose.js`).catch(() => {});

          (window as any).mpPoseReady = true;
          break;
        } catch (err) {
          // 换下一个
          continue;
        }
      }
    })();
  }, []);

  // 3. 选文件
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setVideoUrl(URL.createObjectURL(f));
    setScores(EMPTY_SCORE);
    setIsAnalyzing(false);
  };

  // 4. 视频元数据
  const handleLoadedMetadata = () => {
    const vid = videoRef.current;
    const cvs = canvasRef.current;
    if (!vid || !cvs) return;
    const w = vid.videoWidth;
    const h = vid.videoHeight;
    setVideoSize({ w, h });
    cvs.width = w;
    cvs.height = h;
  };

  // 5. 画姿态
  const drawPoseOnCanvas = useCallback((person: PoseResult) => {
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
        kp.name?.includes('knee') ||
        kp.name?.includes('ankle') ||
        kp.name?.includes('foot') ||
        kp.name?.includes('heel')
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
  }, []);

  // 6. 点「开始分析」
  const handleStart = async () => {
    if (!videoRef.current) return;

    // Mediapipe 还没好
    if (typeof window !== 'undefined' && !(window as any).mpPoseReady) {
      alert('Mediapipe Pose 还没加载好，再点一次即可');
      return;
    }

    // 初始化 mediapipe 的实例（只初始化一次）
    if (!mpPoseRef.current && typeof window !== 'undefined') {
      const mp: any = (window as any).Pose || (window as any).pose;
      if (!mp) {
        alert('浏览器里没拿到 Mediapipe Pose，稍后再试一次');
        return;
      }
      const pose = new mp.Pose({
        locateFile: (file: string) => {
          // 走第一个 CDN
          return `${MP_CDN_BASES[0]}/${file}`;
        },
      });
      // 姿态回调
      pose.onResults((res: any) => {
        if (!engineRef.current) return;
        if (!res || !res.poseLandmarks) return;

        // Mediapipe 是 0~1 归一化的，这里转成像素
        const vid = videoRef.current;
        const cvs = canvasRef.current;
        if (!vid || !cvs) return;

        const w = cvs.width;
        const h = cvs.height;

        const kp = res.poseLandmarks.map((lm: any, idx: number) => {
          return {
            name: res.poseLandmarks[idx]?.name ?? `kp_${idx}`,
            x: lm.x * w,
            y: lm.y * h,
            z: lm.z,
            score: lm.visibility ?? lm.presence ?? 1,
          };
        });

        const person = engineRef.current!.process({
          persons: [
            {
              id: 0,
              keypoints: kp,
            },
          ],
          ts: performance.now(),
        });

        if (!person) return;

        lastPoseRef.current = person;
        drawPoseOnCanvas(person);
        // 这里用你仓库里的 scoring 逻辑，把算出来的分数直接塞进来
        setScores(scoreFromPose(person));
      });

      mpPoseRef.current = pose;
    }

    // 让视频从头播
    videoRef.current.currentTime = 0;
    await videoRef.current.play();

    setIsAnalyzing(true);

    // 每一帧把视频喂给 mediapipe
    const loop = async () => {
      if (!videoRef.current) return;
      if (videoRef.current.paused || videoRef.current.ended) {
        setIsAnalyzing(false);
        return;
      }

      if (mpPoseRef.current) {
        await mpPoseRef.current.send({ image: videoRef.current });
      }

      requestAnimationFrame(loop);
    };
    loop();
  };

  return (
    <div className="space-y-4">
      {/* 顶部 */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">开始分析你的投篮</h1>
        <p className="text-slate-400 text-sm mt-1">
          BUILD: <span className="font-mono">coach-v3.9-release+wrist+color</span>
        </p>
      </div>

      {/* 上传 + 配置 + 开始 */}
      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-2 bg-slate-900 border border-slate-700 px-4 py-2 rounded cursor-pointer text-slate-100">
          选取文件
          <input
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleFileChange}
          />
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

      {/* 视频+canvas */}
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
              muted
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
      <div className="flex flex-col gap-2">
        <div className="text-slate-100 text-base font-medium">投篮姿态评分雷达图</div>
        <RadarChart
          lower={scores.lower.score}
          upper={scores.upper.score}
          balance={scores.balance.score}
        />
        <div className="text-slate-400 text-xs">
          下肢：{scores.lower.score}，上肢：{scores.upper.score}，平衡：{scores.balance.score}
        </div>
      </div>

      {/* 打分 */}
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

      {/* 配置 */}
      {isConfigOpen ? (
        <div className="fixed inset-x-0 bottom-0 bg-slate-900/95 border-t border-slate-700 p-4 space-y-3 z-50">
          <div className="flex justify-between items-center">
            <div className="text-slate-100 font-medium">分析配置</div>
            <button
              onClick={() => setIsConfigOpen(false)}
              className="text-slate-300 hover:text-white text-sm"
            >
              关闭
            </button>
          </div>

          {/* 每一项 100 分对应的值 */}
          <div className="grid grid-cols-2 gap-3 text-sm text-slate-200">
            <label className="flex flex-col gap-1">
              <span>下蹲 100分对应膝角(°)</span>
              <input
                type="number"
                className="bg-slate-800 rounded px-2 py-1"
                value={scoringBase.squatKneeDeg}
                onChange={(e) =>
                  setScoringBase((p) => ({ ...p, squatKneeDeg: Number(e.target.value) }))
                }
              />
            </label>
            <label className="flex flex-col gap-1">
              <span>伸膝 100分对应速度(°/s)</span>
              <input
                type="number"
                className="bg-slate-800 rounded px-2 py-1"
                value={scoringBase.kneeExtSpeed}
                onChange={(e) =>
                  setScoringBase((p) => ({ ...p, kneeExtSpeed: Number(e.target.value) }))
                }
              />
            </label>
            <label className="flex flex-col gap-1">
              <span>出手 100分对应角度(°)</span>
              <input
                type="number"
                className="bg-slate-800 rounded px-2 py-1"
                value={scoringBase.releaseDeg}
                onChange={(e) =>
                  setScoringBase((p) => ({ ...p, releaseDeg: Number(e.target.value) }))
                }
              />
            </label>
            <label className="flex flex-col gap-1">
              <span>随挥 100分对应时间(s)</span>
              <input
                type="number"
                className="bg-slate-800 rounded px-2 py-1"
                value={scoringBase.followSec}
                onChange={(e) =>
                  setScoringBase((p) => ({ ...p, followSec: Number(e.target.value) }))
                }
              />
            </label>
            <label className="flex flex-col gap-1">
              <span>肘路径紧凑 100分对应(%)</span>
              <input
                type="number"
                className="bg-slate-800 rounded px-2 py-1"
                value={scoringBase.elbowTightPct}
                onChange={(e) =>
                  setScoringBase((p) => ({ ...p, elbowTightPct: Number(e.target.value) }))
                }
              />
            </label>
            <label className="flex flex-col gap-1">
              <span>重心稳定 100分对应(%)</span>
              <input
                type="number"
                className="bg-slate-800 rounded px-2 py-1"
                value={scoringBase.balanceCenterPct}
                onChange={(e) =>
                  setScoringBase((p) => ({ ...p, balanceCenterPct: Number(e.target.value) }))
                }
              />
            </label>
            <label className="flex flex-col gap-1">
              <span>对齐 100分对应(°)</span>
              <input
                type="number"
                className="bg-slate-800 rounded px-2 py-1"
                value={scoringBase.balanceAlignDeg}
                onChange={(e) =>
                  setScoringBase((p) => ({ ...p, balanceAlignDeg: Number(e.target.value) }))
                }
              />
            </label>
          </div>

          <p className="text-slate-500 text-xs">
            这些参数目前只保存在前端，如果要「真正参与评分」请在
            <code className="mx-1">lib/analyze/scoring.ts</code> 里把这些值读进去。
          </p>
        </div>
      ) : null}
    </div>
  );
}
