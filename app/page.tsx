import Link from 'next/link'

export default function HomePage(){
  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-semibold">AI 篮球投篮分析</h1>
      <p className="text-slate-300">上传一段你的练习视频，我们会用姿态识别帮你分析下肢发力、上肢出手和对齐与平衡。</p>
      <Link href="/analyze" className="inline-flex items-center gap-2 bg-cyan-400/90 hover:bg-cyan-300 text-black px-4 py-2 rounded">开始分析</Link>
      <div className="text-xs text-slate-500">构建时间：2025-10-30 / build tag: coach-v3.9-release+wrist+color</div>
    </section>
  )
}
