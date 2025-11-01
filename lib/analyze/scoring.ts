// lib/analyze/scoring.ts

import type { PoseKeypoint, PoseResult } from '@/lib/pose/poseEngine';
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
  // 给前端列表展示用
  suggestions: string[];
};

// 一个绝对安全的初始值，前端也要用
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

function getKp(p: PoseResult, name: string): PoseKeypoint | undefined {
  return p.keypoints.find((k) => k.name === name);
}

// 计算夹角：b 为顶点
function angle(a: PoseKeypoint, b: PoseKeypoint, c: PoseKeypoint): number {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const magAB = Math.hypot(abx, aby);
  const magCB = Math.hypot(cbx, cby);
  if (magAB === 0 || magCB === 0) return NaN;
  const cos = dot / (magAB * magCB);
  const clamped = Math.min(1, Math.max(-1, cos));
  return (Math.acos(clamped) * 180) / Math.PI;
}

// 简单打分：实际值越接近目标越高
function scoreByDiff(actual: number, ideal: number, tolerance: number): number {
  if (Number.isNaN(actual)) return 0;
  const diff = Math.abs(actual - ideal);
  if (diff <= tolerance) return 100;
  const s = 100 - (diff - tolerance) * 8; // 掉得快点
  return Math.max(0, Math.min(100, s));
}

// 横向偏移百分比
function horizontalSway(left: PoseKeypoint, right: PoseKeypoint, ref: PoseKeypoint): number {
  const midX = (left.x + right.x) / 2;
  const dx = Math.abs(ref.x - midX);
  const base = Math.abs(left.x - right.x) || 1;
  return (dx / base) * 100;
}

// 肩到脚的对齐角
function verticalAlign(head: PoseKeypoint, foot: PoseKeypoint): number {
  const dx = Math.abs(head.x - foot.x);
  const dy = Math.abs(head.y - foot.y) || 1;
  const rad = Math.atan(dx / dy);
  return (rad * 180) / Math.PI;
}

export function scoreFromPose(pose: PoseResult | null, cfg: AnalyzeConfig): AnalyzeScore {
  if (!pose) return EMPTY_SCORE;

  const kp = (name: string) => getKp(pose, name);
  const lHip = kp('left_hip');
  const rHip = kp('right_hip');
  const lKnee = kp('left_knee');
  const rKnee = kp('right_knee');
  const lAnkle = kp('left_ankle');
  const rAnkle = kp('right_ankle');
  const lShoulder = kp('left_shoulder');
  const rShoulder = kp('right_shoulder');
  const lElbow = kp('left_elbow');
  const rElbow = kp('right_elbow');
  const lWrist = kp('left_wrist');
  const rWrist = kp('right_wrist');
  const nose = kp('nose') || lShoulder || rShoulder;

  // 1) 下肢 —— 用左腿优先，不行再右腿
  let kneeAngle = NaN;
  if (lHip && lKnee && lAnkle) {
    kneeAngle = angle(lHip, lKnee, lAnkle);
  } else if (rHip && rKnee && rAnkle) {
    kneeAngle = angle(rHip, rKnee, rAnkle);
  }
  const squatScore = scoreByDiff(
    kneeAngle,
    cfg.scoring.lower.squatKneeAngleIdeal,
    6 // 容忍 6°
  );

  // 没有真正的速度，这里先给一个你项目里写死的 260
  const kneeExtScore = scoreByDiff(
    cfg.scoring.lower.kneeExtSpeedIdeal,
    cfg.scoring.lower.kneeExtSpeedIdeal,
    10
  );

  const lowerScore = Math.round((squatScore * 0.6 + kneeExtScore * 0.4) / 1);

  // 2) 上肢
  // 先尝试右手，不行再左手
  let releaseAngle = NaN;
  let armPowerAngle = NaN;
  let elbowTightPct = NaN;
  if (rShoulder && rElbow && rWrist) {
    // 肩-肘-腕
    releaseAngle = angle(rShoulder, rElbow, rWrist);
    armPowerAngle = Math.abs(rWrist.y - rElbow.y); // 粗略当成腕部上抬量
    const dx = Math.abs(rElbow.x - rShoulder.x);
    const base = Math.abs(rWrist.x - rShoulder.x) || 1;
    elbowTightPct = (dx / base) * 100;
  } else if (lShoulder && lElbow && lWrist) {
    releaseAngle = angle(lShoulder, lElbow, lWrist);
    armPowerAngle = Math.abs(lWrist.y - lElbow.y);
    const dx = Math.abs(lElbow.x - lShoulder.x);
    const base = Math.abs(lWrist.x - lShoulder.x) || 1;
    elbowTightPct = (dx / base) * 100;
  }

  const releaseScore = scoreByDiff(
    releaseAngle,
    cfg.scoring.upper.releaseAngleIdeal,
    5
  );
  const armPowerScore = scoreByDiff(
    armPowerAngle,
    cfg.scoring.upper.armPowerIdeal,
    8
  );
  // 随挥先给 100，你之后要真做时序再改
  const followScore = 100;

  const elbowScore = Number.isNaN(elbowTightPct)
    ? 0
    : scoreByDiff(elbowTightPct, cfg.scoring.upper.elbowTightPctIdeal, 1);

  const upperScore = Math.round(
    (releaseScore * 0.45 +
      armPowerScore * 0.25 +
      followScore * 0.15 +
      elbowScore * 0.15) /
      1
  );

  // 3) 平衡
  let swayPct = NaN;
  let alignDeg = NaN;
  if (lHip && rHip && (lAnkle || rAnkle)) {
    const refFoot = lAnkle || rAnkle!;
    swayPct = horizontalSway(lHip, rHip, refFoot);
  }
  if (nose && (lAnkle || rAnkle)) {
    const refFoot = lAnkle || rAnkle!;
    alignDeg = verticalAlign(nose, refFoot);
  }

  const centerScore = Number.isNaN(swayPct)
    ? 0
    : scoreByDiff(swayPct, cfg.scoring.balance.swayPctIdeal, 0.5);
  const alignScore = Number.isNaN(alignDeg)
    ? 0
    : scoreByDiff(alignDeg, cfg.scoring.balance.alignDegIdeal, 0.8);

  const balanceScore =
    centerScore === 0 && alignScore === 0
      ? 0
      : Math.round((centerScore * 0.5 + alignScore * 0.5) / 1);

  // 4) 总分
  const total = Math.round((lowerScore * 0.35 + upperScore * 0.4 + balanceScore * 0.25) / 1);

  // 5) 建议
  const suggestions: string[] = [];
  if (squatScore < 70) suggestions.push('下蹲再深一点，让膝角接近 165° 左右。');
  if (releaseScore < 70) suggestions.push('出手夹角再打开一点，靠近 158°。');
  if (centerScore < 70) suggestions.push('出手时保持身体别往一侧压，重心尽量在两脚中间。');
  if (elbowScore < 70) suggestions.push('肘部离身体有点远，试着贴近胸前再出手。');

  return {
    total,
    lower: {
      score: lowerScore,
      squat: {
        score: Math.round(squatScore),
        value: Number.isNaN(kneeAngle) ? '未检测' : `${kneeAngle.toFixed(2)}度`,
      },
      kneeExt: {
        score: Math.round(kneeExtScore),
        value: `${cfg.scoring.lower.kneeExtSpeedIdeal}(度/秒)`,
      },
    },
    upper: {
      score: upperScore,
      releaseAngle: {
        score: Math.round(releaseScore),
        value: Number.isNaN(releaseAngle) ? '未检测' : `${releaseAngle.toFixed(2)}度`,
      },
      armPower: {
        score: Math.round(armPowerScore),
        value: Number.isNaN(armPowerAngle) ? '未检测' : `${armPowerAngle.toFixed(2)}度`,
      },
      follow: {
        score: Math.round(followScore),
        value: '0.4秒',
      },
      elbowTight: {
        score: Math.round(elbowScore),
        value: Number.isNaN(elbowTightPct) ? '未检测' : `${elbowTightPct.toFixed(2)}%`,
      },
    },
    balance: {
      score: balanceScore,
      center: {
        score: Math.round(centerScore),
        value: Number.isNaN(swayPct) ? '未检测' : `${swayPct.toFixed(2)}%`,
      },
      align: {
        score: Math.round(alignScore),
        value: Number.isNaN(alignDeg) ? '未检测' : `${alignDeg.toFixed(2)}度`,
      },
    },
    suggestions,
  };
}
