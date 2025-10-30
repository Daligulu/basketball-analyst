'use client'
import React, { useState } from 'react'
import { DEFAULT_CONFIG, type CoachConfig } from '../config/coach'

// 显式列出基准键，避免构建环境的类型推断退化
const BASELINE_KEYS = ['kneeDepth','extendSpeed','releaseAngle','wristFlex','followThrough','elbowCurve','stability','alignment'] as const
type BaselineKey = typeof BASELINE_KEYS[number]

export default function ConfigPanel({
  open, value, onChange, onClose,
}:{
  open:boolean; value:CoachConfig; onChange:(v:CoachConfig)=>void; onClose:()=>void
}){
  if(!open) return null
  const cfg = value
  const defaultBaseline: any = (DEFAULT_CONFIG as any)?.scoring?.baseline || {}
  const [showHelp, setShowHelp] = useState<string | null>(null)
  const helpOf: Record<string,string> = {
    kneeDepth: '膝关节夹角，越接近目标越好。',
    extendSpeed: '起跳时膝盖伸展的角速度，越快分越高。',
    releaseAngle: '出手瞬间前臂与地面的夹角。',
    wristFlex: '手腕主动发力角度。',
    followThrough: '出手后保持随挥的时间。',
    elbowCurve: '出手过程中肘部的横向漂移百分比，越小越好。',
    stability: '投篮整个过程身体重心的水平摆动百分比，越小越好。',
    alignment: '脚、髋、肩、腕的投篮方向对齐度，越小越好。',
  }
  return (
    <div className="space-y-3">
      <div className="text-slate-200 font-semibold">打分基准设置</div>
      <p className="text-slate-400 text-sm">这里的参数会直接影响最终得分。你可以把实际测出来的数值填到基准里。</p>
      <div className="grid grid-cols-2 gap-3">
        {BASELINE_KEYS.map(k=>{
          const rule = (cfg as any).weights?.flatMap((b:any)=>b.items).find((it:any)=>it.key===k)?.rule
          const baseline = defaultBaseline[k] ?? rule?.target ?? 0
          const tolerance = rule?.tolerance ?? 0
          return (
            <div key={k} className="bg-slate-700/50 rounded p-2">
              <div className="flex items-center justify-between mb-1">
                <div className="text-slate-100 text-sm">{helpOf[k] ? `${helpOf[k].split('，')[0]}` : k}</div>
                <button className="text-xs text-cyan-300" onClick={()=>setShowHelp(showHelp===k?null:k)}>说明</button>
              </div>
              <div className="text-xs text-slate-400">目标: {baseline} / 容差: {tolerance}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
