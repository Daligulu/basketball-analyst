// components/RadarChart.tsx
'use client';

import React from 'react';

export type RadarChartProps = {
  lower: number;   // 下肢 0~100
  upper: number;   // 上肢 0~100
  balance: number; // 平衡 0~100
  size?: number;   // 画布宽高
};

/**
 * 一个非常轻量的雷达图：只画 3 轴（下肢 / 上肢 / 平衡）
 * 不依赖 chart.js，不依赖 CDN，纯 SVG，SSR 安全
 */
const RadarChart: React.FC<RadarChartProps> = ({
  lower,
  upper,
  balance,
  size = 240,
}) => {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.36;

  // 三个轴的角度：上肢(0°) → 平衡(120°) → 下肢(240°)
  const degToRad = (d: number) => (d * Math.PI) / 180;

  const pt = (val: number, deg: number) => {
    const rr = (val / 100) * r;
    return {
      x: cx + rr * Math.cos(degToRad(deg)),
      y: cy + rr * Math.sin(degToRad(deg)),
    };
  };

  const pUpper = pt(upper, -90); // 往上
  const pBalance = pt(balance, 30); // 右下
  const pLower = pt(lower, 150); // 左下

  const grid = [1, 0.66, 0.33];

  return (
    <div style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* 网格 */}
        {grid.map((g, i) => {
          const rr = r * g;
          const gu = {
            x: cx + rr * Math.cos(degToRad(-90)),
            y: cy + rr * Math.sin(degToRad(-90)),
          };
          const gb = {
            x: cx + rr * Math.cos(degToRad(30)),
            y: cy + rr * Math.sin(degToRad(30)),
          };
          const gl = {
            x: cx + rr * Math.cos(degToRad(150)),
            y: cy + rr * Math.sin(degToRad(150)),
          };
          return (
            <polygon
              key={i}
              points={`${gu.x},${gu.y} ${gb.x},${gb.y} ${gl.x},${gl.y}`}
              fill="none"
              stroke="rgba(148, 163, 184, 0.15)" // slate-400/15
              strokeWidth={1}
            />
          );
        })}

        {/* 轴文字 */}
        <text x={cx} y={cy - r - 10} fill="#e2e8f0" fontSize="12" textAnchor="middle">
          上肢
        </text>
        <text
          x={cx + r * Math.cos(degToRad(30)) + 2}
          y={cy + r * Math.sin(degToRad(30)) + 12}
          fill="#e2e8f0"
          fontSize="12"
        >
          平衡
        </text>
        <text
          x={cx + r * Math.cos(degToRad(150)) - 2}
          y={cy + r * Math.sin(degToRad(150)) + 12}
          fill="#e2e8f0"
          fontSize="12"
          textAnchor="end"
        >
          下肢
        </text>

        {/* 实际数据面 */}
        <polygon
          points={`${pUpper.x},${pUpper.y} ${pBalance.x},${pBalance.y} ${pLower.x},${pLower.y}`}
          fill="rgba(56, 189, 248, 0.25)" // sky-400/25
          stroke="rgba(56, 189, 248, 0.9)"
          strokeWidth={2}
        />
      </svg>
    </div>
  );
};

// 既支持默认导出，也支持命名导出，防止再报错
export { RadarChart };
export default RadarChart;
