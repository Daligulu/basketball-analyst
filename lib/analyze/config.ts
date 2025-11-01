// lib/analyze/config.ts

// 整个前端分析的可调配置都放这里，方便面板里展示/以后做接口下发

export type AnalyzeConfig = {
  // mediapipe 用哪个复杂度
  model: 'mediapipe-full' | 'mediapipe-lite';
  // 关键点最低置信度，低于这个就当没检测到
  poseThreshold: number;
  // 前端 OneEuro 平滑
  poseSmoothing: {
    minCutoff: number;
    beta: number;
    dCutoff: number;
  };
  // 评分用的标准值，全放这里
  scoring: {
    lower: {
      // 下蹲角（膝角）小于等于这个视为 100 分
      squatKneeAngleIdeal: number;
      // 伸膝的目标角速度
      kneeExtSpeedIdeal: number;
    };
    upper: {
      // 出手角
      releaseAngleIdeal: number;
      // 腕部发力角度
      armPowerIdeal: number;
      // 随挥保持时间
      followHoldIdeal: number;
      // 肘部贴身百分比
      elbowTightPctIdeal: number;
    };
    balance: {
      // 横向重心偏移百分比（越小越好）
      swayPctIdeal: number;
      // 头肩到脚的纵向对齐角度，越接近 0 越好
      alignDegIdeal: number;
    };
  };
};

export const DEFAULT_ANALYZE_CONFIG: AnalyzeConfig = {
  model: 'mediapipe-full',
  poseThreshold: 0.35,
  poseSmoothing: {
    minCutoff: 1.15,
    beta: 0.05,
    dCutoff: 1.0,
  },
  scoring: {
    lower: {
      squatKneeAngleIdeal: 165, // 库里这种直上直下视频一般在 160~175
      kneeExtSpeedIdeal: 260, // 你之前页面里写的就是 260(度/秒)
    },
    upper: {
      releaseAngleIdeal: 158,
      armPowerIdeal: 35,
      followHoldIdeal: 0.4,
      elbowTightPctIdeal: 2,
    },
    balance: {
      swayPctIdeal: 1, // 1% 左右
      alignDegIdeal: 2, // 2 度左右
    },
  },
};
