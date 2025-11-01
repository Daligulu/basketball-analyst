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

// 这是线上版 VideoAnalyzer.tsx 已经在用的字段
export type PoseSmoothingConfig = {
  minCutoff: number;
  beta: number;
  dCutoff: number;
};

// 线上那份代码里出现的是 analyzeConfig.model
// 我们就直接按它的叫法给出来
export type PoseModel = 'mediapipe-full' | 'mediapipe-lite';

// ------------------ 总配置 ------------------

export type AnalyzeConfig = {
  // ⭐ 线上版需要的字段
  model: PoseModel;

  // ⭐ zip 版本里用的字段
  pose: PoseConfig;

  // ⭐ 线上版里用的字段
  poseSmoothing: PoseSmoothingConfig;

  thresholds: AnalyzeThresholds;

  // 给将来/别的分支撑个兜底
  [key: string]: unknown;
};

// ------------------ 默认配置（这次的重点改动也在这） ------------------

export const DEFAULT_ANALYZE_CONFIG: AnalyzeConfig = {
  // 线上版用来判断 new Pose(...) 里 modelComplexity 的
  model: 'mediapipe-full',

  // 本地(zip)版一直都有的
  pose: {
    modelComplexity: 'full',
    smoothMinCutoff: 1.15,
    smoothBeta: 0.05,
    kpMinScore: 0.35,
  },

  // 给线上版的 engineRef / PoseCtor 用的平滑参数
  poseSmoothing: {
    minCutoff: 1.15,
    beta: 0.05,
    dCutoff: 1.0,
  },

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
    // ⭐⭐ 本次要放宽的地方 ⭐⭐
    balance: {
      // 原始代码是 center100: 1, align100: 2 导致你截图里两个都是 0
      // 放到日常手机拍摄能接受的范围
      center100: 35,  // 横向偏到 35% 身体宽度内算 100 分
      align100: 30,   // 躯干和脚方向在 30° 内算 100 分
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
      // 老版本里可能只有 pose / 没有 poseSmoothing / 没有 model
      pose?: Partial<PoseConfig>;
      poseSmoothing?: Partial<PoseSmoothingConfig>;
      model?: PoseModel;
    };

    // 1) 先合并 pose
    const mergedPose: PoseConfig = {
      ...DEFAULT_ANALYZE_CONFIG.pose,
      ...(parsed.pose ?? {}),
    };

    // 2) 再合并 poseSmoothing
    const mergedPoseSmoothing: PoseSmoothingConfig = {
      ...DEFAULT_ANALYZE_CONFIG.poseSmoothing,
      ...(parsed.poseSmoothing ?? {}),
    };

    // 2.1 老数据只有 pose，没有 poseSmoothing → 从 pose 里抄一份
    if (!parsed.poseSmoothing && parsed.pose) {
      mergedPoseSmoothing.minCutoff =
        parsed.pose.smoothMinCutoff ?? mergedPoseSmoothing.minCutoff;
      mergedPoseSmoothing.beta =
        parsed.pose.smoothBeta ?? mergedPoseSmoothing.beta;
      // dCutoff 没有就用默认的 1.0
    }

    // 2.2 反方向：只有 poseSmoothing，没有 pose → 同步到 pose
    if (!parsed.pose && parsed.poseSmoothing) {
      mergedPose.smoothMinCutoff =
        parsed.poseSmoothing.minCutoff ?? mergedPose.smoothMinCutoff;
      mergedPose.smoothBeta =
        parsed.poseSmoothing.beta ?? mergedPose.smoothBeta;
    }

    // 3) 合并 thresholds
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

    // 4) ⭐ 关键兜底：如果本地还存着老的 1 / 2，就自动抬到我们这次的放宽值
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

    // 5) ⭐ 线上版需要的 model，没有就给默认的
    const mergedModel: PoseModel =
      parsed.model ?? DEFAULT_ANALYZE_CONFIG.model;

    return {
      model: mergedModel,
      pose: mergedPose,
      poseSmoothing: mergedPoseSmoothing,
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
