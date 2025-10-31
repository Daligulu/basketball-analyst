// lib/analyze/release.ts
import type { CoachConfig } from '@/config/coach'

export type Sample = {
  t: number // 秒
  pose: any
}

function kp(pose: any, name: string) {
  return pose?.keypoints?.find((k: any) => k.name === name)
}

function variance(xs: number[]): number {
  if (!xs.length) return 0
  const m = xs.reduce((s, x) => s + x, 0) / xs.length
  const v = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / xs.length
  return v
}

export function detectRelease(samples: Sample[], cfg: CoachConfig) {
  const minElbow = cfg.releaseDetect?.minElbowDeg ?? 150
  const bodyScale = cfg.releaseDetect?.bodyWidthScale ?? 3

  const elbowXs: number[] = []
  const hipXs: number[] = []
  const feetXs: number[] = []

  for (const s of samples) {
    const e = kp(s.pose, 'right_elbow')
    const lh = kp(s.pose, 'left_hip')
    const rh = kp(s.pose, 'right_hip')
    const la = kp(s.pose, 'left_ankle')
    const ra = kp(s.pose, 'right_ankle')

    if (e?.x) elbowXs.push(e.x)
    if (lh?.x) hipXs.push(lh.x)
    if (rh?.x) hipXs.push(rh.x)
    if (la?.x) feetXs.push(la.x)
    if (ra?.x) feetXs.push(ra.x)
  }

  const bases = [...hipXs, ...feetXs]
  const baseSpan = bases.length > 1 ? Math.max(...bases) - Math.min(...bases) : 1

  // 肘部路径紧凑 = 肘的横向跨度 / (身体宽度 * 系数)
  const elbowSpan = elbowXs.length > 1 ? Math.max(...elbowXs) - Math.min(...elbowXs) : 0
  const elbowCurvePct = elbowSpan / (baseSpan * bodyScale)

  // 重心稳定：用髋的方差粗略表示
  const hipVar = variance(hipXs)
  const stabilityPct = baseSpan > 0 ? Math.min(1, hipVar / baseSpan) : 0

  // 对齐：最后一帧髋中点和脚中点的差
  let alignmentPct = 0
  const last = samples.at(-1)
  if (last) {
    const lh = kp(last.pose, 'left_hip')
    const rh = kp(last.pose, 'right_hip')
    const la = kp(last.pose, 'left_ankle')
    const ra = kp(last.pose, 'right_ankle')
    if (lh && rh && la && ra) {
      const hipMid = (lh.x + rh.x) / 2
      const feetMid = (la.x + ra.x) / 2
      alignmentPct = Math.abs(hipMid - feetMid) / (baseSpan || 1)
    }
  }

  return {
    elbowCurvePct: Number.isFinite(elbowCurvePct) ? elbowCurvePct : 0,
    stabilityPct: Number.isFinite(stabilityPct) ? stabilityPct : 0,
    alignmentPct: Number.isFinite(alignmentPct) ? alignmentPct : 0,
    minElbowDeg: minElbow,
  }
}
