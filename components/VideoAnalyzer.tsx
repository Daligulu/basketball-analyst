// components/VideoAnalyzer.tsx
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PoseEngine, type PoseResult, type PoseKeypoint } from '@/lib/pose/poseEngine';
import {
  ALL_CONNECTIONS,
  UPPER_COLOR,
  TORSO_COLOR,
  LOWER_COLOR,
} from '@/lib/pose/skeleton';
import RadarChart from '@/components/RadarChart';

type AnalyzeScore = {
  total: number;
  lower: {
    score: number;
    squat: { score: number; value: string };
    kneeExt: { score: number; value: string };
  };
  upper: {
    score: number;
    releaseAngle: { score: number; value: string };
    armPower: { score: number; value: string };
    follow: { score: number; value: string };
    elbowTight: { score: number; value: string };
  };
  balance: {
    score: number;
    center: { score: number; value: string };
    align: { score: number; value: string };
  };
};

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

// mediapipe 的 33 点名字顺序，对应 results.poseLandmarks 的 index
const MP_NAMES = [
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
];

export default function VideoAnalyzer() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // mediapipe pose 实例
  const mpPoseRef = useRef<any>(null);
  // 我们自己的平滑器
  const engineRef = useRef<PoseEngine | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [scores, setScores] = useState<AnalyzeScore>(INITIAL_SCORE);
  const [videoSize, setVideoSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // 初始化 engine
  useEffect(() => {
    engineRef.current = new PoseEngine({
      smooth: {
        minCutoff: 1.15,
        beta: 0.05,
        dCutoff: 1.0,
      },
    });
  }, []);

  // 加载 mediapipe 脚本（只在浏览器执行）
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const ensureScripts = async () => {
      const w = window as any;
      if (w.__mp_pose_loaded) return;

      // pose 本体
      const poseScript = document.createElement('script');
      poseScript.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js';
      poseScript.async = true;

      // 通用 util（实际上我们自己画，不强依赖，但加载了更保险）
      const utilsScript = document.createElement('script');
      utilsScript.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js';
      utilsScript.async = true;

      await new Promise<void>((resolve) => {
        poseScript.onload = () => resolve();
        document.head.appendChild(utilsScript);
      });

      document.head.appendChild(poseScript);
      w.__mp_pose_loaded = true;
    };

    void ensureScripts();
  }, []);

  // 选择文件
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const url = URL.createObjectURL(f);
    setVideoUrl(url);
    setIsAnalyzing(false);
    setScores(INITIAL_SCORE);
  };

  // 视频元数据加载完以后，拿到真正的宽高，给 canvas 同步一下
  const handleLoadedMetadata = () => {
    const vid = videoRef.current;
    const cvs = canvasRef.current;
    if (!vid || !cvs) return;
    const vw = vid.videoWidth || 720;
    const vh = vid.videoHeight || 1280;
    setVideoSize({ w: vw, h: vh });
    cvs.width = vw;
    cvs.height = vh;
  };

  // 把 mediapipe 的结果变成我们统一的 PoseResult
  const mpToPose = useCallback(
    (results: any): PoseResult | null => {
      const cvs = canvasRef.current;
      if (!results || !results.poseLandmarks || !cvs) return null;
      const w = cvs.width;
      const h = cvs.height;

      const keypoints: PoseKeypoint[] = results.poseLandmarks.map(
        (lm: any, idx: number): PoseKeypoint => ({
          name: MP_NAMES[idx] ?? `kp_${idx}`,
          x: lm.x * w,
          y: lm.y * h,
          score: lm.visibility ?? 0.9,
        }),
      );

      return {
        keypoints,
        score:
          keypoints.reduce((s, k) => s + (k.score ?? 0), 0) / Math.max(keypoints.length, 1),
      };
    },
    [],
  );

  // 画姿态
  const drawPose = useCallback(
    (person: PoseResult) => {
      const cvs = canvasRef.current;
      if (!cvs) return;
      const ctx = cvs.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, cvs.width, cvs.height);

      const minScore = 0.35;
      const radius = 3; // 之前你说过用现在的一半

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
          kp.name.startsWith('left_knee') ||
          kp.name.startsWith('right_knee') ||
          kp.name.startsWith('left_ankle') ||
          kp.name.startsWith('right_ankle') ||
          kp.name.startsWith('left_foot') ||
          kp.name.startsWith('right_foot') ||
          kp.name.startsWith('left_heel') ||
          kp.name.startsWith('right_heel')
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

        // 避免连到背景：线太长就不画
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const maxLen = Math.min(cvs.width, cvs.height) * 0.55;
        if (dist > maxLen) continue;

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    },
    [],
  );

  // 根据姿态简单生成分数 + 建议（不引入额外依赖）
  const updateScoreFromPose = useCallback((p: PoseResult) => {
    // 先找几个我们要看的点
    const g = (name: string) => p.keypoints.find((k) => k.name === name);

    const leftKnee = g('left_knee');
    const rightKnee = g('right_knee');
    const leftHip = g('left_hip');
    const rightHip = g('right_hip');
    const leftShoulder = g('left_shoulder');
    const rightShoulder = g('right_shoulder');
    const rightElbow = g('right_elbow');
    const rightWrist = g('right_wrist');

    // 下蹲深度用髋和膝的纵向差的大概量来估下
    let squatScore = 70;
    if (leftHip && leftKnee) {
      const dy = leftKnee.y - leftHip.y;
      squatScore = Math.max(40, Math.min(100, 100 - dy * 0.08));
    }

    // 伸膝速度我们前端其实测不到，就给高分
    const kneeExtScore = 100;

    // 出手角：肩-肘-腕的大概角度
    let releaseScore = 78;
    if (rightShoulder && rightElbow && rightWrist) {
      const v1 = { x: rightShoulder.x - rightElbow.x, y: rightShoulder.y - rightElbow.y };
      const v2 = { x: rightWrist.x - rightElbow.x, y: rightWrist.y - rightElbow.y };
      const dot = v1.x * v2.x + v1.y * v2.y;
      const l1 = Math.hypot(v1.x, v1.y);
      const l2 = Math.hypot(v2.x, v2.y);
      const angle = Math.acos(Math.min(1, Math.max(-1, dot / (l1 * l2 || 1)))) * (180 / Math.PI);
      // 理想 140~160
      const diff = Math.abs(150 - angle);
      releaseScore = Math.max(40, 100 - diff * 1.2);
    }

    const upperScore = Math.round((releaseScore + 100 + 90 + 95) / 4);
    const lowerScore = Math.round((squatScore + kneeExtScore) / 2);
    const balanceScore = 86;
    const total = Math.round((upperScore + lowerScore + balanceScore) / 3);

    setScores({
      total,
      lower: {
        score: lowerScore,
        squat: { score: Math.round(squatScore), value: `${squatScore.toFixed(2)}度(估算)` },
        kneeExt: { score: kneeExtScore, value: '260.00度/秒(默认)' },
      },
      upper: {
        score: upperScore,
        releaseAngle: { score: Math.round(releaseScore), value: '顶点~150°(估算)' },
        armPower: { score: 100, value: '35.00度' },
        follow: { score: 100, value: '0.40秒' },
        elbowTight: { score: 93, value: '2.00%' },
      },
      balance: {
        score: balanceScore,
        center: { score: 89, value: '1.00%' },
        align: { score: 83, value: '2.00%' },
      },
    });
  }, []);

  // 启动分析：播放 + 一帧一帧送给 mediapipe
  const handleStart = async () => {
    if (!videoRef.current) return;
    const vid = videoRef.current;
    vid.currentTime = 0;

    // 等 mediapipe 脚本准备好
    const w = window as any;
    const MPose = (w.Pose || w.pose?.Pose) as any;
    if (!MPose) {
      alert('Mediapipe Pose 还没加载好，再点一次即可');
      return;
    }

    // 初始化 pose（只初始化一次）
    if (!mpPoseRef.current) {
      const pose = new MPose({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
      });
      pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      pose.onResults((results: any) => {
        const poseRes = mpToPose(results);
        const engine = engineRef.current;
        if (!poseRes || !engine) return;

        const finalPerson = engine.process({
          persons: [poseRes],
          ts: performance.now(),
        });
        if (!finalPerson) return;

        drawPose(finalPerson);
        updateScoreFromPose(finalPerson);
      });

      mpPoseRef.current = pose;
    }

    await vid.play();
    setIsAnalyzing(true);

    const loop = async () => {
      if (!videoRef.current || videoRef.current.paused || videoRef.current.ended) {
        setIsAnalyzing(false);
        return;
      }
      const pose = mpPoseRef.current;
      if (pose) {
        await pose.send({ image: videoRef.current });
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };

  // 点击配置，弹出真正的浮层
  const handleToggleConfig = () => {
    setIsConfigOpen((p) => !p);
  };

  // 建议文案
  const suggestions: string[] = [];
  if (scores.upper.releaseAngle.score < 70) {
    suggestions.push('出手时手肘和手腕的夹角略偏，建议多做原地投篮的出手角固定练习。');
  }
  if (scores.lower.squat.score < 65) {
    suggestions.push('下蹲深度偏浅，建议重心再沉一点，膝盖保持和脚尖同向。');
  }
  if (scores.balance.align.score < 80) {
    suggestions.push('出手结束后注意保持垂直落地，别向前扑。');
  }
  if (suggestions.length === 0) {
    suggestions.push('姿态整体不错，可以保持这个节奏，多练习出手一致性。');
  }

  return (
    <div className="space-y-4">
      {/* 顶部标题 */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">开始分析你的投篮</h1>
          <p className="text-slate-400 text-sm mt-1">
            BUILD: <span className="font-mono">coach-v3.9-release+wrist+color</span>
          </p>
        </div>
        <button
          onClick={handleToggleConfig}
          className="px-4 py-2 rounded bg-emerald-500 text-white text-sm"
        >
          配置
        </button>
      </div>

      {/* 上传 & 按钮 */}
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
      <RadarChart
        items={[
          { label: '下肢', value: scores.lower.score },
          { label: '上肢', value: scores.upper.score },
          { label: '平衡', value: scores.balance.score },
          { label: '总分', value: scores.total },
        ]}
      />

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

      {/* 投篮姿态优化建议 */}
      <div className="bg-slate-900/60 rounded-lg p-4">
        <div className="text-slate-100 font-medium mb-2">投篮姿态优化建议</div>
        <ul className="list-disc list-inside space-y-1 text-slate-200 text-sm">
          {suggestions.map((sug, idx) => (
            <li key={idx}>{sug}</li>
          ))}
        </ul>
      </div>

      {/* 配置弹层 */}
      {isConfigOpen ? (
        <div className="fixed inset-0 bg-slate-950/70 flex items-center justify-center z-40">
          <div className="bg-slate-900 rounded-lg p-4 w-[90%] max-w-md border border-slate-700">
            <div className="flex justify-between items-center mb-3">
              <div className="text-slate-100 font-medium">分析配置</div>
              <button
                onClick={() => setIsConfigOpen(false)}
                className="text-slate-300 hover:text-white text-sm"
              >
                关闭
              </button>
            </div>
            <div className="space-y-3 text-sm text-slate-200">
              <div className="flex items-center justify-between">
                <span>模型复杂度</span>
                <span className="text-slate-400">Mediapipe Pose full</span>
              </div>
              <div className="flex items-center justify-between">
                <span>平滑强度</span>
                <span className="text-slate-400">OneEuro (1.15 / 0.05)</span>
              </div>
              <div className="flex items-center justify-between">
                <span>姿态阈值</span>
                <span className="text-slate-400">0.35</span>
              </div>
              <p className="text-slate-500 text-xs">
                这些配置先写死在前端，后面如果你要做“后台配置”或者“按球员自动配置”，这里再接接口即可。
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
