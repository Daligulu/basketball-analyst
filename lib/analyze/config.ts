// lib/analyze/config.ts
// 前端可调的分析配置，全放这里。
// VideoAnalyzer 会把它存到 localStorage，改完马上生效。

// ====== 阈值类型 ======
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
    center100: number;   // 重心横向偏移小于这个百分比，100
    align100: number;    // 躯干/脚尖对齐角
  };
};

// ====== 姿态模型相关 ======
export type PoseConfig = {
  modelComplexity: 'lite' | 'full';
  smoothMinCutoff: number;
  smoothBeta: number;
  kpMinScore: number;
};

// ====== 有些版本的代码用的是这个结构 ======
export type PoseSmoothingConfig = {
  minCutoff: number;
  beta: number;
  dCutoff: number;
};

// ====== 总配置 ======
export type AnalyzeConfig = {
  // 我们这份项目里本来就有的
  pose: PoseConfig;
  // 你 Vercel 那份代码里 VideoAnalyzer.tsx 用到的
  poseSmoothing: PoseSmoothingConfig;
  thresholds: AnalyzeThresholds;
};

export const DEFAULT_ANALYZE_CONFIG: AnalyzeConfig = {
  pose: {
    modelComplexity: 'full',
    smoothMinCutoff: 1.15,
    smoothBeta: 0.05,
    kpMinScore: 0.35,
  },
  // 跟 pose 里的平滑参数保持一致，这样两个写法都能用
  poseSmoothing: {
    minCutoff: 1.15,
    beta: 0.05,
    dCutoff: 1.0,
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
    // ⭐⭐ 本次真正要改的地方：放宽平衡的容差 ⭐⭐
    balance: {
      // 原来是 1 和 2，太严了，手机一拍就是 0 分
      center100: 35,  // 重心横向偏到身体宽度的 35% 内都给 100
      align100: 30,   // 躯干与脚方向 30° 内都给 100
    },
  },
};

const STORAGE_KEY = 'basketball-analyze-config-v1';

// 做一层安全的合并，兼容老数据 & 老字段名
export function loadAnalyzeConfig(): AnalyzeConfig {
  if (typeof window === 'undefined') {
    return DEFAULT_ANALYZE_CONFIG;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_ANALYZE_CONFIG;
    }

    const parsed = JSON.parse(raw) as Partial<AnalyzeConfig> & {
      // 兼容有些老版本只存了 pose 或只存了 poseSmoothing
      pose?: Partial<PoseConfig>;
      poseSmoothing?: Partial<PoseSmoothingConfig>;
    };

    // ① 先把 pose 补全
    const mergedPose: PoseConfig = {
      ...DEFAULT_ANALYZE_CONFIG.pose,
      ...(parsed.pose ?? {}),
    };

    // ② 再把 poseSmoothing 补全（两个方向都兼容）
    // 情况 A：老版本只有 pose → 从 pose 里抄数
    // 情况 B：老版本只有 poseSmoothing → 下面也能吃
    const mergedPoseSmoothing: PoseSmoothingConfig = {
      ...DEFAULT_ANALYZE_CONFIG.poseSmoothing,
      ...(parsed.poseSmoothing ?? {}),
    };

    // 如果只有 pose，没有 poseSmoothing，就从 pose 里同步一次
    if (!parsed.poseSmoothing && parsed.pose) {
      mergedPoseSmoothing.minCutoff =
        parsed.pose.smoothMinCutoff ?? mergedPoseSmoothing.minCutoff;
      mergedPoseSmoothing.beta = parsed.pose.smoothBeta ?? mergedPoseSmoothing.beta;
      // dCutoff 一般没存，就用默认的 1.0
    }

    // 反过来：如果只有 poseSmoothing，没有 pose，就也同步一下
    if (!parsed.pose && parsed.poseSmoothing) {
      mergedPose.smoothMinCutoff =
        parsed.poseSmoothing.minCutoff ?? mergedPose.smoothMinCutoff;
      mergedPose.smoothBeta = parsed.poseSmoothing.beta ?? mergedPose.smoothBeta;
      // kpMinScore 就保持默认
    }

    // ③ 阈值合并
    const mergedThresholds: AnalyzeThresholds = {
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
    };

    // ④ ⭐ 我们要的关键兜底：如果本地还存着旧的 1 / 2，就强制提到新值
    if (mergedThresholds.balance.center100 < DEFAULT_ANALYZE_CONFIG.thresholds.balance.center100) {
      mergedThresholds.balance.center100 =
        DEFAULT_ANALYZE_CONFIG.thresholds.balance.center100;
    }
    if (mergedThresholds.balance.align100 < DEFAULT_ANALYZE_CONFIG.thresholds.balance.align100) {
      mergedThresholds.balance.align100 =
        DEFAULT_ANALYZE_CONFIG.thresholds.balance.align100;
    }

    return {
      pose: mergedPose,
      poseSmoothing: mergedPoseSmoothing,
      thresholds: mergedThresholds,
    };
  } catch (err) {
    console.warn('[analyze-config] parse failed', err);
    return DEFAULT_ANALYZE_CONFIG;
  }
}

export function saveAnalyzeConfig(cfg: AnalyzeConfig) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}
