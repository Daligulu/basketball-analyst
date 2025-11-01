// lib/pose/oneEuro2d.ts
// 一个非常轻量的 2D One Euro 滤波器，够用就行，重点是要把 OneEuroConfig 导出去，给 poseEngine.ts 用

export type OneEuroConfig = {
  /** 越大越“稳”，但越跟不上快速动作 */
  minCutoff: number;
  /** 越大越能快速跟随加速度变化 */
  beta: number;
  /** 导数的 cutoff，一般 1.0 就够 */
  dCutoff: number;
};

/**
 * 一个最简单的 1-euro 思路的 2D 平滑器
 * 这里只做前端渲染级别的平滑，不是科研级实现
 */
export class OneEuro2D {
  private cfg: OneEuroConfig;
  private lastX: number | null = null;
  private lastY: number | null = null;
  private lastT: number | null = null;

  constructor(cfg: OneEuroConfig) {
    this.cfg = cfg;
  }

  /**
   * @param x 原始 x (像素)
   * @param y 原始 y (像素)
   * @param t 当前时间，ms
   */
  next(x: number, y: number, t: number) {
    // 第一次就直接收下
    if (this.lastX === null || this.lastY === null || this.lastT === null) {
      this.lastX = x;
      this.lastY = y;
      this.lastT = t;
      return { x, y };
    }

    // 计算 dt，防止 0
    const dtMs = t - this.lastT;
    const dt = dtMs <= 0 ? 0.016 : dtMs / 1000; // s
    this.lastT = t;

    // 一个很简化的 alpha 计算：没走全 1-euro 的公式，只要有个“越大越快”的感觉
    const { minCutoff, beta } = this.cfg;
    const speed = Math.hypot(x - this.lastX, y - this.lastY) / Math.max(dt, 1e-6);
    const cutoff = minCutoff + beta * speed;
    // clamp 一下，避免 0
    const alpha = cutoff <= 0 ? 1 : 1 / (1 + cutoff);

    const nx = this.lastX + alpha * (x - this.lastX);
    const ny = this.lastY + alpha * (y - this.lastY);

    this.lastX = nx;
    this.lastY = ny;

    return { x: nx, y: ny };
  }
}
