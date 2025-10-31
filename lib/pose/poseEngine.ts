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

  // 统一入口：tSec 可选；smooth 有兜底
  async estimate(
    video: HTMLVideoElement | HTMLCanvasElement,
    tSec?: number,
  ): Promise<PoseResult | null> {
    if (!this.detector) await this.load()
    if (!this.detector) return null

    const poses = await this.detector.estimatePoses(video as any)
    const p = poses?.[0]
    if (!p) return null

    const nowSec = typeof tSec === 'number' ? tSec : performance.now() / 1000

    const kps: Keypoint[] = (p.keypoints as any).map((k: any, i: number) => ({
      x: k.x,
      y: k.y,
      score: k.score,
      name: k.name || this.kpName(i),
    }))

    // 👉 这里是关键：就算 cfg.smooth 没传，也自己造一个
    const smCfg = this.cfg.smooth ?? {
      minCutoff: 1,
      beta: 0.02,
      dCutoff: 1,
    }

    const out: Keypoint[] = kps.map((k) => {
      const id = k.name || 'kp'
      // 👉 OneEuro2D 要的是一个对象，不是三个参数
      const smoother =
        this.smoothers[id] ||
        (this.smoothers[id] = new OneEuro2D({
          minCutoff: smCfg.minCutoff,
          beta: smCfg.beta,
          dCutoff: smCfg.dCutoff,
        }))
      const filtered = smoother.next(k.x, k.y, nowSec)
      return { ...k, x: filtered.x, y: filtered.y }
    })

    // 可选智能裁剪
    if (this.cfg.enableSmartCrop) {
      const xs = out.map((k) => k.x)
      const ys = out.map((k) => k.y)
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
      keypoints: out,
      bbox: this.bbox || {
        x: 0,
        y: 0,
        w: (video as any).width,
        h: (video as any).height,
      },
    }
  }
}
