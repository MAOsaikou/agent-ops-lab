import { sha256Hex } from "../../engine/hash.js";
import { canonicalJson } from "../../engine/json.js";
import { parseRunId } from "../../engine/ids.js";
import type { LiveLlm } from "./llm.js";
import { copyPrompt, validateCopy } from "./llm.js";
import { analyzeProductInput } from "../intake/agent.js";
import { buildPlan } from "../pricing/plan.js";
import type { ProductInput } from "../pricing/model.js";
import { PLATFORM_PRESETS } from "../pricing/platform.js";
import { AGENTS, DEFAULT_WORKFLOW, resolveAgent } from "./catalog.js";
import type { AgentRun, Artifacts, InternalState, RiskRow, RunEvent, Verification, VerificationStatus } from "./types.js";

const ZERO_HASH = "0".repeat(64);

function money(cents: number): string { return `¥${(cents / 100).toFixed(2)}`; }
function pct(value: number): string { return `${(value * 100).toFixed(1)}%`; }

type TaskFacts = {
  readonly buyCents: number | null;
  readonly packagingCents: number | null;
  readonly shippingCents: number | null;
  readonly adDailyBudgetCents: number | null;
  readonly cashCents: number | null;
  readonly competitorCents: number | null;
  readonly marketOrders: number | null;
  readonly targetMargin: number | null;
};

function yuanOf(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);
  const raw = match?.[1];
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

function parseTaskFacts(text: string): TaskFacts {
  const marginMatch = /(?:目标\s*毛利|毛利(?:率)?|利润率)\s*[:：]?\s*(\d{1,2}(?:\.\d)?)\s*%/i.exec(text);
  const orderMatch = /(?:竞品\s*)?(?:日单量|日销|日均|每天)\s*[:：]?\s*约?\s*(\d{1,6})/.exec(text);
  const marginValue = marginMatch?.[1] === undefined ? null : Number(marginMatch[1]) / 100;
  const orderValue = orderMatch?.[1] === undefined ? null : Number(orderMatch[1]);
  return {
    buyCents: yuanOf(text, /(?:采购价?|进货价?|拿货价?)\s*[:：]?\s*(\d{1,6}(?:\.\d{1,2})?)\s*元/),
    packagingCents: yuanOf(text, /(?:包材|包装)\s*[:：]?\s*(\d{1,6}(?:\.\d{1,2})?)\s*元/),
    shippingCents: yuanOf(text, /(?:快递|运费|物流)\s*[:：]?\s*(\d{1,6}(?:\.\d{1,2})?)\s*元/),
    adDailyBudgetCents: yuanOf(text, /(?:推广预算|日预算|投放预算|预算)\s*[:：]?\s*(\d{1,6}(?:\.\d{1,2})?)\s*元/),
    cashCents: yuanOf(text, /(?:可周转资金|周转金|备货资金)\s*[:：]?\s*(\d{1,7}(?:\.\d{1,2})?)\s*元/),
    competitorCents: yuanOf(text, /(?:竞品(?:主流)?价|京东价|售价)\s*[:：]?\s*[¥￥]?\s*(\d{1,6}(?:\.\d{1,2})?)/),
    marketOrders: orderValue !== null && Number.isFinite(orderValue) ? orderValue : null,
    targetMargin: marginValue !== null && marginValue >= 0.02 && marginValue <= 0.6 ? marginValue : null,
  };
}

function defaultProduct(text: string, facts: ReturnType<typeof analyzeProductInput>["patch"]): ProductInput {
  const platform = facts.platform ?? "taobao";
  const preset = PLATFORM_PRESETS[platform];
  return {
    platform,
    name: facts.name ?? "待确认商品",
    category: facts.category ?? "待确认类目",
    keywords: facts.keywords ?? "",
    buyCents: 1600,
    packagingCents: 150,
    shippingCents: 650,
    commissionRate: preset.commissionRate,
    payFeeRate: preset.payFeeRate,
    returnRate: 0.15,
    returnSalvage: 0.6,
    adDailyBudgetCents: 3000,
    adCpcCents: 80,
    adCvr: 0.04,
    competitorCents: facts.competitorCents ?? 3990,
    marketOrders: facts.marketOrders ?? 50,
    elasticity: 2.2,
    targetMargin: 0.25,
    cashCents: 30_000,
    settleDays: preset.settleDays,
    services: facts.services ?? [],
    promoEnabled: true,
    promoDiscount: 0.9,
    seed: Math.abs([...text].reduce((sum, char) => sum + char.codePointAt(0)!, 0)),
  };
}

function initialState(taskText: string, autoApprove: boolean): InternalState {
  return {
    taskText,
    autoApprove,
    gateDecision: null,
    targetMargin: 0.25,
    facts: null,
    product: null,
    unit: null,
    breakEvenCents: 0,
    candidates: [],
    chosenId: null,
    risk: null,
    copy: null,
    bullets: [],
    report: [],
    assumptions: ["未提供采购、包材、快递等经营数据时，使用可见的演示假设；这些假设会在报告中标注。"],
    verifications: [],
    loops: [],
    adjustments: [],
    loads: {},
    calls: {},
    failures: {},
    runs: {},
    dispatches: [],
    gateNeeded: true,
  };
}

function eventHash(prevHash: string, seq: number, type: string, detail: string): string {
  return sha256Hex(canonicalJson({ version: 1, prevHash, seq, type, detail }));
}

function addEvent(events: RunEvent[], type: RunEvent["type"], title: string, detail: string, nodeId: string | null, agentId: string | null): void {
  const previous = events.at(-1)?.hash ?? ZERO_HASH;
  const seq = events.length + 1;
  events.push({ seq, type, nodeId, agentId, title, detail, prevHash: previous, hash: eventHash(previous, seq, type, detail) });
}

function dispatch(state: InternalState, events: RunEvent[], nodeId: string, capability: Parameters<typeof resolveAgent>[0], title: string, iteration: number): string {
  const selected = resolveAgent(capability, state.loads, state.failures, state.calls);
  const chosen = selected.agent;
  const candidates = selected.scores.map(({ agent, score }) => ({ agentId: agent.id, score, note: `${agent.name} 能力 ${pct(agent.capabilities[capability] ?? 0)}，负载 ${String(state.loads[agent.id] ?? 0)}，失败 ${String(state.failures[agent.id] ?? 0)}` }));
  state.calls[chosen.id] = (state.calls[chosen.id] ?? 0) + 1;
  state.runs[chosen.id] = (state.runs[chosen.id] ?? 0) + 1;
  state.loads[chosen.id] = (state.loads[chosen.id] ?? 0) + 1;
  const rationale = `需求=${capability}；从 ${String(candidates.length)} 个候选中按能力、当前负载、历史失败次数选择 ${chosen.name}`;
  state.dispatches.push({ nodeId, need: capability, chosen: chosen.id, rationale, candidates });
  addEvent(events, "dispatch.decided", `调度：${chosen.name}`, `${title}（第 ${String(iteration)} 轮） · ${rationale}`, nodeId, chosen.id);
  addEvent(events, "node.started", `${chosen.name} 开始执行`, `Agent v${chosen.version} · 工具：${chosen.tools.join("、")}`, nodeId, chosen.id);
  return chosen.id;
}

function runTool(events: RunEvent[], nodeId: string, tool: string, agentId: string, detail: string): void {
  addEvent(events, "tool.called", `工具调用：${tool}`, detail, nodeId, agentId);
}

function verify(state: InternalState, events: RunEvent[], stage: string, verifier: string, title: string, status: VerificationStatus, detail: string, nodeId: string, agentId: string): Verification {
  const item = { stage, verifier, title, status, detail };
  state.verifications.push(item);
  addEvent(events, "verify.checked", `${title}：${status === "pass" ? "通过" : status === "warn" ? "提醒" : "失败"}`, detail, nodeId, agentId);
  return item;
}

function executeResearch(state: InternalState, events: RunEvent[], iteration: number): void {
  const agent = dispatch(state, events, "research", "intake", "识别商品链接与证据", iteration);
  state.facts = analyzeProductInput({ text: state.taskText });
  runTool(events, "research", "product.parse", agent, `${String(state.facts.links.length)} 条链接，${String(state.facts.fields.length)} 个候选字段，保留字段证据与待确认问题`);
  runTool(events, "research", "knowledge.search", agent, "检索平台规则、标题限制和费率边界");
  addEvent(events, "node.output", "商品研究员提交证据包", `${state.facts.headline}；${state.facts.questions.length} 个字段进入待确认，不把短链猜成商品详情`, "research", agent);
  const base = defaultProduct(state.taskText, state.facts.patch);
  const given = parseTaskFacts(state.taskText);
  const product: ProductInput = {
    ...base,
    buyCents: given.buyCents ?? base.buyCents,
    packagingCents: given.packagingCents ?? base.packagingCents,
    shippingCents: given.shippingCents ?? base.shippingCents,
    adDailyBudgetCents: given.adDailyBudgetCents ?? base.adDailyBudgetCents,
    cashCents: given.cashCents ?? base.cashCents,
    competitorCents: given.competitorCents ?? base.competitorCents,
    marketOrders: given.marketOrders ?? base.marketOrders,
    targetMargin: given.targetMargin ?? base.targetMargin,
  };
  state.product = product;
  state.targetMargin = product.targetMargin;
  if (given.buyCents === null) state.assumptions.push(`任务没给采购价，按演示假设 ${money(base.buyCents)} 计算`);
  if (given.shippingCents === null) state.assumptions.push(`任务没给快递成本，按演示假设 ${money(base.shippingCents)} 计算`);
  if (given.competitorCents === null && state.facts.patch.competitorCents === undefined) state.assumptions.push(`没有竞品价证据，按演示假设 ${money(base.competitorCents)} 计算`);
  if (given.marketOrders === null) state.assumptions.push(`任务没给价格带日单量，按演示假设 ${String(base.marketOrders)} 单/天计算`);
  if (given.targetMargin === null) state.assumptions.push(`任务没给目标毛利，按演示假设 ${pct(base.targetMargin)} 计算`);
  if (given.adDailyBudgetCents === null) state.assumptions.push(`任务没给推广预算，按演示假设 ${money(base.adDailyBudgetCents)}/天计算`);
}

function executeAccount(state: InternalState, events: RunEvent[], iteration: number): void {
  const agent = dispatch(state, events, "account", "cost", "核算成本与保本价", iteration);
  if (state.product === null) throw new Error("product is missing before account");
  const plan = buildPlan(state.product, { id: "internal", createdAt: "2026-01-01T00:00:00.000Z" });
  state.unit = plan.candidates[0]?.evaluation.unit ?? null;
  state.breakEvenCents = plan.candidates[0]?.evaluation.breakEvenCents ?? 0;
  runTool(events, "account", "pricing.unit-cost", agent, `一件成本 ${money(state.unit?.totalCents ?? 0)}`);
  runTool(events, "account", "pricing.break-even", agent, `保本价 ${money(state.breakEvenCents)}`);
  addEvent(events, "node.output", "成本会计提交可审计计算", `成本 ${money(state.unit?.totalCents ?? 0)}；保本价 ${money(state.breakEvenCents)}；输入假设已写入报告`, "account", agent);
}

function executeMarket(state: InternalState, events: RunEvent[], iteration: number): void {
  const agent = dispatch(state, events, "market", "market", "生成价格策略与现金流情景", iteration);
  if (state.product === null) throw new Error("product is missing before market");
  const plan = buildPlan(state.product, { id: "internal", createdAt: "2026-01-01T00:00:00.000Z" });
  state.candidates = plan.candidates;
  state.chosenId = plan.recommendedId;
  runTool(events, "market", "pricing.candidates", agent, `生成 ${String(plan.candidates.length)} 个策略：${plan.candidates.map((candidate) => `${candidate.label} ${money(candidate.priceCents)}`).join("、")}`);
  runTool(events, "market", "pricing.simulate", agent, "每个策略进行 30 天、200 次现金流模拟");
  addEvent(events, "node.output", "市场分析师提交三套策略", `推荐 ${plan.candidates.find((candidate) => candidate.id === plan.recommendedId)?.label ?? "—"}，依据 p10 风险利润而非单次最好结果`, "market", agent);
}

function executeRisk(state: InternalState, events: RunEvent[], iteration: number): void {
  const agent = dispatch(state, events, "risk", "risk", "独立验证成本、需求和策略", iteration);
  const chosen = state.candidates.find((candidate) => candidate.id === state.chosenId) ?? state.candidates[0];
  const rows: RiskRow[] = [];
  if (chosen === undefined || state.product === null || state.unit === null) {
    rows.push({ title: "上下文完整性", status: "fail", detail: "风控缺少成本或候选策略，要求回退重算" });
  } else {
    rows.push({ title: "售价高于保本价", status: chosen.priceCents >= state.breakEvenCents ? "pass" : "fail", detail: `${money(chosen.priceCents)} vs ${money(state.breakEvenCents)}` });
    rows.push({ title: "目标毛利达到要求", status: chosen.evaluation.daily.margin >= state.targetMargin ? "pass" : "fail", detail: `${pct(chosen.evaluation.daily.margin)} vs ${pct(state.targetMargin)}；不满足时反馈调整推广预算后重算` });
    rows.push({ title: "最差 10% 仍可承受", status: chosen.sim.p10Cents >= 0 ? "pass" : "fail", detail: `p10 ${money(chosen.sim.p10Cents)}，不使用 p50 掩盖风险` });
    const unanswered = state.facts?.questions.length ?? 0;
    rows.push({ title: "证据边界清晰", status: unanswered > 2 ? "fail" : unanswered === 0 ? "pass" : "warn", detail: state.facts === null ? "没有研究结果" : `${String(unanswered)} 个问题仍需人工确认；超过 2 个时先回到研究分支` });
  }
  const level: VerificationStatus = rows.some((row) => row.status === "fail") ? "fail" : rows.some((row) => row.status === "warn") ? "warn" : "pass";
  state.risk = { level, rows };
  runTool(events, "risk", "pricing.verify", agent, `${String(rows.length)} 项约束检查，结论 ${level}`);
  for (const row of rows) verify(state, events, "risk", "risk-auditor", row.title, row.status, row.detail, "risk", agent);
  addEvent(events, "node.output", "风控审计提交独立结论", `${level === "fail" ? "验证失败，触发 Self-Loop" : level === "warn" ? "存在待确认项，进入人工门" : "全部通过"}`, "risk", agent);
}

function adjust(state: InternalState, events: RunEvent[], iteration: number): string {
  const before = state.product?.adDailyBudgetCents ?? 0;
  const next = Math.max(0, Math.round(before * 0.6));
  if (state.product !== null) state.product = { ...state.product, adDailyBudgetCents: next };
  const reason = `第 ${String(iteration)} 轮：风控未通过，把推广预算从 ${money(before)} 调到 ${money(next)}，降低获客成本假设后重跑市场与风控`;
  state.adjustments.push(reason);
  addEvent(events, "loop.adjusted", "反馈优化：调整策略参数", reason, "adjust-loop", "risk-auditor");
  return reason;
}

const RULE_LLM: AgentRun["llm"] = {
  mode: "rule",
  model: null,
  note: "确定性规则 Harness；配置 AGENTOPS_LLM_* 后，文案节点交给模型、结果需通过校验才采用。",
};

function executeCopy(state: InternalState, events: RunEvent[], _iteration: number): void {
  const agent = dispatch(state, events, "copy", "copy", "生成平台上架文案", _iteration);
  const candidate = state.candidates.find((item) => item.id === state.chosenId) ?? state.candidates[0];
  if (state.product === null || candidate === undefined) throw new Error("copy context missing");
  const plan = buildPlan(state.product, { id: "internal", createdAt: "2026-01-01T00:00:00.000Z" });
  state.copy = plan.copy;
  state.bullets = candidate.bullets.map((bullet) => bullet.text);
  runTool(events, "copy", "copy.generate", agent, `${String(state.copy.titles.length)} 个标题，${String(state.bullets.length)} 条卖点；带需确认标记`);
  addEvent(events, "node.output", "文案 Agent 提交候选内容", `标题受 ${PLATFORM_PRESETS[state.product.platform].titleMax} 字限制；不写入未验证的销量或极限词`, "copy", agent);
}

function executeReport(state: InternalState, events: RunEvent[], iteration: number): void {
  const agent = dispatch(state, events, "report", "report", "汇总可复核决策报告", iteration);
  const candidate = state.candidates.find((item) => item.id === state.chosenId) ?? state.candidates[0];
  state.report = [
    `任务：${state.taskText.slice(0, 120)}`,
    `推荐策略：${candidate?.label ?? "待确认"}，建议价 ${candidate === undefined ? "—" : money(candidate.priceCents)}`,
    `验证结论：${state.risk?.level ?? "未完成"}；Self-Loop 次数：${String(state.loops.length)}`,
    `证据边界：${state.facts?.questions.length ?? 0} 项信息仍需要人工确认，系统没有将其伪装成已抓取事实。`,
    ...state.assumptions,
  ];
  runTool(events, "report", "report.compile", agent, "合并 Agent 输出、验证记录、调整原因和未解决问题");
  addEvent(events, "node.output", "报告 Agent 提交审计报告", `${String(state.report.length)} 条报告记录，可根据事件链复现`, "report", agent);
}

function artifacts(state: InternalState): Artifacts {
  return {
    product: state.product,
    unit: state.unit,
    breakEvenCents: state.breakEvenCents,
    prices: state.candidates.map((candidate) => ({ id: candidate.id, label: candidate.label, priceCents: candidate.priceCents, margin: candidate.evaluation.daily.margin, profitP50Cents: candidate.sim.p50Cents, profitP10Cents: candidate.sim.p10Cents })),
    chosenId: state.chosenId,
    risk: state.risk,
    copy: state.copy,
    bullets: state.bullets,
    report: state.report,
    assumptions: state.assumptions,
  };
}

export async function runAgentWorkflow(
  input: { readonly id: string; readonly taskText: string; readonly autoApprove: boolean; readonly createdAt: string },
  live: LiveLlm | null = null,
): Promise<AgentRun> {
  const base = runDeterministicWorkflow(input);
  if (live === null) return base;
  return enrichWithLlm(input, base, live);
}

async function enrichWithLlm(
  input: { readonly id: string; readonly taskText: string; readonly autoApprove: boolean; readonly createdAt: string },
  base: AgentRun,
  live: LiveLlm,
): Promise<AgentRun> {
  const events = [...base.events];
  const product = base.artifacts.product;
  const chosen = base.artifacts.prices.find((price) => price.id === base.artifacts.chosenId);
  if (product === null || chosen === undefined) return { ...base, events };
  try {
    const completion = await live.client.complete({
      runId: parseRunId(input.id),
      round: 1,
      nodeId: "copy",
      attempt: 1,
      prompt: copyPrompt({ name: product.name, platform: PLATFORM_PRESETS[product.platform].label, maxTitle: PLATFORM_PRESETS[product.platform].titleMax, keywords: product.keywords, price: chosen.priceCents }),
      maxTokens: 400,
    });
    const checked = validateCopy(completion.text, PLATFORM_PRESETS[product.platform].titleMax);
    if (!checked.ok) {
      addEvent(events, "llm.fallback", "模型输出未通过验证，回退规则文案", `${checked.reason}；由 copywriter 的确定性规则兜底`, "copy", "copywriter");
      return { ...base, events, llm: { mode: "fallback", model: live.model, note: `${checked.reason}。已回退到规则文案，验证器拒绝不合约输出。` }, fingerprint: seal(events, base) };
    }
    addEvent(events, "llm.completed", "模型完成文案节点", `${live.model} 生成 ${String(checked.value.titles.length)} 个标题、${String(checked.value.bullets.length)} 条卖点，已通过长度与风险词校验`, "copy", "copywriter");
    const copy = base.artifacts.copy === null ? null : { ...base.artifacts.copy, titles: checked.value.titles.map((text) => ({ label: live.model, text, length: [...text].length })) };
    const artifacts = { ...base.artifacts, copy, bullets: checked.value.bullets };
    return { ...base, artifacts, events, llm: { mode: "live", model: live.model, note: "模型负责文案内容，调度与验证仍由本地 Harness 执行，输出经校验后才进入结果。" }, fingerprint: seal(events, { artifacts }) };
  } catch (error) {
    addEvent(events, "llm.fallback", "模型调用失败，回退规则文案", error instanceof Error ? error.message : "模型调用异常", "copy", "copywriter");
    return { ...base, events, llm: { mode: "fallback", model: live.model, note: "模型调用失败，已回退到可复现的规则文案。" }, fingerprint: seal(events, base) };
  }
}

function seal(events: readonly RunEvent[], base: { readonly artifacts: AgentRun["artifacts"] }): string {
  return sha256Hex(canonicalJson({ workflow: DEFAULT_WORKFLOW, events, artifacts: base.artifacts }));
}

function runDeterministicWorkflow(input: { readonly id: string; readonly taskText: string; readonly autoApprove: boolean; readonly createdAt: string }): AgentRun {
  const state = initialState(input.taskText, input.autoApprove);
  const events: RunEvent[] = [];
  addEvent(events, "run.started", "任务开始", `工作流 ${DEFAULT_WORKFLOW.title} · 目标：${DEFAULT_WORKFLOW.intent}`, null, "planner");
  const planner = dispatch(state, events, "plan", "planning", "理解任务并生成执行计划", 1);
  runTool(events, "plan", "workflow.plan", planner, "确定并行分析、验证门和最多 3 轮 Self-Loop");
  addEvent(events, "node.output", "规划 Agent 提交执行图", "研究 → 成本/市场并行 → 风控验证 → 反馈循环 → 人工门 → 报告 → 最终校验", "plan", planner);

  executeResearch(state, events, 1);
  executeAccount(state, events, 1);
  executeMarket(state, events, 1);
  executeRisk(state, events, 1);
  let iteration = 1;
  while (state.risk?.level === "fail" && iteration < 3) {
    addEvent(events, "loop.iteration", `进入第 ${String(iteration + 1)} 轮 Self-Loop`, "验证失败结果反馈给调度器，允许调整参数并重跑受影响分支", "adjust-loop", "planner");
    const adjustment = adjust(state, events, iteration + 1);
    state.loops.push({ role: "risk-auditor → market-analyst", iteration: iteration + 1, verdicts: [...state.verifications.slice(-4)], adjustment });
    executeMarket(state, events, iteration + 1);
    executeRisk(state, events, iteration + 1);
    iteration += 1;
  }
  executeCopy(state, events, iteration);
  addEvent(events, "gate.awaiting", "等待人工确认", "这是高风险动作的人工介入节点：请确认成本假设、未解析字段和推荐策略", "approval", "owner");
  if (!input.autoApprove) {
    return finalize(input, state, events, "awaiting-approval", RULE_LLM);
  }
  state.gateDecision = "approve";
  state.gateNeeded = false;
  addEvent(events, "gate.autoApproved", "演示模式自动通过人工门", "autoApprove=true；正式部署应由用户点击确认", "approval", "owner");
  executeReport(state, events, iteration);
  const finalAgent = dispatch(state, events, "final-check", "risk", "执行最终一致性验证", iteration);
  verify(state, events, "final", "evidence", "证据链存在", state.facts !== null ? "pass" : "warn", "研究 Agent 已输出字段证据", "final-check", finalAgent);
  verify(state, events, "final", "economics", "经济计算完整", state.unit !== null && state.breakEvenCents > 0 ? "pass" : "fail", "成本会计输出单件成本和保本价", "final-check", finalAgent);
  verify(state, events, "final", "feedback", "反馈回路可解释", state.loops.length > 0 ? "pass" : "warn", `本次运行记录 ${String(state.loops.length)} 轮反馈`, "final-check", finalAgent);
  addEvent(events, "run.completed", "任务完成并封存", "所有 Agent 输出、工具调用、验证和反馈记录已进入事件链", "seal", "reporter");
  return finalize(input, state, events, "completed", RULE_LLM);
}

function finalize(input: { readonly id: string; readonly taskText: string; readonly autoApprove: boolean; readonly createdAt: string }, state: InternalState, events: readonly RunEvent[], status: AgentRun["status"], llm: AgentRun["llm"]): AgentRun {
  const fingerprint = sha256Hex(canonicalJson({ workflow: DEFAULT_WORKFLOW, events, artifacts: artifacts(state) }));
  return {
    id: input.id,
    createdAt: input.createdAt,
    status,
    task: { text: input.taskText, autoApprove: input.autoApprove },
    workflow: DEFAULT_WORKFLOW,
    agents: AGENTS,
    dispatches: state.dispatches,
    events,
    verifications: state.verifications,
    loops: state.loops,
    artifacts: artifacts(state),
    llm,
    fingerprint,
    notes: ["商品链接识别是工具，不是 Agent 本身；每个 Agent 都有独立角色、工具、输出和验证责任。", "并行节点 account / market 由调度器分别选择 Agent；风险失败会触发最多 3 轮反馈循环。", "人工门在正式模式需要用户确认，autoApprove 仅用于可重复演示。"],
  };
}
