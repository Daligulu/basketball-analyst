// lib/analyze/config.ts
// 前端可调的分析配置，全放这里。
// VideoAnalyzer 会把它存到 localStorage，改完马上生效。

export type AnalyzeThresholds = {
  lower: {
    squat100: number;     // 下蹲膝角达到这个就是 100 分，角度越小越好
    kneeExt100: number;   // 伸膝角速度达到这个就是 100 分
  };
  upper: {
    releaseAngle100: number; // 出手角接近这个就是 100 分
    armPower100: number;     // 肘->腕 的摆动角速度
    follow100: number;       // 随挥保持时间（秒）
    elbowTight100: number;   // 肘部路径偏差在这个百分比以内给 100
  };
  balance: {
    center100: number;       // 重心偏移占身体宽度的百分比，小于这个给 100
    align100: number;        // 躯干-脚尖 夹角在多少度以内给 100
  };
};

export type AnalyzeConfig = {
  pose: {
    modelComplexity: 'full' | 'lite';
    smoothMinCutoff: number;
    smoothBeta: number;
    kpMinScore: number;
  };
  thresholds: AnalyzeThresholds;
};

export const DEFAULT_ANALYZE_CONFIG: AnalyzeConfig = {
  pose: {
    modelComplexity: 'full',
    smoothMinCutoff: 1.15,
    smoothBeta: 0.05,
    kpMinScore: 0.35,
  },
  thresholds: {
    lower: {
      squat100: 150,     // 库里原视频膝角差不多 150~160
      kneeExt100: 260,
    },
    upper: {
      releaseAngle100: 158,
      armPower100: 35,
      follow100: 0.4,
      elbowTight100: 2,
    },
    balance: {
      // 原来是 center100: 1, align100: 2，这个太苛刻了，
      // 实际手机拍摄很容易出现脚不在同一条水平线、镜头有一点斜的情况，
      // 会直接把“重心稳定”“对齐”都打成 0。
      // 这里一次性放宽到更接近日常拍摄的容差。
      center100: 35,  // 偏移在身体宽度的 35% 内算 100 分
      align100: 30,   // 躯干与脚的方向差 30° 内算 100 分
    },
  },
};

const STORAGE_KEY = 'basketball-analyze-config-v1';

export function loadAnalyzeConfig(): AnalyzeConfig {
  if (typeof window === 'undefined') return DEFAULT_ANALYZE_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ANALYZE_CONFIG;
    const parsed = JSON.parse(raw) as AnalyzeConfig;

    // 按原来的方式先合并一遍
    const merged: AnalyzeConfig = {
      ...DEFAULT_ANALYZE_CONFIG,
      ...parsed,
      pose: { ...DEFAULT_ANALYZE_CONFIG.pose, ...(parsed.pose ?? {}) },
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

    // 关键：如果本地还存着旧版本的 1 / 2，就强制抬到新值，避免再次出现 0 分
    const b = merged.thresholds.balance;
    merged.thresholds.balance = {
      ...b,
      center100: Math.max(b.center100, DEFAULT_ANALYZE_CONFIG.thresholds.balance.center100),
      align100: Math.max(b.align100, DEFAULT_ANALYZE_CONFIG.thresholds.balance.align100),
    };

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
