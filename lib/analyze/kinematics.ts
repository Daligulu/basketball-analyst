// lib/analyze/kinematics.ts
// 这里做基础的动作学/角度计算，给评分逻辑用

import type { PoseResult, PoseKeypoint } from '../pose/poseEngine';

export type Angles = {
  kneeL?: number;
  kneeR?: number;
  hipL?: number;
  hipR?: number;
  shoulderL?: number;
  shoulderR?: number;
};

function kp(p: PoseResult | null, name: string): PoseKeypoint | null {
  if (!p) return null;
  return p.keypoints.find((k) => k.name === name) ?? null;
}

function angle3(a: PoseKeypoint, b: PoseKeypoint, c: PoseKeypoint): number {
  // 计算 ∠ABC，单位：度
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;

  const dot = abx * cbx + aby * cby;
  const mab = Math.hypot(abx, aby);
  const mcb = Math.hypot(cbx, cby);
  if (mab === 0 || mcb === 0) return 0;

  let cos = dot / (mab * mcb);
  cos = Math.min(1, Math.max(-1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function calcAngles(p: PoseResult | null): Angles {
  if (!p) return {};

  const lHip = kp(p, 'left_hip');
  const lKnee = kp(p, 'left_knee');
  const lAnk = kp(p, 'left_ankle');

  const rHip = kp(p, 'right_hip');
  const rKnee = kp(p, 'right_knee');
  const rAnk = kp(p, 'right_ankle');

  const lShoulder = kp(p, 'left_shoulder');
  const lElbow = kp(p, 'left_elbow');
  const lWrist = kp(p, 'left_wrist');

  const rShoulder = kp(p, 'right_shoulder');
  const rElbow = kp(p, 'right_elbow');
  const rWrist = kp(p, 'right_wrist');

  const out: Angles = {};

  // 膝角
  if (lHip && lKnee && lAnk) {
    out.kneeL = angle3(lHip, lKnee, lAnk);
  }
  if (rHip && rKnee && rAnk) {
    out.kneeR = angle3(rHip, rKnee, rAnk);
  }

  // 髋角（大致：躯干-大腿）
  if (lShoulder && lHip && lKnee) {
    out.hipL = angle3(lShoulder, lHip, lKnee);
  }
  if (rShoulder && rHip && rKnee) {
    out.hipR = angle3(rShoulder, rHip, rKnee);
  }

  // 肩肘腕
  if (lShoulder && lElbow && lWrist) {
    out.shoulderL = angle3(lShoulder, lElbow, lWrist);
  }
  if (rShoulder && rElbow && rWrist) {
    out.shoulderR = angle3(rShoulder, rElbow, rWrist);
  }

  return out;
}
