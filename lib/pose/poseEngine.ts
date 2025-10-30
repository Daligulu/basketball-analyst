import * as poseDetection from '@tensorflow-models/pose-detection'
import * as tf from '@tensorflow/tfjs-core'
import '@tensorflow/tfjs-converter'
import '@tensorflow/tfjs-backend-webgl'
import { OneEuro2D } from '../filters/oneEuro'
import type { CoachConfig } from '../../config/coach'

export type Keypoint = { x:number, y:number, score?:number, name?:string }
export type PoseResult = { keypoints: Keypoint[], bbox: {x:number,y:number,w:number,h:number} }

async function headOk(url: string) {
  try { const r = await fetch(url, { method: 'HEAD' }); return r.ok } catch { return false }
}

export class PoseEngine {
  private detector?: poseDetection.PoseDetector
  private bbox?: {x:number,y:number,w:number,h:number}
  private filter?: OneEuro2D
  private cfg: CoachConfig
  constructor(cfg: CoachConfig){
    this.cfg = cfg
    this.filter = new OneEuro2D(cfg.smooth)
  }
  async init(){
    if (this.detector) return
    const model = this.cfg.modelPreference === 'movenet'
      ? poseDetection.SupportedModels.MoveNet
      : poseDetection.SupportedModels.BlazePose
    this.detector = await poseDetection.createDetector(model, { runtime: 'tfjs', modelType: 'full' })
  }
  async estimate(video: HTMLVideoElement){
    await this.init()
    const det = this.detector!
    const poses = await det.estimatePoses(video, { flipHorizontal: false })
    const pose = poses[0]
    const out: {x:number,y:number,name?:string}[] = []
    if (pose?.keypoints){
      for (const k of pose.keypoints){
        const f = this.filter?.filter(k.x, k.y, performance.now()/1000)
        out.push({ x: f?.x ?? k.x, y: f?.y ?? k.y, name: k.name })
      }
    }
    if (this.cfg.enableSmartCrop) {
      const xs = out.map(k=>k.x), ys = out.map(k=>k.y)
      const minx = Math.min(...xs), maxx = Math.max(...xs)
      const miny = Math.min(...ys), maxy = Math.max(...ys)
      const cx = (minx+maxx)/2, cy = (miny+maxy)/2
      const size = Math.max(maxx-minx, maxy-miny) * 1.6
      this.bbox = { x: cx - size/2, y: cy - size/2, w: size, h: size }
    }
    return { keypoints: out, bbox: this.bbox || { x:0, y:0, w:(video as any).width, h:(video as any).height } }
  }
}
