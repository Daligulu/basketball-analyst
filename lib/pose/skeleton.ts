// lib/pose/skeleton.ts
// 姿态关键点顺序 + 三层配色骨架

export type KPName =
  | 'nose'
  | 'left_eye'
  | 'right_eye'
  | 'left_ear'
  | 'right_ear'
  | 'mouth_left'
  | 'mouth_right'
  | 'left_shoulder'
  | 'right_shoulder'
  | 'left_elbow'
  | 'right_elbow'
  | 'left_wrist'
  | 'right_wrist'
  | 'left_pinky'
  | 'right_pinky'
  | 'left_index'
  | 'right_index'
  | 'left_thumb'
  | 'right_thumb'
  | 'left_hip'
  | 'right_hip'
  | 'left_knee'
  | 'right_knee'
  | 'left_ankle'
  | 'right_ankle'
  | 'left_heel'
  | 'right_heel'
  | 'left_foot_index'
  | 'right_foot_index';

// 这个顺序给 poseEngine.ts 用来补名字，参考 TFJS BlazePose
export const PRIMARY_KEYPOINT_ORDER: KPName[] = [
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'mouth_left',
  'mouth_right',

  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',

  // 手指区域
  'left_pinky',
  'right_pinky',
  'left_index',
  'right_index',
  'left_thumb',
  'right_thumb',

  // 躯干 + 下肢
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
  'left_heel',
  'right_heel',
  'left_foot_index',
  'right_foot_index',
];

export const UPPER_COLOR = '#ff5a5a'; // 红：头+上肢+手
export const TORSO_COLOR = '#2b76ff'; // 蓝：躯干
export const LOWER_COLOR = '#10b981'; // 绿：下肢+脚尖

export const TORSO_CONNECTIONS: [KPName, KPName][] = [
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
];

export const UPPER_CONNECTIONS: [KPName, KPName][] = [
  // 头部
  ['nose', 'left_eye'],
  ['nose', 'right_eye'],
  ['left_eye', 'left_ear'],
  ['right_eye', 'right_ear'],
  ['nose', 'mouth_left'],
  ['nose', 'mouth_right'],
  // 头到肩
  ['nose', 'left_shoulder'],
  ['nose', 'right_shoulder'],
  // 左臂
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['left_wrist', 'left_index'],
  ['left_wrist', 'left_pinky'],
  ['left_wrist', 'left_thumb'],
  // 右臂
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['right_wrist', 'right_index'],
  ['right_wrist', 'right_pinky'],
  ['right_wrist', 'right_thumb'],
];

export const LOWER_CONNECTIONS: [KPName, KPName][] = [
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['left_ankle', 'left_heel'],
  ['left_ankle', 'left_foot_index'],

  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
  ['right_ankle', 'right_heel'],
  ['right_ankle', 'right_foot_index'],
];

// 前端画线用它就行了
export const ALL_CONNECTIONS = [
  ...UPPER_CONNECTIONS.map((pair) => ({ pair, color: UPPER_COLOR })),
  ...TORSO_CONNECTIONS.map((pair) => ({ pair, color: TORSO_COLOR })),
  ...LOWER_CONNECTIONS.map((pair) => ({ pair, color: LOWER_COLOR })),
];
