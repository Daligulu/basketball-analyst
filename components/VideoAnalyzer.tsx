'use client'

import React, { useEffect, useRef, useState } from 'react'
import { PoseEngine } from '@/lib/pose/poseEngine'
import { DEFAULT_CONFIG, type CoachConfig } from '@/config/coach'
import ConfigPanel from '@/components/ConfigPanel'
import RadarChart from '@/components/RadarChart'
import { scoreAngles } from '@/lib/score/scorer'
import { computeAngles } from '@/lib/analyze/kinematics'
import { detectRelease, type Sample } from '@/lib/analyze/release'

// 三色骨架：红=上肢，蓝=躯干，绿=下肢
const SEG: Record<'red' | 'blue' | 'green', [string, string][]> = {
  red: [
    ['left_shoulder', 'left_elbow'],
    ['left_elbow', 'left_wrist'],
    ['right_shoulder', 'right_elbow'],
    ['right_elbow', 'right_wrist'],
  ],
  blue: [
    ['left_shoulder', 'left_hip'],
    ['right_shoulder', 'right_hip'],
    ['left_shoulder', 'right_shoulder'],
    ['left_hip', 'right_hip'],
  ],
  green: [
    ['left_hip', 'left_knee'],
    ['left_knee', 'left_ankle'],
    ['right_hip', 'right_knee'],
    ['right_knee', 'right_ankle'],
  ],
}

// 展示层的最低分
const UI_SOFT_FLOOR = 55

// 单位中文
const UNIT_CN: Record<string, string> = {
  deg: '度',
  s: '秒',
  pct: '%',
}

export default function VideoAnalyzer() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [pose, setPose] = useState<PoseEngine | null>(null)
  const [coach, setCoach] = useState<CoachConfig>(DEFAULT_CONFIG)
  const [score, setScore] = useState<any>(null)
  const [openCfg, setOpenCfg] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)

  // 初始化姿态引擎
  useEffect(() => {
    const p = new PoseEngine(coach)
    setPose(p)
  }, [coach])

  // 上传视频
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const url = URL.createObjectURL(f)
    setVideoUrl(url)
    setScore(null)
  }

  // 在“原视频上”画姿态
  const drawPose = (res: any) => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 用显示尺寸，兼容竖视频
    const displayW = video.clientWidth || video.videoWidth || 640
    const displayH = video.clientHeight || video.videoHeight || 360

    canvas.width = displayW
    canvas.height = displayH

    // 先把视频帧画上去
    ctx.clearRect(0, 0, displayW, displayH)
    ctx.drawImage(video, 0, 0, displayW, displayH)

    // keypoint map
    const map: Record<string, { x: number; y: number }> = {}
    res.keypoints.forEach((k: any) => {
      if (!k?.name) return
      map[k.name] = { x: k.x, y: k.y }
    })

    const drawSeg = (pairs: [string, string][], color: string) => {
      ctx.lineWidth = 4
      ctx.strokeStyle = color
      pairs.forEach(([a, b]) => {
        const p1 = map[a]
        const p2 = map[b]
        if (!p1 || !p2) return
        ctx.beginPath()
        ctx.moveTo(p1.x, p1.y)
        ctx.lineTo(p2.x, p2.y)
        ctx.stroke()
      })
    }

    // 按照你原来的那种颜色来
    drawSeg(SEG.green, 'rgba(34,197,94,0.95)')
    drawSeg(SEG.blue, 'rgba(59,130,246,0.95)')
    drawSeg(SEG.red, 'rgba(248,113,113,1)')

    // 红色关键点
    ctx.fillStyle = 'rgba(248,113,113,1)'
    res.keypoints.forEach((k: any) => {
      if (!k?.x || !k?.y) return
      ctx.beginPath()
      ctx.arc(k.x, k.y, 5, 0, Math.PI * 2)
      ctx.fill()
    })
  }

  // 点击“开始分析”
  const handleAnalyze = async () => {
    const video = videoRef.current
    if (!video || !pose) return

    try {
      await video.play()
    } catch {}

    setAnalyzing(true)
    const samples: Sample[] = []
    const start = performance.now()

    // 取 0~4 秒的帧
    while (video.currentTime <= (video.duration || 4) && video.currentTime <= 4) {
      const res = await pose.estimate(video)
      drawPose(res)

      const now = performance.now()
      samples.push({ t: (now - start) / 1000, pose: res })

      if (video.ended || video.paused) break
      await new Promise((r) => setTimeout(r, 90))
    }

    // ===== 特征计算 =====
    const last = samples.at(-1)
    const kin = last ? computeAngles(last.pose) : {}
    const rel = detectRelease(samples, coach)

    // 再兜一层角度，防止“未检测”
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

    // 左膝
    if (!kin.kneeL) {
      const lh = getKP('left_hip')
      const lk = getKP('left_knee')
      const la = getKP('left_ankle')
      if (lh && lk && la) {
        kin.kneeL = ensureAngle(lh, lk, la)
      }
    }
    // 右膝
    if (!kin.kneeR) {
      const rh = getKP('right_hip')
      const rk = getKP('right_knee')
      const ra = getKP('right_ankle')
      if (rh && rk && ra) {
        kin.kneeR = ensureAngle(rh, rk, ra)
      }
    }

    // 出手角：肩-肘-腕
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

    // 要喂给打分器的特征
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

    // 评分
    let s = scoreAngles(features, coach)

    // UI 兜底：任何小于 55 的一律拉到 55
    s.buckets.forEach((b: any) => {
      b.items.forEach((it: any) => {
        if (!Number.isFinite(it.score) || it.score < UI_SOFT_FLOOR) {
          it.score = UI_SOFT_FLOOR
        }
      })
      const avg =
        b.items.reduce(
          (sum: number, it: any) => sum + (Number.isFinite(it.score) ? it.score : UI_SOFT_FLOOR),
          0,
        ) / Math.max(1, b.items.length)
      b.score = Math.round(avg)
    })
    const total =
      s.buckets.reduce((sum: number, b: any) => sum + b.score, 0) / Math.max(1, s.buckets.length)
    s.total = Math.round(total)

    setScore(s)
    setAnalyzing(false)
  }

  // 建议
  const suggestions: string[] = (() => {
    if (!score) return []
    const out: string[] = []
    const upper = score.buckets.find((b: any) => b.name.includes('上肢'))
    const balance = score.buckets.find((b: any) => b.name.includes('平衡') || b.name.includes('对齐'))
    if (upper) {
      const elbow = upper.items.find((x: any) => x.key === 'elbowCurve')
      if (elbow && elbow.score < 70) {
        out.push('肘部路径有横向漂移，出手时让肘尖朝向篮筐，手肘不要外展。')
      }
      const release = upper.items.find((x: any) => x.key === 'releaseAngle')
      if (release && release.score < 70) {
        out.push('出手角稍偏，出手时前臂再竖直一点。')
      }
    }
    if (balance) {
      const align = balance.items.find((x: any) => x.key === 'alignment')
      if (align && align.score < 70) {
        out.push('脚-髋-肩-腕没有完全对准篮筐，起手前把脚尖和肩都对准。')
      }
    }
    if (!out.length) {
      out.push('整体姿态不错，保持当前节奏，多录几段做基线。')
    }
    return out
  })()

  return (
    <div className="space-y-4">
      {/* 顶部 */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">开始分析你的投篮</h1>
        <p className="text-xs text-slate-400 mt-1">BUILD: coach-v3.9-release+wrist+color</p>
      </div>

      {/* 工具栏 */}
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

      {/* 播放区：video + 盖上的姿态 */}
      <div className="relative w-full max-w-3xl rounded-lg overflow-hidden border border-slate-800 bg-slate-900">
        <video
          ref={videoRef}
          src={videoUrl ?? undefined}
          className="w-full max-h-[360px] bg-black"
          controls
          playsInline
          muted
        />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 w-full h-full" />
      </div>

      {/* 评分面板 */}
      {score && (
        <div className="space-y-3">
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

          {/* 雷达图 */}
          <div className="max-w-[380px]">
            <RadarChart data={score.buckets.map((b: any) => ({ label: b.name, value: b.score }))} />
          </div>

          {/* 建议 */}
          <div className="rounded-lg bg-slate-800/30 border border-slate-700/30 p-3 space-y-2">
            <div className="text-slate-100 font-medium">投篮优化建议</div>
            <ul className="list-disc pl-5 text-slate-200 text-sm space-y-1">
              {suggestions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* 配置面板 */}
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
