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

// 选出“最可能是投篮的人”
function pickPrimaryPose(
  poses: any[],
  videoW: number,
  videoH: number,
): any | null {
  if (!poses || !poses.length) return null
  if (poses.length === 1) return poses[0]

  const cx = videoW / 2
  const cy = videoH * 0.45 // 稍微靠上点，拍投篮一般取上半身

  let best: any = null
  let bestScore = -Infinity

  for (const p of poses) {
    const ks = (p.keypoints || []).filter((k: any) => k.score == null || k.score > 0.2)
    if (!ks.length) continue
    const xs = ks.map((k: any) => k.x)
    const ys = ks.map((k: any) => k.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const bboxW = maxX - minX
    const bboxH = maxY - minY
    const area = bboxW * bboxH

    const px = (minX + maxX) / 2
    const py = (minY + maxY) / 2
    const centerDist = Math.hypot(px - cx, py - cy)

    // 看看有没有脚踝，踝子在下面的更可能是整个人
    const ra = ks.find((k: any) => k.name === 'right_ankle')
    const la = ks.find((k: any) => k.name === 'left_ankle')
    const ankleY = Math.max(ra?.y ?? 0, la?.y ?? 0)

    // 综合评分：面积越大越好，越在中间越好，脚越靠下越好
    const score = area * 1.1 - centerDist * 0.4 + ankleY * 0.15

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

    // ⭐ 这里允许多人的情况
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

    // 可选智能裁剪
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
