// lib/pose/oneEuro2d.ts
// 一个非常小的 One Euro Filter 2D 版本，给关键点做平滑。
// 只依赖 TS，本身不会触发浏览器 API，所以在 Vercel build 阶段没问题。

export type OneEuroConfig = {
  minCutoff: number; // 越大越不平滑，1.0~1.5 比较合适
  beta: number;      // 越大越跟得紧，0.03~0.1
  dCutoff: number;   // 差分滤波器的 cutoff，一般 1.0
};

const TWO_PI = 2 * Math.PI;

function smoothingFactor(tE: number, cutoff: number) {
  const r = 2 * Math.PI * cutoff * tE;
  return r / (r + 1);
}

function exponentialSmoothing(a: number, x: number, xPrev: number) {
  return a * x + (1 - a) * xPrev;
}

class OneEuro1D {
  private xPrev = 0;
  private dxPrev = 0;
  private tPrev = 0;
  private hasPrev = false;
  private readonly cfg: OneEuroConfig;

  constructor(cfg: OneEuroConfig) {
    this.cfg = cfg;
  }

  filter(x: number, t: number) {
    if (!this.hasPrev) {
      this.hasPrev = true;
      this.tPrev = t;
      this.xPrev = x;
      this.dxPrev = 0;
      return x;
    }

    const dt = Math.max(t - this.tPrev, 1e-6);

    // 1. 先滤速度
    const dx = (x - this.xPrev) / dt;
    const aD = smoothingFactor(dt, this.cfg.dCutoff);
    const dxHat = exponentialSmoothing(aD, dx, this.dxPrev);

    // 2. 再根据速度调节主滤波器的 cutoff
    const cutoff = this.cfg.minCutoff + this.cfg.beta * Math.abs(dxHat);
    const a = smoothingFactor(dt, cutoff);
    const xHat = exponentialSmoothing(a, x, this.xPrev);

    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = t;

    return xHat;
  }
}

export class OneEuro2D {
  private fx: OneEuro1D;
  private fy: OneEuro1D;

  constructor(cfg: OneEuroConfig) {
    this.fx = new OneEuro1D(cfg);
    this.fy = new OneEuro1D(cfg);
  }

  filter(pt: { x: number; y: number }, t: number) {
    return {
      x: this.fx.filter(pt.x, t),
      y: this.fy.filter(pt.y, t),
    };
  }
}

// 工具函数：项目里经常要一个默认配置
export function makeDefaultOneEuro(): OneEuroConfig {
  return {
    minCutoff: 1.15,
    beta: 0.05,
    dCutoff: 1.0,
  };
}
