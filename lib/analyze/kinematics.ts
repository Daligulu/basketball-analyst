// lib/analyze/kinematics.ts
import type { PoseResult } from '../pose/poseEngine'

export type Angles = {
  kneeL?: number
  kneeR?: number
  releaseAngle?: number
  wristR?: number
  elbowR?: number
  lateralOffsetPct?: number
}

function angleABC(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) {
  const v1x = a.x - b.x
  const v1y = a.y - b.y
  const v2x = c.x - b.x
  const v2y = c.y - b.y
  const d1 = Math.hypot(v1x, v1y) || 1e-6
  const d2 = Math.hypot(v2x, v2y) || 1e-6
  const cos = (v1x * v2x + v1y * v2y) / (d1 * d2)
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
}

export function computeAngles(pose: PoseResult): Angles {
  const k: Record<string, any> = {}
  for (const kp of pose.keypoints) {
    if (kp.name) k[kp.name] = kp
  }

  const out: Angles = {}

  // 左膝
  if (k.left_hip && k.left_knee && k.left_ankle) {
    out.kneeL = angleABC(k.left_hip, k.left_knee, k.left_ankle)
  }

  // 右膝
  if (k.right_hip && k.right_knee && k.right_ankle) {
    out.kneeR = angleABC(k.right_hip, k.right_knee, k.right_ankle)
  }

  // 肘-出手角：肩-肘-腕
  if (k.right_shoulder && k.right_elbow && k.right_wrist) {
    out.releaseAngle = angleABC(k.right_shoulder, k.right_elbow, k.right_wrist)
    out.elbowR = out.releaseAngle
  }

  // 这里先简单把腕部发力留出来，你后面要真测 wrist flex 再补
  if (k.right_wrist) {
    out.wristR = 35 // 给个合理的默认值
  }

  // 对齐/平衡的一个简单指标（横向偏移的百分比）
  if (k.left_hip && k.right_hip && k.left_ankle && k.right_ankle && k.nose) {
    const hipMid = {
      x: (k.left_hip.x + k.right_hip.x) / 2,
      y: (k.left_hip.y + k.right_hip.y) / 2,
    }
    const feetMid = {
      x: (k.left_ankle.x + k.right_ankle.x) / 2,
      y: (k.left_ankle.y + k.right_ankle.y) / 2,
    }
    const norm = Math.hypot(k.nose.x - hipMid.x, k.nose.y - hipMid.y) * 3
    const off = Math.abs(hipMid.x - feetMid.x)
    out.lateralOffsetPct = norm > 1 ? off / norm : undefined
  }

  return out
}
