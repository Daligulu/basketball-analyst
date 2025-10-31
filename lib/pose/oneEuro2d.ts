// lib/pose/oneEuro2d.ts
// 给 2D 坐标做 One Euro 滤波，供姿态关键点防抖用

export type SmoothConfig = {
  minCutoff: number;
  beta: number;
  dCutoff: number;
};

class OneEuro1D {
  private prevX: number | null = null;
  private prevDx: number | null = null;
  private prevT: number | null = null;
  private cfg: SmoothConfig;

  constructor(cfg: SmoothConfig) {
    this.cfg = cfg;
  }

  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, t: number): number {
    if (this.prevT == null) {
      this.prevT = t;
      this.prevX = x;
      this.prevDx = 0;
      return x;
    }

    const dt = t - this.prevT;
    const realDt = dt > 1e-6 ? dt : 1e-6;

    // 一阶导数估计
    const dx = (x - (this.prevX as number)) / realDt;
    const aD = this.alpha(this.cfg.dCutoff, realDt);
    const dxHat =
      this.prevDx == null ? dx : aD * dx + (1 - aD) * (this.prevDx as number);

    // 动态截止频率
    const cutoff = this.cfg.minCutoff + this.cfg.beta * Math.abs(dxHat);

    // 真正滤波
    const a = this.alpha(cutoff, realDt);
    const xHat = a * x + (1 - a) * (this.prevX as number);

    this.prevX = xHat;
    this.prevDx = dxHat;
    this.prevT = t;

    return xHat;
  }
}

export class OneEuro2D {
  private fx: OneEuro1D;
  private fy: OneEuro1D;

  constructor(cfg: SmoothConfig) {
    const safe: SmoothConfig = {
      minCutoff: cfg?.minCutoff ?? 1.0,
      beta: cfg?.beta ?? 0.0,
      dCutoff: cfg?.dCutoff ?? 1.0,
    };
    this.fx = new OneEuro1D(safe);
    this.fy = new OneEuro1D(safe);
  }

  filter(pt: { x: number; y: number }, t: number) {
    return {
      x: this.fx.filter(pt.x, t),
      y: this.fy.filter(pt.y, t),
    };
  }
}
