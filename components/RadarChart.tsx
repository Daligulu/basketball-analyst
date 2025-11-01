// components/RadarChart.tsx
'use client';

import React from 'react';

type Props = {
  lower: number;
  upper: number;
  balance: number;
};

const RadarChart: React.FC<Props> = ({ lower, upper, balance }) => {
  // 这版先来个最简 SVG，重点是类型和导出别再报错
  // 三个点：下肢(0°)、上肢(120°)、平衡(240°)
  const max = 100;
  const r = 80;
  const cx = 90;
  const cy = 90;

  const toPoint = (value: number, angleDeg: number) => {
    const ratio = Math.max(0, Math.min(1, value / max));
    const rad = (angleDeg * Math.PI) / 180;
    const rr = r * ratio;
    return {
      x: cx + rr * Math.cos(rad),
      y: cy + rr * Math.sin(rad),
    };
  };

  const p1 = toPoint(lower, -90); // 上
  const p2 = toPoint(upper, 30); // 右下
  const p3 = toPoint(balance, 150); // 左下

  return (
    <svg width={180} height={180} className="text-slate-200">
      {/* 背景三角 */}
      <polygon
        points={`${cx},${cy - r} ${cx + r * Math.cos(Math.PI / 6)},${cy + r * Math.sin(
          Math.PI / 6
        )} ${cx - r * Math.cos(Math.PI / 6)},${cy + r * Math.sin(Math.PI / 6)}`}
        fill="transparent"
        stroke="rgba(148, 163, 184, 0.35)"
      />
      {/* 当前值 */}
      <polygon
        points={`${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`}
        fill="rgba(56, 189, 248, 0.25)"
        stroke="rgba(56, 189, 248, 0.8)"
      />
      {/* 文本 */}
      <text x={cx} y={18} textAnchor="middle" fontSize="12" fill="#e2e8f0">
        投篮姿态评分雷达图
      </text>
      <text x={cx} y={cy - r - 6} textAnchor="middle" fontSize="11" fill="#e2e8f0">
        下肢
      </text>
      <text x={cx + r * Math.cos(Math.PI / 6) + 4} y={cy + r * Math.sin(Math.PI / 6)} fontSize="11" fill="#e2e8f0">
        上肢
      </text>
      <text x={cx - r * Math.cos(Math.PI / 6) - 28} y={cy + r * Math.sin(Math.PI / 6)} fontSize="11" fill="#e2e8f0">
        平衡
      </text>
    </svg>
  );
};

export default RadarChart;
export { RadarChart };
