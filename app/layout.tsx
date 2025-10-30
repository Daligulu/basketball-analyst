import './globals.css'
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: 'AI 篮球分析',
  description: '基于 TensorFlow.js 的投篮姿态分析',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-slate-900 text-slate-100">
        <main className="container py-6 space-y-6">{children}</main>
      </body>
    </html>
  )
}
