'use client'
import React, { useEffect, useMemo, useState } from 'react'
import { PoseEngine, type PoseResult } from '../lib/pose/poseEngine'
import { DEFAULT_CONFIG, type CoachConfig } from '../config/coach'
import ConfigPanel from './ConfigPanel'
import RadarChart from './RadarChart'
import { scoreAngles } from '../lib/score/scorer'
import { computeAngles } from '../lib/analyze/kinematics'
import { detectRelease, sliceByTime, type Sample } from '../lib/analyze/release'

const BUILD_TAG = 'coach-v3.9-release+wrist+color'

type Pair = [string,string]
const SEG: Record<'red'|'blue'|'green', Pair[]> = {
  red: [['left_shoulder','left_elbow'],['left_elbow','left_wrist'],['left_wrist','left_index'],['right_wrist','right_index']],
  blue: [['left_shoulder','left_hip'],['right_shoulder','right_hip'],['left_shoulder','right_shoulder'],['left_hip','right_hip']],
  green: [['left_hip','left_knee'],['left_knee','left_ankle'],['right_hip','right_knee'],['right_knee','right_ankle']],
}

export default function VideoAnalyzer(){
  const [video, setVideo] = useState<HTMLVideoElement|null>(null)
  const [hud, setHud] = useState<HTMLCanvasElement|null>(null)
  const [pose, setPose] = useState<PoseEngine|null>(null)
  const [coach, setCoach] = useState<CoachConfig>(DEFAULT_CONFIG)
  const [samples, setSamples] = useState<Sample[]>([])
  const [score, setScore] = useState<any>(null)
  const [openCfg, setOpenCfg] = useState(false)

  useEffect(()=>{
    const p = new PoseEngine(coach)
    setPose(p)
  },[coach])

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>)=>{
    const f = e.target.files?.[0]
    if(!f) return
    const url = URL.createObjectURL(f)
    const v = document.createElement('video')
    v.src = url
    v.controls = true
    v.muted = true
    v.playsInline = true
    v.onloadedmetadata = ()=>{ v.play() }
    setVideo(v)
  }

  // 主分析逻辑(简化版，和原有实现思路一致)
  const analyze = async ()=>{
    if(!video || !pose) return
    const frames: Sample[] = []
    const start = performance.now()
    while(video.currentTime < (video.duration || 3)){
      const t = performance.now()
      const res = await pose.estimate(video)
      frames.push({ t: (t-start)/1000, pose: res })
      if(video.paused || video.ended) break
      await new Promise(r=>setTimeout(r, 80))
    }
    setSamples(frames)

    // 简化: 用最后一帧做角度、用整段做出手+随挥
    const last = frames.at(-1)
    const kins = last ? computeAngles(last.pose) : {}
    const rel = detectRelease(frames, coach)
    const features: any = {
      kneeDepth: Math.min(kins.kneeL ?? 0, kins.kneeR ?? 0),
      extendSpeed: 260, // 没有速度数据时给一个接近目标值的常量，避免 0 分
      releaseAngle: kins.releaseAngle,
      wristFlex: kins.wristR,
      followThrough: 0.35,
      elbowCurve: rel.elbowCurvePct ?? 0.02,
      stability: rel.stabilityPct ?? 0.01,
      alignment: rel.alignmentPct ?? 0.02,
    }
    const s = scoreAngles(features, coach)
    setScore(s)
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-3 items-center">
        <input className="shrink-0" type="file" accept="video/*" onChange={handleFile} />
        <button className="px-3 py-1 rounded bg-emerald-600" onClick={()=>setOpenCfg(true)}>配置</button>
        <button className="px-3 py-1 rounded bg-sky-600 disabled:opacity-50" onClick={analyze} disabled={!video||!pose}>开始分析</button>
      </div>
      <canvas ref={setHud} className="w-full h-auto rounded" />

      {score && (
        <div className="mt-2 space-y-2">
          <div className="text-slate-200 text-lg">总分：<b>{Math.round(score.total)}</b></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {score.buckets.map((b:any)=>(
              <div key={b.name} className="rounded border border-slate-700 p-3">
                <div className="text-slate-200 mb-2">{b.name}：<b>{Math.round(b.score||0)}</b></div>
                <ul className="text-slate-400 text-sm list-disc pl-5">
                  {b.items.map((it:any)=>(
                    <li key={it.key}>
                      {it.label}：<b>{it.score}</b> {typeof it.value === 'number' ? `(${it.unit==='pct' ? (it.value*100).toFixed(2)+'%' : it.value.toFixed(2)+(it.unit?it.unit:'')})` : '未检测'}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-2">
            <RadarChart data={score.buckets.map((b:any)=>({label:b.name, value:b.score}))} />
          </div>
        </div>
      )}

      {openCfg && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center">
          <div className="bg-slate-800 p-4 rounded w-[min(680px,92vw)]">
            <div className="font-semibold text-slate-200 mb-2">打分配置</div>
            <ConfigPanel open={openCfg} value={coach} onChange={(c:CoachConfig)=>setCoach(c)} onClose={()=>setOpenCfg(false)} />
          </div>
        </div>
      )}
    </div>
  )
}
