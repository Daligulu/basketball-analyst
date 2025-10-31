// lib/analyze/release.ts
// 跟出手相关的简单分析（前端版）

import type { PoseResult } from '../pose/poseEngine';

function safeKp(p: PoseResult, name: string) {
  if (!p) {
    return { name, x: 0, y: 0, score: 0 };
  }
  return (
    p.keypoints.find((k) => k.name === name) ?? {
      name,
      x: 0,
      y: 0,
      score: 0,
    }
  );
}

function variance(xs: number[]): number {
  if (!xs.length) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length;
  return v;
}

// 核心：从一段采样里找一个“最像出手”的帧
export function detectRelease(
  samples: PoseResult[],
  cfg?: {
    minElbowDeg?: number;
  }
) {
  const minElbow = cfg?.minElbowDeg ?? 150;

  let bestIdx = -1;
  let bestScore = -1;

  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    if (!p) continue;

    const lw = safeKp(p, 'left_wrist');
    const le = safeKp(p, 'left_elbow');
    const ls = safeKp(p, 'left_shoulder');

    const rw = safeKp(p, 'right_wrist');
    const re = safeKp(p, 'right_elbow');
    const rs = safeKp(p, 'right_shoulder');

    // 简单用 y 值比较高低，找“手腕最高的时刻”
    const maxHandY = Math.min(lw.y || 9999, rw.y || 9999);
    const handScore = 1 / (1 + maxHandY); // 越高越大

    // 简单 elbow 打分（这里不做真正的角度）
    const elbowStraight =
      Math.abs(le.y - ls.y) < 30 || Math.abs(re.y - rs.y) < 30 ? 1 : 0;

    const score = handScore + elbowStraight * 0.5;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return {
    index: bestIdx,
    score: bestScore,
  };
}
