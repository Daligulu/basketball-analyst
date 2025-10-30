# 部署说明（v1.0.1）
- 修复评分映射、单位显示、下肢着色、总分0提示。
- Next.js + TFJS 架构不变；Vercel 一键部署。

## 推送到 GitHub
```bash
git init && git add . && git commit -m "release: v1.0.1 fixes"
git remote add origin https://github.com/<your-account>/Ai-basketball-analysis.git
git branch -M main && git push -u origin main
```

## Vercel
默认 Next.js 设置即可，build: `next build`。
