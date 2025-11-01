// lib/analyze/scoring.ts

import type { AnalyzeConfig } from './config';
import { DEFAULT_ANALYZE_CONFIG } from './config';
import type { PoseResult } from '../pose/poseEngine';

export type AnalyzeScore = {
  total: number;
  lower: {
    score: number;
    squat: { score: number; value: string };
    kneeExt: { score: number; value: string };
  };
  upper: {
    score: number;
    releaseAngle: { score: number; value: string };
    armPower: { score: number; value: string };
    follow: { score: number; value: string };
    elbowTight: { score: number; value: string };
  };
  balance: {
    score: number;
    center: { score: number; value: string };
    align: { score: number; value: string };
  };
};

// 统一一个空的，这样前端初始渲染不报错
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

// 辅助：小于 best 给 100；大于 worst 给 0；中间线性
function scoreLowerIsBetter(
  value: number,
  best: number,
  worst: number,
): number {
  if (value <= best) return 100;
  if (value >= worst) return 0;
  return Math.round(((worst - value) / (worst - best)) * 100);
}

// 辅助：贴近 target 给 100，偏离越大分越低
function scoreCloseTo(
  value: number,
  target: number,
  tolerance: number, // 容许±tolerance内满分
): number {
  const diff = Math.abs(value - target);
  if (diff <= tolerance) return 100;
  // 超过 3 * tolerance 就给 0
  const maxDiff = tolerance * 3;
  if (diff >= maxDiff) return 0;
  return Math.round(((maxDiff - diff) / (maxDiff - tolerance)) * 100);
}

// 你前端现在的调用：scoreFromPose(person, cfg)
export function scoreFromPose(
  pose: PoseResult | null,
  cfg: AnalyzeConfig = DEFAULT_ANALYZE_CONFIG,
): AnalyzeScore {
  if (!pose) return EMPTY_SCORE;

  // ⚠️ 这里很关键：
  // 在 VideoAnalyzer 里我们已经把所有一帧算出来的原始指标塞到了 pose.metrics 里
  // 这里把它安全地取出来，名字兼容几种写法，避免以后你改前端又要改这里
  const metrics =
    (pose as any).metrics ||
    (pose as any).analysis ||
    (pose as any).features ||
    {};

  const {
    squatKneeAngle,
    kneeExtSpeed,
    releaseAngle,
    armPower,
    followDuration,
    elbowTightPct,
    elbowTight, // 万一前端叫这个
    centerOffsetPct,
    alignDeg,
  } = metrics as {
    squatKneeAngle?: number;
    kneeExtSpeed?: number;
    releaseAngle?: number;
    armPower?: number;
    followDuration?: number;
    elbowTightPct?: number;
    elbowTight?: number;
    centerOffsetPct?: number;
    alignDeg?: number;
  };

  const t = cfg.targets;

  // ======================
  // 1) 下肢
  // ======================
  const squat = typeof squatKneeAngle === 'number'
    ? {
        score: scoreCloseTo(squatKneeAngle, t.squatKneeAngle, 15),
        value: `${squatKneeAngle.toFixed(2)}度`,
      }
    : { score: 0, value: '未检测' };

  const kneeExt = typeof kneeExtSpeed === 'number'
    ? {
        // 速度是“高于这个值给 100”，低了就按比例扣
        score:
          kneeExtSpeed >= t.kneeExtSpeed
            ? 100
            : Math.round((kneeExtSpeed / t.kneeExtSpeed) * 100),
        value: `${kneeExtSpeed.toFixed(0)}(度/秒)`,
      }
    : { score: 0, value: '未检测' };

  const lowerScore = Math.round(
    (squat.score * 0.5 + kneeExt.score * 0.5),
  );

  // ======================
  // 2) 上肢
  // ======================
  const rel = typeof releaseAngle === 'number'
    ? {
        score: scoreCloseTo(releaseAngle, t.releaseAngle, 10),
        value: `${releaseAngle.toFixed(2)}度`,
      }
    : { score: 0, value: '未检测' };

  const arm = typeof armPower === 'number'
    ? {
        score:
          armPower >= t.armPower
            ? 100
            : Math.round((armPower / t.armPower) * 100),
        value: `${armPower.toFixed(0)}度`,
      }
    : { score: 0, value: '未检测' };

  const follow = typeof followDuration === 'number'
    ? {
        score:
          followDuration >= t.followDuration
            ? 100
            : Math.round((followDuration / t.followDuration) * 100),
        value: `${followDuration.toFixed(2)}秒`,
      }
    : { score: 0, value: '未检测' };

  const elbowRaw = typeof elbowTightPct === 'number'
    ? elbowTightPct
    : typeof elbowTight === 'number'
      ? elbowTight
      : null;

  const elbow = elbowRaw !== null
    ? {
        score: scoreLowerIsBetter(
          elbowRaw,
          t.elbowCompactPct,
          // 给他一个比较宽的下限，避免一超就是 0
          Math.max(t.elbowCompactPct * 5, t.elbowCompactPct + 5),
        ),
        value: `${elbowRaw.toFixed(2)}%`,
      }
    : { score: 0, value: '未检测' };

  const upperScore = Math.round(
    (rel.score * 0.35 +
      arm.score * 0.25 +
      follow.score * 0.2 +
      elbow.score * 0.2),
  );

  // ======================
  // 3) 平衡与对齐
  // ======================
  const center = typeof centerOffsetPct === 'number'
    ? {
        // 偏移越小越好
        score: scoreLowerIsBetter(
          centerOffsetPct,
          t.centerOffsetPct,
          t.centerOffsetMaxPct,
        ),
        value: `${centerOffsetPct.toFixed(2)}%`,
      }
    : { score: 0, value: '未检测' };

  const align = typeof alignDeg === 'number'
    ? {
        score: scoreLowerIsBetter(
          alignDeg,
          t.alignDeg,
          t.alignMaxDeg,
        ),
        value: `${alignDeg.toFixed(2)}度`,
      }
    : { score: 0, value: '未检测' };

  // 这两个平均一下就是平衡大项
  const balanceScore = Math.round((center.score + align.score) / 2);

  // ======================
  // 4) 总分
  // ======================
  // 你页面上是 3 块：下肢 / 上肢 / 平衡
  // 我按 0.35 / 0.45 / 0.2 给一个比较像人能看的权重
  const total = Math.round(
    lowerScore * 0.35 + upperScore * 0.45 + balanceScore * 0.2,
  );

  return {
    total,
    lower: {
      score: lowerScore,
      squat,
      kneeExt,
    },
    upper: {
      score: upperScore,
      releaseAngle: rel,
      armPower: arm,
      follow,
      elbowTight: elbow,
    },
    balance: {
      score: balanceScore,
      center,
      align,
    },
  };
}
