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
 * 选“真正要画的那个投篮人”
 * 优先级：
 * 1. 框的中心在画面中间（0.32~0.68 之间）
 * 2. 脚在下面
 * 3. 框不要太小
 * 4. 关键点均值高
 */
function pickPrimaryPose(poses: any[], videoW: number, videoH: number): any | null {
  if (!poses || !poses.length) return null
  if (poses.length === 1) return poses[0]

  const screenCenterX = videoW / 2
  const centerL = videoW * 0.32
  const centerR = videoW * 0.68

  let best: any = null
  let bestScore = -Infinity

  for (const p of poses) {
    const ks = (p.keypoints || []).filter((k: any) => k.score == null || k.score > 0.15)
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

    const centerX = (minX + maxX) / 2
    const centerDist = Math.abs(centerX - screenCenterX)

    const lowestY = maxY

    const avgScore =
      ks.reduce((s: number, k: any) => s + (k.score ?? 0.5), 0) / Math.max(1, ks.length)

    const inCenter = centerX >= centerL && centerX <= centerR

    // 打分：中心奖励拉得很高，防止左边那个背景人
    const score =
      lowestY * 1.6 + // 脚越靠下越好
      area * 0.3 + // 框越大越好
      -centerDist * 2.0 + // 离中越近越好
      avgScore * 1000 + // 关键点越靠谱越好
      (inCenter ? 2500 : 0) // 在中间直接给巨额奖励

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
    return [
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
    ][i] || ''
  }

  async estimate(
    video: HTMLVideoElement | HTMLCanvasElement,
    tSec?: number,
  ): Promise<PoseResult | null> {
    if (!this.detector) await this.load()
    if (!this.detector) return null

    const videoW = (video as any).videoWidth || (video as any).width || 720
    const videoH = (video as any).videoHeight || (video as any).height || 1280

    const poses = await this.detector.estimatePoses(video as any, {
      maxPoses: 4,
      flipHorizontal: false,
    } as any)

    const primary = pickPrimaryPose(poses as any[], videoW, videoH)
    if (!primary) return null

    const nowSec = typeof tSec === 'number' ? tSec : performance.now() / 1000
    const smCfg = this.cfg.smooth ?? { minCutoff: 1, beta: 0.02, dCutoff: 1 }

    const keypoints: Keypoint[] = (primary.keypoints as any).map((k: any, i: number) => {
      const name = k.name || this.kpName(i)
      const smootherId = name || `kp-${i}`
      const smoother =
        this.smoothers[smootherId] ||
        (this.smoothers[smootherId] = new OneEuro2D({
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

      return { x: filtered.x, y: filtered.y, score: k.score, name }
    })

    if (this.cfg.enableSmartCrop) {
      const xs = keypoints.map((k) => k.x)
      const ys = keypoints.map((k) => k.y)
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
      keypoints,
      bbox: this.bbox || { x: 0, y: 0, w: videoW, h: videoH },
    }
  }
}
