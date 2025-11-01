// lib/analyze/scoring.ts
// 真正把 PoseResult -> 面板里的分数。
// 这版是在你 zip 里的原版基础上，只改了「对齐与平衡」那一小段，
// 把它做成“软容差”：拍得不那么标准也不要直接给 0 分。

import type { PoseResult } from '../pose/poseEngine';
import type { AnalyzeConfig } from './config';

export type AnalyzeScore = {
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

export const EMPTY_SCORE: AnalyzeScore = {
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

// 从 pose 里按名字拿关键点
function get(pose: PoseResult | null, name: string) {
  if (!pose) return null;
  return pose.keypoints.find((k) => k.name === name) ?? null;
}

// 计算三点夹角 a-b-c
function angle(
  a: { x: number; y: number } | null,
  b: { x: number; y: number } | null,
  c: { x: number; y: number } | null,
): number | null {
  if (!a || !b || !c) return null;
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const norm1 = Math.hypot(abx, aby);
  const norm2 = Math.hypot(cbx, cby);
  if (!norm1 || !norm2) return null;
  const cos = dot / (norm1 * norm2);
  const rad = Math.acos(Math.min(1, Math.max(-1, cos)));
  return (rad * 180) / Math.PI;
}

function clamp100(v: number) {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * 一个更“温柔”的偏移打分：
 * - base 以内：最多扣 25 分（也就是还能有 75~100）
 * - base~softBase：从 75 往下掉到 floor
 * - 大于 softBase：给 floor
 *
 * 这样像你那张截图里中心偏移 31%（我们 base=35%）就不会变成 0。
 */
function softOffsetScore(offset: number, base: number, floor = 20) {
  // 没配置就给个保守值
  const realBase = base > 0 ? base : 30;
  const softBase = realBase * 1.6; // 允许到 1.6 倍再慢慢掉
  if (offset <= 0) return 100;

  // 1) 完全在基准容差内：最多扣 25 分
  if (offset <= realBase) {
    const ratio = offset / realBase; // 0~1
    const score = 100 - ratio * 25;  // 100 -> 75
    return clamp100(score);
  }

  // 2) 在基准和软容差之间：75 -> floor
  if (offset <= softBase) {
    const ratio = (offset - realBase) / (softBase - realBase); // 0~1
    const score = 75 - ratio * (75 - floor); // 75 -> floor
    return clamp100(score);
  }

  // 3) 再往外就别再往下打了，给个保底
  return floor;
}

/**
 * 角度版的 soft score，逻辑同上。
 */
function softAngleScore(diffDeg: number, baseDeg: number, floor = 20) {
  const realBase = baseDeg > 0 ? baseDeg : 25;
  const softBase = realBase * 1.6;
  if (diffDeg <= 0) return 100;

  if (diffDeg <= realBase) {
    const ratio = diffDeg / realBase;
    const score = 100 - ratio * 25; // 100 -> 75
    return clamp100(score);
  }

  if (diffDeg <= softBase) {
    const ratio = (diffDeg - realBase) / (softBase - realBase);
    const score = 75 - ratio * (75 - floor); // 75 -> floor
    return clamp100(score);
  }

  return floor;
}

export function scoreFromPose(pose: PoseResult | null, cfg: AnalyzeConfig): AnalyzeScore {
  if (!pose) {
    return EMPTY_SCORE;
  }

  // ----------------------------------------------------
  // 1. 下肢：蹲深（髋-膝-踝角）
  // ----------------------------------------------------
  const lh = get(pose, 'left_hip');
  const lk = get(pose, 'left_knee');
  const laa = get(pose, 'left_ankle');
  const rh = get(pose, 'right_hip');
  const rk = get(pose, 'right_knee');
  const raa = get(pose, 'right_ankle');

  const leftKneeAngle = angle(lh, lk, laa);
  const rightKneeAngle = angle(rh, rk, raa);
  const kneeAngle = leftKneeAngle ?? rightKneeAngle ?? null;

  let squatScore = 0;
  let squatValue = '未检测';
  if (kneeAngle != null) {
    const target = cfg.thresholds.lower.squat100;
    const diff = Math.abs(kneeAngle - target);
    // 40° 内线性掉到 0
    squatScore = clamp100(100 - (diff / 40) * 100);
    squatValue = `${kneeAngle.toFixed(2)}度`;
  }

  // ----------------------------------------------------
  // 2. 下肢：伸膝速度（这里还是用配置里的一个“理想速度”占位）
  // ----------------------------------------------------
  const kneeExtTarget = cfg.thresholds.lower.kneeExt100;
  const kneeExtScore = 100;
  const kneeExtValue = `${kneeExtTarget}度/秒`;

  // ----------------------------------------------------
  // 3. 上肢：出手角（肩-肘-腕）
  // ----------------------------------------------------
  const la = angle(
    get(pose, 'left_shoulder'),
    get(pose, 'left_elbow'),
    get(pose, 'left_wrist'),
  );
  const ra = angle(
    get(pose, 'right_shoulder'),
    get(pose, 'right_elbow'),
    get(pose, 'right_wrist'),
  );
  const releaseAngle = la ?? ra ?? null;
  let releaseScore = 0;
  let releaseValue = '未检测';
  if (releaseAngle != null) {
    const target = cfg.thresholds.upper.releaseAngle100;
    const diff = Math.abs(releaseAngle - target);
    releaseScore = clamp100(100 - (diff / 40) * 100);
    releaseValue = `${releaseAngle.toFixed(2)}度`;
  }

  // ----------------------------------------------------
  // 4. 上肢：腕部发力 / 随挥 / 肘部路径
  // 这些你原来就是用配置值占的位，我们保持不动，避免影响其他功能
  // ----------------------------------------------------
  const armPowerVal = cfg.thresholds.upper.armPower100;
  const armPowerScore = 100;

  const followVal = cfg.thresholds.upper.follow100;
  const followScore = 100;

  const elbowVal = cfg.thresholds.upper.elbowTight100;
  const elbowScore = 100;

  // ----------------------------------------------------
  // 5. 对齐与平衡（这次重点）
  // 原版写法是：
  //   centerScore = clamp100(100 - (percent / target) * 100)
  //   alignScore  = clamp100(100 - (diff    / target) * 100)
  // 只要 percent > target 基本就是 0，太苛刻
  // 我们改成 soft 版，只要没离谱，就给 70~80 这一档
  // ----------------------------------------------------
  // 5.1 重心稳定（横摆）
  let centerScore = 0;
  let centerVal = '未检测';
  {
    const leftShoulder = get(pose, 'left_shoulder');
    const rightShoulder = get(pose, 'right_shoulder');

    if (leftShoulder && rightShoulder) {
      const midx = (leftShoulder.x + rightShoulder.x) / 2;
      const bodyWidth = Math.abs(leftShoulder.x - rightShoulder.x);

      // 脚可能只有一只能检测到，就用肩的中点当脚的中点
      const leftAnkle = laa;
      const rightAnkle = raa;
      const footMid =
        leftAnkle && rightAnkle ? (leftAnkle.x + rightAnkle.x) / 2 : midx;

      const diffPx = Math.abs(midx - footMid);
      const percent = bodyWidth ? (diffPx / bodyWidth) * 100 : 0;

      // 你 config 里放宽后的值（比如 35），没有的话给 30
      const target = cfg.thresholds?.balance?.center100 ?? 30;

      centerScore = softOffsetScore(percent, target, 20);
      centerVal = `${percent.toFixed(2)}%`;
    }
  }

  // 5.2 对齐角
  let alignScore = 0;
  let alignVal = '未检测';
  {
    const leftShoulder = get(pose, 'left_shoulder');
    const rightShoulder = get(pose, 'right_shoulder');
    const leftAnkle = laa;
    const rightAnkle = raa;

    if (leftShoulder && rightShoulder && leftAnkle && rightAnkle) {
      // 身体方向：左右肩连线
      const torsoAngle = Math.atan2(
        leftShoulder.y - rightShoulder.y,
        leftShoulder.x - rightShoulder.x,
      );
      // 脚的方向：左右踝连线
      const footAngle = Math.atan2(
        leftAnkle.y - rightAnkle.y,
        leftAnkle.x - rightAnkle.x,
      );
      const diffDeg = Math.abs(torsoAngle - footAngle) * (180 / Math.PI);

      const target = cfg.thresholds?.balance?.align100 ?? 25;

      alignScore = softAngleScore(diffDeg, target, 20);
      alignVal = `${diffDeg.toFixed(2)}度`;
    }
  }

  // ----------------------------------------------------
  // 汇总
  // ----------------------------------------------------
  const lowerScore = Math.round((squatScore + kneeExtScore) / 2);
  const upperScore = Math.round(
    (releaseScore + armPowerScore + followScore + elbowScore) / 4,
  );
  const balanceScore = Math.round((centerScore + alignScore) / 2);

  const total = Math.round((lowerScore + upperScore + balanceScore) / 3);

  return {
    total,
    lower: {
      score: lowerScore,
      squat: { score: squatScore, value: squatValue },
      kneeExt: { score: kneeExtScore, value: kneeExtValue },
    },
    upper: {
      score: upperScore,
      releaseAngle: { score: releaseScore, value: releaseValue },
      armPower: { score: armPowerScore, value: `${armPowerVal}度` },
      follow: { score: followScore, value: `${followVal}秒` },
      elbowTight: { score: elbowScore, value: `${elbowVal}%` },
    },
    balance: {
      score: balanceScore,
      center: { score: centerScore, value: centerVal },
      align: { score: alignScore, value: alignVal },
    },
  };
}
