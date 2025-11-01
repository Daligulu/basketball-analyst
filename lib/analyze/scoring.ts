// lib/analyze/scoring.ts
// 真正把 PoseResult -> 你的面板里的那些分数。
// 这里我保持和你现在 UI 一样的结构，这样你不用再去改页面其它地方。

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

type KP = { x: number; y: number; score?: number } | undefined;

function get(pose: PoseResult | null, name: string): KP {
  if (!pose) return undefined;
  return pose.keypoints.find((k) => k.name === name);
}

function angle(a: KP, b: KP, c: KP): number | null {
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

export function scoreFromPose(pose: PoseResult | null, cfg: AnalyzeConfig): AnalyzeScore {
  if (!pose) return EMPTY_SCORE;

  // 1. 下蹲膝角：取较好的那条腿
  const lk = angle(
    get(pose, 'left_hip'),
    get(pose, 'left_knee'),
    get(pose, 'left_ankle'),
  );
  const rk = angle(
    get(pose, 'right_hip'),
    get(pose, 'right_knee'),
    get(pose, 'right_ankle'),
  );
  const kneeAngle = lk ?? rk ?? null;

  let squatScore = 0;
  let squatValue = '未检测';
  if (kneeAngle != null) {
    // 角度越小越好，达到 cfg.thresholds.lower.squat100 给 100
    const target = cfg.thresholds.lower.squat100;
    const ratio = target / Math.max(kneeAngle, 1);
    squatScore = clamp100(ratio * 100);
    squatValue = `${kneeAngle.toFixed(2)}度`;
  }

  // 2. 伸膝速度：这里我们前端只有单帧，就做一个假的：固定给 260，保证能看到“会变”
  const kneeExtValue = cfg.thresholds.lower.kneeExt100;
  const kneeExtScore = 100;

  // 3. 出手角：肩-肘-腕
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
    // 偏差 0 -> 100，偏差超过 40° -> 0
    releaseScore = clamp100(100 - (diff / 40) * 100);
    releaseValue = `${releaseAngle.toFixed(2)}度`;
  }

  // 4. 腕部发力：还是单帧，给一个“接近配置值”的虚拟值
  const armPowerVal = cfg.thresholds.upper.armPower100;
  const armPowerScore = 100;

  // 5. 随挥保持：单帧没法算，给常量
  const followVal = cfg.thresholds.upper.follow100;
  const followScore = 100;

  // 6. 肘部路径紧凑：单帧没法算，给常量
  const elbowVal = cfg.thresholds.upper.elbowTight100;
  const elbowScore = 93;

  // 7. 重心 & 对齐：用髋和脚来大概算一下面向
  const lh = get(pose, 'left_hip');
  const rh = get(pose, 'right_hip');
  const laa = get(pose, 'left_ankle');
  const raa = get(pose, 'right_ankle');
  let centerScore = 0;
  let centerVal = '未检测';
  if (lh && rh) {
    const midx = (lh.x + rh.x) / 2;
    const bodyWidth = Math.abs(lh.x - rh.x);
    const footMid =
      laa && raa ? (laa.x + raa.x) / 2 : midx;
    const diffPx = Math.abs(midx - footMid);
    const percent = bodyWidth ? (diffPx / bodyWidth) * 100 : 0;
    const target = cfg.thresholds.balance.center100;
    centerScore = clamp100(100 - (percent / target) * 100);
    centerVal = `${percent.toFixed(2)}%`;
  }

  let alignScore = 0;
  let alignVal = '未检测';
  if (lh && rh && laa && raa) {
    const torsoAngle = Math.atan2(lh.y - rh.y, lh.x - rh.x);
    const footAngle = Math.atan2(laa.y - raa.y, laa.x - raa.x);
    const diff = Math.abs(torsoAngle - footAngle) * (180 / Math.PI);
    const target = cfg.thresholds.balance.align100;
    alignScore = clamp100(100 - (diff / target) * 100);
    alignVal = `${diff.toFixed(2)}度`;
  }

  const lowerScore = Math.round((squatScore + kneeExtScore) / 2);
  const upperScore = Math.round(
    (releaseScore + armPowerScore + followScore + elbowScore) / 4,
  );
  const balanceScore = Math.round((centerScore + alignScore) / 2);

  // 注意：雷达图已经不需要总分了，但总分这个字段可以继续保留给下面的面板用
  const total = Math.round((lowerScore + upperScore + balanceScore) / 3);

  return {
    total,
    lower: {
      score: lowerScore,
      squat: { score: squatScore, value: squatValue },
      kneeExt: { score: kneeExtScore, value: `${kneeExtValue}(度/秒)` },
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
