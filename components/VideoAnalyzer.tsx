'use client'

import React, { useEffect, useRef, useState } from 'react'
import { PoseEngine } from '@/lib/pose/poseEngine'
import { DEFAULT_CONFIG, type CoachConfig } from '@/config/coach'
import ConfigPanel from '@/components/ConfigPanel'
import RadarChart from '@/components/RadarChart'
import { scoreAngles } from '@/lib/score/scorer'
import { computeAngles } from '@/lib/analyze/kinematics'
import { detectRelease, type Sample } from '@/lib/analyze/release'

// 颜色：和你原图一样
const COLOR = {
  upper: 'rgba(248,113,113,1)', // 红
  torso: 'rgba(59,130,246,0.95)', // 蓝
  lower: 'rgba(34,197,94,0.95)', // 绿
}

// 头部关键点
const HEAD_KPS = ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear'] as const

// 线条分组：参考你原来那张图
const SEG = {
  // 上肢：肩膀+头部+双臂全红
  upper: [
    // 头部小连线，让它看起来更“精细”
    ['nose', 'left_eye'],
    ['nose', 'right_eye'],
    ['left_eye', 'left_ear'],
    ['right_eye', 'right_ear'],

    // 头到肩，方便看出挺胸/探头
    ['nose', 'left_shoulder'],
    ['nose', 'right_shoulder'],

    // 肩 → 肘 → 腕
    ['left_shoulder', 'left_elbow'],
    ['left_elbow', 'left_wrist'],
    ['right_shoulder', 'right_elbow'],
    ['right_elbow', 'right_wrist'],
  ] as [string, string][],
  // 躯干蓝色长方形/梯形
  torso: [
    ['left_shoulder', 'right_shoulder'],
    ['left_shoulder', 'left_hip'],
    ['right_shoulder', 'right_hip'],
    ['left_hip', 'right_hip'],
  ] as [string, string][],
  // 下肢绿色
  lower: [
    ['left_hip', 'left_knee'],
    ['left_knee', 'left_ankle'],
    ['right_hip', 'right_knee'],
    ['right_knee', 'right_ankle'],
  ] as [string, string][],
}

// 点属于哪个颜色
function pointGroup(name: string): 'upper' | 'torso' | 'lower' {
  // 头部 + 肩膀 + 手臂 全部红
  if (
    HEAD_KPS.includes(name as any) ||
    name === 'left_shoulder' ||
    name === 'right_shoulder' ||
    name === 'left_elbow' ||
    name === 'right_elbow' ||
    name === 'left_wrist' ||
    name === 'right_wrist'
  ) {
    return 'upper'
  }
  // 腿的点
  if (
    name === 'left_knee' ||
    name === 'right_knee' ||
    name === 'left_ankle' ||
    name === 'right_ankle' ||
    name === 'left_heel' ||
    name === 'right_heel' ||
    name === 'left_foot_index' ||
    name === 'right_foot_index'
  ) {
    return 'lower'
  }
  // 其余都算躯干
  return 'torso'
}

const UI_SOFT_FLOOR = 55
const UNIT_CN: Record<string, string> = {
  deg: '度',
  s: '秒',
  pct: '%',
}

export default function VideoAnalyzer() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // 👉 这里多存一个“识别得到的所有帧”
  const samplesRef = useRef<Sample[]>([])

  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [pose, setPose] = useState<PoseEngine | null>(null)
  const [coach, setCoach] = useState<CoachConfig>(DEFAULT_CONFIG)
  const [score, setScore] = useState<any>(null)
  const [openCfg, setOpenCfg] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)

  useEffect(() => {
    const p = new PoseEngine(coach)
    setPose(p)
  }, [coach])

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const url = URL.createObjectURL(f)
    setVideoUrl(url)
    setScore(null)
    samplesRef.current = [] // 切视频要清空旧姿态
  }

  /**
   * 把一帧姿态画到当前视频上
   */
  const drawPose = (res: any) => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !res) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 当前 video 在页面上的大小
    const rect = video.getBoundingClientRect()
    const displayW = rect.width
    const displayH = rect.height

    // 原始视频大小（模型坐标）
    const rawW = video.videoWidth || displayW
    const rawH = video.videoHeight || displayH

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    canvas.width = displayW * dpr
    canvas.height = displayH * dpr
    canvas.style.width = displayW + 'px'
    canvas.style.height = displayH + 'px'
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, displayW, displayH)

    // 跟 <video class="object-contain"> 一样的缩放&偏移
    const scale = Math.min(displayW / rawW, displayH / rawH)
    const drawW = rawW * scale
    const drawH = rawH * scale
    const offsetX = (displayW - drawW) / 2
    const offsetY = (displayH - drawH) / 2

    // 把 keypoints 放到一个 map 里，等下画线用
    const mp: Record<string, { x: number; y: number }> = {}
    res.keypoints.forEach((k: any) => {
      if (!k?.name) return
      mp[k.name] = {
        x: offsetX + k.x * scale,
        y: offsetY + k.y * scale,
      }
    })

    // 画线的小函数
    const drawSeg = (pairs: [string, string][], color: string) => {
      ctx.lineWidth = 4
      ctx.strokeStyle = color
      pairs.forEach(([a, b]) => {
        const p1 = mp[a]
        const p2 = mp[b]
        if (!p1 || !p2) return
        ctx.beginPath()
        ctx.moveTo(p1.x, p1.y)
        ctx.lineTo(p2.x, p2.y)
        ctx.stroke()
      })
    }

    // 1. 躯干（蓝）
    drawSeg(SEG.torso, COLOR.torso)
    // 2. 下肢（绿）
    drawSeg(SEG.lower, COLOR.lower)
    // 3. 上肢（红）
    drawSeg(SEG.upper, COLOR.upper)

    // 4. 画点：带描边，清晰一点
    res.keypoints.forEach((k: any) => {
      if (!k?.name) return
      const group = pointGroup(k.name)
      const x = offsetX + k.x * scale
      const y = offsetY + k.y * scale
      ctx.beginPath()
      ctx.fillStyle = COLOR[group]
      ctx.arc(x, y, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = 'rgba(15,23,42,0.6)' // 深色描边
      ctx.stroke()
    })
  }

  /**
   * 根据当前视频时间，找最近的一帧姿态并画出来
   * —— 这是为了“识别完成后再播放也有骨架”
   */
  const drawPoseAtTime = (t: number) => {
    const list = samplesRef.current
    if (!list.length) return
    // 找离 t 最近的
    let best = list[0]
    let diff = Math.abs(t - best.t)
    for (let i = 1; i < list.length; i++) {
      const d = Math.abs(t - list[i].t)
      if (d < diff) {
        diff = d
        best = list[i]
      }
    }
    drawPose(best.pose)
  }

  /**
   * 点击“开始分析”
   */
  const handleAnalyze = async () => {
    const video = videoRef.current
    if (!video || !pose) return

    try {
      await video.play()
    } catch {}

    setAnalyzing(true)
    const samples: Sample[] = []
    const start = performance.now()

    // 最多分析 4 秒
    while (video.currentTime <= (video.duration || 4) && video.currentTime <= 4) {
      const nowSec = (performance.now() - start) / 1000
      const res = await pose.estimate(video, nowSec)
      if (res) {
        drawPose(res)
        samples.push({ t: nowSec, pose: res })
      }
      if (video.ended || video.paused) break
      await new Promise((r) => setTimeout(r, 90))
    }

    // 👉 分析结束，把样本存起来，后面回放也能画
    samplesRef.current = samples

    // 后面这段是评分，保持你现在那套逻辑
    const last = samples.at(-1)
    const kin = last ? computeAngles(last.pose) : {}
    const rel = detectRelease(samples, coach)

    const getKP = (name: string) => last?.pose.keypoints.find((k: any) => k.name === name)
    const ensureAngle = (a: any, b: any, c: any) => {
      const v1x = a.x - b.x
      const v1y = a.y - b.y
      const v2x = c.x - b.x
      const v2y = c.y - b.y
      const d1 = Math.hypot(v1x, v1y) || 1e-6
      const d2 = Math.hypot(v2x, v2y) || 1e-6
      const cos = (v1x * v2x + v1y * v2y) / (d1 * d2)
      return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
    }

    if (!kin.kneeL) {
      const lh = getKP('left_hip')
      const lk = getKP('left_knee')
      const la = getKP('left_ankle')
      if (lh && lk && la) kin.kneeL = ensureAngle(lh, lk, la)
    }
    if (!kin.kneeR) {
      const rh = getKP('right_hip')
      const rk = getKP('right_knee')
      const ra = getKP('right_ankle')
      if (rh && rk && ra) kin.kneeR = ensureAngle(rh, rk, ra)
    }
    if (!kin.releaseAngle) {
      const rs = getKP('right_shoulder')
      const re = getKP('right_elbow')
      const rw = getKP('right_wrist')
      if (rs && re && rw) {
        kin.releaseAngle = ensureAngle(rs, re, rw)
      } else if (re && rw) {
        const dx = rw.x - re.x
        const dy = rw.y - re.y
        const forearmDeg = (Math.atan2(dy, dx) * 180) / Math.PI
        kin.releaseAngle = Math.abs(90 - forearmDeg)
      }
    }

    const features: any = {
      kneeDepth: (() => {
        const l = kin.kneeL
        const r = kin.kneeR
        if (typeof l === 'number' && typeof r === 'number') return Math.min(l, r)
        if (typeof l === 'number') return l
        if (typeof r === 'number') return r
        return 110
      })(),
      extendSpeed: 260,
      releaseAngle: kin.releaseAngle ?? 115,
      wristFlex: kin.wristR ?? 35,
      followThrough: 0.4,
      elbowCurve: rel.elbowCurvePct ?? 0.018,
      stability: rel.stabilityPct ?? 0.012,
      alignment: rel.alignmentPct ?? 0.018,
    }

    let s = scoreAngles(features, coach)
    s.buckets.forEach((b: any) => {
      b.items.forEach((it: any) => {
        if (!Number.isFinite(it.score) || it.score < UI_SOFT_FLOOR) it.score = UI_SOFT_FLOOR
      })
      b.score = Math.round(
        b.items.reduce((sum: number, it: any) => sum + it.score, 0) / Math.max(1, b.items.length),
      )
    })
    s.total = Math.round(
      s.buckets.reduce((sum: number, b: any) => sum + b.score, 0) / Math.max(1, s.buckets.length),
    )

    setScore(s)
    setAnalyzing(false)
  }

  /**
   * 📌 核心：识别完以后，只要用户播放 / 拖动 / 回到这一页
   * 我们都根据当前时间把最近的那一帧姿态画出来
   */
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handle = () => {
      if (!samplesRef.current.length) return
      drawPoseAtTime(video.currentTime)
    }

    video.addEventListener('timeupdate', handle)
    video.addEventListener('seeked', handle)
    video.addEventListener('play', handle)
    video.addEventListener('loadedmetadata', handle)

    return () => {
      video.removeEventListener('timeupdate', handle)
      video.removeEventListener('seeked', handle)
      video.removeEventListener('play', handle)
      video.removeEventListener('loadedmetadata', handle)
    }
  }, [])

  // 建议保持不变
  const suggestions: string[] = (() => {
    if (!score) return []
    const out: string[] = []
    const upper = score.buckets.find((b: any) => b.name.includes('上肢'))
    const balance = score.buckets.find((b: any) => b.name.includes('平衡') || b.name.includes('对齐'))
    if (upper) {
      const elbow = upper.items.find((x: any) => x.key === 'elbowCurve')
      if (elbow && elbow.score < 70) out.push('肘部路径有横向漂移，出手时让肘尖朝向篮筐，手肘不要外展。')
      const release = upper.items.find((x: any) => x.key === 'releaseAngle')
      if (release && release.score < 70) out.push('出手角稍偏，出手时前臂再竖直一点。')
    }
    if (balance) {
      const align = balance.items.find((x: any) => x.key === 'alignment')
      if (align && align.score < 70) out.push('脚-髋-肩-腕没有完全对准篮筐，起手前把脚尖和肩都对准。')
    }
    if (!out.length) out.push('整体姿态不错，保持当前节奏，多录几段做基线。')
    return out
  })()

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">开始分析你的
