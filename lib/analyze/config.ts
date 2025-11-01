// lib/analyze/config.ts
// 前端可调的分析配置，全放这里。
// VideoAnalyzer 会把它存到 localStorage，改完马上生效。

// ------------------ 基础类型 ------------------

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
    center100: number;       // 重心横向偏移(%) ≤ 这个给 100
    align100: number;        // 躯干-脚尖 夹角 ≤ 这个给 100
  };
};

export type PoseConfig = {
  modelComplexity: 'lite' | 'full';
  smoothMinCutoff: number;
  smoothBeta: number;
  kpMinScore: number;
};

// 线上版 VideoAnalyzer.tsx 已经在用的字段
export type PoseSmoothingConfig = {
  minCutoff: number;
  beta: number;
  dCutoff: number;
};

// 线上代码里是 analyzeConfig.model
export type PoseModel = 'mediapipe-full' | 'mediapipe-lite';

// ------------------ 总配置 ------------------

export type AnalyzeConfig = {
  // ⭐ 线上版需要的字段
  model: PoseModel;

  // ⭐ zip 版本里用的字段
  pose: PoseConfig;

  // ⭐ 线上版里用的字段
  poseSmoothing: PoseSmoothingConfig;

  // ⭐ 线上版 VideoAnalyzer.tsx 要展示的
  poseThreshold: number;

  thresholds: AnalyzeThresholds;
};

// ------------------ 默认配置（含这次的放宽） ------------------

export const DEFAULT_ANALYZE_CONFIG: AnalyzeConfig = {
  // 线上版用来判断 mediapipe Pose 的复杂度
  model: 'mediapipe-full',

  // 本地(zip)里的老写法
  pose: {
    modelComplexity: 'full',
    smoothMinCutoff: 1.15,
    smoothBeta: 0.05,
    kpMinScore: 0.35,
  },

  // 线上版的 OneEuro 参数
  poseSmoothing: {
    minCutoff: 1.15,
    beta: 0.05,
    dCutoff: 1.0,
  },

  // 线上组件要显示的“姿态阈值”
  // 你线上代码里画骨架用的是 0.28，这里就用 0.28
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
    // ⭐⭐ 本次真正要改的地方：放宽平衡容差 ⭐⭐
    balance: {
      // 原来是 1 / 2，太苛刻了
      center100: 35,  // 横向偏到 35% 身体宽度内算 100
      align100: 30,   // 躯干与脚方向 30° 内算 100
    },
  },
};

const STORAGE_KEY = 'basketball-analyze-config-v1';

// ------------------ 读取（带兼容） ------------------

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
      pose?: Partial<PoseConfig>;
      poseSmoothing?: Partial<PoseSmoothingConfig>;
      model?: PoseModel;
      poseThreshold?: number;
    };

    // 1) pose 合并
    const mergedPose: PoseConfig = {
      ...DEFAULT_ANALYZE_CONFIG.pose,
      ...(parsed.pose ?? {}),
    };

    // 2) poseSmoothing 合并
    const mergedPoseSmoothing: PoseSmoothingConfig = {
      ...DEFAULT_ANALYZE_CONFIG.poseSmoothing,
      ...(parsed.poseSmoothing ?? {}),
    };

    // 2.1 旧数据只有 pose → 同步到 poseSmoothing
    if (!parsed.poseSmoothing && parsed.pose) {
      mergedPoseSmoothing.minCutoff =
        parsed.pose.smoothMinCutoff ?? mergedPoseSmoothing.minCutoff;
      mergedPoseSmoothing.beta =
        parsed.pose.smoothBeta ?? mergedPoseSmoothing.beta;
    }

    // 2.2 旧数据只有 poseSmoothing → 同步回 pose
    if (!parsed.pose && parsed.poseSmoothing) {
      mergedPose.smoothMinCutoff =
        parsed.poseSmoothing.minCutoff ?? mergedPose.smoothMinCutoff;
      mergedPose.smoothBeta =
        parsed.poseSmoothing.beta ?? mergedPose.smoothBeta;
    }

    // 3) 阈值合并
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

    // 4) ⭐ 把旧的 1 / 2 自动抬高
    if (
      mergedThresholds.balance.center100 <
      DEFAULT_ANALYZE_CONFIG.thresholds.balance.center100
    ) {
      mergedThresholds.balance.center100 =
        DEFAULT_ANALYZE_CONFIG.thresholds.balance.center100;
    }
    if (
      mergedThresholds.balance.align100 <
      DEFAULT_ANALYZE_CONFIG.thresholds.balance.align100
    ) {
      mergedThresholds.balance.align100 =
        DEFAULT_ANALYZE_CONFIG.thresholds.balance.align100;
    }

    // 5) 线上版需要的 model
    const mergedModel: PoseModel =
      parsed.model ?? DEFAULT_ANALYZE_CONFIG.model;

    // 6) 线上版要展示的 poseThreshold
    const mergedPoseThreshold =
      typeof parsed.poseThreshold === 'number'
        ? parsed.poseThreshold
        : DEFAULT_ANALYZE_CONFIG.poseThreshold;

    return {
      model: mergedModel,
      pose: mergedPose,
      poseSmoothing: mergedPoseSmoothing,
      poseThreshold: mergedPoseThreshold,
      thresholds: mergedThresholds,
    };
  } catch (err) {
    console.warn('[analyze-config] parse failed', err);
    return DEFAULT_ANALYZE_CONFIG;
  }
}

// ------------------ 保存 ------------------

export function saveAnalyzeConfig(cfg: AnalyzeConfig) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}
