// lib/pose/poseEngine.ts

import type { CoachConfig } from '../../config/coach';
import { OneEuro2D, type SmoothConfig } from './oneEuro2d';
import { PRIMARY_KEYPOINT_ORDER } from './skeleton';

export interface PoseKeypoint {
  name: string;
  x: number;
  y: number;
  score?: number;
}

export interface PosePerson {
  keypoints: PoseKeypoint[];
  score?: number;
}

export interface PoseFrame {
  persons: PosePerson[];
  ts: number; // ms
}

// 头部相关点：避免头后面乱拉线
const HEAD_LIKE = new Set([
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'mouth_left',
  'mouth_right',
]);

// 比较稳的身体大点：用来算中心、锁住投篮人
const BODY_LIKE = new Set([
  'left_shoulder',
  'right_shoulder',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
  'left_foot_index',
  'right_foot_index',
]);

const DEFAULT_SMOOTH: SmoothConfig = {
  minCutoff: 1.15,
  beta: 0.05,
  dCutoff: 1.0,
};

export class PoseEngine {
  private cfg: CoachConfig;
  private filters: Map<string, OneEuro2D>;
  private lastCenter: { x: number; y: number } | null = null;

  constructor(cfg: CoachConfig) {
    // 保持和原配置兼容，多的就塞进去
    this.cfg = {
      ...cfg,
      smooth: cfg.smooth ?? DEFAULT_SMOOTH,
    };
    this.filters = new Map();
  }

  /**
   * 主入口：传一帧“可能有多个人”的检测结果进来，返回一个清洗后的、只针对投篮人的 Pose
   */
  process(frame: PoseFrame): PosePerson | null {
    const { persons, ts } = frame;
    if (!persons || persons.length === 0) return null;

    const main = this.pickMainPerson(persons);
    if (!main) return null;

    const named = this.normalizeKeypoints(main.keypoints);
    const smoothed = this.smoothKeypoints(named, ts);
    const cleaned = this.fixHeadSpikes(smoothed);

    return {
      keypoints: cleaned,
      score: main.score ?? this.avgScore(cleaned),
    };
  }

  // ============== 内部逻辑 ==============

  // 从多个人里选中真正要画的那个人
  private pickMainPerson(persons: PosePerson[]): PosePerson | null {
    if (persons.length === 1) {
      const only = persons[0];
      this.lastCenter = this.personCenter(only.keypoints);
      return only;
    }

    let best: PosePerson | null = null;
    let bestScore = -1;

    for (const p of persons) {
      const center = this.personCenter(p.keypoints);
      if (!center) continue;

      const distToMid = Math.hypot(center.x - 0.5, center.y - 0.5); // 越靠中心越好
      const distToLast =
        this.lastCenter != null
          ? Math.hypot(center.x - this.lastCenter.x, center.y - this.lastCenter.y)
          : 0;

      const avg = this.avgScore(p.keypoints);

      // 权重稍微偏向上一帧锁定的那个人，防止跳到背景
      const score =
        avg -
        distToMid * 0.35 -
        distToLast * 0.28; // 可再调

      if (score > bestScore) {
        bestScore = score;
        best = p;
        this.lastCenter = center;
      }
    }

    return best;
  }

  // 把没有 name 的点按顺序补 name，方便前端用名字找点
  private normalizeKeypoints(kps: PoseKeypoint[]): PoseKeypoint[] {
    if (kps.every((k) => !!k.name)) {
      return kps;
    }
    return kps.map((k, i) => ({
      ...k,
      name: k.name ?? PRIMARY_KEYPOINT_ORDER[i] ?? `kp_${i}`,
    }));
  }

  // 每个点一条 OneEuro2D，时间用秒
  private smoothKeypoints(kps: PoseKeypoint[], ts: number): PoseKeypoint[] {
    const t = ts / 1000;
    return kps.map((kp) => {
      const f = this.getFilter(kp.name);
      const out = f.filter({ x: kp.x, y: kp.y }, t);
      return {
        ...kp,
        x: out.x,
        y: out.y,
      };
    });
  }

  private getFilter(id: string): OneEuro2D {
    let f = this.filters.get(id);
    if (!f) {
      f = new OneEuro2D(this.cfg.smooth ?? DEFAULT_SMOOTH);
      this.filters.set(id, f);
    }
    return f;
  }

  // 把“头后面飞出去的点”收回来
  private fixHeadSpikes(kps: PoseKeypoint[]): PoseKeypoint[] {
    const headPts = kps.filter((k) => HEAD_LIKE.has(k.name));
    if (headPts.length === 0) return kps;

    const cx = headPts.reduce((s, k) => s + k.x, 0) / headPts.length;
    const cy = headPts.reduce((s, k) => s + k.y, 0) / headPts.length;

    const MAX_R = 0.08; // 头的半径上限（相对 0~1）

    return kps.map((k) => {
      if (!HEAD_LIKE.has(k.name)) return k;
      const dx = k.x - cx;
      const dy = k.y - cy;
      const d = Math.hypot(dx, dy);
      if (d <= MAX_R) return k;
      const ratio = MAX_R / d;
      return {
        ...k,
        x: cx + dx * ratio,
        y: cy + dy * ratio,
      };
    });
  }

  private personCenter(kps: PoseKeypoint[]): { x: number; y: number } | null {
    const body = kps.filter((k) => BODY_LIKE.has(k.name));
    if (!body.length) return null;
    const x = body.reduce((s, k) => s + k.x, 0) / body.length;
    const y = body.reduce((s, k) => s + k.y, 0) / body.length;
    return { x, y };
  }

  private avgScore(kps: PoseKeypoint[]): number {
    let s = 0;
    let c = 0;
    for (const k of kps) {
      if (typeof k.score === 'number') {
        s += k.score;
        c++;
      }
    }
    return c ? s / c : 0;
  }
}
