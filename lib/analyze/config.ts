// lib/analyze/config.ts

export type SmoothConfig = {
  minCutoff: number;
  beta: number;
};

export type AnalyzeTargets = {
  // 下肢
  squatKneeAngle: number;      // 膝角最好值，越接近越高分，例如 170°
  kneeExtSpeed: number;        // 伸膝速度达到这个值给 100 分，例如 260 (deg/s)

  // 上肢
  releaseAngle: number;        // 出手角最好值，例如 165°
  armPower: number;            // 腕部甩动角，达到给 100 分，例如 35°
  followDuration: number;      // 随挥保持时间(s)，达到给 100 分，例如 0.4
  elbowCompactPct: number;     // 肘部路径离散度(%)，这里是“最好 <= 这个值”，例如 2%

  // 平衡
  centerOffsetPct: number;     // 重心左右偏移，<= 这个值给 100 分，例如 8%
  centerOffsetMaxPct: number;  // 偏移到这个值就给 0 分，例如 35%

  alignDeg: number;            // 肩-髋对齐，<= 这个角度给 100 分，例如 5°
  alignMaxDeg: number;         // 超过这个角度给 0 分，例如 25°
};

export type AnalyzeConfig = {
  poseScoreThreshold: number;  // 小于这个置信度的关键点不参与分析
  smooth: SmoothConfig;
  targets: AnalyzeTargets;
};

export const DEFAULT_ANALYZE_CONFIG: AnalyzeConfig = {
  poseScoreThreshold: 0.35,
  smooth: {
    minCutoff: 1.15,
    beta: 0.05,
  },
  targets: {
    // 下面这几个就是你说的“配置面板里希望能调的值”
    squatKneeAngle: 170,
    kneeExtSpeed: 260,

    releaseAngle: 165,
    armPower: 35,
    followDuration: 0.4,
    elbowCompactPct: 2,

    // 这里我调宽了一点，这样你视频里那个 28% 就不会直接变 0 分了
    centerOffsetPct: 8,
    centerOffsetMaxPct: 35,

    alignDeg: 5,
    alignMaxDeg: 25,
  },
};
