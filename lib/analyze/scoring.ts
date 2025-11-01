// lib/analyze/scoring.ts
// PoseResult -> 前端面板展示的数据结构
// 这版做了两件事：
// 1. 把“对齐与平衡”改成宽容的软打分，避免手机拍出来就是 0 分；
// 2. 补上了 suggestions: string[]，跟 components/VideoAnalyzer.tsx 的渲染对上。

import type { PoseResult } from '../pose/poseEngine';
import type { AnalyzeConfig } from './config';

export type AnalyzeScore = {
  total: number;
  lower: {
    score: number;
    squat: { score: number; value: string };     // 下蹲膝角
    kneeExt: { score: number; value: string };   // 伸膝速度
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
    center: { score: number; value: string };    // 重心稳定（横摆）
    align: { score: number; value: string };     // 对齐
  };
  // ⭐⭐⭐ 前端在 VideoAnalyzer.tsx 里要的字段
  suggestions: string[];
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
  suggestions: [],
};

// 工具函数 ------------------------------------------------

function kp(pose: PoseResult | null, name: string) {
  if (!pose) return null;
  return pose.keypoints.find((k) => k.name === name) ?? null;
}

// 计算三点夹角 a-b-c (b 为顶点)，返回角度(度)
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
  const n1 = Math.hypot(abx, aby);
  const n2 = Math.hypot(cbx, cby);
  if (!n1 || !n2) return null;
  const cos = dot / (n1 * n2);
  const rad = Math.acos(Math.min(1, Math.max(-1, cos)));
  return (rad * 180) / Math.PI;
}

function clamp100(v: number) {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * 偏移版软打分：
 * - 偏移 <= base：100 -> 75
 * - base < 偏移 <= 1.6 * base：75 -> floor
 * - > 1.6 * base：floor
 */
function softOffsetScore(offsetPct: number, basePct: number, floor = 20) {
  const base = basePct > 0 ? basePct : 30;
  const soft = base * 1.6;
  if (offsetPct <= 0) return 100;

  if (offsetPct <= base) {
    const r = offsetPct / base;
    return clamp100(100 - r * 25); // 100 -> 75
  }

  if (offsetPct <= soft) {
    const r = (offsetPct - base) / (soft - base);
    return clamp100(75 - r * (75 - floor));
  }

  return floor;
}

/**
 * 角度版软打分，逻辑同上
 */
function softAngleScore(diffDeg: number, baseDeg: number, floor = 20) {
  const base = baseDeg > 0 ? baseDeg : 25;
  const soft = base * 1.6;
  if (diffDeg <= 0) return 100;

  if (diffDeg <= base) {
    const r = diffDeg / base;
    return clamp100(100 - r * 25);
  }

  if (diffDeg <= soft) {
    const r = (diffDeg - base) / (soft - base);
    return clamp100(75 - r * (75 - floor));
  }

  return floor;
}

// 主函数 -------------------------------------------------

export function scoreFromPose(pose: PoseResult | null, cfg: AnalyzeConfig): AnalyzeScore {
  if (!pose) {
    return EMPTY_SCORE;
  }

  const suggestions: string[] = [];

  // -------------- 1. 下肢：蹲深 ----------------
  const lh = kp(pose, 'left_hip');
  const lk = kp(pose, 'left_knee');
  const la = kp(pose, 'left_ankle');

  const rh = kp(pose, 'right_hip');
  const rk = kp(pose, 'right_knee');
  const ra = kp(pose, 'right_ankle');

  const leftKneeAngle = angle(lh, lk, la);
  const rightKneeAngle = angle(rh, rk, ra);
  const kneeAngle = leftKneeAngle ?? rightKneeAngle ?? null;

  let squatScore = 0;
  let squatValue = '未检测';
  if (kneeAngle != null) {
    const target = cfg.thresholds.lower.squat100; // 比如 150
    const diff = Math.abs(kneeAngle - target);
    // 给个比较宽的线性区间：40 度内掉完
    squatScore = clamp100(100 - (diff / 40) * 100);
    squatValue = `${kneeAngle.toFixed(2)}度`;

    if (squatScore < 70) {
      suggestions.push('下肢下蹲深度与目标差距稍大，可再微微屈膝或调整拍摄角度以减少误差。');
    }
  }

  // -------------- 2. 下肢：伸膝速度 ----------------
  // 你目前项目其实是没有帧间速度的，这里保持原来的占位式写法
  const kneeExtTarget = cfg.thresholds.lower.kneeExt100;
  const kneeExtScore = 100; // 先给满
  const kneeExtValue = `${kneeExtTarget}度/秒`;

  // -------------- 3. 上肢：出手角 ----------------
  const lShoulder = kp(pose, 'left_shoulder');
  const lElbow = kp(pose, 'left_elbow');
  const lWrist = kp(pose, 'left_wrist');
  const rShoulder = kp(pose, 'right_shoulder');
  const rElbow = kp(pose, 'right_elbow');
  const rWrist = kp(pose, 'right_wrist');

  const leftArmAngle = angle(lShoulder, lElbow, lWrist);
  const rightArmAngle = angle(rShoulder, rElbow, rWrist);
  const releaseAngle = leftArmAngle ?? rightArmAngle ?? null;

  let releaseScore = 0;
  let releaseValue = '未检测';
  if (releaseAngle != null) {
    const target = cfg.thresholds.upper.releaseAngle100; // 比如 158
    const diff = Math.abs(releaseAngle - target);
    releaseScore = clamp100(100 - (diff / 40) * 100);
    releaseValue = `${releaseAngle.toFixed(2)}度`;

    if (releaseScore < 70) {
      suggestions.push('出手角度与理想值偏差较大，注意肘腕连线顺着投篮方向上扬。');
    }
  }

  // -------------- 4. 上肢：其他几项先保持你原来的“占位式” ----------------
  const armPowerVal = cfg.thresholds.upper.armPower100;
  const armPowerScore = 100;

  const followVal = cfg.thresholds.upper.follow100;
  const followScore = 100;

  const elbowVal = cfg.thresholds.upper.elbowTight100;
  const elbowScore = 100;

  // -------------- 5. 对齐与平衡（关键修改点） ----------------

  // 5.1 重心稳定（横摆）
  let centerScore = 0;
  let centerVal = '未检测';
  {
    const ls = lShoulder;
    const rs = rShoulder;

    if (ls && rs) {
      const shoulderMidX = (ls.x + rs.x) / 2;
      const bodyWidth = Math.abs(ls.x - rs.x);

      const footMidX =
        la && ra ? (la.x + ra.x) / 2 : shoulderMidX;

      const diffPx = Math.abs(shoulderMidX - footMidX);
      const percent = bodyWidth ? (diffPx / bodyWidth) * 100 : 0;

      // 你 config 里我们已经放宽到了 35，没有的话就用 30
      const targetPct = cfg.thresholds?.balance?.center100 ?? 30;

      centerScore = softOffsetScore(percent, targetPct, 20);
      centerVal = `${percent.toFixed(2)}%`;

      if (centerScore < 70) {
        suggestions.push('重心左右摆动偏大，拍摄时让身体正对镜头、双脚离镜头等距会更准确。');
      }
    }
  }

  // 5.2 对齐角
  let alignScore = 0;
  let alignVal = '未检测';
  {
    const ls = lShoulder;
    const rs = rShoulder;
    const laKp = la;
    const raKp = ra;

    if (ls && rs && laKp && raKp) {
      const torsoRad = Math.atan2(ls.y - rs.y, ls.x - rs.x);
      const footRad = Math.atan2(laKp.y - raKp.y, laKp.x - raKp.x);
      const diffDeg = Math.abs(torsoRad - footRad) * (180 / Math.PI);

      const targetDeg = cfg.thresholds?.balance?.align100 ?? 25;

      alignScore = softAngleScore(diffDeg, targetDeg, 20);
      alignVal = `${diffDeg.toFixed(2)}度`;

      if (alignScore < 70) {
        suggestions.push('上身与双脚朝向不一致，尝试让肩和脚处在同一条射篮线或微调相机角度。');
      }
    }
  }

  // -------------- 6. 汇总 ----------------
  const lowerScore = Math.round((squatScore + kneeExtScore) / 2);
  const upperScore = Math.round(
    (releaseScore + armPowerScore + followScore + elbowScore) / 4,
  );
  const balanceScore = Math.round((centerScore + alignScore) / 2);

  const total = Math.round((lowerScore + upperScore + balanceScore) / 3);

  // 没建议的话也要给一条，免得前端渲染空数组不太好看
  if (suggestions.length === 0) {
    suggestions.push('整体动作较稳定，可以尝试从拍摄角度和光线上再优化输入画面。');
  }

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
    suggestions,
  };
}
