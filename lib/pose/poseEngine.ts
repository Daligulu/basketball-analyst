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

// 头部相关点：用来做“头后面乱连”裁剪
const HEAD_LIKE = new Set([
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'mouth_left',
  'mouth_right',
]);

// 较稳定的身体点：用来算人体中心，锁定真正要画的那个人
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
    this.cfg = {
      ...cfg,
      smooth: cfg.smooth ?? DEFAULT_SMOOTH,
    };
    this.filters = new Map();
  }

  /**
   * 传入一帧（可能多人）的检测结果，返回一个清洗后的“当前这个要跟踪的人”
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

  // ========== 内部工具 ==========

  // 从多个人里挑真正要画的那一个（靠中 + 靠上一帧 + 检测分高）
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

      const distToMid = Math.hypot(center.x - 0.5, center.y - 0.5);
      const distToLast =
        this.lastCenter != null
          ? Math.hypot(center.x - this.lastCenter.x, center.y - this.lastCenter.y)
          : 0;

      const avg = this.avgScore(p.keypoints);

      // 稍微偏好上一帧 + 居中
      const score = avg - distToMid * 0.35 - distToLast * 0.28;

      if (score > bestScore) {
        bestScore = score;
        best = p;
        this.lastCenter = center;
      }
    }

    return best;
  }

  // 给没名字的关键点补名字
  private normalizeKeypoints(kps: PoseKeypoint[]): PoseKeypoint[] {
    if (kps.every((k) => !!k.name)) return kps;
    return kps.map((k, i) => ({
      ...k,
      name: k.name ?? PRIMARY_KEYPOINT_ORDER[i] ?? `kp_${i}`,
    }));
  }

  // 帧间平滑
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

  // 修头部飞点
  private fixHeadSpikes(kps: PoseKeypoint[]): PoseKeypoint[] {
    const headPts = kps.filter((k) => HEAD_LIKE.has(k.name));
    if (!headPts.length) return kps;

    const cx = headPts.reduce((s, k) => s + k.x, 0) / headPts.length;
    const cy = headPts.reduce((s, k) => s + k.y, 0) / headPts.length;

    const MAX_HEAD_R = 0.08;

    return kps.map((k) => {
      if (!HEAD_LIKE.has(k.name)) return k;
      const dx = k.x - cx;
      const dy = k.y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist <= MAX_HEAD_R) return k;
      const ratio = MAX_HEAD_R / dist;
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

// ✅ 给老代码用的类型出口，修复 vercel 报错
export type PoseResult = PosePerson | null;
