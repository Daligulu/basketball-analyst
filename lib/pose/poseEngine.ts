// lib/pose/poseEngine.ts
// 统一的姿态结果结构 + 选人 + 平滑
// 给已有的 lib/analyze/*.ts 用的

import { OneEuro2D, OneEuroConfig } from './oneEuro2d';

export type PoseKeypoint = {
  name: string;
  x: number;
  y: number;
  score?: number;
};

export type PoseResult = {
  keypoints: PoseKeypoint[];
  box?: { x: number; y: number; width: number; height: number };
  score?: number;
  ts?: number;
};

export type MultiPersonFrame = {
  persons: PoseResult[];
  ts: number; // ms
};

type EngineOpts = {
  smooth?: Partial<OneEuroConfig>;
};

export class PoseEngine {
  private smoothers: Record<string, OneEuro2D> = {};
  private smoothCfg: OneEuroConfig;

  constructor(opts?: EngineOpts) {
    this.smoothCfg = {
      minCutoff: 1.15,
      beta: 0.05,
      dCutoff: 1.0,
      ...(opts?.smooth ?? {}),
    };
  }

  // 只要一个人：选得分最高的那个人 + 平滑
  process(frame: MultiPersonFrame): PoseResult | null {
    if (!frame.persons || frame.persons.length === 0) return null;

    const best = [...frame.persons]
      .map((p) => ({
        p,
        sc:
          p.score ??
          p.keypoints.reduce((s, k) => s + (k.score ?? 0), 0) / Math.max(p.keypoints.length, 1),
      }))
      .sort((a, b) => b.sc - a.sc)[0].p;

    const tSec = frame.ts / 1000;

    const keypoints = best.keypoints.map((kp) => {
      const id = kp.name;
      if (!this.smoothers[id]) {
        this.smoothers[id] = new OneEuro2D(this.smoothCfg);
      }
      const smoothed = this.smoothers[id].filter(kp.x, kp.y, tSec);
      return { ...kp, x: smoothed.x, y: smoothed.y };
    });

    return {
      ...best,
      keypoints,
      ts: frame.ts,
    };
  }
}
