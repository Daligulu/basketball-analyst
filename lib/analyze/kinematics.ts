import type { PoseResult } from '../pose/poseEngine'

export type Angles = {
  kneeL?: number; kneeR?: number; hipL?: number; hipR?: number;
  ankleL?: number; ankleR?: number; elbowR?: number; wristR?: number;
  releaseAngle?: number; lateralOffsetPct?: number
}

function ang(a:{x:number,y:number}, b:{x:number,y:number}, c:{x:number,y:number}){
  const v1=[a.x-b.x,a.y-b.y], v2=[c.x-b.x,c.y-b.y]
  const dot=v1[0]*v2[0]+v1[1]*v2[1]
  const n1=Math.hypot(...v1), n2=Math.hypot(...v2)
  const cos=Math.max(-1,Math.min(1,dot/(n1*n2+1e-6)))
  return Math.acos(cos)*180/Math.PI
}

export function computeAngles(pose:PoseResult): Angles {
  const k: any = {}
  for (const kp of pose.keypoints){
    k[kp.name!] = kp
  }
  let kneeL: number|undefined, kneeR: number|undefined
  if (k.left_hip && k.left_knee && k.left_ankle){
    kneeL = ang(k.left_hip, k.left_knee, k.left_ankle)
  }
  if (k.right_hip && k.right_knee && k.right_ankle){
    kneeR = ang(k.right_hip, k.right_knee, k.right_ankle)
  }
  let releaseAngle: number|undefined
  if (k.right_elbow && k.right_wrist && k.right_shoulder){
    const forearm = Math.atan2(k.right_wrist.y-k.right_elbow.y, k.right_wrist.x-k.right_elbow.x)
    const ground = Math.PI/2
    const rel = Math.abs((Math.PI/2 - (forearm - ground)))
    releaseAngle = Math.abs(rel*180/Math.PI)
  }
  let lateralOffsetPct: number|undefined
  if (k.left_hip&&k.right_hip&&k.left_ankle&&k.right_ankle&&k.nose){
    const hipMid = {x:(k.left_hip.x+k.right_hip.x)/2,y:(k.left_hip.y+k.right_hip.y)/2}
    const feetMid= {x:(k.left_ankle.x+k.right_ankle.x)/2,y:(k.left_ankle.y+k.right_ankle.y)/2}
    const height = Math.hypot(k.nose.x-hipMid.x, k.nose.y-hipMid.y)*3
    const off = Math.abs(hipMid.x - feetMid.x)
    lateralOffsetPct = height>1? off/height: undefined
  }
  return { kneeL,kneeR,hipL:undefined,hipR:undefined,ankleL:undefined,ankleR:undefined,elbowR:k.right_elbow?.x?undefined:undefined,wristR:k.right_wrist?.x?undefined:undefined,releaseAngle,lateralOffsetPct }
}
