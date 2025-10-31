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

// ---- 分数类型 ----
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
  const [videoUrl, setVideoUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [scores, setScores] = useState<AnalyzeScore>(INITIAL_SCORE);
  const [videoSize, setVideoSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // 初始化引擎
  useEffect(() => {
    engineRef.current = new PoseEngine({
      smooth: {
        minCutoff: 1.15,
        beta: 0.05,
        dCutoff: 1.0,
      },
    });
  }, []);

  // 上传视频
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const url = URL.createObjectURL(f);
    setVideoUrl(url);
    setScores(INITIAL_SCORE);
    setIsAnalyzing(false);
  };

  // 视频元数据
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

  // 开始分析
  const handleStart = async () => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = 0;
    await videoRef.current.play();
    setIsAnalyzing(true);

    // 这里先用一个固定的演示分数，避免下面的面板是空的
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

    // ⚠️ 关键：这里立刻复位按钮，不然你线上看到的一直是“识别中…”
    setIsAnalyzing(false);
  };

  // 画姿态
  const drawPose = useCallback(() => {
    const vid = videoRef.current;
    const cvs = canvasRef.current;
    const engine = engineRef.current;
    if (!vid || !cvs || !engine) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;

    // 前端真正的检测你还没接上，这里先从 window 兜底拿一下
    let persons: any[] = [];
    if (typeof window !== 'undefined') {
      const raw = (window as any).__lastPoseFrame__;
      if (Array.isArray(raw)) {
        persons = raw;
      }
    }

    const frame = {
      persons,
      ts: performance.now(),
    };

    const person: PoseResult = engine.process(frame);
    ctx.clearRect(0, 0, cvs.width, cvs.height);

    if (!person) {
      return;
    }

    const minScore = 0.28;
    const radius = 3;

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
        kp.name?.includes('knee') ||
        kp.name?.includes('ankle') ||
        kp.name?.includes('foot') ||
        kp.name?.includes('heel')
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

  // 跟视频播放绑定
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

  // 一个简单的雷达图（SVG），不额外引第三方
  const Radar = ({ score }: { score: AnalyzeScore }) => {
    // 按你原页面的三大块来：下肢、上肢、对齐
    const vals = [
      score.lower.score || 0,
      score.upper.score || 0,
      score.balance.score || 0,
    ];
    const max = 100;
    const points = vals
      .map((v, i) => {
        const ang = (-Math.PI / 2) + (i * (2 * Math.PI)) / 3;
        const r = 70 * (v / max);
        const cx = 90 + r * Math.cos(ang);
        const cy = 90 + r * Math.sin(ang);
        return `${cx},${cy}`;
      })
      .join(' ');

    return (
      <svg width={180} height={180} className="mx-auto">
        {/* 三个轴 */}
        <line x1="90" y1="90" x2="90" y2="20" stroke="#334155" />
        <line x1="90" y1="90" x2="20" y2="140" stroke="#334155" />
        <line x1="90" y1="90" x2="160" y2="140" stroke="#334155" />
        {/* 面 */}
        <polygon points={points} fill="rgba(56,189,248,0.3)" stroke="#38bdf8" strokeWidth={2} />
        <text x="88" y="14" fontSize="10" fill="#cbd5f5">
          下肢
        </text>
        <text x="0" y="154" fontSize="10" fill="#cbd5f5">
          对齐
        </text>
        <text x="145" y="154" fontSize="10" fill="#cbd5f5">
          上肢
        </text>
      </svg>
    );
  };

  // 简单的建议
  const renderSuggestion = (s: AnalyzeScore) => {
    const list: string[] = [];
    if (s.lower.squat.score < 60) {
      list.push('下蹲略浅，起跳前再多沉一点蹲深度（膝角 < 160°）。');
    }
    if (s.upper.releaseAngle.score < 60) {
      list.push('出手角度偏低，出手时肘部再高一点。');
    }
    if (s.balance.center.score < 70) {
      list.push('重心左右有摆动，注意起跳时膝盖保持在脚尖上方。');
    }
    if (!list.length) {
      list.push('动作整体不错，保持节奏即可。');
    }
    return list;
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

      {/* 视频 + overlay */}
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

      {/* 分数 */}
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

        {/* 雷达图 + 建议 */}
        <div className="bg-slate-900/40 rounded-lg p-4 space-y-3">
          <div className="text-slate-100 font-medium mb-1">投篮姿态雷达图</div>
          <Radar score={scores} />
          <div className="text-slate-100 font-medium mt-3">投篮优化建议</div>
          <ul className="list-disc list-inside space-y-1 text-sm text-slate-200">
            {renderSuggestion(scores).map((t, idx) => (
              <li key={idx}>{t}</li>
            ))}
          </ul>
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
            这里可以放“检测模型选择”“平滑强度”“评分阈值”等选项，占个位，保持布局一致。
          </p>
        </div>
      ) : null}
    </div>
  );
}
