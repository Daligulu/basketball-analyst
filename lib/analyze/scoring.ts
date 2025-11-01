// lib/analyze/scoring.ts
// 统一的打分逻辑：把「算出来的原始指标」→「0~100 分」→ 汇总成你页面上那三个大块
// 这个版本的重点是：把「对齐与平衡」这块放宽，不要再一言不合就是 0 分。

export type PoseAnalyzeInput = {
  // ↓ 这几个名字就是 VideoAnalyzer 那边塞进来的字段名
  // 下肢
  squatKneeAngle?: number;     // 单位：度，比如 172.48
  kneeExtSpeed?: number;       // 单位：度/秒，比如 260

  // 上肢
  releaseAngle?: number;       // 单位：度，比如 167
  armPowerAngle?: number;      // 单位：度，腕/小臂的夹角，比如 35
  followDuration?: number;     // 单位：秒，比如 0.4
  elbowTightness?: number;     // 单位：比例，比如 0.02 = 2%

  // 平衡
  swayPercent?: number;        // 单位：比例，比如 0.2868 = 28.68%
  alignAngle?: number;         // 单位：度，比如 12.9
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

// 一些默认的“打 100 分”的目标值 —— 和你页面上现在展示的数是一致的
const TARGETS = {
  lower: {
    squatAngle: 165,     // 理想的膝角，越接近越好
    kneeExtSpeed: 260,   // 伸膝速度，越大越好
  },
  upper: {
    releaseAngle: 158,   // 出手角，越接近越好
    armPowerAngle: 35,   // 腕部发力角，越接近越好
    followDuration: 0.4, // 随挥保持时间，越接近越好
    elbowTight: 0.02,    // 肘部路径紧凑，越小越好（2%）
  },
  balance: {
    // 这里是这次真正要放宽的两个值 👇
    centerSway100: 0.08, // 8% 横摆以内给 100 分（你之前是 1% 左右，太狠了）
    alignAngle100: 5,    // 5° 以内给 100 分
  },
};

// 工具函数：值越接近 target 越好
function scoreAroundTarget(
  v: number | undefined,
  target: number,
  tolerance: number,     // 容忍范围，比如 ±8°
  hardZeroMul = 3        // 超过多少倍容忍范围直接给 0
): number {
  if (v == null) return 0;
  const diff = Math.abs(v - target);
  if (diff <= tolerance) return 100;
  const maxDiff = tolerance * hardZeroMul;
  if (diff >= maxDiff) return 0;
  // 线性往下掉
  return Math.round(100 - ((diff - tolerance) / (maxDiff - tolerance)) * 100);
}

// 工具函数：值越大越好
function scoreBiggerBetter(v: number | undefined, target: number): number {
  if (v == null) return 0;
  if (v >= target) return 100;
  return Math.round((v / target) * 100);
}

// 工具函数：值越小越好
function scoreSmallerBetter(
  v: number | undefined,
  best: number,
  worst?: number  // 不传就自动 = best * 5
): number {
  if (v == null) return 0;
  const hard0 = worst ?? best * 5;
  if (v <= best) return 100;
  if (v >= hard0) return 0;
  return Math.round(100 - ((v - best) / (hard0 - best)) * 100);
}

/**
 * 主入口：VideoAnalyzer 最后就是调这个
 */
export function scoreFromPose(data: PoseAnalyzeInput | null): AnalyzeScore {
  // 防御
  const d = data ?? {};

  // 1️⃣ 下肢
  const squatScore = scoreAroundTarget(
    d.squatKneeAngle,
    TARGETS.lower.squatAngle,
    8 // 膝角 ±8° 都算好
  );
  const kneeExtScore = scoreBiggerBetter(d.kneeExtSpeed, TARGETS.lower.kneeExtSpeed);
  const lowerScore = Math.round((squatScore + kneeExtScore) / 2);

  // 2️⃣ 上肢
  const releaseScore = scoreAroundTarget(d.releaseAngle, TARGETS.upper.releaseAngle, 10);
  const armPowerScore = scoreAroundTarget(d.armPowerAngle, TARGETS.upper.armPowerAngle, 6);
  const followScore = scoreAroundTarget(d.followDuration, TARGETS.upper.followDuration, 0.12);
  const elbowScore = scoreSmallerBetter(d.elbowTightness, TARGETS.upper.elbowTight, TARGETS.upper.elbowTight * 6);
  const upperScore = Math.round(
    (releaseScore + armPowerScore + followScore + elbowScore) / 4
  );

  // 3️⃣ 对齐与平衡（这次的重点）
  // 页面上你看到的是 “28.68%” 这种，就是 0.2868 * 100 的结果，
  // 所以内存里我们就按 0.2868 这个小数来算
  const sway = d.swayPercent;             // 小数，例如 0.2868
  const align = d.alignAngle;             // 度，例如 12.9

  // 横摆：8% 内 100 分，40%（= 0.08 * 5）以后掉到 0 分
  const balanceCenterScore = scoreSmallerBetter(sway, TARGETS.balance.centerSway100, TARGETS.balance.centerSway100 * 5);

  // 对齐角：5° 内 100 分，20° 以后 0 分
  const balanceAlignScore = scoreSmallerBetter(align, TARGETS.balance.alignAngle100, 20);

  const balanceScore = Math.round((balanceCenterScore + balanceAlignScore) / 2);

  // 总分 = 3 大项平均
  const total = Math.round((lowerScore + upperScore + balanceScore) / 3);

  return {
    total,
    lower: {
      score: lowerScore,
      squat: {
        score: squatScore,
        value:
          d.squatKneeAngle != null ? `${d.squatKneeAngle.toFixed(2)}度` : '未检测',
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
        value:
          sway != null ? `${(sway * 100).toFixed(2)}%` : '未检测',
      },
      align: {
        score: balanceAlignScore,
        value:
          align != null ? `${align.toFixed(2)}度` : '未检测',
      },
    },
  };
}
