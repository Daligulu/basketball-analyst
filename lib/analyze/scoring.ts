// lib/analyze/scoring.ts
// 把“算出来的动作指标” → “0~100 分”
// 这版修了两个点：
// 1. 加回 EMPTY_SCORE，给 VideoAnalyzer 初始渲染用（否则 Vercel 报你刚才那个错）
// 2. 放宽 “对齐与平衡” 的打分，不再一上来就是 0

export type PoseAnalyzeInput = {
  // ↓ 下肢
  squatKneeAngle?: number;   // 膝角，度
  kneeExtSpeed?: number;     // 伸膝速度，度/秒

  // ↓ 上肢
  releaseAngle?: number;     // 出手角，度
  armPowerAngle?: number;    // 腕/小臂发力角，度
  followDuration?: number;   // 随挥保持时间，秒
  elbowTightness?: number;   // 肘部路径紧凑度，0~1（比如 0.02 = 2%）

  // ↓ 平衡
  swayPercent?: number;      // 横摆百分比，0~1（比如 0.2868 = 28.68%）
  alignAngle?: number;       // 对齐角，度（比如 12.9）
};

export type SubScore = {
  score: number;
  value: string;
};

export type AnalyzeScore = {
  total: number;
  lower: {
    score: number;
    squat: SubScore;
    kneeExt: SubScore;
  };
  upper: {
    score: number;
    releaseAngle: SubScore;
    armPower: SubScore;
    follow: SubScore;
    elbowTight: SubScore;
  };
  balance: {
    score: number;
    center: SubScore;
    align: SubScore;
  };
};

// 你页面上显示的那些“基准值”
const TARGETS = {
  lower: {
    squatAngle: 165,     // 理想膝角
    kneeExtSpeed: 260,   // 理想伸膝速度
  },
  upper: {
    releaseAngle: 158,   // 理想出手角
    armPowerAngle: 35,   // 理想腕部发力角
    followDuration: 0.4, // 理想随挥时间
    elbowTight: 0.02,    // 2% 以内算很好
  },
  balance: {
    centerSway100: 0.08, // 横摆 8% 以内给 100 分（这就是这次放宽的关键）
    alignAngle100: 5,    // 对齐 5° 以内给 100 分
  },
};

// ========= 工具函数们 =========

// ① 值越接近 target 越好，超出一定范围线性扣到 0
function scoreAroundTarget(
  v: number | undefined,
  target: number,
  tolerance: number,
  hardZeroMul = 3
): number {
  if (v == null) return 0;
  const diff = Math.abs(v - target);
  if (diff <= tolerance) return 100;
  const maxDiff = tolerance * hardZeroMul;
  if (diff >= maxDiff) return 0;
  return Math.round(100 - ((diff - tolerance) / (maxDiff - tolerance)) * 100);
}

// ② 值越大越好
function scoreBiggerBetter(v: number | undefined, target: number): number {
  if (v == null) return 0;
  if (v >= target) return 100;
  return Math.round((v / target) * 100);
}

// ③ 值越小越好
function scoreSmallerBetter(
  v: number | undefined,
  best: number,
  worst?: number
): number {
  if (v == null) return 0;
  const hard0 = worst ?? best * 5;
  if (v <= best) return 100;
  if (v >= hard0) return 0;
  return Math.round(100 - ((v - best) / (hard0 - best)) * 100);
}

// ========= 主打分入口 =========

export function scoreFromPose(data: PoseAnalyzeInput | null): AnalyzeScore {
  const d = data ?? {};

  // 1) 下肢
  const squatScore = scoreAroundTarget(
    d.squatKneeAngle,
    TARGETS.lower.squatAngle,
    8 // ±8°
  );
  const kneeExtScore = scoreBiggerBetter(d.kneeExtSpeed, TARGETS.lower.kneeExtSpeed);
  const lowerScore = Math.round((squatScore + kneeExtScore) / 2);

  // 2) 上肢
  const releaseScore = scoreAroundTarget(d.releaseAngle, TARGETS.upper.releaseAngle, 10);
  const armPowerScore = scoreAroundTarget(d.armPowerAngle, TARGETS.upper.armPowerAngle, 6);
  const followScore = scoreAroundTarget(d.followDuration, TARGETS.upper.followDuration, 0.12);
  const elbowScore = scoreSmallerBetter(
    d.elbowTightness,
    TARGETS.upper.elbowTight,
    TARGETS.upper.elbowTight * 6
  );
  const upperScore = Math.round(
    (releaseScore + armPowerScore + followScore + elbowScore) / 4
  );

  // 3) 平衡与对齐（这次的重点）
  const sway = d.swayPercent;  // 比如 0.2868
  const align = d.alignAngle;  // 比如 12.9

  // 横摆：<=8% → 100；>=40% → 0；中间线性
  const balanceCenterScore = scoreSmallerBetter(
    sway,
    TARGETS.balance.centerSway100,
    TARGETS.balance.centerSway100 * 5
  );

  // 对齐：<=5° → 100；>=20° → 0；中间线性
  const balanceAlignScore = scoreSmallerBetter(
    align,
    TARGETS.balance.alignAngle100,
    20
  );

  const balanceScore = Math.round((balanceCenterScore + balanceAlignScore) / 2);

  // 4) 总分 = 三大块平均
  const total = Math.round((lowerScore + upperScore + balanceScore) / 3);

  return {
    total,
    lower: {
      score: lowerScore,
      squat: {
        score: squatScore,
        value: d.squatKneeAngle != null ? `${d.squatKneeAngle.toFixed(2)}度` : '未检测',
      },
      kneeExt: {
        score: kneeExtScore,
        value: d.kneeExtSpeed != null ? `${d.kneeExtSpeed.toFixed(0)}(度/秒)` : '未检测',
      },
    },
    upper: {
      score: upperScore,
      releaseAngle: {
        score: releaseScore,
        value: d.releaseAngle != null ? `${d.releaseAngle.toFixed(2)}度` : '未检测',
      },
      armPower: {
        score: armPowerScore,
        value: d.armPowerAngle != null ? `${d.armPowerAngle.toFixed(0)}度` : '未检测',
      },
      follow: {
        score: followScore,
        value: d.followDuration != null ? `${d.followDuration.toFixed(2)}秒` : '未检测',
      },
      elbowTight: {
        score: elbowScore,
        value:
          d.elbowTightness != null ? `${(d.elbowTightness * 100).toFixed(2)}%` : '未检测',
      },
    },
    balance: {
      score: balanceScore,
      center: {
        score: balanceCenterScore,
        value: sway != null ? `${(sway * 100).toFixed(2)}%` : '未检测',
      },
      align: {
        score: balanceAlignScore,
        value: align != null ? `${align.toFixed(2)}度` : '未检测',
      },
    },
  };
}

// ========= 给前端初始用的空分数 =========

export const EMPTY_SCORE: AnalyzeScore = {
  total: 0,
  lower: {
    score: 0,
    squat: { score: 0, value: '未检测' },
    kneeExt: { score: 0, value: '未检测' },
  },
  upper: {
    score: 0,
    releaseAngle: { score: 0, value: '未检测' },
    armPower: { score: 0, value: '未检测' },
    follow: { score: 0, value: '未检测' },
    elbowTight: { score: 0, value: '未检测' },
  },
  balance: {
    score: 0,
    center: { score: 0, value: '未检测' },
    align: { score: 0, value: '未检测' },
  },
};
