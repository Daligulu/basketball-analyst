// lib/pose/poseEngine.ts
// 把“多人检测一帧” → 选出前景投篮的人 → 按关键点做平滑 → 返回给前端画

import { OneEuro2D, type OneEuroConfig } from './oneEuro2d';

export type PoseKeypoint = {
  name: string;
  x: number;
  y: number;
  score?: number;
};

export type RawPerson = {
  keypoints: PoseKeypoint[];
  score?: number;
};

export type PoseFrame = {
  persons: RawPerson[];
  /** ms 时间戳 */
  ts: number;
};

export type PoseResult = {
  keypoints: PoseKeypoint[];
  ts: number;
};

export type CoachConfig = {
  /** 全局平滑配置，可不传 */
  smooth?: OneEuroConfig;
};

// 哪些点我们认为是“前景最重要”的，用来挑那个真正投篮的人
const IMPORTANT_JOINTS = [
  'nose',
  'left_shoulder',
  'right_shoulder',
  'left_hip',
  'right_hip',
  'left_wrist',
  'right_wrist',
];

export class PoseEngine {
  private cfg: CoachConfig;
  // 每个关键点一个滤波器
  private filters = new Map<string, OneEuro2D>();

  constructor(cfg: CoachConfig = {}) {
    this.cfg = cfg;
  }

  /**
   * 选一个最像投篮主体的人
   * 策略：score 高 + 靠画面中间 + 靠下
   */
  private pickPerson(frame: PoseFrame): RawPerson | null {
    if (!frame.persons || frame.persons.length === 0) return null;

    const centerX = 0.5 *
      (frame.persons[0]?.keypoints?.[0]?.x
        ? // 有像素，就用第一帧视频宽度的一半，这个值其实没法这里拿到，就用 0～1 归一做个近似
          1
        : 1);
    // 上面这块其实用不到真实宽度，我们主要靠 score 来排

    let best: RawPerson | null = null;
    let bestScore = -Infinity;

    for (const p of frame.persons) {
      if (!p.keypoints || p.keypoints.length === 0) continue;

      // 基础分：检测器给的
      const base = typeof p.score === 'number' ? p.score * 100 : 0;

      // 取一下肩膀/髋部，估计一下“在不在中间”
      const ls = p.keypoints.find((k) => k.name === 'left_shoulder');
      const rs = p.keypoints.find((k) => k.name === 'right_shoulder');
      const lh = p.keypoints.find((k) => k.name === 'left_hip');
      const rh = p.keypoints.find((k) => k.name === 'right_hip');

      const cx =
        ((ls?.x ?? rs?.x ?? lh?.x ?? rh?.x) ?? 0) / 1000; // 粗糙归一化，防止 NaN
      const cy =
        ((ls?.y ?? rs?.y ?? lh?.y ?? rh?.y) ?? 0) / 1000;

      // 越靠下越像前景
      const bonusY = cy * 50;
      // 越靠中间越好（这里中心写死 0.5）
      const distToCenter = Math.abs(cx - 0.5);
      const bonusX = (1 - distToCenter) * 40;

      const total = base + bonusX + bonusY;

      if (total > bestScore) {
        bestScore = total;
        best = p;
      }
    }

    return best;
  }

  private getFilter(jointName: string): OneEuro2D | null {
    const base = this.cfg.smooth;
    if (!base) return null;
    let f = this.filters.get(jointName);
    if (!f) {
      f = new OneEuro2D(base);
      this.filters.set(jointName, f);
    }
    return f;
  }

  /**
   * 外部真正调用的接口
   */
  process(frame: PoseFrame): PoseResult | null {
    const person = this.pickPerson(frame);
    if (!person) return null;

    const filtered: PoseKeypoint[] = person.keypoints.map((kp) => {
      const f = this.getFilter(kp.name);
      if (!f) {
        return kp;
      }
      const sm = f.next(kp.x, kp.y, frame.ts);
      return {
        ...kp,
        x: sm.x,
        y: sm.y,
      };
    });

    return {
      keypoints: filtered,
      ts: frame.ts,
    };
  }
}
