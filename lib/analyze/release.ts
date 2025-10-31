// lib/analyze/release.ts
// 从连续姿态帧里检测“出手”那一帧

import type { PoseResult, PoseKeypoint } from '../pose/poseEngine';
import type { CoachConfig } from '../../config/coach';

export type ReleaseSample = {
  ts: number;          // 时间戳（ms）
  pose: PoseResult;    // 这一帧的姿态，可能是 null
};

export type ReleaseDetectConfig = {
  // 肘角至少要这么大才认为是完全伸开（越大越接近直线）
  minElbowDeg?: number;
  // 手腕相对前几帧至少要抬这么多（像素/同一坐标系）
  minWristLift?: number;
  // 最多往前看几帧来比较
  lookback?: number;
};

export type ReleaseResult = {
  index: number;   // 在 samples 里的下标
  ts: number;      // 出手时间
} | null;

// 安全取关键点 —— 不存在就 undefined，不会再 TS 报 “p 可能为 null”
function kp(p: PoseResult | null, name: string): PoseKeypoint | undefined {
  if (!p) return undefined;
  return p.keypoints.find((k) => k.name === name);
}

// 三点角度：以 b 为顶点
function angle3(
  a?: PoseKeypoint,
  b?: PoseKeypoint,
  c?: PoseKeypoint,
): number | undefined {
  if (!a || !b || !c) return undefined;
  if ((a.score ?? 0) < 0.15 || (b.score ?? 0) < 0.15 || (c.score ?? 0) < 0.15) {
    return undefined;
  }
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const magAB = Math.hypot(abx, aby);
  const magCB = Math.hypot(cbx, cby);
  if (magAB === 0 || magCB === 0) return undefined;
  let cos = dot / (magAB * magCB);
  // 数值安全
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * 检测出手帧
 * 思路（简单版）：
 * 1. 肘角要足够大（手臂伸开）
 * 2. 手腕要比前面几帧“更高/更往前”
 * 3. 满足就认为这是出手点
 */
export function detectRelease(
  samples: ReleaseSample[],
  cfg: CoachConfig,
): ReleaseResult {
  if (!samples || samples.length < 3) return null;

  // 兼容没有 releaseDetect 的 config
  const rd = (cfg as any).releaseDetect as ReleaseDetectConfig | undefined;
  const minElbowDeg = rd?.minElbowDeg ?? 150;   // 150°左右基本是直臂
  const minWristLift = rd?.minWristLift ?? 4;   // 没配就给个很小的值，避免老是检测不到
  const lookback = rd?.lookback ?? 2;           // 往前看 2 帧

  // 从第 2~3 帧开始看，和前面比较
  for (let i = lookback; i < samples.length; i++) {
    const cur = samples[i];
    const curPose = cur.pose;

    // 没有检测到人就跳过
    if (!curPose) continue;

    const rwC = kp(curPose, 'right_wrist') || kp(curPose, 'left_wrist');
    const reC = kp(curPose, 'right_elbow') || kp(curPose, 'left_elbow');
    const rsC = kp(curPose, 'right_shoulder') || kp(curPose, 'left_shoulder');

    // 手、肘、肩必须都有
    if (!rwC || !reC || !rsC) continue;

    // 1) 肘角是否伸开
    const elbowAng = angle3(rsC, reC, rwC);
    if (elbowAng !== undefined && elbowAng < minElbowDeg) {
      // 手还没完全伸开，再看下一帧
      continue;
    }

    // 2) 相对前几帧，手腕是否有明显抬高（y 变小）
    let lifted = false;
    for (let b = 1; b <= lookback; b++) {
      const prev = samples[i - b];
      if (!prev || !prev.pose) continue;
      const rwPrev =
        kp(prev.pose, 'right_wrist') || kp(prev.pose, 'left_wrist');
      if (!rwPrev) continue;

      // 注意：视频坐标通常是 y 越大越靠下，所以“抬手”= 当前 y 比前面的小
      const diffY = rwPrev.y - rwC.y;
      if (diffY >= minWristLift) {
        lifted = true;
        break;
      }
    }

    if (!lifted) {
      // 手没有相对前面抬高——可能只是中间过程
      continue;
    }

    // 满足两个条件，就认为这是出手帧
    return {
      index: i,
      ts: cur.ts,
    };
  }

  return null;
}
