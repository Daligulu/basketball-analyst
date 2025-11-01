// components/VideoAnalyzer.tsx
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PoseEngine, type PoseResult } from '@/lib/pose/poseEngine';
import ScoreRadar from '@/components/ScoreRadar';
import {
  loadAnalyzeConfig,
  saveAnalyzeConfig,
  DEFAULT_ANALYZE_CONFIG,
  type AnalyzeConfig,
} from '@/lib/analyze/config';
import { scoreFromPose, EMPTY_SCORE, type AnalyzeScore } from '@/lib/analyze/scoring';
import {
  ALL_CONNECTIONS,
  UPPER_COLOR,
  TORSO_COLOR,
  LOWER_COLOR,
} from '@/lib/pose/skeleton';

type MPose = any;

// 本地优先的尝试路径（给你本地开发用）
// 线上 vercel 我们会自动走 CDN
const MP_LOCAL_BASES = ['/mediapipe/pose', '/pose'];
const MP_CDN_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5';

async function loadScriptOnce(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('no document'));
      return;
    }
    if (document.querySelector(`script[data-src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.dataset.src = src;
    s.onload = () => resolve();
    s.onerror = (e) => reject(e);
    document.body.appendChild(s);
  });
}

// 把真正的“加载 mediapipe pose.js”拆出来
async function ensureMediapipePoseLoaded(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if ((window as any).Pose) return true;

  // 本地开发：可以走本地
  const isLocalhost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  if (isLocalhost) {
    for (const base of MP_LOCAL_BASES) {
      try {
        await loadScriptOnce(`${base}/pose.js`);
        if ((window as any).Pose) return true;
      } catch {
        // 失败就换下一个
      }
    }
  }

  // vercel 或本地都没有，就走 CDN
  try {
    await loadScriptOnce(`${MP_CDN_BASE}/pose.js`);
    return !!(window as any).Pose;
  } catch {
    return false;
  }
}

export default function VideoAnalyzer() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mpPoseRef = useRef<MPose | null>(null);
  const engineRef = useRef<PoseEngine | null>(null);
  const lastPoseRef = useRef<PoseResult | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [poseReady, setPoseReady] = useState(false);
  const [scores, setScores] = useState<AnalyzeScore>(EMPTY_SCORE);
  const [cfg, setCfg] = useState<AnalyzeConfig>(() => loadAnalyzeConfig() ?? DEFAULT_ANALYZE_CONFIG);
  const [showConfig, setShowConfig] = useState(false);
  const [videoSize, setVideoSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // 1. 初始化平滑引擎（只做关键点选人 + OneEuro）
  useEffect(() => {
    engineRef.current = new PoseEngine({
      smooth: {
        minCutoff: cfg.pose.smoothMinCutoff,
        beta: cfg.pose.smoothBeta,
        dCutoff: 1.0,
      },
      minScore: cfg.pose.kpMinScore,
    });
  }, [cfg.pose.smoothMinCutoff, cfg.pose.smoothBeta, cfg.pose.kpMinScore]);

  // 2. 页面一进来就先加载 mediapipe（防止你点按钮才去下 CDN）
  useEffect(() => {
    let destroy = false;
    (async () => {
      if (typeof window === 'undefined') return;
      const ok = await ensureMediapipePoseLoaded();
      if (destroy) return;
      if (!ok) {
        setPoseReady(false);
        return;
      }

      const PoseCtor = (window as any).Pose as any;

      // 这里是关键：Vercel 上统一走 CDN；本地才走 /mediapipe/pose
      const isLocalhost =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

      const pose = new PoseCtor({
        locateFile: (file: string) => {
          if (isLocalhost) {
            // 本地想从 public/mediapipe/pose 走
            return `/mediapipe/pose/${file}`;
          }
          // 线上全部走 CDN，避免 404 卡住
          return `${MP_CDN_BASE}/${file}`;
        },
      });

      pose.setOptions({
        // 你可以在面板里切 lite / full
        modelComplexity: cfg.pose.modelComplexity === 'lite' ? 0 : 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      // 收到结果 → 走我们自己的平滑 + 评分 + 画图
      pose.onResults((res: any) => {
        const landmarks: Array<any> | undefined = res.poseLandmarks;
        if (!landmarks || !engineRef.current || !videoRef.current || !canvasRef.current) {
          return;
        }

        // mediapipe 是 33 个点，转成我们统一的结构
        const v = videoRef.current;
        const persons = [
          {
            score: 1,
            keypoints: landmarks.map((lm, idx) => {
              const names = [
                'nose',
                'left_eye_inner',
                'left_eye',
                'left_eye_outer',
                'right_eye_inner',
                'right_eye',
                'right_eye_outer',
                'left_ear',
                'right_ear',
                'mouth_left',
                'mouth_right',
                'left_shoulder',
                'right_shoulder',
                'left_elbow',
                'right_elbow',
                'left_wrist',
                'right_wrist',
                'left_pinky',
                'right_pinky',
                'left_index',
                'right_index',
                'left_thumb',
                'right_thumb',
                'left_hip',
                'right_hip',
                'left_knee',
                'right_knee',
                'left_ankle',
                'right_ankle',
                'left_heel',
                'right_heel',
                'left_foot_index',
                'right_foot_index',
              ] as const;
              const name = names[idx] ?? `kp_${idx}`;
              return {
                name,
                x: lm.x * v.videoWidth,
                y: lm.y * v.videoHeight,
                z: lm.z,
                score: lm.visibility ?? 1,
              };
            }),
          },
        ];

        const person = engineRef.current.process({
          persons,
          ts: performance.now(),
        });

        lastPoseRef.current = person;
        drawPoseOnCanvas(person, cfg);
        setScores(scoreFromPose(person, cfg));
      });

      mpPoseRef.current = pose;
      setPoseReady(true);
    })();

    return () => {
      destroy = true;
    };
  }, [cfg]);

  // 3. 画姿态的函数
  const drawPoseOnCanvas = (person: PoseResult | null, curCfg: AnalyzeConfig) => {
    const cvs = canvasRef.current;
    const vid = videoRef.current;
    if (!cvs || !vid) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, cvs.width, cvs.height);
    if (!person) return;

    const minScore = curCfg.pose.kpMinScore;
    const r = 3;

    // 点
    for (const kp of person.keypoints) {
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
        kp.name.startsWith('left_knee') ||
        kp.name.startsWith('right_knee') ||
        kp.name.startsWith('left_ankle') ||
        kp.name.startsWith('right_ankle') ||
        kp.name.startsWith('left_heel') ||
        kp.name.startsWith('right_heel') ||
        kp.name.startsWith('left_foot') ||
        kp.name.startsWith('right_foot')
      ) {
        color = LOWER_COLOR;
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(kp.x, kp.y, r, 0, Math.PI * 2);
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
      if (dist > Math.min(cvs.width, cvs.height) * 0.7) continue;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  };

  // 4. 播放视频后，循环送帧给 mediapipe
  const analyzeLoop = useCallback(async () => {
    const vid = videoRef.current;
    const pose = mpPoseRef.current;
    if (!vid || !pose) return;

    // 用 RAF + await 的组合
    const tick = async () => {
      const v = videoRef.current;
      const p = mpPoseRef.current;
      if (!v || !p) {
        setIsAnalyzing(false);
        return;
      }
      if (v.paused || v.ended) {
        setIsAnalyzing(false);
        return;
      }

      try {
        await p.send({ image: v });
      } catch (err) {
        console.error('mediapipe pose send error:', err);
        setIsAnalyzing(false);
        return;
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }, []);

  // 5. 选文件
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    setFile(f);
    setVideoUrl(url);
    setScores(EMPTY_SCORE);
    setIsAnalyzing(false);
  };

  // 6. 视频尺寸同步到画布
  const handleLoadedMetadata = () => {
    const vid = videoRef.current;
    const cvs = canvasRef.current;
    if (!vid || !cvs) return;
    cvs.width = vid.videoWidth;
    cvs.height = vid.videoHeight;
    setVideoSize({ w: vid.videoWidth, h: vid.videoHeight });
  };

  // 7. 开始分析
  const handleStart = async () => {
    if (!videoRef.current) return;
    if (!poseReady) {
      alert('Mediapipe Pose 还没加载好，再点一次即可；或把 mediapipe 放到 /public/mediapipe/pose 下。');
      return;
    }
    setIsAnalyzing(true);
    videoRef.current.currentTime = 0;
    await videoRef.current.play();
    analyzeLoop();
  };

  // 8. 配置变化要持久化 + 重新评分
  const updateCfg = (next: AnalyzeConfig) => {
    setCfg(next);
    saveAnalyzeConfig(next);
    setScores(scoreFromPose(lastPoseRef.current, next));
  };

  return (
    <div className="space-y-5">
      {/* 顶部标题 + 配置按钮 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">开始分析你的投篮</h1>
          <p className="text-slate-400 text-sm mt-1">
            BUILD: <span className="font-mono">coach-v3.9-release+wrist+color</span>
          </p>
        </div>
        <button
          onClick={() => setShowConfig((s) => !s)}
          className="px-4 py-2 rounded bg-emerald-500 text-white text-sm"
        >
          配置
        </button>
      </div>

      {/* 上传 & 操作 */}
      <div className="flex gap-3 flex-wrap">
        <label className="flex items-center gap-2 bg-slate-900 border border-slate-700 px-4 py-2 rounded cursor-pointer text-slate-100">
          选取文件
          <input type="file" accept="video/*" className="hidden" onChange={handleFileChange} />
          {file ? (
            <span className="text-xs text-slate-300 max-w-[160px] truncate">{file.name}</span>
          ) : null}
        </label>
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
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
          </>
        ) : (
          <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
            请先上传视频
          </div>
        )}
      </div>

      {/* 雷达图（不含总分） */}
      <ScoreRadar lower={scores.lower.score} upper={scores.upper.score} balance={scores.balance.score} />

      {/* 评分面板 */}
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
        <div className="bg-slate-900/60 rounded-lg p-4 mb-6">
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

      {/* 配置面板（底部抽屉） */}
      {showConfig ? (
        <div className="fixed inset-x-0 bottom-0 bg-slate-900/95 border-t border-slate-700 px-4 py-4 space-y-3 max-h-[75vh] overflow-y-auto">
          <div className="flex justify-between items-center mb-1">
            <div className="text-slate-100 font-medium text-sm">分析配置</div>
            <button
              onClick={() => setShowConfig(false)}
              className="text-slate-300 hover:text-white text-sm"
            >
              关闭
            </button>
          </div>

          {/* 模型 & 姿态 */}
          <div className="grid grid-cols-2 gap-3 text-xs text-slate-100">
            <div>
              <div className="text-slate-300 mb-1">模型复杂度</div>
              <select
                className="bg-slate-800/80 rounded px-2 py-1 w-full"
                value={cfg.pose.modelComplexity}
                onChange={(e) =>
                  updateCfg({
                    ...cfg,
                    pose: { ...cfg.pose, modelComplexity: e.target.value as 'lite' | 'full' },
                  })
                }
              >
                <option value="lite">Mediapipe Pose lite</option>
                <option value="full">Mediapipe Pose full</option>
              </select>
            </div>
            <div>
              <div className="text-slate-300 mb-1">姿态阈值</div>
              <input
                type="number"
                step="0.01"
                className="bg-slate-800/80 rounded px-2 py-1 w-full"
                value={cfg.pose.kpMinScore}
                onChange={(e) =>
                  updateCfg({
                    ...cfg,
                    pose: { ...cfg.pose, kpMinScore: Number(e.target.value) },
                  })
                }
              />
            </div>
            <div>
              <div className="text-slate-300 mb-1">OneEuro minCutoff</div>
              <input
                type="number"
                step="0.01"
                className="bg-slate-800/80 rounded px-2 py-1 w-full"
                value={cfg.pose.smoothMinCutoff}
                onChange={(e) =>
                  updateCfg({
                    ...cfg,
                    pose: { ...cfg.pose, smoothMinCutoff: Number(e.target.value) },
                  })
                }
              />
            </div>
            <div>
              <div className="text-slate-300 mb-1">OneEuro beta</div>
              <input
                type="number"
                step="0.01"
                className="bg-slate-800/80 rounded px-2 py-1 w-full"
                value={cfg.pose.smoothBeta}
                onChange={(e) =>
                  updateCfg({
                    ...cfg,
                    pose: { ...cfg.pose, smoothBeta: Number(e.target.value) },
                  })
                }
              />
            </div>
          </div>

          {/* 评分 100 分对应值 */}
          <div className="text-slate-300 text-xs mt-2 mb-1">评分 100 分对应的实际值</div>
          <div className="grid grid-cols-2 gap-3 text-xs text-slate-100">
            {/* 下肢 */}
            <div>
              <div className="text-slate-400 mb-1">下蹲膝角(°) = 100 分</div>
              <input
                type="number"
                className="bg-slate-800/80 rounded px-2 py-1 w-full"
                value={cfg.thresholds.lower.squat100}
                onChange={(e) =>
                  updateCfg({
                    ...cfg,
                    thresholds: {
                      ...cfg.thresholds,
                      lower: {
                        ...cfg.thresholds.lower,
                        squat100: Number(e.target.value),
                      },
                    },
                  })
                }
              />
            </div>
            <div>
              <div className="text-slate-400 mb-1">伸膝速度(°/s) = 100 分</div>
              <input
                type="number"
                className="bg-slate-800/80 rounded px-2 py-1 w-full"
                value={cfg.thresholds.lower.kneeExt100}
                onChange={(e) =>
                  updateCfg({
                    ...cfg,
                    thresholds: {
                      ...cfg.thresholds,
                      lower: {
                        ...cfg.thresholds.lower,
                        kneeExt100: Number(e.target.value),
                      },
                    },
                  })
                }
              />
            </div>

            {/* 上肢 */}
            <div>
              <div className="text-slate-400 mb-1">出手角(°) = 100 分</div>
              <input
                type="number"
                className="bg-slate-800/80 rounded px-2 py-1 w-full"
                value={cfg.thresholds.upper.releaseAngle100}
                onChange={(e) =>
                  updateCfg({
                    ...cfg,
                    thresholds: {
                      ...cfg.thresholds,
                      upper: {
                        ...cfg.thresholds.upper,
                        releaseAngle100: Number(e.target.value),
                      },
                    },
                  })
                }
              />
            </div>
            <div>
              <div className="text-slate-400 mb-1">腕部发力角(°) = 100 分</div>
              <input
                type="number"
                className="bg-slate-800/80 rounded px-2 py-1 w-full"
                value={cfg.thresholds.upper.armPower100}
                onChange={(e) =>
                  updateCfg({
                    ...cfg,
                    thresholds: {
                      ...cfg.thresholds,
                      upper: {
                        ...cfg.thresholds.upper,
                        armPower100: Number(e.target.value),
                      },
                    },
                  })
                }
              />
            </div>
            <div>
              <div className="text-slate-400 mb-1">随挥保持(s) = 100 分</div>
              <input
                type="number"
                step="0.01"
                className="bg-slate-800/80 rounded px-2 py-1 w-full"
                value={cfg.thresholds.upper.follow100}
                onChange={(e) =>
                  updateCfg({
                    ...cfg,
                    thresholds: {
                      ...cfg.thresholds,
                      upper: {
                        ...cfg.thresholds.upper,
                        follow100: Number(e.target.value),
                      },
                    },
                  })
                }
              />
            </div>
            <div>
              <div className="text-slate-400 mb-1">肘部路径紧凑(%) = 100 分</div>
              <input
                type="number"
                step="0.01"
                className="bg-slate-800/80 rounded px-2 py-1 w-full"
                value={cfg.thresholds.upper.elbowTight100}
                onChange={(e) =>
                  updateCfg({
                    ...cfg,
                    thresholds: {
                      ...cfg.thresholds,
                      upper: {
                        ...cfg.thresholds.upper,
                        elbowTight100: Number(e.target.value),
                      },
                    },
                  })
                }
              />
            </div>

            {/* 平衡 */}
            <div>
              <div className="text-slate-400 mb-1">重心横向偏移(%) ≤ = 100 分</div>
              <input
                type="number"
                step="0.01"
                className="bg-slate-800/80 rounded px-2 py-1 w-full"
                value={cfg.thresholds.balance.center100}
                onChange={(e) =>
                  updateCfg({
                    ...cfg,
                    thresholds: {
                      ...cfg.thresholds,
                      balance: {
                        ...cfg.thresholds.balance,
                        center100: Number(e.target.value),
                      },
                    },
                  })
                }
              />
            </div>
            <div>
              <div className="text-slate-400 mb-1">对齐误差(°) ≤ = 100 分</div>
              <input
                type="number"
                step="0.01"
                className="bg-slate-800/80 rounded px-2 py-1 w-full"
                value={cfg.thresholds.balance.align100}
                onChange={(e) =>
                  updateCfg({
                    ...cfg,
                    thresholds: {
                      ...cfg.thresholds,
                      balance: {
                        ...cfg.thresholds.balance,
                        align100: Number(e.target.value),
                      },
                    },
                  })
                }
              />
            </div>
          </div>

          <p className="text-slate-500 text-[10px] mt-3 mb-1">
            为了移动端更快：把 <code>@mediapipe/pose@0.5</code> 里的文件拷到
            <code>public/mediapipe/pose</code>，本地就走本地，不用下 CDN 了。
          </p>
        </div>
      ) : null}
    </div>
  );
}
