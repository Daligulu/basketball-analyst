// config/coach.ts

export type ScoreRule = {
  target: number
  tolerance: number
  unit?: 'deg' | 's' | 'pct' | string
  better?: 'closer' | '>=|' | '<=|'
}

export type CoachItem = {
  key: string
  label: string
  weight: number
  rule: ScoreRule
}

export type WeightBucket = {
  name: string
  weight: number
  items: CoachItem[]
}

export type ReleaseDetectConfig = {
  minElbowDeg?: number
  bodyWidthScale?: number
}

export type CoachConfig = {
  releaseDetect?: ReleaseDetectConfig
  weights: WeightBucket[]
}

export const DEFAULT_CONFIG: CoachConfig = {
  // 给 release.ts 用的配置
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
            tolerance: 0.3, // 稍微放宽，别老 0 分
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
