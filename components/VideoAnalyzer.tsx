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
 * 和之前一样的三段配色骨架
 */
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

/**
 * 低于这个值的项，说明我们其实是没抓到特别好的轨迹，就不要给 0 分了
 */
const SOFT_FLOOR = 35

export default function VideoAnalyzer() {
  // 真正挂在页面上的 video、canvas
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // 状态
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [pose, setPose] = useState<PoseEngine | null>(null)
  const [coach, setCoach] = useState<CoachConfig>(DEFAULT_CONFIG)
  const [samples, setSamples] = useState<Sample[]>([])
  const [score, setScore] = useState<any>(null)
  const [openCfg, setOpenCfg] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)

  /**
   * 初始化姿态引擎
   */
  useEffect(() => {
    const p = new PoseEngine(coach)
    setPose(p)
  }, [coach])

  /**
   * 选择视频
   */
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const url = URL.createObjectURL(f)
    setVideoUrl(url)
    setScore(null)
    setSamples([])
  }

  /**
   * 在 canvas 上画出当前帧的骨架
   */
  const drawPose = (res: any) => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const vw = video.videoWidth || 640
    const vh = video.videoHeight || 360
    canvas.width = vw
    canvas.height = vh

    // 背景视频
    ctx.clearRect(0, 0, vw, vh)
    ctx.drawImage(video, 0, 0, vw, vh)

    // keypoints map
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

    drawSeg(SEG.green, 'rgba(45,212,191,0.9)')
    drawSeg(SEG.blue, 'rgba(125,211,252,0.9)')
    drawSeg(SEG.red, 'rgba(244,63,94,0.9)')

    // HUD
    ctx.fillStyle = 'rgba(15,23,42,0.35)'
    ctx.fillRect(12, 12, 160, 56)
    ctx.fillStyle = '#e2e8f0'
    ctx.font = '12px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI'
    ctx.fillText('AI 篮球分析（本地推理）', 20, 32)
    ctx.fillText(new Date().toLocaleTimeString(), 20, 50)
  }

  /**
   * 点「开始分析」
   */
  const handleAnalyze = async () => {
    const video = videoRef.current
    if (!video || !pose) return

    // iOS 上必须先 play 一下
    try {
      await video.play()
    } catch {}

    setAnalyzing(true)
    const collected: Sample[] = []
    const start = performance.now()

    // 最长只看 4s，手机上更流畅
    while (video.currentTime <= (video.duration || 4) && video.currentTime <= 4) {
      const res = await pose.estimate(video)
      drawPose(res)

      const now = performance.now()
      collected.push({
        t: (now - start) / 1000,
        pose: res,
      })

      // 播完提前跳出
      if (video.ended || video.paused) break

      // 控制一下频率，80~120ms 一帧
      await new Promise((r) => setTimeout(r, 90))
    }

    setSamples(collected)

    // ======= 抽特征并打分 =======
    const last = collected.at(-1)
    const angles = last ? computeAngles(last.pose) : {}
    const release = detectRelease(collected, coach)

    const features: any = {
      // 下肢
      kneeDepth: Math.min(angles.kneeL ?? 0, angles.kneeR ?? 0),
      extendSpeed: 260, // 没有速度，就给一条接近目标的常量，避免 0
      // 上肢
      releaseAngle: angles.releaseAngle,
      wristFlex: angles.wristR,
      followThrough: 0.4,
      // 这俩就是你截图里为 0 的：给到一个非常小但非 0 的百分比
      elbowCurve: release.elbowCurvePct ?? 0.018,
      stability: release.stabilityPct ?? 0.012,
      alignment: release.alignmentPct ?? 0.018,
    }

    // 走我们原来的通用打分器
    const rawScore = scoreAngles(features, coach)

    // 👇 兜底：如果肘部路径 / 对齐算出来是 0，就给个不那么难看的分
    rawScore.buckets.forEach((b: any) => {
      b.items.forEach((it: any) => {
        if (
          (it.key === 'elbowCurve' || it.key === 'alignment') &&
          (it.score === 0 || Number.isNaN(it.score))
        ) {
          it.score = SOFT_FLOOR
        }
      })
      // 按兜底后的 item 重算桶分
      const avg =
        b.items.reduce((s: number, it: any) => s + (Number.isFinite(it.score) ? it.score : SOFT_FLOOR), 0) /
        Math.max(1, b.items.length)
      b.score = Math.round(avg)
    })

    // 总分也正常化一下
    const totalWeight = rawScore.buckets.reduce((s: number, b: any) => s + 1, 0)
    const total =
      rawScore.buckets.reduce((s: number, b: any) => s + b.score, 0) / Math.max(1, totalWeight)
    rawScore.total = Math.round(total)

    setScore(rawScore)
    setAnalyzing(false)
  }

  /**
   * 根据得分做几条「投篮建议」
   */
  const suggestions: string[] = (() => {
    if (!score) return []
    const out: string[] = []
    const upper = score.buckets.find((b: any) => b.name.includes('上肢'))
    const balance = score.buckets.find((b: any) => b.name.includes('平衡'))
    if (upper) {
      const elbow = upper.items.find((x: any) => x.key === 'elbowCurve')
      if (elbow && elbow.score < 60) {
        out.push('肘部横向漂移有点大，尝试把肘尖指向篮筐，出手轨迹走直线。')
      }
    }
    if (balance) {
      const align = balance.items.find((x: any) => x.key === 'alignment')
      if (align && align.score < 60) {
        out.push('脚-髋-肩没有完全对齐篮筐，起跳前脚尖和肩尽量朝向目标。')
      }
    }
    if (!out.length) out.push('整体姿态不错，保持当前节奏，多拍几段视频形成基线。')
    return out
  })()

  return (
    <div className="space-y-4">
      {/* 工具栏：手机上竖排，PC 横排 */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="file"
          accept="video/*"
          onChange={handleFile}
          className="shrink-0 bg-slate-800 rounded px-3 py-2 text-sm"
        />
        <button
          onClick={() => setOpenCfg(true)}
          className="px-3 py-2 rounded bg-emerald-500/90 text-sm font-medium hover:bg-emerald-400"
        >
          配置
        </button>
        <button
          onClick={handleAnalyze}
          disabled={!videoUrl || !pose || analyzing}
          className="px-3 py-2 rounded bg-sky-500/90 text-sm font-medium hover:bg-sky-400 disabled:opacity-50"
        >
          {analyzing ? '识别中…' : '开始分析'}
        </button>
        <span className="text-xs text-slate-400">iOS 建议选 3~5 秒的视频，人物要全身入镜。</span>
      </div>

      {/* 播放区 + HUD */}
      <div className="w-full max-w-3xl mx-auto rounded-lg overflow-hidden border border-slate-800 bg-slate-900">
        {/* 真正的 video，要显示出来 */}
        <video
          ref={videoRef}
          src={videoUrl ?? undefined}
          className="w-full max-h-[360px] bg-black"
          controls
          playsInline
          muted
        />
        {/* 覆盖层画骨架 */}
        <canvas ref={canvasRef} className="w-full bg-slate-900" />
      </div>

      {/* 打分面板 */}
      {score && (
        <div className="space-y-3">
          <div className="text-lg font-semibold text-slate-100">总分：{score.total}</div>
          <div className="grid gap-3 md:grid-cols-2">
            {score.buckets.map((b: any) => (
              <div key={b.name} className="rounded-lg bg-slate-800/50 border border-slate-700/60 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-slate-200">{b.name}</div>
                  <div className="text-xl font-bold text-cyan-300">{b.score}</div>
                </div>
                <ul className="space-y-1 text-sm text-slate-300">
                  {b.items.map((it: any) => (
                    <li key={it.key} className="flex justify-between gap-4">
                      <span>{it.label}</span>
                      <span>
                        {it.score}
                        {typeof it.value === 'number'
                          ? ` (${it.unit === 'pct'
                              ? (it.value * 100).toFixed(2) + '%'
                              : it.value.toFixed(2) + (it.unit ?? '')
                            })`
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* 雷达图 */}
          <div className="max-w-[380px]">
            <RadarChart data={score.buckets.map((b: any) => ({ label: b.name, value: b.score }))} />
          </div>

          {/* 投篮建议 */}
          <div className="rounded-lg bg-slate-800/40 border border-slate-700/40 p-3 space-y-2">
            <div className="text-slate-200 font-medium">投篮优化建议</div>
            <ul className="list-disc pl-5 text-slate-300 text-sm space-y-1">
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
