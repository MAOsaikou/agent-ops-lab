# AgentOps Harness · 可信多智能体编排与验证平台

面向「复杂行业任务的 Agent 编排」：定义 Agent 团队，把任务拆成带依赖、并行、条件与循环的工作流，由调度器按能力画像、运行负载和历史失败动态分配，再经过验证、自我循环修正和人工门，最后封存一条可回放的事件链。

演示场景是**商品上架评审**：从商品链接或分享文案 + 经营数字，跑出一条完整的 7 Agent 协作链路，产出定价、风险与上架建议。

## 平台做了什么

| 赛题要求的能力 | 平台里的实现 |
| --- | --- |
| Agent 团队定义 | `src/templates/agentops/catalog.ts`：7 个 Agent，各有角色、版本、能力画像、工具集与调用预算 |
| 工作流编排 | 同一文件里的 `DEFAULT_WORKFLOW`：顺序、并行（成本/市场）、条件分支、Self-Loop、人工门、最终验证、封存 |
| 动态调度 | `resolveAgent()` 按 `能力×负载×历史失败` 打分选择，并记录候选分数与理由 |
| 工具集成 | 9 个注册工具（链接解析、成本、保本价、三策略报价、30 天模拟、约束验证、文案、报告、知识库检索） |
| 多 Agent 协作 | 研究 → 成本 ∥ 市场 → 风控 →（失败回路）→ 文案 → 人审 → 报告 → 终检 |
| Self-Loop | 风控未通过时把验证结论反馈给调度器，调整假设后重跑受影响分支，最多 3 轮，每轮留痕 |
| 结果验证 | 逐项 verifier（保本价、目标毛利、p10 风险、证据边界、终检一致性），状态 pass / warn / fail |
| 可复现 | 每个事件带前序哈希成链，运行结束封存 SHA-256 指纹；同一输入重跑结果完全一致 |
| LLM 推理节点 | 文案节点可接 OpenAI-compatible 模型；模型输出必须通过长度与风险词校验，否则回退规则并记录 `llm.fallback` |

## 怎么跑

需要 Node.js 22 和 pnpm 10。

```bash
pnpm install
pnpm dev
```

- 界面：http://127.0.0.1:47322
- 接口：http://127.0.0.1:47321

在首页输入一段自然语言任务即可运行，例如：

> 分析这个拼多多商品是否值得上架：链接 + 分享文案。采购 16 元，包材 1.5 元，快递 6.5 元，目标毛利 30%，推广预算 30 元，可周转资金 300 元。

界面会实时给出：调度了哪个 Agent、为什么选它、调用了什么工具、验证通过与否、是否进入 Self-Loop、报告与指纹。

## 模型配置（可选）

默认不需要任何密钥：调度、工具、验证、循环全部是本地确定性实现，方便复现演示。

要启用真实模型节点：

```bash
AGENTOPS_LLM_BASE_URL=http://localhost:11434/v1   # Ollama / vLLM / 任意兼容网关
AGENTOPS_LLM_MODEL=qwen2.5:7b
AGENTOPS_LLM_API_KEY=local
```

配好后「文案」节点交给模型生成，输出先过校验（平台字数上限、极限词黑名单、JSON 结构），不合格就回退规则文案并留下 `llm.fallback` 事件。平台不会把规则结果伪装成模型推理。

```bash
pnpm lint && pnpm typecheck && pnpm test   # 120 个测试
pnpm e2e                                   # 先 pnpm dev，再跑
```

## 几十秒看懂数字打哪来

```
一件成本 = 采购价 + 包材 + 快递 + 平台佣金 + 支付手续费 + 退货摊销
退货摊销 = 退货率 ×（来回运费 + 包材 + 商品折损）
保本价   = 一件成本 ÷（1 − 平台佣金率 − 支付费率）
单件净利 = 售价 − 一件成本 − 推广摊销
日订单量 = 竞品价下的市场日单量 ×（竞品价 ÷ 售价）^ 价格弹性 + 推广带来的单量
推广单量 = 日预算 ÷ 点击单价 × 转化率
```

30 天推演：每天的需求按 ±28% 随机波动，备货受周转金限制，回款按平台账期延后，跑 200 次取 p10 / p50 / p90。推荐方案按 p10（最差 10% 的情况）挑，不赌最好的一天。

## 目录

- `src/templates/agentops/`：**平台层**。`catalog.ts`（Agent 团队、工具注册表、工作流定义、调度打分）、`runner.ts`（执行、验证、Self-Loop、事件链与指纹）、`llm.ts`（模型节点提示词与输出校验）、`types.ts`（工作流节点、事件、产物类型）。
- `src/templates/intake/`：商品链接与分享文案解析，作为「研究 Agent」的工具。
- `src/templates/pricing/`：定价领域计算。`economics.ts` 成本与需求，`simulate.ts` 30 天现金流推演，`candidates.ts` 三套方案与风控检查，`copy.ts` 标题卖点，`platform.ts` 六个平台的默认费率与标题限制。
- `src/server/`：Hono 接口（`pricing-app.ts`）、Agent 运行存档（`agent-runs.ts`，存在 `.data/agent-runs/`）、本地方案存档（`plans.ts`）。
- `web/`：Vite + React + Tailwind 的 Agent 控制台。
- `src/engine/`、`src/templates/simshop/`、`src/server/app.ts`：更早的多 Agent 编排引擎、确定性沙盘和它的事件流接口，保留并带完整测试，作为回归基准与设计参考。

## 接口

```
GET  /api/agentops/catalog            Agent 团队、工具注册表、默认工作流
POST /api/agentops/runs               传 {task, autoApprove?}，执行一次完整编排
GET  /api/agentops/runs               运行列表
GET  /api/agentops/runs/:id           单次运行：调度、事件、验证、循环、产物、指纹
GET  /api/agentops/runs/:id/events    只取事件链与指纹

GET  /api/platforms                   平台预设：抽成、支付费、退货率、标题字数上限
POST /api/plans                       传一份商品输入，返回三套方案 + 过程 + 指纹
GET  /api/plans/:id/export.csv        导出价格表（带 BOM，Excel 直接开）
```

## 边界（请务必知道）

- 平台费率是常见参考值，各平台按类目浮动，请填你后台的实际扣点。
- 需求模型只用任务里给的市场日单量和价格弹性，不预测趋势、不保证销量；没给的数字会在报告里列为「演示假设」。
- 短链和动态商品页不会被假装解析；缺失字段进入待确认，不写成已抓取事实。
- 卖点模板句要换成你实拍实测能对上的话；标题别写「全网最低」「销量第一」。
- 运行指纹只能证明「同样输入得到同样事件链和结果」，不能证明市场会照着走。
- 默认运行使用确定性规则 Harness；未配置模型时，界面不会宣称存在模型推理。