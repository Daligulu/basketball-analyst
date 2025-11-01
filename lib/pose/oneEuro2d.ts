// lib/pose/oneEuro2d.ts
// 一个非常轻量的 One Euro Filter，实现 2D 点平滑，完全跑在前端
// 主要用来消掉 Mediapipe 偶尔的抖点，给姿态线条稳定一点的视觉效果

export interface OneEuroConfig {
  minCutoff: number; // 默认 1.0~1.2
  beta: number; // 默认 0.0~0.1
  dCutoff: number; // 默认 1.0
}

class LowPassFilter {
  private y: number;
  private a: number;
  private s: boolean;

  constructor(alpha: number, initValue: number) {
    this.y = initValue;
    this.a = alpha;
    this.s = false;
  }

  filter(value: number, alpha: number): number {
    if (!this.s) {
      this.y = value;
      this.s = true;
      return value;
    }
    this.a = alpha;
    this.y = this.a * value + (1 - this.a) * this.y;
    return this.y;
  }

  lastValue() {
    return this.y;
  }
}

function smoothingFactor(t_e: number, cutoff: number): number {
  const r = 2 * Math.PI * cutoff * t_e;
  return r / (r + 1);
}

function exponentialSmoothing(a: number, x: number, xPrev: number): number {
  return a * x + (1 - a) * xPrev;
}

class OneEuroFilter {
  private freq: number;
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private x: LowPassFilter | null;
  private dx: LowPassFilter | null;
  private lastTime: number | null;

  constructor(freq: number, minCutoff: number, beta: number, dCutoff: number) {
    this.freq = freq;
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = null;
    this.dx = null;
    this.lastTime = null;
  }

  filter(t: number, value: number): number {
    if (this.lastTime != null && t !== this.lastTime) {
      this.freq = 1.0 / (t - this.lastTime);
    }
    this.lastTime = t;

    if (!this.dx) {
      this.dx = new LowPassFilter(1, 0.0);
    }
    const dValue = this.dx.filter(
      this.freq ? (value - (this.x ? this.x.lastValue() : value)) * this.freq : 0.0,
      smoothingFactor(1.0 / this.freq, this.dCutoff),
    );

    const cutoff = this.minCutoff + this.beta * Math.abs(dValue);

    if (!this.x) {
      this.x = new LowPassFilter(1, value);
    }

    return this.x.filter(value, smoothingFactor(1.0 / this.freq, cutoff));
  }
}

// 真正对 (x, y) 做平滑的这个类
export class OneEuro2D {
  private fx: OneEuroFilter;
  private fy: OneEuroFilter;

  constructor(cfg: OneEuroConfig) {
    const minCutoff = cfg.minCutoff ?? 1.15;
    const beta = cfg.beta ?? 0.0;
    const dCutoff = cfg.dCutoff ?? 1.0;
    // 初始频率随便给个 60
    this.fx = new OneEuroFilter(60, minCutoff, beta, dCutoff);
    this.fy = new OneEuroFilter(60, minCutoff, beta, dCutoff);
  }

  filter(x: number, y: number, t: number): { x: number; y: number } {
    const nx = this.fx.filter(t, x);
    const ny = this.fy.filter(t, y);
    return { x: nx, y: ny };
  }
}
