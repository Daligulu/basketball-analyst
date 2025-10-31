// lib/analyze/kinematics.ts
// 这里做基础的动作学/角度计算，给评分逻辑用

import type { PoseResult, PoseKeypoint } from '../pose/poseEngine';

export type Angles = {
  kneeL?: number;
  kneeR?: number;
  hipL?: number;
  hipR?: number;
  elbowL?: number;
  elbowR?: number;
  shoulderL?: number;
  shoulderR?: number;
  ankleL?: number;
  ankleR?: number;
  wristL?: number;
  wristR?: number;
};

// 从一帧姿态里算出我们常用的关节角
export function computeAngles(pose: PoseResult): Angles {
  if (!pose) return {};

  const kp = indexByName(pose.keypoints);

  const kneeL = angle3(kp['left_hip'], kp['left_knee'], kp['left_ankle']);
  const kneeR = angle3(kp['right_hip'], kp['right_knee'], kp['right_ankle']);
  const hipL = angle3(kp['left_shoulder'], kp['left_hip'], kp['left_knee']);
  const hipR = angle3(kp['right_shoulder'], kp['right_hip'], kp['right_knee']);

  const elbowL = angle3(kp['left_shoulder'], kp['left_elbow'], kp['left_wrist']);
  const elbowR = angle3(kp['right_shoulder'], kp['right_elbow'], kp['right_wrist']);

  const shoulderL = angle3(kp['left_elbow'], kp['left_shoulder'], kp['left_hip']);
  const shoulderR = angle3(kp['right_elbow'], kp['right_shoulder'], kp['right_hip']);

  const ankleL = angle3(kp['left_knee'], kp['left_ankle'], kp['left_foot_index'] ?? kp['left_heel']);
  const ankleR = angle3(
    kp['right_knee'],
    kp['right_ankle'],
    kp['right_foot_index'] ?? kp['right_heel'],
  );

  const wristL = angle3(kp['left_elbow'], kp['left_wrist'], pickHandTip(kp, 'left'));
  const wristR = angle3(kp['right_elbow'], kp['right_wrist'], pickHandTip(kp, 'right'));

  return {
    kneeL,
    kneeR,
    hipL,
    hipR,
    elbowL,
    elbowR,
    shoulderL,
    shoulderR,
    ankleL,
    ankleR,
    wristL,
    wristR,
  };
}

// ========== 小工具 ==========

// 把 keypoints 按名字索引一下，方便取
function indexByName(arr: PoseKeypoint[]): Record<string, PoseKeypoint | undefined> {
  const out: Record<string, PoseKeypoint | undefined> = {};
  for (const k of arr) {
    out[k.name] = k;
  }
  return out;
}

// 三点角度：以 b 为顶点，单位度，缺点返回 undefined
function angle3(
  a?: PoseKeypoint,
  b?: PoseKeypoint,
  c?: PoseKeypoint,
): number | undefined {
  if (!a || !b || !c) return undefined;
  // 分数太低也不要
  if ((a.score ?? 1) < 0.15 || (b.score ?? 1) < 0.15 || (c.score ?? 1) < 0.15) {
    return undefined;
  }
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };

  const dot = ab.x * cb.x + ab.y * cb.y;
  const magAB = Math.hypot(ab.x, ab.y);
  const magCB = Math.hypot(cb.x, cb.y);
  const denom = magAB * magCB;
  if (denom === 0) return undefined;
  let cos = dot / denom;
  // 数值安全
  cos = Math.min(1, Math.max(-1, cos));
  const angle = Math.acos(cos);
  return (angle * 180) / Math.PI;
}

// 挑一个“手指端”出来，左手/右手
function pickHandTip(
  kp: Record<string, PoseKeypoint | undefined>,
  side: 'left' | 'right',
): PoseKeypoint | undefined {
  return (
    kp[`${side}_index`] ||
    kp[`${side}_pinky`] ||
    kp[`${side}_thumb`] ||
    kp[`${side}_wrist`]
  );
}
