// lib/analyze/config.ts
// 前端可调的分析配置，全放这里。

export type AnalyzeThresholds = {
  lower: {
    squat100: number;
    kneeExt100: number;
  };
  upper: {
    releaseAngle100: number;
    armPower100: number;
    follow100: number;
    elbowTight100: number;
  };
  balance: {
    center100: number;
    align100: number;
  };
};

export type PoseConfig = {
  modelComplexity: 'lite' | 'full';
  smoothMinCutoff: number;
  smoothBeta: number;
  kpMinScore: number;
};

export type PoseSmoothingConfig = {
  minCutoff: number;
  beta: number;
  dCutoff: number;
};

export type PoseModel = 'mediapipe-full' | 'mediapipe-lite';

export type AnalyzeConfig = {
  model: PoseModel;
  pose: PoseConfig;
  poseSmoothing: PoseSmoothingConfig;
  poseThreshold: number;
  thresholds: AnalyzeThresholds;
};

export const DEFAULT_ANALYZE_CONFIG: AnalyzeConfig = {
  model: 'mediapipe-full',
  pose: {
    modelComplexity: 'full',
    smoothMinCutoff: 1.15,
    smoothBeta: 0.05,
    kpMinScore: 0.35,
  },
  poseSmoothing: {
    minCutoff: 1.15,
    beta: 0.05,
    dCutoff: 1.0,
  },
  poseThreshold: 0.28,
  thresholds: {
    lower: {
      squat100: 150,
      kneeExt100: 260,
    },
    upper: {
      releaseAngle100: 158,
      armPower100: 35,
      follow100: 0.4,
      elbowTight100: 2,
    },
    // 放宽后的
    balance: {
      center100: 35,
      align100: 30,
    },
  },
};

const STORAGE_KEY = 'basketball-analyze-config-v1';

export function loadAnalyzeConfig(): AnalyzeConfig {
  if (typeof window === 'undefined') {
    return DEFAULT_ANALYZE_CONFIG;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ANALYZE_CONFIG;
    const parsed = JSON.parse(raw) as Partial<AnalyzeConfig>;

    const merged: AnalyzeConfig = {
      model: parsed.model ?? DEFAULT_ANALYZE_CONFIG.model,
      pose: {
        ...DEFAULT_ANALYZE_CONFIG.pose,
        ...(parsed.pose ?? {}),
      },
      poseSmoothing: {
        ...DEFAULT_ANALYZE_CONFIG.poseSmoothing,
        ...(parsed.poseSmoothing ?? {}),
      },
      poseThreshold:
        typeof parsed.poseThreshold === 'number'
          ? parsed.poseThreshold
          : DEFAULT_ANALYZE_CONFIG.poseThreshold,
      thresholds: {
        ...DEFAULT_ANALYZE_CONFIG.thresholds,
        ...(parsed.thresholds ?? {}),
        lower: {
          ...DEFAULT_ANALYZE_CONFIG.thresholds.lower,
          ...(parsed.thresholds?.lower ?? {}),
        },
        upper: {
          ...DEFAULT_ANALYZE_CONFIG.thresholds.upper,
          ...(parsed.thresholds?.upper ?? {}),
        },
        balance: {
          ...DEFAULT_ANALYZE_CONFIG.thresholds.balance,
          ...(parsed.thresholds?.balance ?? {}),
        },
      },
    };

    // 老数据如果还是 1 / 2，就抬到这次的 35 / 30
    if (
      merged.thresholds.balance.center100 <
      DEFAULT_ANALYZE_CONFIG.thresholds.balance.center100
    ) {
      merged.thresholds.balance.center100 =
        DEFAULT_ANALYZE_CONFIG.thresholds.balance.center100;
    }
    if (
      merged.thresholds.balance.align100 <
      DEFAULT_ANALYZE_CONFIG.thresholds.balance.align100
    ) {
      merged.thresholds.balance.align100 =
        DEFAULT_ANALYZE_CONFIG.thresholds.balance.align100;
    }

    return merged;
  } catch (err) {
    console.warn('[analyze-config] parse failed', err);
    return DEFAULT_ANALYZE_CONFIG;
  }
}

export function saveAnalyzeConfig(cfg: AnalyzeConfig) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}
