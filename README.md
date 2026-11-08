# 多 Agent 经营挑战（规划阶段）

第五届「未来杯」赛题一「Agent 编排创新应用」参赛项目的规划仓库。目标是一个可复用的多 Agent 编排、调度、执行、验证平台，用多个 Agent 合作经营虚拟小店作为演示场景。

当前仓库是 TypeScript 骨架，设计与计划仍在 `docs/`。经营模拟还没有实现。

- `docs/design.md`：设计说明，包括回滚漏洞审查、架构取舍、数据形状、状态机、验收、预算、提交材料和演示脚本。
- `docs/plan.md`：分阶段执行计划（U0 到 U8），按 pstack 的 Multi-phase plan 骨架编写。
- `docs/check-plan-output.txt`：pstack `check-plan.mjs` 对计划的真实输出。
- `docs/decisions.tsv`：本次规划的决策日志。

## 本地运行

正式包名还没有定。`package.json` 里的 `agent-ops-lab` 是临时名字。

需要 Node.js 22 和 pnpm 10。在仓库根目录执行：

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```

`pnpm dev` 和 `pnpm exp` 还没有实现。`pnpm sim` 跑市场。`pnpm replay <runId>` 按 `.data/events.sqlite` 里的事件日志打印每回合哈希。

