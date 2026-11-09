# U7 本机任务（用 Opus 5.5，禁止 Fast）

仓库：Origin `maosaikou/tmp-fa9caf936c82a984`
Cloud Agent：https://cursor.com/agents/bc-97ccb31c-ef67-5161-9bca-9c0b8484079a
分支：在 main 上开 `cursor/u7-console-079a`；不要改无关单元。

## 硬约束
- 模型：Claude Opus 5.5（本机可用的 Opus）。禁止 Fast / 加速模式。
- 只做 U7：中文运行控制台。不要开始 U8，不要部署，不要公开仓库。
- 读 docs/plan.md「做运行控制台界面 (U7)」和 docs/design.md 相关节。
- 技术栈：src/server（Hono + SSE）+ web/（Vite + React + Tailwind + shadcn/ui + React Flow + Recharts）。
- 界面必须是中文：断供报价、预算决定、锁定账本要直接看得见，不要只甩终端日志。
- Mock / 无密钥模式可完整演示；顶部横幅标明模式。
- 价格战广告/降价为 0 是真实沙盘负边际结果，界面照实展示，不要改数字。
- U6 若未合入，可先基于 U5 事件流做界面；不要为了界面去改市场公式。
- 完成后停在 U7 审阅门：准备截图 artifacts/u7-review-*.png 与 30–60 秒录像 artifacts/u7-review.mp4，等用户确认，不要自行进 U8。

## 验收（P0）
- pnpm test 含 reducer / sse 相关测试通过。
- pnpm dev：服务 127.0.0.1:47321，界面 127.0.0.1:47322。
- 至少交付：完整 8 回合回放截图、断供协商报价图、账本锁定无重做、无密钥横幅。
- 提交信息以 U7 开头；未获用户审阅确认前不要声称完成。

用 poteto-mode 执行；汇报用中文。
