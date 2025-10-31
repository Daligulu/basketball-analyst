// lib/pose/poseEngine.ts
// 一个极简的前端姿态后处理器，把多人的一帧 -> 单人、并做一下平滑

export type Keypoint2D = {
  name: string;
  x: number;
  y: number;
  score?: number;
};

export type Person2D = {
  keypoints: Keypoint2D[];
  box?: { x: number; y: number; w: number; h: number };
  score?: number;
};

export type MultiPersonFrame = {
  persons: Person2D[];
  ts: number; // ms
};

export type PoseResult = Person2D | null;

export type SmoothConfig = {
  minCutoff: number;
  beta: number;
  dCutoff: number;
};

// -------------------- OneEuro2D 内嵌版 --------------------
class OneEuro2D {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private prevTime: number | null = null;
  private prev: { [name: string]: { x: number; y: number } } = {};

  constructor(cfg: SmoothConfig) {
    this.minCutoff = cfg.minCutoff;
    this.beta = cfg.beta;
    this.dCutoff = cfg.dCutoff;
  }

  private alpha(dt: number, cutoff: number) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  private filterPoint(
    name: string,
    x: number,
    y: number,
    dt: number
  ): { x: number; y: number } {
    const prev = this.prev[name];
    if (!prev) {
      this.prev[name] = { x, y };
      return { x, y };
    }

    // 简化版：不做速度滤波，直接一阶低通
    const alpha = this.alpha(dt, this.minCutoff);
    const nx = prev.x + alpha * (x - prev.x);
    const ny = prev.y + alpha * (y - prev.y);
    this.prev[name] = { x: nx, y: ny };
    return { x: nx, y: ny };
  }

  smooth(
    kps: Keypoint2D[],
    ts: number
  ): Keypoint2D[] {
    if (this.prevTime == null) {
      this.prevTime = ts;
      // 第一次不动
      for (const kp of kps) {
        this.prev[kp.name] = { x: kp.x, y: kp.y };
      }
      return kps;
    }
    const dt = Math.max((ts - this.prevTime) / 1000, 1e-3);
    this.prevTime = ts;
    return kps.map((kp) => {
      const sm = this.filterPoint(kp.name, kp.x, kp.y, dt);
      return { ...kp, x: sm.x, y: sm.y };
    });
  }
}

// -------------------- PoseEngine 本体 --------------------
export type CoachConfig = {
  smooth?: SmoothConfig;
};

export class PoseEngine {
  private cfg: CoachConfig;
  private filter: OneEuro2D | null = null;

  constructor(cfg: CoachConfig) {
    this.cfg = cfg;
    if (cfg.smooth) {
      this.filter = new OneEuro2D(cfg.smooth);
    }
  }

  /**
   * 输入一帧多人的检测，输出 1 个人（优先选面积最大的）
   */
  process(frame: MultiPersonFrame): PoseResult {
    const persons = frame?.persons ?? [];
    if (!persons.length) return null;

    // 1. 先选一个最像“前景人物”的
    const best = persons
      .map((p) => {
        const box = p.box;
        const area = box ? box.w * box.h : 0;
        return { person: p, area };
      })
      .sort((a, b) => b.area - a.area)[0].person;

    let kps = best.keypoints ?? [];
    // 2. 做平滑
    if (this.filter) {
      kps = this.filter.smooth(kps, frame.ts);
    }

    return {
      ...best,
      keypoints: kps,
    };
  }
}
