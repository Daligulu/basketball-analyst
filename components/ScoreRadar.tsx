// components/ScoreRadar.tsx
'use client';

import React from 'react';

type Props = {
  lower: number;
  upper: number;
  balance: number;
};

export default function ScoreRadar({ lower, upper, balance }: Props) {
  // 简单 3 轴雷达：下肢(上)、上肢(右)、平衡(下)
  const max = 100;
  const r = 110;

  const valToPoint = (val: number, angleDeg: number) => {
    const ratio = Math.max(0, Math.min(1, val / max));
    const rad = (angleDeg * Math.PI) / 180;
    const rr = ratio * r;
    const x = 150 + rr * Math.cos(rad);
    const y = 150 - rr * Math.sin(rad);
    return { x, y };
  };

  const pLower = valToPoint(lower, 90);   // 上
  const pUpper = valToPoint(upper, 330);  // 右下
  const pBalance = valToPoint(balance, 210); // 左下

  return (
    <div className="bg-slate-900/50 rounded-lg p-4">
      <div className="text-slate-100 mb-3 text-sm">投篮姿态评分雷达图</div>
      <svg width={300} height={300} viewBox="0 0 300 300" className="mx-auto">
        {/* 参考三角形 */}
        <polygon
          points="150,40 260,225 40,225"
          fill="none"
          stroke="#1f2937"
          strokeWidth={1.2}
        />
        <polygon
          points="150,65 235,207 65,207"
          fill="none"
          stroke="#1f2937"
          strokeWidth={1}
        />
        {/* 真正的数据 */}
        <polygon
          points={`${pLower.x},${pLower.y} ${pUpper.x},${pUpper.y} ${pBalance.x},${pBalance.y}`}
          fill="rgba(56,189,248,0.35)"
          stroke="#38bdf8"
          strokeWidth={2}
        />
        {/* 轴文字 */}
        <text x="150" y="28" textAnchor="middle" fill="#e2e8f0" fontSize="12">
          下肢
        </text>
        <text x="270" y="230" textAnchor="end" fill="#e2e8f0" fontSize="12">
          上肢
        </text>
        <text x="30" y="230" textAnchor="start" fill="#e2e8f0" fontSize="12">
          平衡
        </text>
      </svg>
      <div className="mt-3 text-xs text-slate-400 leading-5">
        下肢：{lower}，上肢：{upper}，平衡：{balance}
      </div>
    </div>
  );
}
