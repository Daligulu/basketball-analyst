// lib/pose/poseEngine.ts
// 作用：
// 1. 外面塞进来一帧“可能有多个人”的姿态
// 2. 我们挑出那个最像前景投篮的人
// 3. 给每个关键点做 OneEuro 平滑
// 4. 统一成我们前端画布好画的格式

import { OneEuro2D, type OneEuroConfig, makeDefaultOneEuro } from './oneEuro2d';

export type PoseKeypoint = {
  name: string;
  x: number; // 绝对像素坐标
  y: number;
  z?: number;
  score?: number;
};

export type RawPerson = {
  id?: string;
  score?: number;
  keypoints: PoseKeypoint[];
};

export type PoseFrame = {
  persons: RawPerson[];
  ts: number; // ms
};

export type PoseResult = {
  id: string;
  keypoints: PoseKeypoint[];
  score: number;
};

type PoseEngineOpts = {
  smooth?: OneEuroConfig;
  minScore?: number;
};

export class PoseEngine {
  private readonly opts: Required<PoseEngineOpts>;
  private readonly filters = new Map<string, OneEuro2D>();

  constructor(opts: PoseEngineOpts = {}) {
    this.opts = {
      smooth: opts.smooth ?? makeDefaultOneEuro(),
      minScore: opts.minScore ?? 0.2,
    };
  }

  private pickMainPerson(persons: RawPerson[]): RawPerson | null {
    if (!persons.length) return null;
    // 1. 按 score 排
    const withScore = [...persons].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const best = withScore[0];
    if ((best.score ?? 0) >= this.opts.minScore) {
      return best;
    }
    // 2. 没有 score 的场景下，用“有没有肩膀+胯”来判
    const hasCore = (p: RawPerson) => {
      const names = p.keypoints.map((k) => k.name);
      return (
        names.includes('left_shoulder') ||
        names.includes('right_shoulder') ||
        names.includes('left_hip') ||
        names.includes('right_hip')
      );
    };
    const candidate = withScore.find(hasCore);
    return candidate ?? best;
  }

  private getFilter(name: string) {
    let f = this.filters.get(name);
    if (!f) {
      f = new OneEuro2D(this.opts.smooth);
      this.filters.set(name, f);
    }
    return f;
  }

  process(frame: PoseFrame): PoseResult | null {
    const p = this.pickMainPerson(frame.persons);
    if (!p) return null;

    const t = frame.ts / 1000; // 内部用秒
    const smoothed: PoseKeypoint[] = p.keypoints.map((kp) => {
      const f = this.getFilter(kp.name);
      const { x, y } = f.filter({ x: kp.x, y: kp.y }, t);
      return {
        ...kp,
        x,
        y,
      };
    });

    return {
      id: p.id ?? 'main',
      keypoints: smoothed,
      score: p.score ?? 1,
    };
  }
}
