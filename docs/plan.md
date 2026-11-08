# 多 Agent 经营挑战：分阶段执行计划（待审阅）

本计划把 `docs/design.md` 的推荐方案拆成 9 个可独立验证的单元，按顺序在一个分支上提交。
读者是执行者和审阅者。平台对象是参赛团队与评委，目标是 11/19 前备齐赛题一的全部初赛材料。
计划强制的规则只有一条。已提交的经营回合不可重做，所有结果都能从事件日志重放。
单元顺序是 U0 骨架，U1 市场引擎，U2 事件与结算，U3 Agent 与工具，U4 执行与调度，U5 验证与循环，U6 实验台，U7 界面，U8 提交材料。
本文件只是计划。没有写任何应用代码，没有跑过任何原型或测量。

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

正文是操作步骤。附录记录取舍、风险和与 pstack 骨架的偏离。

The program runs `pstack/skills/poteto-mode/playbooks/feature.md` once per unit. 本项目是新建私有仓库，用户没有要求开 PR，所以每个单元是同一分支上的一组提交，不是 PR。没有任何单元会自动合并或发布。用户逐个审阅 U5、U7、U8 的审阅门。

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] 向用户复述本计划和协议，然后停下。只有用户明确说开始，才进入执行。证据是聊天里的批准消息。
- [ ] 执行开始时读取以下文件。每完成一个单元再读一次。本仓库不含 pstack，所以从本机插件缓存读，路径前缀记为 `$PSTACK`，即 `~/.cursor/plugins/cache/cursor-public/9717366/<sha>/skills`。
  - [ ] `$PSTACK/poteto-mode/playbooks/feature.md`
  - [ ] `$PSTACK/swarm/SKILL.md`
  - [ ] `cursor-team-kit` 的 `control-ui/SKILL.md` 和 `control-cli/SKILL.md`
  - [ ] `$PSTACK/principle-make-operations-idempotent/SKILL.md`、`$PSTACK/principle-model-the-domain/SKILL.md`、`$PSTACK/principle-explain-the-number/SKILL.md`、`$PSTACK/benchmark-checklist/SKILL.md`
- [ ] 不设定时巡检，不开 `/loop`。用户明确禁止定时任务和无限循环。每完成一个单元，执行者主动发一条 status message，内容只写新完成的单元、证据路径、新出现的阻塞。
- [ ] 用户说暂停或停止时，立即停止写入，按 `$PSTACK/poteto-mode/playbooks/pause-safely.md` 收尾。

### Spawn owners

- [ ] 默认一个执行者顺序完成全部单元。理由是代码耦合在同一个引擎上，并行的收益小于冲突成本。
- [ ] 依赖关系如下。
  - [ ] U0 最先，从 `main` 开始。
  - [ ] U1 与 U3 都只依赖 U0，可以并行。
  - [ ] U2 在 U1 之后。
  - [ ] U4 在 U2 与 U3 之后。
  - [ ] U5 在 U4 之后。
  - [ ] U6 在 U5 之后。
  - [ ] U7 在 U2 之后开工，用录制的事件夹具开发，U5 完成后接真实事件流。
  - [ ] U8 的方案书骨架在 U0 之后开写，定稿在 U6 与 U7 之后。
- [ ] 守住文件边界。U1 只动 `src/templates/simshop/market/**`。U2、U4 只动 `src/engine/**`。U7 只动 `web/**` 和 `src/server/**`。
- [ ] 守住审阅门。U5、U7、U8 改变用户可见行为或对外材料，用户看过截图和录像后才算完成。
- [ ] 子代理模型。平时非前端用 `grok-4.7-xhigh` 或 `grok-4.7-high`，规划修订与前端大块用 Opus 5.5。Grok 配额不足时按附录 C 第 1 条改选，小任务优先经济模型。任何 slug 都不得带 `-fast`。

### PR mechanics, for every PR

- [ ] 本项目不开 PR，除非用户明确要求。每个单元在当前分支上提交，提交信息写明单元编号。
- [ ] 每个单元提交前运行 `pnpm lint && pnpm typecheck && pnpm test`，带钩子推送。
- [ ] 每次提交前跑 `/deslop`，单元收尾前跑 `/no-comments`。
- [ ] 如果用户之后要求开 PR，改用 `origin pr create`，并按 `$PSTACK/poteto-mode/playbooks/opening-a-pr.md` 写描述。

### Verdict and merge, for every PR

- [ ] 每个单元完成时，执行者按该单元的 Verify 三块逐项打勾，证据路径写进 `docs/decisions.tsv`。
- [ ] 某个 live lane 失败时，单元不算完成。先修根因，再整组重跑该单元的 lanes。
- [ ] 不合并，不发布。单元完成即在分支上推送。仓库公开与正式提交由用户执行。

### Boot recipe, for every live lane

每个 lane 在本机或云端虚拟机上，基于该单元最后一次提交运行。

- [ ] `git fetch origin <branch> && git checkout <unit head SHA>`。
- [ ] `pnpm install --frozen-lockfile`，然后 `pnpm dev`。服务监听 `127.0.0.1:47321`（配置），界面监听 `127.0.0.1:47322`（配置）。等待 `/healthz` 返回 200。
- [ ] 界面类 lane 只通过 `control-ui` 操作浏览器。命令行类 lane 只通过 `control-cli` 运行 `pnpm sim` 和 `pnpm exp`。只读诊断用 `GET /runs/:id/events` 和 `pnpm replay <runId>`。
- [ ] 截图存到 `/tmp/lanes-<unit>/lane-<n>/<slug>.png`，命令行输出存成同目录的 `.txt`，随报告返回路径。

## 搭骨架并强制平台与模板的边界 (U0)

**Depends on.** None.

**Files.**

- [ ] Create `package.json`、`pnpm-lock.yaml`、`tsconfig.json`、`vitest.config.ts`、`eslint.config.js`。
- [ ] Create `src/engine/index.ts`、`src/templates/simshop/index.ts`、`src/templates/meeting/index.ts`（第二模板占位）。
- [ ] Create `README.md` 的运行说明段落。

**Build.**

- [ ] 在 `eslint.config.js` 加 `no-restricted-imports` 规则，禁止 `src/engine/**` 导入 `src/templates/**`。
- [ ] 加脚本 `lint`、`typecheck`、`test`、`dev`、`sim`、`exp`、`replay`，后四个先输出「未实现」并以非零码退出。

**You see.**

- [ ] `pnpm lint && pnpm typecheck && pnpm test` 全部退出码为 0。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/boundary.test.ts` 新增一例，构造一个从引擎导入模板的临时文件，断言 lint 报错。运行 `pnpm test boundary`。

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Lanes on `待定，见附录 C 第 1 条` at the unit head.

- [ ] Lane 1. Regression lane against trunk. trunk 只有 README，没有可运行项目，记录这一事实。在单元头运行 `pnpm install && pnpm test`。Save `u0-install.txt`. Pass when 安装与测试退出码都是 0。
- [ ] Lane 2. 新克隆仓库，按 README 从零执行。Save `u0-readme.txt`. Pass when 按 README 原文执行无需额外步骤即可通过 `pnpm test`。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `pnpm lint && pnpm typecheck && pnpm test` 的墙钟时间。trunk 无此功能。
- [ ] Probe. `hyperfine -r 5 'pnpm lint && pnpm typecheck && pnpm test'`。
- [ ] Baseline. trunk 无可测项，记录为不适用。
- [ ] Rule. 绝对预算，目标 30 秒以内。超过即检查是否误把构建产物纳入检查。

**Review gate.** None. U0 is not review-gated.

**Merge.**

- [ ] 三块 Verify 全部打勾，证据写入 `docs/decisions.tsv`。
- [ ] 提交并推送到当前分支，提交信息以 `U0` 开头。

## 写确定性市场引擎并先检验决策是否有区分度 (U1)

**Depends on.** U0.

**Files.**

- [ ] Create `src/templates/simshop/market/rules.ts`，纯函数 `settle(state, decision, rng): Outcome`。
- [ ] Create `src/templates/simshop/market/rng.ts`，按 `(seed, stream, round, k)` 派生随机流。
- [ ] Create `src/templates/simshop/market/scenarios/*.json`，3 个场景（配置）。
- [ ] Create `src/templates/simshop/policies/heuristic.ts`，一个好的启发式和一个差的启发式。
- [ ] Create `scripts/sensitivity.ts`。

**Build.**

- [ ] 金额用整数分。需求公式按设计 6.4 节。噪声只读结算流。
- [ ] 随机流用 `hash(seed, stream, round, sku, k)` 派生，每回合每个 SKU 抽固定个数，与决策无关。
- [ ] 定义 `ScenarioTruth`、`Observation`、`PublicModel` 三个类型和 `project(state)`，隐藏参数只出现在 `ScenarioTruth`。
- [ ] `scripts/sensitivity.ts` 在 3 场景 × 20 种子上跑好坏两个启发式，输出两者利润分布。

**You see.**

- [ ] `pnpm sim --scenario spring --seed 42 --policy heuristic-good` 打印 8 回合账本和最终哈希。同命令再跑一次，哈希相同。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/market.golden.test.ts` 固定 3 组输入，比对整份 `Outcome` 快照。
- [ ] `test/market.property.test.ts` 断言销量不超过库存，现金变动等于营收减成本，同输入同输出。
- [ ] `test/rng.test.ts` 断言结算流与预测流前 1000 个数不相同，且两个不同决策在同一种子下消耗的噪声序列相同。
- [ ] `test/observation.test.ts` 扰动 `ScenarioTruth` 的隐藏参数和未来事件，断言 `project(state)` 逐字节不变。运行 `pnpm test market rng observation`。

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Lanes on `待定，见附录 C 第 1 条` at the unit head.

- [ ] Lane 1. Regression lane against trunk. trunk 无市场引擎，记录这一事实。在单元头跑 `pnpm sim` 两次比较哈希。Save `u1-determinism.txt`. Pass when 两次最终哈希相同。
- [ ] Lane 2. 运行 `pnpm tsx scripts/sensitivity.ts`。Save `u1-sensitivity.txt`. Pass when 好坏启发式的利润中位数之差大于两者四分位距之和。不满足则这是风险门，停下调参数并通知用户，不进入 U2。
- [ ] Lane 3. 断供场景，主供应商产能置零 2 回合。Save `u1-supplycut.txt`. Pass when 账本出现缺货且声誉下降，且不出现负库存。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 单回合 `settle` 的耗时。trunk 无此功能。
- [ ] Probe. `pnpm tsx scripts/bench-settle.ts`，预热后跑 10000 次，取中位数与 p95，重复 5 轮。
- [ ] Baseline. trunk 无可测项，记录为不适用。
- [ ] Rule. 绝对预算，目标 p95 不超过 1 ms。超过则说明公式里有不该有的循环或分配。

**Review gate.** None. U1 is not review-gated.

**Merge.**

- [ ] 三块 Verify 全部打勾，敏感度结果写入 `docs/decisions.tsv`。
- [ ] 提交并推送，提交信息以 `U1` 开头。

## 建事件日志、回合状态机和幂等结算 (U2)

**Depends on.** U1.

**Files.**

- [ ] Create `src/engine/events/store.ts`，SQLite 追加写，`(runId, seq)` 唯一。
- [ ] Create `src/engine/round/machine.ts`，回合状态机为显式迁移表。
- [ ] Create `src/engine/round/commit.ts`，提交与结算，幂等键 `(runId, round, decisionHash)`。
- [ ] Create `src/engine/snapshot.ts` 与 `src/engine/replay.ts`。
- [ ] Create `src/engine/types.ts`，设计 6.3 节的类型。

**Build.**

- [ ] 迁移表里 `Committed` 之后只有 `Settled` 与 `Reflected`，没有回到提案或验证的边。
- [ ] 加入否决边（`AwaitingApproval` 到 `Fallback`）和 `FallbackApproval` 状态，后者没有退回边。回合状态带 `returnsUsed` 与 `iterations` 字段。
- [ ] 复盘用幂等键 `(runId, round)`，已写入则跳过。信念更新是结算结果的纯函数。
- [ ] 同回合第二次提交不同决策返回 `RoundAlreadyCommitted`。相同决策重复提交返回已有记录。
- [ ] 回合记录形成哈希链，哈希包含观察、信念参数和知识库覆盖层的哈希。

**You see.**

- [ ] `pnpm replay <runId>` 打印逐回合哈希，最后一行是 `replay ok, final hash <h>`，与运行时记录的哈希相同。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/round.machine.test.ts` 枚举所有状态与事件，断言不存在从 `Committed` 回到 `Proposing` 或 `Verifying` 的迁移。
- [ ] `test/commit.idempotent.test.ts` 断言结算调用两次结果相同，账本只有一行。
- [ ] `test/crash.test.ts` 在每个事件写入点模拟崩溃（含已结算未复盘），恢复后最终哈希与不崩溃时相同。
- [ ] `test/round.approval.test.ts` 断言每回合最多退回一次，否决走安全默认决策，`FallbackApproval` 无法退回。运行 `pnpm test round commit crash approval`。

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Lanes on `待定，见附录 C 第 1 条` at the unit head.

- [ ] Lane 1. Regression lane against trunk. trunk 无事件日志，记录这一事实。在单元头用启发式策略跑 8 回合后 `pnpm replay`。Save `u2-replay.txt`. Pass when 输出 `replay ok` 且哈希一致。
- [ ] Lane 2. 第 4 回合结算中途 `kill -9`，重启 `pnpm sim --resume <runId>`。Save `u2-crash.txt`. Pass when 最终哈希与 Lane 1 相同。
- [ ] Lane 3. 对已结算的第 2 回合调用提交接口，传不同决策。Save `u2-reject.txt`. Pass when 返回 `RoundAlreadyCommitted` 且账本行数不变。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 事件追加吞吐，以及 8 回合运行的重放耗时。trunk 无此功能。
- [ ] Probe. `pnpm tsx scripts/bench-events.ts` 追加 10 万条事件，重复 5 轮。`hyperfine -r 10 'pnpm replay <runId>'`。
- [ ] Baseline. trunk 无可测项，记录为不适用。
- [ ] Rule. 绝对预算，目标每秒 5000 条以上，重放目标 1 秒以内。不达标时先查 SQLite 是否未开 WAL 或逐条提交事务。

**Review gate.** None. U2 is not review-gated.

**Merge.**

- [ ] 三块 Verify 全部打勾，证据写入 `docs/decisions.tsv`。
- [ ] 提交并推送，提交信息以 `U2` 开头。

## 注册 Agent 与工具并接入 LLM、知识库和 MCP (U3)

**Depends on.** U0.

**Files.**

- [ ] Create `src/engine/agents/registry.ts`，`AgentSpec` 注册、版本、按能力发现。
- [ ] Create `src/engine/tools/registry.ts`，`ToolSpec` 带 `effect`，Zod 生成 JSON Schema。
- [ ] Create `src/engine/llm/{openai-compatible,mock,cassette}.ts`。
- [ ] Create `src/engine/kb/index.ts`，本地 BM25 检索。
- [ ] Create `src/engine/tools/mcp-client.ts` 与 `src/templates/simshop/mcp-server.ts`。

**Build.**

- [ ] 注册校验：Agent 的工具清单含 `commit` 类工具时注册失败。
- [ ] LLM 适配器统一记录调用次数与 token，超出 `AgentSpec.budget` 直接拒绝。
- [ ] 回放模式按 `(runId, round, nodeId, attempt, promptHash)` 取录制结果，缺失时报错，不静默调用真实接口。
- [ ] Agent 产生的每个事件记录 `agentId@version` 与 `promptHash`。已用预算由事件折叠得出。
- [ ] 知识库分只读底库和按 `runId` 隔离的覆盖层。
- [ ] MCP 传输是 P1。截止节点前未完成时只保留 Function Calling，在材料里如实说明。
- [ ] 无密钥时自动进入 Mock 模式，并发出 `LlmModeChanged` 事件。

**You see.**

- [ ] `pnpm sim --llm mock` 跑通，日志首行打印 `llm mode: mock`。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/registry.test.ts` 断言带 `commit` 工具的 Agent 注册失败，同 ID 不同版本可并存并可按版本取用。
- [ ] `test/cassette.test.ts` 断言录制后回放输出逐字节相同，缺失录制时报错，崩溃重启后仍按键命中。
- [ ] `test/kb.isolation.test.ts` 断言新运行的覆盖层为空，检索不到其他运行的经验。
- [ ] `test/mcp.test.ts` 启动模板 MCP 服务器，经客户端调用 `market.read_prices` 得到与进程内调用相同的结果。运行 `pnpm test registry cassette mcp`。

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Lanes on `待定，见附录 C 第 1 条` at the unit head.

- [ ] Lane 1. Regression lane against trunk. trunk 无 Agent 层，记录这一事实。在单元头用真实密钥让定价 Agent 产出一次提案。Save `u3-real.txt`. Pass when 输出通过 Schema 校验，usage 被记录。无密钥时本 lane 标为 INCONCLUSIVE，不算通过。
- [ ] Lane 2. 删除密钥后运行。Save `u3-mock.txt`. Pass when 自动进入 Mock 模式且运行完成。
- [ ] Lane 3. 在 MCP 服务器运行中将其杀掉。Save `u3-mcp-drop.txt`. Pass when 客户端重连一次，失败后 Agent 收到「数据不可用」信号，进程不崩溃。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 回放模式下单次 LLM 调用的适配器开销，以及 MCP 调用与进程内调用的耗时差。trunk 无此功能。
- [ ] Probe. `pnpm tsx scripts/bench-llm.ts`，回放 1000 次；MCP 与进程内各调用 1000 次，重复 5 轮。
- [ ] Baseline. trunk 无可测项，记录为不适用。
- [ ] Rule. 绝对预算，目标回放开销 p95 不超过 2 ms，MCP 额外开销 p95 不超过 20 ms。

**Review gate.** None. U3 is not review-gated.

**Merge.**

- [ ] 三块 Verify 全部打勾，证据写入 `docs/decisions.tsv`。
- [ ] 提交并推送，提交信息以 `U3` 开头。

## 实现工作流执行器和调度器 (U4)

**Depends on.** U2, U3.

**Files.**

- [ ] Create `src/engine/workflow/{schema,executor}.ts`，九种节点，设计 6.2 节。
- [ ] Create `src/engine/scheduler/{queue,score,budget}.ts`。
- [ ] Create `src/templates/meeting/workflow.ts`，第二模板的最小工作流。

**Build.**

- [ ] 执行器按依赖就绪队列推进，`parallel` 支持 `all`、`any`、`quorum`，`loop` 必须带 `maxIterations`，`subflow` 可嵌套。
- [ ] 动态协作默认开启 LLM 规划器，它读 `Observation` 和注册表，提出要激活的 Agent 与要插入的子工作流。
- [ ] 规则层按能力画像、剩余预算、依赖关系裁决或否决规划，评分表与每次裁决都写成 `NodeScheduled` 事件，附理由。规则层不替规划器补上它漏掉的子工作流。
- [ ] 规划器可用 `--planner off` 关闭，供消融实验使用。
- [ ] 步骤重试、超时、退避，用尽进入 `DeadLetter`。

**You see.**

- [ ] `pnpm sim --llm mock --trace` 打印每个节点的排队、开始、结束时间，并行节点时间重叠。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/workflow.nodes.test.ts` 每种节点一例，含两层子工作流嵌套。
- [ ] `test/workflow.schema.test.ts` 断言缺 `maxIterations` 的循环定义解析失败。
- [ ] `test/scheduler.test.ts` 断言同输入同选择，预算不足时低分节点被跳过并记录原因。
- [ ] `test/meeting.test.ts` 第二模板端到端通过。运行 `pnpm test workflow scheduler meeting`。

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Lanes on `待定，见附录 C 第 1 条` at the unit head.

- [ ] Lane 1. Regression lane against trunk. trunk 无执行器，记录这一事实。在单元头跑 `pnpm sim --llm mock --trace`。Save `u4-trace.txt`. Pass when 三个提案节点的运行区间重叠。
- [ ] Lane 2. Mock LLM 对一个 Agent 注入 100% 超时。Save `u4-deadletter.txt`. Pass when 该步骤进入 `DeadLetter`，回合走 `Fallback` 并正常结束。
- [ ] Lane 3. 平静回合与断供回合各跑一次。Save `u4-selective.txt`. Pass when 两个回合激活的 Agent 集合不同，且 `NodeScheduled` 事件写明理由。
- [ ] Lane 4. 两个回合之间注册 `pricer@1.0.1`。Save `u4-hot-register.txt`. Pass when 下一回合的调度事件引用 `pricer@1.0.1`，`promptHash` 随之变化。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 不含 LLM 等待的调度开销，每步 p95。trunk 无此功能。
- [ ] Probe. `pnpm tsx scripts/bench-scheduler.ts`，Mock LLM 延迟设为 0，跑 1000 个回合，重复 5 轮，同时记录 CPU 采样。
- [ ] Baseline. trunk 无可测项，记录为不适用。
- [ ] Rule. 绝对预算，目标每步 p95 不超过 50 ms。超出时用 CPU 采样指出瓶颈，不凭读代码猜。

**Review gate.** None. U4 is not review-gated.

**Merge.**

- [ ] 三块 Verify 全部打勾，证据写入 `docs/decisions.tsv`。
- [ ] 提交并推送，提交信息以 `U4` 开头。

## 组装经营模板的验证、Self-Loop 和协商 (U5)

**Depends on.** U4.

**Files.**

- [ ] Create `src/engine/verify/{pipeline,loop}.ts`，分层验证与修正循环控制器。
- [ ] Create `src/templates/simshop/agents/*.ts`，采购、定价、营销、Critic、复盘、两个供应商谈判方。
- [ ] Create `src/templates/simshop/workflows/{round,supply-negotiation,price-war}.ts`。
- [ ] Create `src/templates/simshop/constraints.ts` 与 `src/templates/simshop/fallback.ts`。
- [ ] Create `src/templates/simshop/kb/*.md`，经营手册与合同条款。

**Build.**

- [ ] 循环终止条件按设计 7.4 节，每次迭代写 `LoopIterated` 事件，含终止原因。Critic 自报置信度不单独决定终止。
- [ ] 用 Mock 跑最坏回合，数出全部 LLM 调用（规划、提案、Critic、修正、供应商话术、复盘），再定每回合调用上限，写入 `docs/decisions.tsv`。
- [ ] Critic 的反对意见必须引用检查项 ID 或 `forecast`，否则丢弃并记录。
- [ ] 供应商的接受与还价由规则函数决定（隐藏底价、产能、交期、让步曲线）。LLM 只生成供应商话术，话术不含底价，不影响成交价。
- [ ] 协商子工作流是带 `maxIterations` 的循环节点，破裂时输出「本回合不向该供应商下单」。
- [ ] 预算协商的出价取沙盘工具对方案算出的边际收益，不取 Agent 自报数字。
- [ ] 复盘产出的提示词补丁发布为该 Agent 的新小版本。
- [ ] 复盘写入知识库的经验带回合号和事件指针，只在之后回合可检索。

**You see.**

- [ ] 断供场景下 `pnpm sim --llm real --scenario supplycut --seed 7` 的事件日志里出现 `supply-negotiation` 子工作流，报价轮数不超过上限，回合正常结算。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/fallback.property.test.ts` 对随机合法状态断言安全默认决策满足全部硬约束。
- [ ] `test/verify.injected.test.ts` 注入超库存促销、低于成本定价、超现金投放三类决策包，断言硬约束层全部拦截。
- [ ] `test/loop.termination.test.ts` 覆盖五种终止条件各一例。
- [ ] `test/sandbox.purity.test.ts` 断言沙盘调用前后状态哈希不变。
- [ ] `test/kb.timeline.test.ts` 断言第 n 回合检索不到第 n 回合及以后写入的经验。运行 `pnpm test fallback verify loop sandbox kb`。

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Lanes on `待定，见附录 C 第 1 条` at the unit head.

- [ ] Lane 1. Regression lane against trunk. trunk 无模板工作流，记录这一事实。回放模式跑完整 8 回合两次。Save `u5-replay.txt`. Pass when 两次最终哈希相同。
- [ ] Lane 2. 真实 LLM 跑断供场景。Save `u5-supply.txt`. Pass when 协商子工作流出现并在上限内结束，账本无负库存。
- [ ] Lane 3. 真实 LLM 跑价格战场景。Save `u5-pricewar.txt`. Pass when 出现预算仲裁事件，分配结果附各方沙盘估值。
- [ ] Lane 4. 把沙盘 p10 利润阈值调到不可能达到。Save `u5-loopcap.txt`. Pass when 每回合迭代数等于上限后进入 `Fallback`，运行结束。
- [ ] Lane 5. 检查断供回合的供应商话术和成交记录。Save `u5-supplier-rule.txt`. Pass when 成交价等于规则函数的输出，话术里不出现底价数字。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 每回合 LLM 调用次数与 token，以及真实模式下每回合墙钟时间。trunk 无此功能。
- [ ] Probe. 真实 LLM 跑 3 场景 × 3 种子，读引擎计数器和供应商 usage 字段。
- [ ] Baseline. trunk 无可测项，记录为不适用。
- [ ] Rule. 每回合调用上限取 Build 中自下而上数出的最坏回合次数，单局目标不超过 15 万 token。危机回合因预算落入 Fallback 即视为上限定错，回到 Build 重定。

**Review gate.** The operator reviews before merge.

- [ ] 把 Lane 2 与 Lane 3 的事件摘录渲染成截图，存为 `artifacts/u5-review-supply.png` 与 `artifacts/u5-review-pricewar.png`。
- [ ] 录一段 30 到 60 秒的终端录像，展示断供回合的协商过程，存为 `artifacts/u5-review.mp4`。
- [ ] 把截图（screenshot）和录像（video）发给用户（operator）审阅，等用户确认后再进入 U6。

**Merge.**

- [ ] 三块 Verify 全部打勾，用户已确认审阅门。
- [ ] 提交并推送，提交信息以 `U5` 开头。

## 建实验台并做压力测试 (U6)

**Depends on.** U5.

**Files.**

- [ ] Create `src/engine/experiments/{matrix,report}.ts`。
- [ ] Create `src/templates/simshop/strategies/{heuristic,single,serial,dynamic,cheat}.ts`。
- [ ] Create `scripts/stress.ts`。

**Build.**

- [ ] `pnpm exp --strategies all --scenarios all --seeds 1..10` 输出 CSV、Markdown 表和图。
- [ ] 每种策略相同的每回合调用上限。报告里列出每种策略实际用掉的调用数。
- [ ] `cheat` 策略只能经 `--include-cheat` 显式开启，报告里单独标注。
- [ ] P0 策略是规则基线、固定串行、动态协作、作弊对照。单 Agent 是 P1。
- [ ] 种子分开发集与报告集。报告集写入 `experiments/report-seeds.json` 并在首次录制前提交，报告头记录其哈希。
- [ ] 每次 `pnpm exp` 调用追加到 `experiments/log.jsonl`，报告引用日志中的全部运行，失败与 Fallback 计入分母。
- [ ] 实验时审批节点固定自动批准，危机卡日程固定。
- [ ] 报告成功率（验证通过、非 Fallback 提交的回合占比）、Fallback 率，以及相同注入延迟下每回合墙钟时间。
- [ ] 压力测试 `scripts/stress.ts` 是 P1。

**You see.**

- [ ] `artifacts/experiments/<date>/report.md` 列出各策略的利润中位数、四分位距、缺货率、调用量、成功率、Fallback 率和报告集种子哈希。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/experiments.fairness.test.ts` 断言各策略的调用上限相同，种子集合相同，组件差异只在设计第 9 节对照表允许的列。
- [ ] `test/experiments.log.test.ts` 断言报告的运行数等于日志的运行数，报告集哈希与提交的文件一致。
- [ ] `test/experiments.report.test.ts` 用 Mock 结果断言报告的统计量计算正确。运行 `pnpm test experiments`。

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Lanes on `待定，见附录 C 第 1 条` at the unit head.

- [ ] Lane 1. Regression lane against trunk. trunk 无实验台，记录这一事实。回放模式跑全矩阵两次。Save `u6-repro.txt`. Pass when 两份报告逐字节相同。
- [ ] Lane 2. 真实 LLM 跑用户批准预算内的矩阵。Save `u6-real.txt`. Pass when 报告完整，没有运行因预算超限被截断以外的失败。
- [ ] Lane 3. `pnpm tsx scripts/stress.ts --runs 20 --llm mock --latency lognormal`。Save `u6-stress.txt`. Pass when 20 个运行全部完成，报告调度开销 p50、p95 与成功率。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 并发运行数与成功率、调度开销 p95、事件写入吞吐。trunk 无此功能。
- [ ] Probe. `scripts/stress.ts` 在 1、5、10、20 个并发下各跑 3 次，交替顺序，记录 CPU 与磁盘计数。
- [ ] Baseline. trunk 无可测项。以 1 个并发的结果作为本单元内的基线。
- [ ] Rule. 目标 20 并发成功率 100%，调度开销 p95 相对 1 并发增长不超过 3 倍。每个数字附运行次数、波动和瓶颈说明，按 `benchmark-checklist` 复核后才写进材料。

**Review gate.** None. U6 is not review-gated. 实验结论的使用方式在 U8 的审阅门里由用户审。

**Merge.**

- [ ] 三块 Verify 全部打勾，报告路径写入 `docs/decisions.tsv`。
- [ ] 提交并推送，提交信息以 `U6` 开头。

## 做运行控制台界面 (U7)

**Depends on.** U2（事件结构），U5（真实事件流）。

**Files.**

- [ ] Create `src/server/app.ts`，Hono 路由与 SSE，按 `seq` 续传。
- [ ] Create `web/` 下的 Vite + React + Tailwind + shadcn/ui 项目。
- [ ] Create `web/src/views/{RunSetup,RunConsole,Negotiation,Ledger,Compare}.tsx`。
- [ ] Create `e2e/*.spec.ts`。

**Build.**

- [ ] 控制台主区是工作流图（React Flow），节点状态随事件变化；侧栏是 Agent 卡片、验证报告、沙盘区间。
- [ ] 账本区已结算回合显示锁定标记，没有重做入口。
- [ ] 危机卡、店长审批按钮、协商报价走势图。
- [ ] 空状态、加载状态、错误状态、无密钥模式横幅，窄屏布局。

**You see.**

- [ ] 浏览器打开 `http://127.0.0.1:47322`，开一局，工作流图节点依次亮起，第 1 回合结束后账本出现一行带锁的记录。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `web/src/state/reducer.test.ts` 用录制事件夹具断言界面状态折叠正确，乱序和重复事件被正确处理。
- [ ] `test/server.sse.test.ts` 断言带 `Last-Event-ID` 重连只收到之后的事件。运行 `pnpm test reducer sse`。

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Lanes on `待定，见附录 C 第 1 条` at the unit head.

- [ ] Lane 1. Regression lane against trunk. trunk 无界面，记录这一事实。在单元头开一局回放模式，跑完 8 回合。Save `u7-full-run.png`. Pass when 8 行账本全部带锁，最终哈希与 `pnpm replay` 一致。
- [ ] Lane 2. 并行提案阶段截图。Save `u7-parallel.png`. Pass when 图上同时有三个节点处于运行状态。
- [ ] Lane 3. 注入一个超库存促销提案。Save `u7-verify-fail.png`. Pass when 验证面板显示失败的检查项 ID，随后出现一次修正迭代。
- [ ] Lane 4. 店长审批节点点击退回。Save `u7-gate-return.png`. Pass when 回合回到修正状态，循环计数加一。
- [ ] Lane 5. 打出断供危机卡。Save `u7-negotiation.png`. Pass when 子工作流节点出现，报价走势图有至少两轮数据。
- [ ] Lane 6. 在账本上查找重做操作，并直接调用提交接口重做第 2 回合。Save `u7-locked.png`. Pass when 界面无入口，接口返回冲突，账本不变。
- [ ] Lane 7. P1。运行中断开网络 10 秒再恢复。未做断线续传时记录为未实现，不算通过。Save `u7-reconnect.png`. Pass when 事件续传无缺口，`seq` 连续。
- [ ] Lane 8. 375 像素宽视口走完一回合。Save `u7-mobile.png`. Pass when 无横向滚动，审批按钮可点。
- [ ] Lane 9. 无密钥启动。Save `u7-no-key.png`. Pass when 顶部横幅显示当前模式，演示可完整进行。
- [ ] Lane 10. 打过危机卡的一局结束后打开对比页。Save `u7-compare.png`. Pass when 其他策略的结果是用本局危机卡日志重跑得到的，图上显示种子、调用量与 Fallback 率。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 首屏可交互时间，以及事件从写入到界面渲染的延迟。trunk 无此功能。
- [ ] Probe. Playwright 记录 `domcontentloaded` 与首个工作流节点渲染时间，各跑 10 次；服务端事件写入时间戳与界面渲染时间戳相减。
- [ ] Baseline. trunk 无可测项，记录为不适用。
- [ ] Rule. 绝对预算，目标本地首屏 2 秒内可交互，事件到界面延迟 p95 不超过 300 ms。

**Review gate.** The operator reviews before merge.

- [ ] 把 Lane 1、5、6、10 的截图复制为 `artifacts/u7-review-<slug>.png`。
- [ ] 录一段 30 到 60 秒的完整回合录像，存为 `artifacts/u7-review.mp4`。
- [ ] 把截图（screenshot）和录像（video）发给用户（operator）审阅，等用户确认。

**Merge.**

- [ ] 三块 Verify 全部打勾，用户已确认审阅门。
- [ ] 提交并推送，提交信息以 `U7` 开头。

## 产出初赛提交材料 (U8)

**Depends on.** U6, U7.

**Files.**

- [ ] Create `submission/whitepaper.md` 与导出的 `submission/赛题一-<队伍名称>-<项目名称>.pdf`。
- [ ] Create `submission/slides.md` 或 `.pptx`，正文 10 到 15 页。
- [ ] Create `submission/video-script.md` 与 `submission/demo.mp4`。
- [ ] Edit `README.md`，写清安装、三种 LLM 模式、复现实验的命令。

**Build.**

- [ ] 方案书按设计第 13 节结构，赛题要求的 8 部分各成一章，附商业模式与团队介绍。
- [ ] 每个出现在材料里的数字都链接到 `artifacts/experiments/` 下的报告文件和种子列表。
- [ ] 人工智能使用说明写清 LLM、知识库、MCP 各自的作用、贡献和局限，包括「真实模型不逐字复现，只在回放模式下复现」。

**You see.**

- [ ] `submission/` 下四类材料齐全，文件名符合【赛题一+队伍名称+项目名称】。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `scripts/check-submission.ts` 断言 PDF 正文字数不少于 5000，8 个必需章节标题都存在，PPT 正文页数在 10 到 15 之间，视频时长在 3 到 5 分钟之间。运行 `pnpm tsx scripts/check-submission.ts`。

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Lanes on `待定，见附录 C 第 1 条` at the unit head.

- [ ] Lane 1. Regression lane against trunk. trunk 无材料，记录这一事实。新克隆仓库，只按 README 操作，复现视频里的演示。Save `u8-fresh-clone.png`. Pass when 无需额外口头说明即可跑通。
- [ ] Lane 2. 抽查材料里的 5 个数字。Save `u8-number-audit.txt`. Pass when 每个数字都能在实验报告里找到同值，并附种子数。
- [ ] Lane 3. 按视频脚本逐段对照视频。Save `u8-video-check.png`. Pass when 视频覆盖平台界面、编排过程、调度执行、结果验证、反馈循环五项。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 方案书字数、PPT 正文页数、视频时长。trunk 无此功能。
- [ ] Probe. `scripts/check-submission.ts`。
- [ ] Baseline. 赛事要求的下限与上限即基线。
- [ ] Rule. 任一项超出赛事要求即不通过。

**Review gate.** The operator reviews before merge.

- [ ] 把 PDF 首页、PPT 架构页、对比页导出为截图，存为 `artifacts/u8-review-<slug>.png`。
- [ ] 把成片视频 `submission/demo.mp4` 作为审阅录像。
- [ ] 把截图（screenshot）和视频（video）发给用户（operator）审阅。仓库公开和官网提交由用户执行。

**Merge.**

- [ ] 三块 Verify 全部打勾，用户已确认审阅门。
- [ ] 提交并推送，提交信息以 `U8` 开头。

## Close the program

- [ ] 上面每个勾都有证据。
- [ ] 向用户回报，内容按 `feature.md` 的回复要求，加上实验报告路径和未完成项。

截止节点（用户给定的硬期限倒推，是检查点，不是工作量估计）：

- [ ] 11/11 晚。U0、U1、U2 完成，U1 的敏感度风险门有结论。
- [ ] 11/14 晚。U3、U4、U5 完成，无界面跑通 8 回合（Mock 与真实各一次）。
- [ ] 11/16 晚。U6、U7 的 P0 部分完成，代码冻结。11/17 起只修缺陷和做材料。
- [ ] 11/18。方案书、PPT、视频成稿。
- [ ] 11/19。全量复核，材料交给用户提交。

范围按设计 11b 节分 P0 与 P1。落后时按此顺序砍 P1：同种子挑战，第二模板，断线续传，压力测试，MCP 传输（改为只用 Function Calling 并如实说明），价格战仲裁（并入主流程的条件分支），单 Agent 基线。P0 不砍，其中两阶段执行、幂等结算、观察投影、实验台公平条件是底线。

## Appendix A. Prototype evidence

本次没有跑任何原型，没有任何测量。以下开放问题都未经证明，由对应单元的 lane 回答。

1. 市场规则是否对决策敏感。未证明。U1 Lane 2 回答，它是第一个风险门。
2. 动态协作在同预算下是否优于固定串行。未证明。U6 Lane 2 回答。如果只在危机回合有差别，材料就如实这样写。
3. 每回合调用上限该定多少，以及真实 LLM 在该上限内能否稳定产出合法决策包。未证明。U5 Build 与 Perf 回答。
4. 供应商谈判在轮数上限内是否经常破裂。未证明。U5 Lane 2 回答。
5. 本地 BM25 知识库对决策是否有可见作用。未证明。U6 的消融对比回答（关掉复盘写入）。

## Appendix B. Alternatives rejected

- 方案 A，图编排框架加自定义节点。落选，因为调度、验证、循环会落入框架默认语义，踩赛题「禁止直接套用默认示例」的红线，并且提交边界需要额外包装。详见 `docs/design.md` 第 4 节。
- 方案 C，LLM 主管群聊式路由。落选，因为不可复现，且最容易退化成轮流聊天。它的长处保留为调度器的一个可选候选生成策略。
- 草案的「结算后不达标就回滚重做」。落选，因为它等于偷看结果，详见 `docs/design.md` 第 1 节。
- 草案的「MarketSim 规则加 LLM」。落选，因为 LLM 会编造数值。LLM 只在结算后写文字。
- 向量数据库。落选，因为语料只有几十条，BM25 足够，引入向量库只增加部署负担。
- 同种子挑战模式进入首个版本。暂缓，因为它需要一整套人工操作界面，挤占平台工作。

## Appendix C. Risks

1. 模型选择。平时非前端实现与验证用 `grok-4.7-xhigh` 或 `grok-4.7-high`，规划修订与前端大块用 Opus 5.5。任何 slug 都不得带 `-fast`，包括 pstack 默认的 `grok-4.7-xhigh-fast`。Grok 配额不足时，可以改用当时可用且适合的模型。小任务优先经济模型，重要规划与前端仍优先 Opus 5.5。只在启动下一任务或当次调用被配额拒绝时改选，不中断已在跑的有效工作。每次替换都记下实际 slug 和原因。此授权不包括应用内真实模型付费实验、购买、扩大范围、部署或公开。2026-11-08 已在跑的 U1 与 U3 仍是 `grok-4.7-xhigh`，没有因为本条改派。落在全部单元。
2. 市场规则不敏感，策略比较无意义。落在 U1，执行者盯 Lane 2。
3. 真实 LLM 预算和密钥未提供。落在 U3、U5、U6。没有密钥时只能交付回放与 Mock 模式，实验台真实数据缺失，材料要如实说明。
4. 时间。11/19 前要完成 9 个单元。落在全部单元，执行者按截止节点检查，落后就按砍单执行。
5. 赛题评分权重未公布。本计划没有按任何假设的权重分配精力。落在 U8。
6. 「回滚」措辞。赛题原文要求回滚能力，本设计只允许回滚未提交的沙盘状态。材料要正面解释这个边界，避免评委误读为缺功能。落在 U8。
7. 仓库公开。提交需要公开仓库或演示链接，这是对外发布，必须由用户执行或明确授权。落在 U8。
8. 学生团队成员与证明材料由用户提供，本计划无法代办。落在 U8。
9. 设计只经过同家族模型（`claude-opus-5-5-high`）的一次只读审阅，12 条意见已全部并入，但审阅属于判断，没有用运行证明。跨家族复核受附录 C 第 1 条约束，未做。落在 U2 与 U5，执行前由用户决定是否跑 interrogate。

## Appendix D. Links and reading list

- `docs/design.md`，本计划的设计依据。
- `docs/decisions.tsv`，本次规划的决策日志，按 `show-me-your-work` 的格式。
- `uploads/competition-details_6749.txt`，赛事原文（未提交进仓库）。
- `uploads/02-simshop-harness-mvp_4235.md`，原草案（未提交进仓库）。
- U2 与 U5 改变核心语义，执行前对这两个单元跑 `$PSTACK/interrogate/SKILL.md`。interrogate 默认用多家模型，与附录 C 第 1 条冲突，先由用户定模型。
- U2 的回合状态机可选用 `$PSTACK/statechart/SKILL.md` 做 TLA+ 检查，断言「提交后不回到提案」。它需要联网安装 Java 与 TLC，本次未运行。

## Appendix E. Deviations from the pstack skeleton

本计划按 `multi-phase-plan.md` 的骨架写，但有意不照搬以下部分。`check-plan.mjs` 会对其中几项报错，真实输出见 `docs/check-plan-output.txt`。

1. 不写 `/loop 1h` 巡检。用户明确禁止定时任务和无限循环。单人顺序执行，每个单元结束主动报告即可。
2. 不用 `git show origin/main:pstack/...` 读技能。本仓库不含 pstack，改为从本机插件缓存读。
3. 每个单元不是 PR。新建项目流程下用户没有要求开 PR。
4. 不是每个单元都跑十条 live lane。只有 U7 改变界面，跑满十条。其他单元按风险跑二到四条，用 `control-cli` 驱动。对纯引擎单元跑十条只会重复同一个命令。
5. live lane 的模型留空为待定，原因见附录 C 第 1 条。
6. 不做每单元全量 swarm 裁决。swarm 默认用别家模型，与用户的模型要求冲突，且本项目单人顺序执行，由执行者本人对照证据验收。
