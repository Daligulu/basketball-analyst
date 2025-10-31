// lib/pose/skeleton.ts
// 定义骨架、关键点顺序和配色
// 注意：这个顺序要和浏览器里用的 pose 模型保持一致（BlazePose / TFJS pose-detection）

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

// 这是给 poseEngine.ts 用的名字排序：如果当前帧的 keypoint 里没带 name，就按这个顺序去补
// 顺序参考了 TFJS pose-detection 的 BlazePose 输出
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

  // 手部
  'left_pinky',
  'right_pinky',
  'left_index',
  'right_index',
  'left_thumb',
  'right_thumb',

  // 躯干 & 下肢
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

// 颜色：上肢 + 头 红色；躯干 蓝色；下肢 绿色
export const UPPER_COLOR = '#ff5a5a'; // 红
export const TORSO_COLOR = '#2b76ff'; // 蓝
export const LOWER_COLOR = '#10b981'; // 绿

// 躯干连接（蓝）——这几条基本不会错位
export const TORSO_CONNECTIONS: [KPName, KPName][] = [
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
];

// 上肢 + 头部（红）
export const UPPER_CONNECTIONS: [KPName, KPName][] = [
  // 头脸
  ['nose', 'left_eye'],
  ['nose', 'right_eye'],
  ['left_eye', 'left_ear'],
  ['right_eye', 'right_ear'],
  ['nose', 'mouth_left'],
  ['nose', 'mouth_right'],

  // 头和肩
  ['nose', 'left_shoulder'],
  ['nose', 'right_shoulder'],

  // 左手
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['left_wrist', 'left_index'],
  ['left_wrist', 'left_pinky'],
  ['left_wrist', 'left_thumb'],

  // 右手
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['right_wrist', 'right_index'],
  ['right_wrist', 'right_pinky'],
  ['right_wrist', 'right_thumb'],
];

// 下肢（绿）——带脚跟和脚尖
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

// 前端画线时就遍历这个
export const ALL_CONNECTIONS = [
  ...UPPER_CONNECTIONS.map((pair) => ({ pair, color: UPPER_COLOR })),
  ...TORSO_CONNECTIONS.map((pair) => ({ pair, color: TORSO_COLOR })),
  ...LOWER_CONNECTIONS.map((pair) => ({ pair, color: LOWER_COLOR })),
];
