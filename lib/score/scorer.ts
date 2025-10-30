// lib/score/scorer.ts
import {
  DEFAULT_CONFIG,
  type CoachConfig,
  type WeightBucket,
  type ScoreRule as CoachScoreRule,
} from '../../config/coach'

export type ScoreItem = {
  key: string
  label: string
  score: number
  value?: number
  unit?: string
}
export type Bucket = {
  name: string
  score: number
  items: ScoreItem[]
}
export type ScoreResult = {
  total: number
  buckets: Bucket[]
}

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x))
const isNum = (x: any): x is number => typeof x === 'number' && Number.isFinite(x)

// 算分层面的最低分（UI 再拉到 55）
const FLOOR = 20

function scoreByRule(value: number | undefined, rule: CoachScoreRule): number {
  if (!isNum(value)) return FLOOR
  const tgt = rule.target
  const tol = Math.max(1e-6, rule.tolerance ?? 0)
  const mode = rule.better ?? 'closer'

  // 1) 离目标越近越好
  if (mode === 'closer') {
    const diff = Math.abs(value - tgt)
    if (diff >= tol) return FLOOR
    return clamp(100 * (1 - diff / tol))
  }

  // 2) 越大越好
  if (mode === '>=|') {
    if (value >= tgt) return 100
    if (value <= tgt - tol) return FLOOR
    return clamp(100 * (value - (tgt - tol)) / tol)
  }

  // 3) 越小越好 (<=|)
  if (value <= tgt) return 100
  if (value >= tgt + tol) return FLOOR
  return clamp(100 * (1 - (value - tgt) / tol))
}

export type FeatureVector = {
  kneeDepth?: number
  extendSpeed?: number
  releaseAngle?: number
  wristFlex?: number
  followThrough?: number
  elbowCurve?: number
  stability?: number
  alignment?: number
}

export function scoreAngles(features: FeatureVector, coach: CoachConfig = DEFAULT_CONFIG): ScoreResult {
  const buckets: Bucket[] = []
  const weights = (coach as any).weights as WeightBucket[]

  for (const bucket of weights) {
    const items: ScoreItem[] = []
    for (const it of bucket.items) {
      const v = (features as any)[it.key] as number | undefined
      const score = scoreByRule(v, it.rule)
      items.push({
        key: it.key,
        label: it.label,
        score: Math.round(score),
        value: v,
        unit: it.rule.unit,
      })
    }

    const bucketScore = items.length ? Math.round(items.reduce((s, x) => s + x.score, 0) / items.length) : 0
    buckets.push({
      name: bucket.name,
      score: bucketScore,
      items,
    })
  }

  // 总分：按大项权重来
  const totalWeight = buckets.reduce((s, b, i) => {
    const w = weights?.[i]?.weight ?? 1
    return s + w
  }, 0)

  const total =
    totalWeight > 0
      ? Math.round(
          buckets.reduce((s, b, i) => {
            const w = weights?.[i]?.weight ?? 1
            return s + b.score * w
          }, 0) / totalWeight,
        )
      : 0

  return {
    total: clamp(total),
    buckets,
  }
}
