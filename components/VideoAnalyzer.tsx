// components/VideoAnalyzer.tsx
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PoseEngine, type PoseResult } from '@/lib/pose/poseEngine';
import {
  ALL_CONNECTIONS,
  UPPER_COLOR,
  TORSO_COLOR,
  LOWER_COLOR,
} from '@/lib/pose/skeleton';

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

export default function VideoAnalyzer() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<PoseEngine | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [scores, setScores] = useState<AnalyzeScore>(INITIAL_SCORE);
  const [videoSize, setVideoSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // 初始化姿态引擎
  useEffect(() => {
    engineRef.current = new PoseEngine({
      smooth: {
        minCutoff: 1.15,
        beta: 0.05,
        dCutoff: 1.0,
      },
    });
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

  // 视频元数据加载完以后，拿到真正的宽高
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

  // 点击“开始分析”
  const handleStart = async () => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = 0;
    await videoRef.current.play();
    setIsAnalyzing(true);

    // 临时写死一份得分
    setScores({
      total: 78,
      lower: {
        score: 78,
        squat: { score: 55, value: '164.00度' },
        kneeExt: { score: 100, value: '260.00度/秒' },
      },
      upper: {
        score: 78,
        releaseAngle: { score: 55, value: '158.00度' },
        armPower: { score: 100, value: '35.00度' },
        follow: { score: 100, value: '0.40秒' },
        elbowTight: { score: 93, value: '2.00%' },
      },
      balance: {
        score: 86,
        center: { score: 89, value: '1.00%' },
        align: { score: 83, value: '2.00%' },
      },
    });
  };

  // 姿态绘制
  const drawPose = useCallback(async () => {
    const vid = videoRef.current;
    const cvs = canvasRef.current;
    const engine = engineRef.current;
    if (!vid || !cvs || !engine) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;

    // 每帧先清一下
    ctx.clearRect(0, 0, cvs.width, cvs.height);

    // 从全局拿这一帧的多人体姿态（你之后要接真正的 detector，就把这里换掉）
    const det: any =
      (typeof globalThis !== 'undefined' && (globalThis as any).__lastPoseFrame__) || null;

    if (!det || !Array.isArray(det)) {
      return;
    }

    const frame = {
      persons: det as PoseResult[],
      ts: performance.now(),
    };

    const person = engine.process(frame);
    if (!person) {
      return;
    }

    const radius = 3;
    const minScore = 0.28;

    // 画点
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

    // 画线
    for (const { pair, color } of ALL_CONNECTIONS) {
      const [aName, bName] = pair;
      const a = person.keypoints.find((k) => k.name === aName);
      const b = person.keypoints.find((k) => k.name === bName);
      if (!a || !b) continue;
      if ((a.score ?? 0) < minScore || (b.score ?? 0) < minScore) continue;

      // 防止跨背景
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

  // 播放时循环画
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    const handlePlay = () => {
      const loop = () => {
        if (!videoRef.current) return;
        if (!videoRef.current.paused && !videoRef.current.ended) {
          drawPose();
          requestAnimationFrame(loop);
        }
      };
      loop();
    };

    const handleTime = () => {
      drawPose();
    };

    vid.addEventListener('play', handlePlay);
    vid.addEventListener('timeupdate', handleTime);
    vid.addEventListener('seeked', handleTime);

    return () => {
      vid.removeEventListener('play', handlePlay);
      vid.removeEventListener('timeupdate', handleTime);
      vid.removeEventListener('seeked', handleTime);
    };
  }, [drawPose]);

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
            <div className="flex justify之间">
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
        <div className="bg-slate-900/80 rounded-lg p-4 border border-slate-700">
          <div className="flex justify-between items-center mb-2">
            <div className="text-slate-100 font-medium">配置</div>
            <button
              onClick={() => setIsConfigOpen(false)}
              className="text-slate-300 hover:text-white text-sm"
            >
              关闭
            </button>
          </div>
          <p className="text-slate-400 text-sm">
            这里可以放「检测模型选择」「平滑强度」「评分阈值」等选项，先留占位。
          </p>
        </div>
      ) : null}
    </div>
  );
}
