// config/coach.ts

export type ScoreBetter = 'closer' | '>=|' | '<=|'

export type ScoreRule = {
  target: number
  tolerance: number
  unit?: 'deg' | 'pct' | 'px' | 's'
  better?: ScoreBetter
}

export type WeightItem = {
  key: string
  label: string
  weight: number
  rule: ScoreRule
}

export type WeightBucket = {
  name: '下肢动力链' | '上肢出手' | '对齐与平衡' | string
  weight: number
  items: WeightItem[]
}

export type ReleaseDetectConfig = {
  minElbowDeg?: number
  bodyWidthScale?: number
}

export type ScoringWindow = {
  preReleaseSec?: number
  postReleaseSec?: number
}

export type CoachConfig = {
  modelPreference: 'blaze-full' | 'blaze-lite' | 'movenet'
  enableSmartCrop: boolean
  enableOpenCV: boolean
  smooth: { minCutoff: number; beta: number; dCutoff: number }
  thresholds: {
    kneeMin: number
    kneeMax: number
    releaseAngleIdeal: number
    lateralOffsetMaxPct: number
  }
  scoring?: ScoringWindow
  releaseDetect?: ReleaseDetectConfig
  weights: WeightBucket[]
}

export const DEFAULT_CONFIG: CoachConfig = {
  modelPreference: 'movenet',
  enableSmartCrop: true,
  enableOpenCV: false,
  smooth: {
    minCutoff: 1,
    beta: 0.02,
    dCutoff: 1,
  },
  thresholds: {
    kneeMin: 60,
    kneeMax: 140,
    releaseAngleIdeal: 115,
    lateralOffsetMaxPct: 0.12,
  },
  scoring: {
    preReleaseSec: 0.25,
    postReleaseSec: 0.45,
  },
  releaseDetect: {
    minElbowDeg: 150,
    bodyWidthScale: 3,
  },
  weights: [
    {
      name: '下肢动力链',
      weight: 0.34,
      items: [
        {
          key: 'kneeDepth',
          label: '下蹲深度(膝角)',
          weight: 0.5,
          rule: {
            target: 95,
            tolerance: 35,
            unit: 'deg',
            better: 'closer',
          },
        },
        {
          key: 'extendSpeed',
          label: '伸膝速度',
          weight: 0.5,
          rule: {
            target: 260,
            tolerance: 180,
            unit: 'deg',
            better: '>=|',
          },
        },
      ],
    },
    {
      name: '上肢出手',
      weight: 0.33,
      items: [
        {
          key: 'releaseAngle',
          label: '出手角',
          weight: 0.35,
          rule: {
            target: 115,
            tolerance: 30,
            unit: 'deg',
            better: 'closer',
          },
        },
        {
          key: 'wristFlex',
          label: '腕部发力',
          weight: 0.25,
          rule: {
            target: 35,
            tolerance: 25,
            unit: 'deg',
            better: '>=|',
          },
        },
        {
          key: 'followThrough',
          label: '随挥保持',
          weight: 0.2,
          rule: {
            target: 0.35,
            tolerance: 0.25,
            unit: 's',
            better: '>=|',
          },
        },
        {
          key: 'elbowCurve',
          label: '肘部路径紧凑',
          weight: 0.2,
          rule: {
            target: 0,
            tolerance: 0.3, // 放宽，别老 0 分
            unit: 'pct',
            better: '<=|',
          },
        },
      ],
    },
    {
      name: '对齐与平衡',
      weight: 0.33,
      items: [
        {
          key: 'stability',
          label: '重心稳定(横摆)',
          weight: 0.5,
          rule: {
            target: 0,
            tolerance: 0.09,
            unit: 'pct',
            better: '<=|',
          },
        },
        {
          key: 'alignment',
          label: '对齐',
          weight: 0.5,
          rule: {
            target: 0,
            tolerance: 0.12, // 放宽
            unit: 'pct',
            better: '<=|',
          },
        },
      ],
    },
  ],
}
