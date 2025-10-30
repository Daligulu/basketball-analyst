import type { CoachConfig } from '../../config/coach'
import type { PoseResult } from '../pose/poseEngine'

export type Sample = { t:number; pose: PoseResult }

function kp(p: PoseResult, name:string){ return p.keypoints.find(k=>k.name===name) }

function angleDeg(ax:number,ay:number, bx:number,by:number, cx:number,cy:number){
  const v1x = ax - bx, v1y = ay - by
  const v2x = cx - bx, v2y = cy - by
  const d1 = Math.hypot(v1x, v1y) || 1e-6
  const d2 = Math.hypot(v2x, v2y) || 1e-6
  const cos = (v1x*v2x + v1y*v2y) / (d1*d2)
  return Math.acos(Math.max(-1, Math.min(1, cos))) * 180/Math.PI
}

export function detectRelease(samples: Sample[], cfg: CoachConfig){
  const minElbow = cfg.releaseDetect?.minElbowDeg ?? 150
  for (let i=2; i<samples.length; i++){
    const a = samples[i-2], b = samples[i-1], c = samples[i]
    const rwA = kp(a.pose, 'right_wrist'); const rwB = kp(b.pose, 'right_wrist'); const rwC = kp(c.pose, 'right_wrist')
    if (!rwA || !rwB || !rwC) continue
    const dt = Math.max(1e-3, c.t - b.t)
    const vy = (rwC.y - rwB.y) / dt
    const vyPrev = (rwB.y - rwA.y) / Math.max(1e-3, b.t - a.t)
    const elb = angleDeg(
      kp(c.pose,'right_shoulder')?.x ?? 0, kp(c.pose,'right_shoulder')?.y ?? 0,
      kp(c.pose,'right_elbow')?.x ?? 0, kp(c.pose,'right_elbow')?.y ?? 0,
      kp(c.pose,'right_wrist')?.x ?? 0, kp(c.pose,'right_wrist')?.y ?? 0,
    )
    if (vyPrev < 0 && vy > 0 && elb >= minElbow){
      return { idx: i, elbowCurvePct: 0.02, stabilityPct: 0.01, alignmentPct: 0.02 }
    }
  }
  return { idx: undefined, elbowCurvePct: 0.02, stabilityPct: 0.01, alignmentPct: 0.02 }
}

export function sliceByTime<T extends {t:number}>(arr:T[], t0:number, t1:number){
  const a = Math.min(t0,t1), b = Math.max(t0,t1)
  return arr.filter(s=> s.t>=a && s.t<=b)
}
