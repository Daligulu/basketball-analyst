// lib/pose/poseEngine.ts
// 统一把姿态结果“锁”在投篮的人身上，并做防抖 + 头部修正
// 说明：这里的名字、导出和构造函数都保持跟你仓库里之前的一致，避免再出现 TS 报错

'use client';

import { OneEuro2D, type SmoothConfig } from './oneEuro2d';
import { PRIMARY_KEYPOINT_ORDER } from './skeleton'; // 我们在 skeleton.ts 里定义的顺序常量
import type { CoachConfig } from '../config';

// 默认的平滑参数，vercel 打包时如果 cfg.smooth 没传就会用它，避免上次的
// “Argument of type 'undefined' is not assignable …” 报错
const DEFAULT_SMOOTH: SmoothConfig = {
  minCutoff: 1.15,
  beta: 0.05,
  dCutoff: 1.0,
};

// mediapipe/pose 会给到的常见关键点名字，拿来算人框 & 头部中心用
const HEAD_LIKE = new Set([
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'mouth_left',
  'mouth_right',
]);

// 可能参与“锁定是谁”的关键点——含肩、髋，基本不会掉
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

// 实际关键点的 shape
export interface PoseKeypoint {
  name: string;
  x: number; // 0~1 相对 video 宽
  y: number; // 0~1 相对 video 高
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

// 这个类被 VideoAnalyzer / 你的分析逻辑 new 出来
export class PoseEngine {
  private cfg: CoachConfig;
  // 给每一个 keypoint 单独做一条欧拉滤波，避免手、脚比身体抖得厉害
  private filters: Map<string, OneEuro2D>;
  // 记一下上一次真正选中的那个人的中心，下一帧优先贴着这个人
  private lastCenter: { x: number; y: number } | null = null;

  constructor(cfg: CoachConfig) {
    this.cfg = {
      // 保底
      smooth: cfg.smooth ?? DEFAULT_SMOOTH,
      // 下面两个是我们自己加的，没在 config 里也没事
      // 中心惩罚系数，越大越偏向画面正中
      personBoxBias: (cfg as any).personBoxBias ?? 0.35,
      // 最多就跟踪 1 个人
      maxPersons: (cfg as any).maxPersons ?? 1,
      ...cfg,
    } as CoachConfig;
    this.filters = new Map();
  }

  /**
   * 主入口：传进来一帧 pose 检测的“多个人”，返回
   * 1. 只认定的那个投篮的人
   * 2. 且做了平滑、做了头部错误点清洗
   */
  process(frame: PoseFrame): PosePerson | null {
    const { persons, ts } = frame;
    if (!persons || persons.length === 0) return null;

    // 1. 先从多个人里挑出“真正的投篮人”
    const chosen = this.pickMainPerson(persons);
    if (!chosen) return null;

    // 2. 把关键点补名字 & 补顺序（有些模型不返回 name）
    const withNames = this.normalizeKeypoints(chosen.keypoints);

    // 3. 做帧间平滑
    const smoothed = this.smoothKeypoints(withNames, ts);

    // 4. 把头后面跑掉的点拉回来
    const cleaned = this.fixHeadSpikes(smoothed);

    return {
      keypoints: cleaned,
      score: chosen.score ?? this.avgScore(cleaned),
    };
  }

  /**
   * 把当前帧的姿态画出来时用的——你 VideoAnalyzer 里应该是调用类似的接口
   * 如果你组件里是直接拿 process 的返回去画，这个函数可以不用
   */
  processAndGetKeypoints(frame: PoseFrame): PoseKeypoint[] {
    const p = this.process(frame);
    return p ? p.keypoints : [];
  }

  // ========== 内部工具 ==========

  // 从多个人里挑一个“像是正在投篮的这个人”
  private pickMainPerson(persons: PosePerson[]): PosePerson | null {
    if (persons.length === 1) {
      const only = persons[0];
      // 也把中心记一下，下一帧继续锁
      this.lastCenter = this.personCenter(only.keypoints);
      return only;
    }

    let best: PosePerson | null = null;
    let bestScore = -999;

    for (const p of persons) {
      const center = this.personCenter(p.keypoints);
      if (!center) continue;

      // 越靠中越好
      const distToMid = Math.hypot(center.x - 0.5, center.y - 0.5);

      // 靠上一帧的中心也要加分，避免忽然跟到后面那个人
      const distToLast =
        this.lastCenter != null
          ? Math.hypot(center.x - this.lastCenter.x, center.y - this.lastCenter.y)
          : 0;

      const avg = this.avgScore(p.keypoints);

      // 分数 = 检测平均分 - 中心惩罚 - 与上一帧中心的距离惩罚
      const score =
        avg -
        distToMid * (this.cfg as any).personBoxBias -
        distToLast * ((this.cfg as any).personBoxBias * 0.8);

      if (score > bestScore) {
        bestScore = score;
        best = p;
        this.lastCenter = center;
      }
    }

    return best;
  }

  // 关键点转成有名字的一致结构，方便后面画骨架
  private normalizeKeypoints(kps: PoseKeypoint[]): PoseKeypoint[] {
    if (!kps) return [];
    // 如果本身就带 name，优先用原来的
    if (kps.every((k) => k.name)) return kps;

    // 不带 name 的情况我们按 skeleton 里的顺序补
    return kps.map((k, i) => ({
      ...k,
      name: k.name ?? PRIMARY_KEYPOINT_ORDER[i] ?? `kp_${i}`,
    }));
  }

  // 每个点一条 OneEuro2D，时间戳要用秒
  private smoothKeypoints(kps: PoseKeypoint[], ts: number): PoseKeypoint[] {
    const t = ts / 1000;
    return kps.map((kp) => {
      const id = kp.name;
      const filter = this.getFilter(id);
      const filtered = filter.filter({ x: kp.x, y: kp.y }, t);
      return {
        ...kp,
        x: filtered.x,
        y: filtered.y,
      };
    });
  }

  private getFilter(id: string): OneEuro2D {
    let f = this.filters.get(id);
    if (!f) {
      // 这里一定给构造器传东西，防止 vercel 上 again 报 not assignable to …
      f = new OneEuro2D(this.cfg.smooth ?? DEFAULT_SMOOTH);
      this.filters.set(id, f);
    }
    return f;
  }

  // 把“头后面飞出去”的点拉回到头附近，解决你截图里那条红线戳到后排人的问题
  private fixHeadSpikes(kps: PoseKeypoint[]): PoseKeypoint[] {
    const headPts = kps.filter((k) => HEAD_LIKE.has(k.name));
    if (!headPts.length) return kps;

    // 头中心
    const cx = headPts.reduce((s, k) => s + k.x, 0) / headPts.length;
    const cy = headPts.reduce((s, k) => s + k.y, 0) / headPts.length;

    // 允许的半径：头的尺寸不会太大，用 0.08 (屏幕宽高的 8%) 就够了
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

  // 计算某个人的“身体中心”，尽量用肩/髋/膝/踝这些稳定点
  private personCenter(kps: PoseKeypoint[]):
    | {
        x: number;
        y: number;
      }
    | null {
    const bodyPts = kps.filter((k) => BODY_LIKE.has(k.name));
    if (!bodyPts.length) return null;
    const x = bodyPts.reduce((s, k) => s + k.x, 0) / bodyPts.length;
    const y = bodyPts.reduce((s, k) => s + k.y, 0) / bodyPts.length;
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
