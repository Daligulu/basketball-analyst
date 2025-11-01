// lib/pose/poseEngine.ts
// 把浏览器/后端出来的“多人姿态” → 选出最像投篮前景的那个人 → 做平滑 → 给前端/分析层用

import { OneEuro2D, type OneEuroConfig } from './oneEuro2d';

export type PoseKeypoint = {
  name: string;
  x: number;
  y: number;
  score?: number;
};

export type PoseResult = {
  id: string;
  keypoints: PoseKeypoint[];
};

export type CoachConfig = {
  smooth?: OneEuroConfig;
};

// 取关键点的小工具
export function findKeypoint(
  p: PoseResult | null | undefined,
  name: string,
): PoseKeypoint | null {
  if (!p) return null;
  return p.keypoints.find((k) => k.name === name) ?? null;
}

// 给一个人做“像投篮的程度”的打分，用来从多人里挑出前景
function personScore(p: PoseResult): number {
  const ls = findKeypoint(p, 'left_shoulder');
  const rs = findKeypoint(p, 'right_shoulder');
  const lh = findKeypoint(p, 'left_hip');
  const rh = findKeypoint(p, 'right_hip');
  const la = findKeypoint(p, 'left_ankle');
  const ra = findKeypoint(p, 'right_ankle');

  const scores = [ls, rs, lh, rh, la, ra]
    .filter(Boolean)
    .map((k) => k!.score ?? 0);

  if (!scores.length) return 0;

  // 关键点越多、分越高的优先
  let s = scores.reduce((a, b) => a + b, 0);

  // 脚越靠画面底部越像是离镜头最近的人
  const footY = Math.max(la?.y ?? 0, ra?.y ?? 0);
  s += footY * 0.002;

  return s;
}

export class PoseEngine {
  private cfg: CoachConfig;
  private smoother = new Map<string, OneEuro2D>();

  constructor(cfg: CoachConfig = {}) {
    this.cfg = cfg;
  }

  /**
   * @param frame  { persons: PoseResult[], ts: number(ms) }
   * @returns  选出来&平滑之后的那一个人
   */
  process(frame: { persons: PoseResult[]; ts: number }): PoseResult | null {
    const persons = frame.persons ?? [];
    if (!persons.length) return null;

    // 1. 选前景
    const best = [...persons].sort((a, b) => personScore(b) - personScore(a))[0];
    if (!best) return null;

    // 2. 做平滑
    if (this.cfg.smooth) {
      const id = best.id;
      const t = frame.ts / 1000; // 转成秒，跟滤波器统一
      if (!this.smoother.has(id)) {
        this.smoother.set(id, new OneEuro2D(this.cfg.smooth));
      }
      const sm = this.smoother.get(id)!;
      const newKps: PoseKeypoint[] = best.keypoints.map((k) => {
        const f = sm.next(k.x, k.y, t);
        return { ...k, x: f.x, y: f.y };
      });
      return { ...best, keypoints: newKps };
    }

    return best;
  }
}

// 👇 很关键：把所有类型都显式导出去，给 lib/analyze/* 用
export type { PoseKeypoint as TPoseKeypoint, PoseResult as TPoseResult };
export { PoseKeypoint }; // 让 isolatedModules 也看得见
export { PoseResult };
