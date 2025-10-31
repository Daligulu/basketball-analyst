'use client'

import React, { useEffect, useRef, useState } from 'react'
import { PoseEngine } from '@/lib/pose/poseEngine'
import { DEFAULT_CONFIG, type CoachConfig } from '@/config/coach'
import ConfigPanel from '@/components/ConfigPanel'
import RadarChart from '@/components/RadarChart'
import { scoreAngles } from '@/lib/score/scorer'
import { computeAngles } from '@/lib/analyze/kinematics'
import { detectRelease, type Sample } from '@/lib/analyze/release'

/**
 * 颜色：上肢红、躯干蓝、下肢绿
 */
const COLOR = {
  upper: 'rgba(248,113,113,1)',
  torso: 'rgba(59,130,246,0.95)',
  lower: 'rgba(34,197,94,0.95)',
}

const HEAD_KPS = ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear'] as const

const SEG = {
  upper: [
    ['nose', 'left_eye'],
    ['nose', 'right_eye'],
    ['left_eye', 'left_ear'],
    ['right_eye', 'right_ear'],
    ['nose', 'left_shoulder'],
    ['nose', 'right_shoulder'],

    ['left_shoulder', 'left_elbow'],
    ['left_elbow', 'left_wrist'],
    ['left_wrist', 'left_finger_tip'],

    ['right_shoulder', 'right_elbow'],
    ['right_elbow', 'right_wrist'],
    ['right_wrist', 'right_finger_tip'],
  ] as [string, string][],
  torso: [
    ['left_shoulder', 'right_shoulder'],
    ['left_shoulder', 'left_hip'],
    ['right_shoulder', 'right_hip'],
    ['left_hip', 'right_hip'],
  ] as [string, string][],
  lower: [
    ['left_hip', 'left_knee'],
    ['left_knee', 'left_ankle'],
    ['left_ankle', 'left_foot_index'],

    ['right_hip', 'right_knee'],
    ['right_knee', 'right_ankle'],
    ['right_ankle', 'right_foot_index'],
  ] as [string, string][],
}

function pointGroup(name: string): 'upper' | 'torso' | 'lower' {
  if (
    HEAD_KPS.includes(name as any) ||
    name === 'left_shoulder' ||
    name === 'right_shoulder' ||
    name === 'left_elbow' ||
    name === 'right_elbow' ||
    name === 'left_wrist' ||
    name === 'right_wrist' ||
    name === 'left_finger_tip' ||
    name === 'right_finger_tip'
  ) {
    return 'upper'
  }
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
  return 'torso'
}

const UI_SOFT_FLOOR = 55
const UNIT_CN: Record<string, string> = { deg: '度', s: '秒', pct: '%' }

export default function VideoAnalyzer() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const samplesRef = useRef<Sample[]>([])
  const lastDrawnRef = useRef<Record<string, { x: number; y: number }>>({})

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
    samplesRef.current = []
  }

  /**
   * 判断当前帧哪个是“投篮手”
   * 策略：
   * 1. 有肩 → 取两个肩的中点为 center
   * 2. 看这一帧里左右手腕哪个“更靠近 center 且更高” → 这个就是 primary arm
   */
  function detectPrimaryArm(
    pts: Record<string, { x: number; y: number }>,
    anchor: { ls?: { x: number; y: number }; rs?: { x: number; y: number } },
  ): 'left' | 'right' | null {
    const { ls, rs } = anchor
    if (!ls || !rs) return null
    const centerX = (ls.x + rs.x) / 2
    const lw = pts['left_wrist']
    const rw = pts['right_wrist']
    const span = Math.hypot(rs.x - ls.x, rs.y - ls.y) || 1

    const scoreSide = (p?: { x: number; y: number }) => {
      if (!p) return Number.NEGATIVE_INFINITY
      // 越靠近中心 + 越高，得分越高
      const distX = Math.abs(p.x - centerX)
      const normX = 1 - Math.min(distX / (span * 0.8), 1)
      const height = 1 - Math.min((p.y - Math.min(ls.y, rs.y)) / (span * 2.2), 1)
      return normX * 0.6 + height * 0.4
    }

    const lScore = scoreSide(lw)
    const rScore = scoreSide(rw)

    if (lScore < 0 && rScore < 0) return null
    return lScore >= rScore ? 'left' : 'right'
  }

  /**
   * 上肢点是否允许 —— 加了 primaryArm 的特判
   */
  function allowUpperPoint(
    name: string,
    pt: { x: number; y: number },
    anchors: {
      ls?: { x: number; y: number }
      rs?: { x: number; y: number }
      headY?: number
      shoulderSpan?: number
      centerX?: number
      primary?: 'left' | 'right' | null
    },
  ): boolean {
    const { ls, rs, headY, shoulderSpan, primary, centerX } = anchors
    if (!ls || !rs || !shoulderSpan) return true

    // 基础限制
    const maxHorizontal = shoulderSpan * 0.5
    const maxRadius = shoulderSpan * 1.85

    // 这个点是某一侧的
    const isLeft = name.startsWith('left_')
    const isRight = name.startsWith('right_')
    const thisShoulder = isLeft ? ls : isRight ? rs : null

    // 1) primary arm 可以高过头，也可以稍微再往中心伸
    const isPrimaryPoint =
      primary &&
      ((primary === 'left' && isLeft) || (primary === 'right' && isRight)) &&
      thisShoulder

    if (isPrimaryPoint) {
      // 放宽高度：不做头顶限制
      // 放宽水平：左右各 0.65 span
      const px = pt.x
      const py = pt.y
      const maxHori = shoulderSpan * 0.65
      const dx = px - thisShoulder!.x
      const dy = py - thisShoulder!.y
      if (isLeft && px < thisShoulder!.x - maxHori) return false
      if (isRight && px > thisShoulder!.x + maxHori) return false
      const maxR = shoulderSpan * 2.6
      if (Math.hypot(dx, dy) > maxR) return false
      return true
    }

    // 2) 非 primary arm 走原来的“头顶+距离肩”限制
    const topLimit = headY ? headY - shoulderSpan * 0.3 : undefined
    if (topLimit !== undefined && pt.y < topLimit) return false

    if (thisShoulder) {
      const dx = pt.x - thisShoulder.x
      const dy = pt.y - thisShoulder.y
      if (isLeft && pt.x < thisShoulder.x - maxHorizontal) return false
      if (isRight && pt.x > thisShoulder.x + maxHorizontal) return false
      if (Math.hypot(dx, dy) > maxRadius) return false
    }

    // 中间的（鼻子这种）只要没超头顶就行
    return true
  }

  const drawPose = (res: any) => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !res) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = video.getBoundingClientRect()
    const displayW = rect.width
    const displayH = rect.height
    const rawW = video.videoWidth || displayW
    const rawH = video.videoHeight || displayH

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    canvas.width = displayW * dpr
    canvas.height = displayH * dpr
    canvas.style.width = displayW + 'px'
    canvas.style.height = displayH + 'px'
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, displayW, displayH)

    const scale = Math.min(displayW / rawW, displayH / rawH)
    const drawW = rawW * scale
    const drawH = rawH * scale
    const offsetX = (displayW - drawW) / 2
    const offsetY = (displayH - drawH) / 2

    // 1. 原始点 → 画布坐标
    const mp: Record<string, { x: number; y: number }> = {}
    res.keypoints.forEach((k: any) => {
      if (!k?.name) return
      mp[k.name] = {
        x: offsetX + k.x * scale,
        y: offsetY + k.y * scale,
      }
    })

    // 2. 手指、脚尖先补一遍
    const ensureFinger = (wrist: string, elbow: string, out: string) => {
      const w = mp[wrist]
      const e = mp[elbow]
      if (w && e && !mp[out]) {
        const dx = w.x - e.x
        const dy = w.y - e.y
        mp[out] = { x: w.x + dx * 0.35, y: w.y + dy * 0.35 }
      }
    }
    ensureFinger('left_wrist', 'left_elbow', 'left_finger_tip')
    ensureFinger('right_wrist', 'right_elbow', 'right_finger_tip')

    const ensureToe = (ankle: string, heel: string, out: string) => {
      const a = mp[ankle]
      const h = mp[heel]
      if (mp[out]) return
      if (a && h) {
        const dx = a.x - h.x
        const dy = a.y - h.y
        mp[out] = { x: a.x + dx * 0.4, y: a.y + dy * 0.4 }
      } else if (a) {
        mp[out] = { x: a.x, y: a.y + drawH * 0.03 }
      }
    }
    ensureToe('left_ankle', 'left_heel', 'left_foot_index')
    ensureToe('right_ankle', 'right_heel', 'right_foot_index')

    // 3. bbox 粗过滤（把背景人先搬走一部分）
    const bbox = res.bbox as { x: number; y: number; w: number; h: number }
    const boxX = offsetX + bbox.x * scale
    const boxY = offsetY + bbox.y * scale
    const boxW = bbox.w * scale
    const boxH = bbox.h * scale
    const padX = boxW * 0.25
    const padY = boxH * 0.25

    let filtered: Record<string, { x: number; y: number }> = {}
    Object.entries(mp).forEach(([name, p]) => {
      const inBox =
        p.x >= boxX - padX &&
        p.x <= boxX + boxW + padX &&
        p.y >= boxY - padY &&
        p.y <= boxY + boxH + padY
      if (inBox) filtered[name] = p
    })

    // 4. 锚点 + primary arm
    const ls = filtered['left_shoulder']
    const rs = filtered['right_shoulder']
    const nose = filtered['nose']
    const le = filtered['left_eye']
    const re = filtered['right_eye']

    let headY: number | undefined = undefined
    const headCand = [nose, le, re].filter(Boolean) as { y: number }[]
    if (headCand.length) headY = Math.min(...headCand.map((p) => p.y))
    const shoulderSpan = ls && rs ? Math.hypot(rs.x - ls.x, rs.y - ls.y) : undefined
    const centerX = ls && rs ? (ls.x + rs.x) / 2 : undefined
    const primary = detectPrimaryArm(filtered, { ls, rs })

    const anchor = { ls, rs, headY, shoulderSpan, centerX, primary }

    // 5. 上肢做 3rd-pass 过滤（含 primary 特判）
    Object.entries(filtered).forEach(([name, p]) => {
      if (pointGroup(name) !== 'upper') return
      if (!allowUpperPoint(name, p, anchor)) {
        delete filtered[name]
      }
    })

    // 6. 保证 primary arm 这一侧的 3 个点都有：shoulder / elbow / wrist / finger
    const last = lastDrawnRef.current
    const ensurePrimaryChain = (side: 'left' | 'right') => {
      const sName = side === 'left' ? 'left_shoulder' : 'right_shoulder'
      const eName = side === 'left' ? 'left_elbow' : 'right_elbow'
      const wName = side === 'left' ? 'left_wrist' : 'right_wrist'
      const fName = side === 'left' ? 'left_finger_tip' : 'right_finger_tip'
      const s = filtered[sName]
      if (!s) return
      const e = filtered[eName] ?? last[eName]
      const w = filtered[wName] ?? last[wName]

      // elbow 不在就用 shoulder → (shoulder → 另一侧肩) 的中点拉一小段出来
      if (!filtered[eName]) {
        if (e && allowUpperPoint(eName, e, anchor)) {
          filtered[eName] = e
        } else {
          // 用肩往上长一点
          const fake = { x: s.x, y: s.y - (shoulderSpan ?? 20) * 0.35 }
          if (allowUpperPoint(eName, fake, anchor)) filtered[eName] = fake
        }
      }

      const elbowNow = filtered[eName]
      if (!filtered[wName] && elbowNow) {
        if (w && allowUpperPoint(wName, w, anchor)) {
          filtered[wName] = w
        } else {
          // 肘 → 手腕方向再拉一截
          const fakeW = { x: elbowNow.x, y: elbowNow.y - (shoulderSpan ?? 20) * 0.55 }
          if (allowUpperPoint(wName, fakeW, anchor)) filtered[wName] = fakeW
        }
      }

      const wristNow = filtered[wName]
      if (!filtered[fName] && wristNow && elbowNow) {
        const dx = wristNow.x - elbowNow.x
        const dy = wristNow.y - elbowNow.y
        const fakeF = { x: wristNow.x + dx * 0.35, y: wristNow.y + dy * 0.35 }
        if (allowUpperPoint(fName, fakeF, anchor)) filtered[fName] = fakeF
      }
    }

    if (primary) {
      ensurePrimaryChain(primary)
    } else {
      // 如果没识别出 primary，就至少把两侧都补一下，保证不缺胳膊
      ensurePrimaryChain('left')
      ensurePrimaryChain('right')
    }

    // 7. 回填上一帧里本应出现的关键点（同样要走 allowUpperPoint）
    const EXPECTED = [
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
      'left_finger_tip',
      'right_finger_tip',
      'left_hip',
      'right_hip',
      'left_knee',
      'right_knee',
      'left_ankle',
      'right_ankle',
      'left_foot_index',
      'right_foot_index',
    ]
    EXPECTED.forEach((name) => {
      if (filtered[name]) return
      const prev = last[name]
      if (!prev) return
      // 也要在 bbox 里
      const inBox =
        prev.x >= boxX - padX &&
        prev.x <= boxX + boxW + padX &&
        prev.y >= boxY - padY &&
        prev.y <= boxY + boxH + padY
      if (!inBox) return
      if (pointGroup(name) === 'upper') {
        if (!allowUpperPoint(name, prev, anchor)) return
      }
      filtered[name] = prev
    })

    // 8. 开始画线
    const drawSeg = (pairs: [string, string][], color: string) => {
      ctx.lineWidth = 2
      ctx.strokeStyle = color
      pairs.forEach(([a, b]) => {
        const p1 = filtered[a]
        const p2 = filtered[b]
        if (!p1 || !p2) return
        ctx.beginPath()
        ctx.moveTo(p1.x, p1.y)
        ctx.lineTo(p2.x, p2.y)
        ctx.stroke()
      })
    }

    drawSeg(SEG.torso, COLOR.torso)
    drawSeg(SEG.lower, COLOR.lower)
    drawSeg(SEG.upper, COLOR.upper)

    // 9. 画点（你说一半大小，这里用 2px）
    Object.entries(filtered).forEach(([name, p]) => {
      const g = pointGroup(name)
      ctx.beginPath()
      ctx.fillStyle = COLOR[g]
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(15,23,42,0.4)'
      ctx.stroke()
    })

    // 10. 存这一帧
    lastDrawnRef.current = filtered
  }

  const drawPoseAtTime = (t: number) => {
    const list = samplesRef.current
    if (!list.length) return
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

  const handleAnalyze = async () => {
    const video = videoRef.current
    if (!video || !pose) return

    video.pause()
    video.currentTime = 0
    await video.play()
    setAnalyzing(true)

    const samples: Sample[] = []
    const maxDur = Math.min(video.duration || 4, 4)

    while (!video.ended && video.currentTime <= maxDur) {
      const t = video.currentTime
      const res = await pose.estimate(video, t)
      if (res) {
        drawPose(res)
        samples.push({ t, pose: res })
      }
      await new Promise((r) => setTimeout(r, 70))
    }

    video.pause()
    video.currentTime = 0
    samplesRef.current = samples

    // ===== 打分保持你现在逻辑 =====
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
    drawPoseAtTime(0)
  }

  // 播放/seek 时同步姿态
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
  })() // 注意这里要有括号闭合

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">开始分析你的投篮</h1>
        <p className="text-xs text-slate-400 mt-1">BUILD: coach-v3.9-release+wrist+color</p>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="file"
          accept="video/*"
          onChange={handleFile}
          className="shrink-0 bg-slate-100 text-slate-900 rounded px-3 py-2 text-sm"
        />
        <button
          onClick={() => setOpenCfg(true)}
          className="px-4 py-2 rounded bg-emerald-500 text-white text-sm font-medium"
        >
          配置
        </button>
        <button
          onClick={handleAnalyze}
          disabled={!videoUrl || !pose || analyzing}
          className="px-4 py-2 rounded bg-sky-500 text-white text-sm font-medium disabled:opacity-50"
        >
          {analyzing ? '识别中…' : '开始分析'}
        </button>
      </div>

      <div className="relative w-full max-w-3xl rounded-lg overflow-hidden border border-slate-800 bg-slate-900">
        <video
          ref={videoRef}
          src={videoUrl ?? undefined}
          className="w-full max-h-[360px] bg-black object-contain"
          controls
          playsInline
          muted
        />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" />
      </div>

      {score && (
        <>
          <div className="text-lg font-semibold text-slate-100">总分：{score.total}</div>
          <div className="grid gap-3 md:grid-cols-2">
            {score.buckets.map((b: any) => (
              <div key={b.name} className="rounded-lg bg-slate-800/40 border border-slate-700/50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-slate-100">{b.name}</div>
                  <div className="text-cyan-300 text-xl font-bold">{b.score}</div>
                </div>
                <ul className="space-y-1 text-sm text-slate-200">
                  {b.items.map((it: any) => {
                    const unit = it.unit ? UNIT_CN[it.unit] ?? it.unit : ''
                    const hasValue = typeof it.value === 'number' && Number.isFinite(it.value)
                    const shown = hasValue
                      ? it.unit === 'pct'
                        ? (it.value * 100).toFixed(2) + '%'
                        : it.value.toFixed(2) + unit
                      : '未检测'
                    return (
                      <li key={it.key} className="flex items-center justify-between gap-2">
                        <span>{it.label}</span>
                        <span>
                          {it.score}
                          {` (${shown})`}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
          <div className="max-w-[380px]">
            <RadarChart data={score.buckets.map((b: any) => ({ label: b.name, value: b.score }))} />
          </div>
          <div className="rounded-lg bg-slate-800/30 border border-slate-700/30 p-3 space-y-2">
            <div className="text-slate-100 font-medium">投篮优化建议</div>
            <ul className="list-disc pl-5 text-slate-200 text-sm space-y-1">
              {suggestions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </>
      )}

      {openCfg && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-900 rounded-lg p-4 w-[min(90vw,720px)] max-h-[90vh] overflow-y-auto space-y-3">
            <div className="flex justify-between items-center">
              <div className="text-slate-100 font-semibold">打分配置</div>
              <button onClick={() => setOpenCfg(false)} className="text-slate-400 hover:text-slate-100">
                关闭
              </button>
            </div>
            <ConfigPanel open={true} value={coach} onChange={setCoach} onClose={() => setOpenCfg(false)} />
          </div>
        </div>
      )}
    </div>
  )
}
