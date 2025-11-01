// components/RadarChart.tsx
'use client';

import React from 'react';

type RadarItem = {
  label: string;
  value: number; // 0 ~ 100
};

type RadarChartProps = {
  items: RadarItem[];
};

export default function RadarChart({ items }: RadarChartProps) {
  if (!items || items.length === 0) return null;

  const size = 240;
  const center = size / 2;
  const maxR = size * 0.36;

  const angleStep = (Math.PI * 2) / items.length;

  const points = items
    .map((item, idx) => {
      const angle = -Math.PI / 2 + idx * angleStep;
      const r = (item.value / 100) * maxR;
      const x = center + r * Math.cos(angle);
      const y = center + r * Math.sin(angle);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className="bg-slate-900/60 rounded-lg p-4">
      <div className="text-slate-100 text-sm mb-2">投篮姿态评分雷达图</div>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto">
        {/* 底网格 */}
        {[1, 0.75, 0.5, 0.25].map((p) => (
          <polygon
            key={p}
            points={items
              .map((_, idx) => {
                const angle = -Math.PI / 2 + idx * angleStep;
                const r = maxR * p;
                const x = center + r * Math.cos(angle);
                const y = center + r * Math.sin(angle);
                return `${x},${y}`;
              })
              .join(' ')}
            fill="none"
            stroke="#0f172a"
            strokeWidth={1}
          />
        ))}

        {/* 实际数据 */}
        <polygon
          points={points}
          fill="rgba(56, 189, 248, 0.35)"
          stroke="#38bdf8"
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* 轴线 + 标签 */}
        {items.map((item, idx) => {
          const angle = -Math.PI / 2 + idx * angleStep;
          const x = center + (maxR + 16) * Math.cos(angle);
          const y = center + (maxR + 16) * Math.sin(angle);
          return (
            <g key={item.label}>
              <line
                x1={center}
                y1={center}
                x2={center + maxR * Math.cos(angle)}
                y2={center + maxR * Math.sin(angle)}
                stroke="#1f2937"
                strokeWidth={1}
              />
              <text
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#cbd5f5"
                fontSize={10}
              >
                {item.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
