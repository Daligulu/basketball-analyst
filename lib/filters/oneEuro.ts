export class OneEuro2D {
  private minCutoff: number; private beta: number; private dCutoff: number;
  private prevX: number|null = null; private prevY: number|null = null; private prevT: number|null = null;
  constructor(cfg:{minCutoff:number,beta:number,dCutoff:number}){
    this.minCutoff = cfg.minCutoff; this.beta = cfg.beta; this.dCutoff = cfg.dCutoff;
  }
  filter(x:number,y:number,t:number){
    if(this.prevX===null){ this.prevX=x; this.prevY=y; this.prevT=t; return {x,y} }
    const dt = Math.max(1e-3, t-(this.prevT as number))
    const dx = (x - (this.prevX as number))/dt
    const dy = (y - (this.prevY as number))/dt
    const cutoff = this.minCutoff + this.beta * Math.hypot(dx,dy)
    const a = dt / (dt + 1/(2*Math.PI*cutoff))
    const fx = a*x + (1-a)*(this.prevX as number)
    const fy = a*y + (1-a)*(this.prevY as number)
    this.prevX = fx; this.prevY = fy; this.prevT = t;
    return {x:fx, y:fy}
  }
}
