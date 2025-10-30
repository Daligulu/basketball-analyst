'use client'
import React, { useEffect, useRef } from 'react'

export type RadarDatum = { label: string, value: number } // 0..100

export default function RadarChart({data}:{data:RadarDatum[]}){
  const ref = useRef<HTMLCanvasElement|null>(null)
  useEffect(()=>{
    const c = ref.current!; const ctx = c.getContext('2d')!
    const W = 360, H = 300; c.width=W; c.height=H
    ctx.clearRect(0,0,W,H)
    const cx=W/2, cy=H/2+10, r=Math.min(W,H)/2-30
    const n=data.length
    // 画网格
    ctx.strokeStyle='rgba(148,163,184,0.35)'
    ctx.lineWidth=1
    for(let k=1;k<=4;k++){
      ctx.beginPath()
      const rr = r * k / 4
      for(let i=0;i<n;i++){
        const th = -Math.PI/2 + i*2*Math.PI/n
        const x = cx + rr*Math.cos(th), y = cy + rr*Math.sin(th)
        if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y)
      }
      ctx.closePath(); ctx.stroke()
    }
    // 画边和文本
    data.forEach((d,i)=>{
      const th = -Math.PI/2 + i*2*Math.PI/n
      const x = cx + (r+12)*Math.cos(th), y = cy + (r+12)*Math.sin(th)
      ctx.fillStyle = '#e2e8f0'
      ctx.font = '12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      ctx.textAlign = Math.cos(th)>0.3 ? 'left' : (Math.cos(th)<-0.3 ? 'right' : 'center')
      ctx.textBaseline = Math.sin(th)>0.3 ? 'top' : (Math.sin(th)<-0.3 ? 'bottom' : 'middle')
      ctx.fillText(d.label, x, y)
    })
    // 画数据
    ctx.beginPath()
    data.forEach((d,i)=>{
      const th = -Math.PI/2 + i*2*Math.PI/n
      const rr = r * (d.value/100)
      const x = cx + rr*Math.cos(th), y = cy + rr*Math.sin(th)
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y)
    })
    ctx.closePath()
    ctx.fillStyle='rgba(34,211,238,0.12)'
    ctx.fill()
    ctx.strokeStyle='rgba(34,211,238,0.8)'
    ctx.lineWidth=2
    ctx.stroke()
  },[data])
  return <canvas ref={ref} className='w-full max-w-[360px] h-[300px] border border-slate-700 rounded bg-slate-900'/>
}

export function exportCanvasPNG(canvas: HTMLCanvasElement, filename='radar.png'){
  const url = canvas.toDataURL('image/png')
  const a = document.createElement('a'); a.href=url; a.download=filename; a.click()
}
