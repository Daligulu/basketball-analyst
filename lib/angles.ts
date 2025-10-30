export function angle(a:{x:number,y:number}, b:{x:number,y:number}, c:{x:number,y:number}){
  const v1 = [a.x-b.x,a.y-b.y]
  const v2 = [c.x-b.x,c.y-b.y]
  const dot = v1[0]*v2[0]+v1[1]*v2[1]
  const n1 = Math.hypot(...v1)
  const n2 = Math.hypot(...v2)
  const cos = Math.max(-1, Math.min(1, dot/(n1*n2+1e-6)))
  return Math.acos(cos)*180/Math.PI
}
