// lib/pose/skeleton.ts
// 定义要画的骨架结构 & 颜色

export const UPPER_COLOR = '#f43f5e'; // 红
export const TORSO_COLOR = '#38bdf8'; // 蓝
export const LOWER_COLOR = '#22c55e'; // 绿

export type Connection = {
  pair: [string, string];
  color: string;
};

// 这个名字要和我们在 VideoAnalyzer 里生成的 name 一致（Mediapipe 33 点）
export const ALL_CONNECTIONS: Connection[] = [
  // 躯干
  { pair: ['left_shoulder', 'right_shoulder'], color: TORSO_COLOR },
  { pair: ['left_shoulder', 'left_hip'], color: TORSO_COLOR },
  { pair: ['right_shoulder', 'right_hip'], color: TORSO_COLOR },
  { pair: ['left_hip', 'right_hip'], color: TORSO_COLOR },

  // 左臂
  { pair: ['left_shoulder', 'left_elbow'], color: UPPER_COLOR },
  { pair: ['left_elbow', 'left_wrist'], color: UPPER_COLOR },
  { pair: ['left_wrist', 'left_index'], color: UPPER_COLOR },
  { pair: ['left_wrist', 'left_pinky'], color: UPPER_COLOR },
  { pair: ['left_wrist', 'left_thumb'], color: UPPER_COLOR },

  // 右臂
  { pair: ['right_shoulder', 'right_elbow'], color: UPPER_COLOR },
  { pair: ['right_elbow', 'right_wrist'], color: UPPER_COLOR },
  { pair: ['right_wrist', 'right_index'], color: UPPER_COLOR },
  { pair: ['right_wrist', 'right_pinky'], color: UPPER_COLOR },
  { pair: ['right_wrist', 'right_thumb'], color: UPPER_COLOR },

  // 左腿
  { pair: ['left_hip', 'left_knee'], color: LOWER_COLOR },
  { pair: ['left_knee', 'left_ankle'], color: LOWER_COLOR },
  { pair: ['left_ankle', 'left_heel'], color: LOWER_COLOR },
  { pair: ['left_heel', 'left_foot_index'], color: LOWER_COLOR },

  // 右腿
  { pair: ['right_hip', 'right_knee'], color: LOWER_COLOR },
  { pair: ['right_knee', 'right_ankle'], color: LOWER_COLOR },
  { pair: ['right_ankle', 'right_heel'], color: LOWER_COLOR },
  { pair: ['right_heel', 'right_foot_index'], color: LOWER_COLOR },

  // 头部（只画自己，不会连到背景）
  { pair: ['nose', 'left_eye'], color: UPPER_COLOR },
  { pair: ['nose', 'right_eye'], color: UPPER_COLOR },
  { pair: ['left_eye', 'left_ear'], color: UPPER_COLOR },
  { pair: ['right_eye', 'right_ear'], color: UPPER_COLOR },
];
