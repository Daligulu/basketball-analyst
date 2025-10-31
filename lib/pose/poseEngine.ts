// lib/pose/poseEngine.ts
import * as poseDetection from '@tensorflow-models/pose-detection'
import * as tf from '@tensorflow/tfjs-core'
import '@tensorflow/tfjs-converter'
import '@tensorflow/tfjs-backend-webgl'
import { OneEuro2D } from '../filters/oneEuro'
import type { CoachConfig } from '../../config/coach'

export type Keypoint = { x: number; y: number; score?: number; name?: string }
export type PoseResult = { keypoints: Keypoint[]; bbox: { x: number; y: number; w: number; h: number } }

async function headOk(url: string) {
  try {
    const r = await fetch(url, { method: 'HEAD' })
    return r.ok
  } catch {
    return false
  }
}

/**
 * 从模型返回的多个人里挑“最像是投篮的人”
 * 规则（从强到弱）：
 * 1. 脚越接近画面底部越好（前景人）
 * 2. 框越大越好（但不过分）
 * 3. 越靠中间越好
 * 4. 关键点平均分越高越好
 */
function pickPrimaryPose(poses: any[], videoW: number, videoH: number): any | null {
  if (!poses || !poses.length) return null
  if (poses.length === 1) return poses[0]

  const imgCenterX = videoW / 2
  let best: any = null
  let bestScore = -Infinity

  for (const p of poses) {
    const ks = (p.keypoints || []).filter((k: any) => k.score == null || k.score > 0.15)
    if (!ks.length) continue

    // 基础框
    const xs = ks.map((k: any) => k.x)
    const ys = ks.map((k: any) => k.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const bboxW = maxX - minX
    const bboxH = maxY - minY
    const area = bboxW * bboxH

    // 最低的点（越靠下越像前景）
    const lowestY = maxY // y 越大越靠下

    // 在画面里的水平中心
    const centerX = (minX + maxX) / 2
    const centerDist = Math.abs(centerX - imgCenterX) // 越小越好

    // 平均置信度
    const avgScore =
      ks.reduce((sum: number, k: any) => sum + (k.score ?? 0.5), 0) / Math.max(1, ks.length)

    // 分数：把“脚在下面”权重拉高，把“在中间”也拉高
    const score =
      // 脚越靠下面越好
      lowestY * 1.7 +
      // 框越大越好
      area * 0.35 +
      // 越在中间越好
      -centerDist * 0.6 +
      // 置信度加一点
      avgScore * 1200

    if (score > bestScore) {
      bestScore = score
      best = p
    }
  }

  return best || poses[0]
}

export class PoseEngine {
  private detector?: poseDetection.PoseDetector
  private smoothers: Record<string, OneEuro2D> = {}
  private bbox?: { x: number; y: number; w: number; h: number }

  constructor(private cfg: CoachConfig) {}

  private async ensureBackend() {
    try {
      await tf.setBackend('webgl')
      await tf.ready()
    } catch {
      const wasm = await import('@tensorflow/tfjs-backend-wasm')
      ;(wasm as any).setWasmPaths?.('/wasm/')
      await tf.setBackend('wasm')
      await tf.ready()
    }
  }

  async load() {
    await this.ensureBackend()
    const pref = this.cfg.modelPreference ?? 'movenet'

    if (pref === 'movenet') {
      const MT = (poseDetection as any).movenet?.modelType
      const thunder = MT?.SINGLEPOSE_THUNDER ?? 'thunder'
      const lightning = MT?.SINGLEPOSE_LIGHTNING ?? 'lightning'
      try {
        this.detector = await poseDetection.createDetector(
          poseDetection.SupportedModels.MoveNet,
          { modelType: thunder } as any,
        )
      } catch {
        this.detector = await poseDetection.createDetector(
          poseDetection.SupportedModels.MoveNet,
          { modelType: lightning } as any,
        )
      }
      return
    }

    // BlazePose
    const type = pref === 'blaze-full' ? 'full' : 'lite'
    const local = '/mediapipe/pose'
    const localOk = await headOk(`${local}/pose_solution_packed_assets.data`)
    const cdn = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404'
    const solutionPath = localOk ? local : cdn

    try {
      this.detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.BlazePose,
        { runtime: 'mediapipe', modelType: type, solutionPath } as any,
      )
    } catch {
      this.detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.BlazePose,
        { runtime: 'mediapipe', modelType: 'lite', solutionPath: cdn } as any,
      )
    }
  }

  private kpName(i: number) {
    // 保持你项目里这套 keypoint 命名，末尾是脚尖
    const names = [
      'nose',
      'left_eye',
      'right_eye',
      'left_ear',
      'right_ear',
      'left_shoulder',
      'right_shoulder',
      'left_elbow',
      'right_elbow',
      'left_wrist',
      'right_wrist',
      'left_hip',
      'right_hip',
      'left_knee',
      'right_knee',
      'left_ankle',
      'right_ankle',
      'left_heel',
      'right_heel',
      'left_foot_index',
      'right_foot_index',
    ]
    return names[i] || ''
  }

  async estimate(
    video: HTMLVideoElement | HTMLCanvasElement,
    tSec?: number,
  ): Promise<PoseResult | null> {
    if (!this.detector) await this.load()
    if (!this.detector) return null

    const videoW = (video as any).videoWidth || (video as any).width || 720
    const videoH = (video as any).videoHeight || (video as any).height || 1280

    // ⭐ 一次取多个人
    const poses = await this.detector.estimatePoses(video as any, {
      maxPoses: 4,
      flipHorizontal: false,
    } as any)

    const primary = pickPrimaryPose(poses as any[], videoW, videoH)
    if (!primary) return null

    const nowSec = typeof tSec === 'number' ? tSec : performance.now() / 1000

    const smCfg = this.cfg.smooth ?? {
      minCutoff: 1,
      beta: 0.02,
      dCutoff: 1,
    }

    const kps: Keypoint[] = (primary.keypoints as any).map((k: any, i: number) => {
      const name = k.name || this.kpName(i)
      const id = name || 'kp'
      const smoother =
        this.smoothers[id] ||
        (this.smoothers[id] = new OneEuro2D({
          minCutoff: smCfg.minCutoff,
          beta: smCfg.beta,
          dCutoff: smCfg.dCutoff,
        }) as any)

      const filtered =
        (smoother as any).next
          ? (smoother as any).next(k.x, k.y, nowSec)
          : (smoother as any).filter
            ? (smoother as any).filter(k.x, k.y, nowSec)
            : { x: k.x, y: k.y }

      return {
        x: filtered.x,
        y: filtered.y,
        score: k.score,
        name,
      }
    })

    // 可选裁剪
    if (this.cfg.enableSmartCrop) {
      const xs = kps.map((k) => k.x)
      const ys = kps.map((k) => k.y)
      const minx = Math.min(...xs)
      const maxx = Math.max(...xs)
      const miny = Math.min(...ys)
      const maxy = Math.max(...ys)
      const cx = (minx + maxx) / 2
      const cy = (miny + maxy) / 2
      const size = Math.max(maxx - minx, maxy - miny) * 1.6
      this.bbox = { x: cx - size / 2, y: cy - size / 2, w: size, h: size }
    }

    return {
      keypoints: kps,
      bbox: this.bbox || { x: 0, y: 0, w: videoW, h: videoH },
    }
  }
}
