import { runDeliberation } from "./deliberation.js";
import { sha256Hex } from "../../engine/hash.js";
import { parseRunId } from "../../engine/ids.js";
import { canonicalJson } from "../../engine/json.js";
import { analyzeProductInput } from "../intake/agent.js";
import type { IntakeQuestion } from "../intake/types.js";
import { buildCandidates, checksFor, draftCandidates } from "../pricing/candidates.js";
import { buildCopy } from "../pricing/copy.js";
import { breakEvenCents, nicePrice, unitCost } from "../pricing/economics.js";
import type { Candidate, CandidateId, ProductInput } from "../pricing/model.js";
import { normalizeInput, recommendId } from "../pricing/plan.js";
import { PLATFORM_PRESETS } from "../pricing/platform.js";
import { simulate } from "../pricing/simulate.js";
import { AGENTS, AGENTS_V1, COLLAB_WORKFLOW, DEFAULT_WORKFLOW, resolveAgent } from "./catalog.js";
import { adjudicateCollaboration, analyzeCollaborationRole, respondToObjections } from "./collaboration.js";
import { parseTaskFacts } from "./task-facts.js";
import {
  demandDoubtRiskRow,
  demandExceedsCash,
  evidenceRiskRows,
  isUnprofitableAtMarket,
  marketRejectRiskRows,
  mergeRiskRows,
  missingEvidence,
} from "./review-policy.js";
import type { LiveLlm } from "./llm.js";
import { copyPrompt, validateCopy } from "./llm.js";
import type {
  AgentRun,
  AgentSpec,
  Artifacts,
  GateDecisionInput,
  InternalState,
  LoopAction,
  LoopSnapshot,
  RiskRow,
  RunEvent,
  RunEventListener,
  Verification,
  VerificationStatus,
  WorkflowDocument,
} from "./types.js";

const ZERO_HASH = "0".repeat(64);

const RULE_LLM: AgentRun["llm"] = {
  mode: "rule",
  model: null,
  note: "确定性规则 Harness；配置 AGENTOPS_LLM_* 后，文案节点交给模型、结果需通过校验才采用。",
};

function money(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
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

function initialState(
  taskText: string,
  autoApprove: boolean,
  agents: readonly AgentSpec[] = AGENTS,
): InternalState {
  return {
    agents,
    taskText,
    autoApprove,
    gateDecision: null,
    decidedCandidateId: null,
    targetMargin: 0.25,
    facts: null,
    product: null,
    unit: null,
    breakEvenCents: 0,
    candidates: [],
    chosenId: null,
    preferredCandidateId: null,
    risk: null,
    copy: null,
    bullets: [],
    report: [],
    llm: RULE_LLM,
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

type EmitEvent = (event: RunEvent) => void;

function addEvent(
  events: RunEvent[],
  type: RunEvent["type"],
  title: string,
  detail: string,
  nodeId: string | null,
  agentId: string | null,
  emit?: EmitEvent,
): void {
  const previous = events.at(-1)?.hash ?? ZERO_HASH;
  const seq = events.length + 1;
  const event: RunEvent = {
    seq,
    type,
    nodeId,
    agentId,
    title,
    detail,
    prevHash: previous,
    hash: eventHash(previous, seq, type, detail),
  };
  events.push(event);
  emit?.(event);
}

function dispatch(
  state: InternalState,
  events: RunEvent[],
  nodeId: string,
  capability: Parameters<typeof resolveAgent>[0],
  title: string,
  iteration: number,
  emit?: EmitEvent,
): string {
  // Specialists reserve their bounded calls for their own reports; general audit belongs
  // to risk/accounting, otherwise a risk fallback can starve the next report iteration.
  const eligibleAgents = capability !== "procure" && capability !== "price" && capability !== "promote"
    ? state.agents.filter((agent) => agent.id !== "procurement-lead" && agent.id !== "pricing-lead" && agent.id !== "growth-operator")
    : state.agents;
  const selected = resolveAgent(capability, state.loads, state.failures, state.calls, eligibleAgents);
  const chosen = selected.agent;
  const candidates = selected.scores.map(({ agent, score }) => ({
    agentId: agent.id,
    score,
    note: `${agent.name} 能力 ${pct(agent.capabilities[capability] ?? 0)}，负载 ${String(state.loads[agent.id] ?? 0)}，失败 ${String(state.failures[agent.id] ?? 0)}`,
  }));
  state.calls[chosen.id] = (state.calls[chosen.id] ?? 0) + 1;
  state.runs[chosen.id] = (state.runs[chosen.id] ?? 0) + 1;
  state.loads[chosen.id] = (state.loads[chosen.id] ?? 0) + 1;
  const rationale = `需求=${capability}；从 ${String(candidates.length)} 个候选中按能力、当前负载、历史失败次数选择 ${chosen.name}`;
  state.dispatches.push({ nodeId, need: capability, chosen: chosen.id, rationale, candidates });
  addEvent(events, "dispatch.decided", `调度：${chosen.name}`, `${title}（第 ${String(iteration)} 轮） · ${rationale}`, nodeId, chosen.id, emit);
  addEvent(events, "node.started", `${chosen.name} 开始执行`, `Agent v${chosen.version} · 工具：${chosen.tools.join("、")}`, nodeId, chosen.id, emit);
  return chosen.id;
}

function runTool(events: RunEvent[], nodeId: string, tool: string, agentId: string, detail: string, emit?: EmitEvent): void {
  addEvent(events, "tool.called", `工具调用：${tool}`, detail, nodeId, agentId, emit);
}

function verify(
  state: InternalState,
  events: RunEvent[],
  stage: string,
  verifier: string,
  title: string,
  status: VerificationStatus,
  detail: string,
  nodeId: string,
  agentId: string,
  emit?: EmitEvent,
): Verification {
  const item = { stage, verifier, title, status, detail };
  state.verifications.push(item);
  addEvent(events, "verify.checked", `${title}：${status === "pass" ? "通过" : status === "warn" ? "提醒" : "失败"}`, detail, nodeId, agentId, emit);
  return item;
}

function executeResearch(state: InternalState, events: RunEvent[], iteration: number, emit?: EmitEvent, strictEvidence = false): void {
  const agent = dispatch(state, events, "research", "intake", "识别商品链接与证据", iteration, emit);
  state.facts = analyzeProductInput({ text: state.taskText });
  runTool(events, "research", "product.parse", agent, `${String(state.facts.links.length)} 条链接，${String(state.facts.fields.length)} 个候选字段，保留字段证据与待确认问题`, emit);
  runTool(events, "research", "knowledge.search", agent, "检索平台规则、标题限制和费率边界", emit);
  addEvent(events, "node.output", "商品研究员提交证据包", `${state.facts.headline}；${String(state.facts.questions.length)} 个字段进入待确认，不把短链猜成商品详情`, "research", agent, emit);
  const base = defaultProduct(state.taskText, state.facts.patch);
  const given = parseTaskFacts(state.taskText);

  const extraQuestions: IntakeQuestion[] = [];
  if (given.buyCents === null && !state.facts.questions.some((q) => q.id === "ask-buy")) {
    extraQuestions.push({
      id: "ask-buy",
      ask: "采购价（进货成本）是多少元？",
      why: "未提供采购价，目前按演示值计算，会直接影响保本价与毛利核算。",
      options: [],
    });
  }
  if (given.shippingCents === null && !state.facts.questions.some((q) => q.id === "ask-shipping")) {
    extraQuestions.push({
      id: "ask-shipping",
      ask: "单件快递运费是多少元？",
      why: "未提供快递运费，目前按演示值计算，会直接影响每单履约成本。",
      options: [],
    });
  }
  if (
    given.marketOrders === null &&
    (state.facts.salesHint === null || state.facts.salesHint === undefined) &&
    state.facts.patch.marketOrders === undefined &&
    !state.facts.questions.some((q) => q.id === "ask-orders")
  ) {
    extraQuestions.push({
      id: "ask-orders",
      ask: "预估或同类商品日单量大约多少？",
      why: "未提供单量且无公开销量证据，目前按默认单量推演 30 天现金流。",
      options: [],
    });
  }
  if (extraQuestions.length > 0) {
    state.facts = {
      ...state.facts,
      questions: [...state.facts.questions, ...extraQuestions],
    };
  }
  if (strictEvidence) {
    const gap = missingEvidence(given);
    if (gap !== null) {
      state.product = null;
      state.chosenId = null;
      state.risk = { level: "fail", rows: evidenceRiskRows(gap) };
      if (
        state.facts !== null &&
        gap.fields.includes("competitor") &&
        !state.facts.questions.some((question) => question.id === "ask-competitor")
      ) {
        state.facts = {
          ...state.facts,
          questions: [
            ...state.facts.questions,
            {
              id: "ask-competitor",
              ask: "同类商品通常卖多少元？",
              why: "缺少竞品价，无法判断跟价是否保本，先追问再核算。",
              options: [],
            },
          ],
        };
      }
      addEvent(
        events,
        "node.output",
        "需要掌柜补充关键经营数据",
        "缺少采购价、快递费或竞品价，先追问再核算，不以演示数字给出上架建议",
        "research",
        agent,
        emit,
      );
      return;
    }
  }

  const product: ProductInput = normalizeInput({
    ...base,
    buyCents: given.buyCents ?? base.buyCents,
    packagingCents: given.packagingCents ?? base.packagingCents,
    shippingCents: given.shippingCents ?? base.shippingCents,
    adDailyBudgetCents: given.adDailyBudgetCents ?? base.adDailyBudgetCents,
    cashCents: given.cashCents ?? base.cashCents,
    competitorCents: given.competitorCents ?? base.competitorCents,
    marketOrders: given.marketOrders ?? base.marketOrders,
    targetMargin: given.targetMargin ?? base.targetMargin,
    promoDiscount: given.promoDiscount ?? base.promoDiscount,
    returnRate: given.returnRate ?? base.returnRate,
    returnSalvage: given.returnSalvage ?? base.returnSalvage,
  });
  state.product = product;
  state.targetMargin = product.targetMargin;
  if (given.buyCents === null) state.assumptions.push(`任务没给采购价，按演示假设 ${money(base.buyCents)} 计算`);
  if (given.shippingCents === null) state.assumptions.push(`任务没给快递成本，按演示假设 ${money(base.shippingCents)} 计算`);
  if (given.competitorCents === null && state.facts.patch.competitorCents === undefined) state.assumptions.push(`没有竞品价证据，按演示假设 ${money(base.competitorCents)} 计算`);
  if (given.marketOrders === null) state.assumptions.push(`任务没给价格带日单量，按演示假设 ${String(base.marketOrders)} 单/天计算`);
  if (given.targetMargin === null) state.assumptions.push(`任务没给目标毛利，按演示假设 ${pct(base.targetMargin)} 计算`);
  if (given.adDailyBudgetCents === null) state.assumptions.push(`任务没给推广预算，按演示假设 ${money(base.adDailyBudgetCents)}/天计算`);
}

function executeAccount(state: InternalState, events: RunEvent[], iteration: number, emit?: EmitEvent): void {
  const agent = dispatch(state, events, "account", "cost", "核算成本与保本价", iteration, emit);
  if (state.product === null) throw new Error("product is missing before account");
  const breakEven = breakEvenCents(state.product);
  const unit = unitCost(state.product, breakEven);
  state.breakEvenCents = breakEven;
  state.unit = unit;
  runTool(events, "account", "pricing.unit-cost", agent, `一件成本 ${money(unit.totalCents)}`, emit);
  runTool(events, "account", "pricing.break-even", agent, `保本价 ${money(breakEven)}`, emit);
  addEvent(events, "node.output", "成本会计提交可审计计算", `成本 ${money(unit.totalCents)}；保本价 ${money(breakEven)}；输入假设已写入报告`, "account", agent, emit);
}

function executeMarket(state: InternalState, events: RunEvent[], iteration: number, emit?: EmitEvent): void {
  const agent = dispatch(state, events, "market", "market", "生成价格策略与现金流情景", iteration, emit);
  if (state.product === null || state.unit === null || state.breakEvenCents <= 0) {
    throw new Error("account context is missing before market");
  }
  const preset = PLATFORM_PRESETS[state.product.platform];
  const drafts = draftCandidates(state.product);
  const candidates = buildCandidates(state.product, preset);
  const firstDraft = drafts[0];
  if (firstDraft === undefined || candidates.length === 0) {
    simulate(state.product, state.breakEvenCents);
  }
  const recommended = recommendId(candidates);
  const chosenId =
    state.preferredCandidateId !== null && candidates.some((candidate) => candidate.id === state.preferredCandidateId)
      ? state.preferredCandidateId
      : recommended;
  state.candidates = candidates;
  state.chosenId = chosenId;
  runTool(
    events,
    "market",
    "pricing.candidates",
    agent,
    `生成 ${String(candidates.length)} 个策略：${candidates.map((candidate) => `${candidate.label} ${money(candidate.priceCents)}`).join("、")}`,
    emit,
  );
  runTool(events, "market", "pricing.simulate", agent, "每个策略进行 30 天、200 次现金流模拟", emit);
  addEvent(
    events,
    "node.output",
    "市场分析师提交三套策略",
    `推荐 ${candidates.find((candidate) => candidate.id === chosenId)?.label ?? "—"}，依据 p10 风险利润而非单次最好结果`,
    "market",
    agent,
    emit,
  );
}

function ownerForCheck(checkId: string): string {
  if (checkId === "evidence") return "link-researcher";
  if (checkId === "break-even" || checkId === "context") return "cost-accountant";
  return "market-analyst";
}

function executeChallenge(state: InternalState, events: RunEvent[], iteration: number, emit?: EmitEvent): void {
  if (state.product === null || state.candidates.length === 0) return;
  const originalRecommendedId = (state.chosenId as CandidateId) ?? "match";
  const roles = [
    { role: "procurement-lead", capability: "procure", tool: "pricing.simulate" },
    { role: "pricing-lead", capability: "price", tool: "pricing.verify" },
    { role: "growth-operator", capability: "promote", tool: "pricing.simulate" },
  ] as const;
  const analyses = roles.map(({ role, capability, tool }) => {
    const nodeId = `challenge-${role}`;
    const agent = dispatch(state, events, nodeId, capability, "接收会计成本和市场三套报价，独立重算", iteration, emit);
    const analysis = analyzeCollaborationRole(role, state.product!, state.candidates);
    runTool(events, nodeId, tool, agent, `${analysis.scenario}；${analysis.inputSummary}；逐策略复核毛利、p10、订单与备货资金`, emit);
    addEvent(events, "node.output", `独立分析交付：${analysis.roleName}`,
      `${analysis.scenario}；${analysis.rows.map((r) => `${r.candidateId}：毛利${pct(r.margin)} / p10 ${money(r.p10Cents)} / 日单${r.orders.toFixed(1)} / 缺货${String(r.stockoutDays)}天`).join("；")}`,
      nodeId, agent, emit);
    addEvent(events, "node.output", `会签提议：${analysis.roleName}`,
      `提议「${analysis.proposal.candidateLabel}」：${analysis.proposal.rationale}`, nodeId, agent, emit);
    return analysis;
  });
  // Market owns the quotes; consume each objection before handing complete reports to risk.
  // This is part of its existing invocation, rather than a second unrelated role attribution.
  const marketAgent = [...state.dispatches].reverse().find((d) => d.nodeId === "market")?.chosen ?? "market-analyst";
  const responses = respondToObjections(state.candidates, analyses).map((response) => ({
    ...response, owner: marketAgent, ownerName: state.agents.find((a) => a.id === marketAgent)?.name ?? "市场分析师",
  }));
  runTool(events, "challenge-response", "pricing.verify", marketAgent, "报价责任人对照原报价与每条情景质询的数值证据；接收失败项不意味着已修复", emit);
  for (const response of responses) {
    addEvent(events, "node.output", `质询回应：${response.ownerName}`,
      `${response.challenger} → ${response.targetCandidateId} / ${response.checkId}；${response.evidence}；${response.action}`,
      "challenge-response", marketAgent, emit);
  }
  const agent = dispatch(state, events, "challenge", "risk", "消费三方独立报告与报价责任人的逐项回应并裁决", iteration, emit);
  const collab = adjudicateCollaboration(state.product, state.candidates, originalRecommendedId, analyses, responses);
  runTool(events, "challenge", "pricing.verify", agent, "按失败质询数、基准 p10 和原推荐顺序裁决；未解决失败项保留 fail", emit);
  state.chosenId = collab.adjudicatedId;
  state.preferredCandidateId = collab.adjudicatedId;
  state.collaboration = collab;
  addEvent(events, "node.output", "三方交叉质询记录", `共提出 ${String(collab.objections.length)} 项质询，均有报价责任人回应；接收不等于风险消除`, "challenge", agent, emit);
  addEvent(events, "node.output", "风控裁决结论", collab.summary, "challenge", agent, emit);
}
function executeRisk(state: InternalState, events: RunEvent[], iteration: number, emit?: EmitEvent): readonly Verification[] {
  const agent = dispatch(state, events, "risk", "risk", "独立验证成本、需求和策略", iteration, emit);
  const chosen = state.candidates.find((candidate) => candidate.id === state.chosenId) ?? state.candidates[0];
  const rows: RiskRow[] = [];
  if (chosen === undefined || state.product === null || state.unit === null || state.breakEvenCents <= 0) {
    rows.push({
      id: "context",
      title: "上下文完整性",
      status: "fail",
      detail: "风控缺少成本或候选策略，要求回退重算",
      owner: "cost-accountant",
    });
  } else {
    const preset = PLATFORM_PRESETS[state.product.platform];
    const domainChecks = checksFor(state.product, preset, chosen.evaluation, chosen.sim, chosen.promoPriceCents);
    for (const check of domainChecks) {
      rows.push({
        id: check.id,
        title: check.label,
        status: check.status,
        detail: check.detail,
        owner: ownerForCheck(check.id),
      });
    }
    const unanswered = state.facts?.questions.length ?? 0;
    rows.push({
      id: "evidence",
      title: "证据边界清晰",
      status: unanswered > 2 ? "fail" : unanswered === 0 ? "pass" : "warn",
      detail: state.facts === null ? "没有研究结果" : `${String(unanswered)} 个问题仍需人工确认；超过 2 个时先回到研究分支`,
      owner: "link-researcher",
    });
    if (state.collaboration?.leftoverRisks && state.collaboration.leftoverRisks.length > 0) {
      for (const lr of state.collaboration.leftoverRisks) {
        rows.push(lr);
      }
    }
  }
  for (const row of rows) {
    if (row.status === "fail" && row.owner !== undefined) {
      state.failures[row.owner] = (state.failures[row.owner] ?? 0) + 1;
    }
  }
  const level: VerificationStatus = rows.some((row) => row.status === "fail")
    ? "fail"
    : rows.some((row) => row.status === "warn")
      ? "warn"
      : "pass";
  state.risk = { level, rows };
  runTool(events, "risk", "pricing.verify", agent, `${String(rows.length)} 项约束检查，结论 ${level}`, emit);
  const verdicts: Verification[] = [];
  for (const row of rows) {
    verdicts.push(verify(state, events, "risk", "risk-auditor", row.title, row.status, row.detail, "risk", agent, emit));
  }
  const willLoop = level === "fail" && iteration < 3 && planAdjustment(state, iteration + 1) !== null;
  const summary =
    level === "fail"
      ? willLoop
        ? "验证未通过，进入 Self-Loop 定向修正"
        : "验证仍存风险项，保留失败结论交由人工门确认"
      : level === "warn"
        ? "存在待确认项，进入人工门"
        : "全部通过";
  addEvent(events, "node.output", "风控审计提交独立结论", summary, "risk", agent, emit);
  return verdicts;
}

function captureSnapshot(state: InternalState): LoopSnapshot {
  const chosen = state.candidates.find((candidate) => candidate.id === state.chosenId) ?? state.candidates[0];
  const failTitles = state.risk?.rows.filter((row) => row.status === "fail").map((row) => row.title) ?? [];
  return {
    chosenId: state.chosenId,
    priceCents: chosen?.priceCents ?? 0,
    promoPriceCents: chosen?.promoPriceCents ?? 0,
    margin: chosen?.evaluation.daily.margin ?? 0,
    p10Cents: chosen?.sim.p10Cents ?? 0,
    adDailyBudgetCents: state.product?.adDailyBudgetCents ?? 0,
    promoDiscount: state.product?.promoDiscount ?? 1,
    stockoutDays: chosen?.sim.stockoutDays ?? 0,
    failTitles,
  };
}

type PlannedAdjustment = {
  readonly action: LoopAction;
  readonly role: string;
  readonly reason: string;
  readonly apply: () => void;
};

function findTighterCandidate(
  candidates: readonly Candidate[],
  current: Candidate,
  failedIds: ReadonlySet<string>,
): Candidate | null {
  if (current.id !== "volume" && current.id !== "match") {
    return null;
  }
  const order: readonly CandidateId[] = current.id === "volume" ? ["match", "profit"] : ["profit"];
  const viable: Candidate[] = [];
  for (const id of order) {
    const candidate = candidates.find((item) => item.id === id);
    if (candidate === undefined) continue;
    const improvesMargin =
      (failedIds.has("margin") || failedIds.has("break-even")) &&
      candidate.evaluation.daily.margin > current.evaluation.daily.margin &&
      candidate.priceCents > current.priceCents;
    const improvesStockout =
      failedIds.has("cashflow") &&
      candidate.sim.stockoutDays < current.sim.stockoutDays &&
      candidate.priceCents > current.priceCents;
    if (improvesMargin || improvesStockout) {
      viable.push(candidate);
    }
  }
  if (viable.length === 0) return null;
  const clean = viable.find((candidate) =>
    candidate.checks.every((check) => (check.id === "margin" || check.id === "cashflow" || check.id === "break-even" ? check.status !== "fail" : true)),
  );
  return clean ?? viable.at(-1) ?? null;
}

function planAdjustment(state: InternalState, nextIteration: number): PlannedAdjustment | null {
  const product = state.product;
  const chosen = state.candidates.find((candidate) => candidate.id === state.chosenId) ?? state.candidates[0];
  if (product === null || chosen === undefined || state.risk === null || state.risk.level !== "fail") {
    return null;
  }
  const failedIds = new Set(state.risk.rows.filter((row) => row.status === "fail").map((row) => row.id ?? row.title));

  const price = chosen.priceCents;
  const adShare = price > 0 ? chosen.evaluation.daily.adPerOrderCents / price : 0;
  if (failedIds.has("ad-share") && product.adDailyBudgetCents > 100 && adShare > 0.2) {
    const before = product.adDailyBudgetCents;
    const next = Math.max(100, Math.round(before * 0.6));
    if (next < before) {
      const reason = `第 ${String(nextIteration)} 轮：推广分摊占售价 ${pct(adShare)}，把推广预算从 ${money(before)} 下调到 ${money(next)} 后重算市场与风控`;
      return {
        action: "ad-budget",
        role: "risk-auditor → market-analyst",
        reason,
        apply: () => {
          state.product = { ...product, adDailyBudgetCents: next };
        },
      };
    }
  }

  if (failedIds.has("promo") && product.promoEnabled && chosen.promoPriceCents < state.breakEvenCents) {
    const beforeDiscount = product.promoDiscount;
    const discount = Number(clamp(Math.ceil((state.breakEvenCents / price) * 100) / 100 + 0.01, 0.4, 0.99).toFixed(2));
    const nextPromo = nicePrice(Math.round(price * discount));
    if (discount > beforeDiscount) {
      const reason = `第 ${String(nextIteration)} 轮：活动价 ${money(chosen.promoPriceCents)} 低于保本价 ${money(state.breakEvenCents)}，把活动折扣从 ${pct(beforeDiscount)} 上调到 ${pct(discount)}（活动价 ${money(nextPromo)}）后重算市场与风控`;
      return {
        action: "promo-discount",
        role: "risk-auditor → market-analyst",
        reason,
        apply: () => {
          state.product = { ...product, promoDiscount: discount };
        },
      };
    }
  }

  if (failedIds.has("cashflow") || failedIds.has("margin") || failedIds.has("break-even")) {
    const tighter = findTighterCandidate(state.candidates, chosen, failedIds);
    if (tighter !== null && tighter.id !== chosen.id) {
      const reason = `第 ${String(nextIteration)} 轮：${chosen.label}（${money(chosen.priceCents)}）在毛利或备货天数上未达标，收紧推荐候选为「${tighter.label}」（${money(tighter.priceCents)}）后重新验证`;
      return {
        action: "switch-candidate",
        role: "risk-auditor → market-analyst",
        reason,
        apply: () => {
          state.preferredCandidateId = tighter.id;
        },
      };
    }
  }

  return null;
}

async function executeCopy(
  state: InternalState, events: RunEvent[], iteration: number, runId: string,
  live: LiveLlm | null, emit?: EmitEvent,
): Promise<AgentRun["llm"]> {
  const agent = dispatch(state, events, "copy", "copy", "生成平台上架文案", iteration, emit);
  const candidate = state.candidates.find((item) => item.id === state.chosenId) ?? state.candidates[0];
  if (state.product === null || candidate === undefined) throw new Error("copy context missing");
  const preset = PLATFORM_PRESETS[state.product.platform];
  state.copy = buildCopy(state.product, preset, candidate.priceCents, state.breakEvenCents);
  state.bullets = candidate.bullets.map((bullet) => bullet.text);
  runTool(events, "copy", "copy.generate", agent, "根据最终报价与已提供事实准备文案，保留本地初稿直至模型校验完成", emit);
  addEvent(events, "node.output", live === null ? "文案 Agent 提交候选内容" : "文案 Agent 已接收最终方案",
    "标题受 " + String(preset.titleMax) + " 字限制；不写未验证的销量或极限词", "copy", agent, emit);
  if (live === null) { state.llm = RULE_LLM; return RULE_LLM; }
  const prompt = copyPrompt({ name: state.product.name, platform: preset.label,
    maxTitle: preset.titleMax, keywords: state.product.keywords, price: candidate.priceCents });
  let reason = "模型未完成";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const completion = await live.client.complete({
        runId: parseRunId(runId), round: iteration, nodeId: "copy", attempt,
        prompt: prompt + (attempt === 2 ? "\n上次失败原因：" + reason + "。请修正后只返回规定 JSON。" : ""),
        maxTokens: 1200, responseFormat: "json_object", reasoningEffort: "none", timeoutMs: 45_000,
      });
      const checked = validateCopy(completion.text, preset.titleMax);
      if (!checked.ok) throw new Error(checked.reason);
      state.copy = { ...state.copy, titles: checked.value.titles.map((text) => ({ label: live.model, text, length: [...text].length })) };
      state.bullets = checked.value.bullets;
      state.llm = { mode: "live", model: live.model, note: "模型文案已通过结构、字数和风险词检查；数值核算仍由本地工具执行。" };
      addEvent(events, "llm.completed", "模型完成文案节点", live.model + " 生成 " + String(checked.value.titles.length) + " 个标题、" + String(checked.value.bullets.length) + " 条卖点，校验通过", "copy", agent, emit);
      return state.llm;
    } catch (error) {
      reason = error instanceof Error ? error.message : "模型调用异常";
      if (attempt === 1 && !/HTTP (?:401|403)/.test(reason)) {
        addEvent(events, "llm.retrying", "文案校验后请求修订", reason + "；携带具体错误重新生成，最多重试一次", "copy", agent, emit);
      } else break;
    }
  }
  state.llm = { mode: "fallback", model: live.model, note: reason + "。文案未采用模型结果，保留本地初稿。" };
  addEvent(events, "llm.fallback", "文案模型未完成", reason + "；已保留本地初稿", "copy", agent, emit);
  return state.llm;
}

function executeReport(state: InternalState, events: RunEvent[], iteration: number, emit?: EmitEvent): void {
  const agent = dispatch(state, events, "report", "report", "汇总可复核决策报告", iteration, emit);
  const candidate = state.candidates.find((item) => item.id === state.chosenId) ?? state.candidates[0];
  state.report = [
    `任务：${state.taskText.slice(0, 120)}`,
    `推荐策略：${candidate?.label ?? "待确认"}，建议价 ${candidate === undefined ? "—" : money(candidate.priceCents)}`,
    `验证结论：${state.risk?.level ?? "未完成"}；Self-Loop 次数：${String(state.loops.length)}`,
    `证据边界：${String(state.facts?.questions.length ?? 0)} 项信息仍需要人工确认，系统没有将其伪装成已抓取事实。`,
      ...(state.collaboration ? [
        `会签裁决：${state.collaboration.summary}`,
        `协作证据：引用最终当前轮的三方规则分析与逐项回应；未消除失败项 ${String(state.collaboration.leftoverRisks.filter((row) => row.status === "fail").length)} 项。压力情景是规则假设，不是外部模型或实测市场结果。`,
      ] : []),
    ...state.assumptions,
  ];
  runTool(events, "report", "report.compile", agent, "合并 Agent 输出、验证记录、调整原因和未解决问题", emit);
  addEvent(events, "node.output", "报告 Agent 提交审计报告", `${String(state.report.length)} 条报告记录，可根据事件链复现`, "report", agent, emit);
}

function artifacts(state: InternalState): Artifacts {
  return {
    product: state.product,
    unit: state.unit,
    breakEvenCents: state.breakEvenCents,
    candidates: state.candidates,
    prices: state.candidates.map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
      priceCents: candidate.priceCents,
      margin: candidate.evaluation.daily.margin,
      profitP50Cents: candidate.sim.p50Cents,
      profitP10Cents: candidate.sim.p10Cents,
    })),
    chosenId: state.chosenId,
    risk: state.risk,
    copy: state.copy,
    bullets: state.bullets,
    report: state.report,
    assumptions: state.assumptions,
    ...(state.collaboration ? { collaboration: state.collaboration } : {}),
    ...(state.deliberation ? { deliberation: state.deliberation } : {}),
  };
}

function completeAfterApproval(
  state: InternalState,
  events: RunEvent[],
  iteration: number,
  setCompleted: () => void,
  emit?: EmitEvent,
): void {
  executeReport(state, events, iteration, emit);
  const finalAgent = dispatch(state, events, "final-check", "risk", "执行最终一致性验证", iteration, emit);
  verify(state, events, "final", "evidence", "证据链存在", state.facts !== null ? "pass" : "warn", "研究 Agent 已输出字段证据", "final-check", finalAgent, emit);
  verify(state, events, "final", "economics", "经济计算完整", state.unit !== null && state.breakEvenCents > 0 ? "pass" : "fail", "成本会计输出单件成本和保本价", "final-check", finalAgent, emit);
  verify(state, events, "final", "feedback", "反馈回路可解释", state.loops.length > 0 ? "pass" : "warn", `本次运行记录 ${String(state.loops.length)} 轮反馈`, "final-check", finalAgent, emit);
  setCompleted();
  addEvent(events, "run.completed", "任务完成并封存", "所有 Agent 输出、工具调用、验证和反馈记录已进入事件链", "seal", "reporter", emit);
}

export class DecisionConflictError extends Error {
  readonly code: "decision-conflict" | "run-not-awaiting-decision";
  readonly status: AgentRun["status"];

  constructor(code: "decision-conflict" | "run-not-awaiting-decision", status: AgentRun["status"], message: string) {
    super(message);
    this.name = "DecisionConflictError";
    this.code = code;
    this.status = status;
  }
}

export function isSameDecision(run: AgentRun, decision: GateDecisionInput): boolean {
  if (run.gateDecision === null || run.gateDecision !== decision.action) {
    return false;
  }
  if (decision.action === "reject") {
    return decision.candidateId === undefined || decision.candidateId === run.decidedCandidateId;
  }
  const previousCandidate = run.decidedCandidateId ?? run.artifacts.chosenId;
  const requestedCandidate = decision.candidateId ?? previousCandidate;
  return requestedCandidate === previousCandidate;
}

function restoreState(run: AgentRun): { readonly state: InternalState; readonly iteration: number } {
  const sched = run.scheduler;
  const product = run.artifacts.product;
  const candidates = run.artifacts.candidates ? [...run.artifacts.candidates] : [];
  const iteration = sched?.iteration ?? 1 + run.loops.length;
  const state: InternalState = {
    agents: run.agents,
    taskText: run.task.text,
    autoApprove: run.task.autoApprove,
    gateDecision: sched?.gateDecision ?? run.gateDecision ?? null,
    decidedCandidateId: sched?.decidedCandidateId ?? run.decidedCandidateId ?? null,
    targetMargin: product?.targetMargin ?? 0.25,
    facts: sched?.facts ?? analyzeProductInput({ text: run.task.text }),
    product,
    unit: run.artifacts.unit,
    breakEvenCents: run.artifacts.breakEvenCents,
    candidates,
    chosenId: run.artifacts.chosenId,
    preferredCandidateId: sched?.preferredCandidateId ?? run.preferredCandidateId ?? null,
    risk: run.artifacts.risk,
    copy: run.artifacts.copy,
    bullets: [...run.artifacts.bullets],
    report: [...run.artifacts.report],
    collaboration: run.artifacts.collaboration,
    deliberation: run.artifacts.deliberation,
    llm: run.llm,
    assumptions: [...run.artifacts.assumptions],
    verifications: [...run.verifications],
    loops: [...run.loops],
    adjustments: sched ? [...sched.adjustments] : [],
    loads: { ...(sched?.loads ?? run.loads ?? {}) },
    calls: { ...(sched?.calls ?? run.calls ?? {}) },
    failures: { ...(sched?.failures ?? run.failures ?? {}) },
    runs: { ...(sched?.runs ?? {}) },
    dispatches: [...run.dispatches],
    gateNeeded: run.status === "awaiting-approval",
  };
  return { state, iteration };
}

export type WorkflowRunOptions = {
  readonly collaboration?: boolean | undefined;
  readonly modelReview?: boolean | undefined;
  readonly strictEvidence?: boolean | undefined;
};

export async function runAgentWorkflow(
  input: { readonly id: string; readonly taskText: string; readonly autoApprove: boolean; readonly createdAt: string },
  live: LiveLlm | null = null,
  onEvent?: RunEventListener,
  options?: WorkflowRunOptions,
): Promise<AgentRun> {
  const enableCollaboration = options?.collaboration ?? true;
  const modelReview = enableCollaboration && live !== null && options?.modelReview !== false;
  const workflow: WorkflowDocument = modelReview ? {
    ...COLLAB_WORKFLOW, id: "product-launch-review.v3", title: "商品上架评审 · 模型协作会审",
    nodes: COLLAB_WORKFLOW.nodes.flatMap((node) => node.id === "copy" ? [
      { kind: "agent" as const, id: "model-review", capability: "risk" as const, title: "三方模型提案、主席质询和定向修订", dependsOn: ["risk-gate"] },
      { ...node, dependsOn: ["model-review"] },
    ] : [node]),
  } : enableCollaboration ? COLLAB_WORKFLOW : DEFAULT_WORKFLOW;
  const agents = enableCollaboration ? AGENTS : AGENTS_V1;
  const state = initialState(input.taskText, input.autoApprove, agents);
  const events: RunEvent[] = [];
  let status: AgentRun["status"] = "running";
  let iteration = 1;
  const emit: EmitEvent | undefined =
    onEvent === undefined
      ? undefined
      : (event) => {
          onEvent(event, finalize(input, state, [...events], status, state.llm, iteration, workflow, agents));
        };

  addEvent(events, "run.started", "任务开始", `工作流 ${workflow.title} · 目标：${workflow.intent}`, null, "planner", emit);
  const planner = dispatch(state, events, "plan", "planning", "理解任务并生成执行计划", 1, emit);
  runTool(events, "plan", "workflow.plan", planner, "确定交付依赖、验证门和最多 2 轮额外 Self-Loop 修正", emit);
  addEvent(
    events,
    "node.output",
    "规划 Agent 提交执行图",
    enableCollaboration
      ? "研究 → 成本会计 → 市场报价 → 三方独立分析 → 责任人回应 → 风控裁决 → 反馈循环 → 人工门 → 报告 → 最终校验"
      : "研究 → 成本会计 → 市场报价 → 风控验证 → 反馈循环 → 人工门 → 报告 → 最终校验",
    "plan",
    planner,
    emit,
  );

  const strictEvidence = options?.strictEvidence === true;
  executeResearch(state, events, 1, emit, strictEvidence);
  if (strictEvidence && state.product === null) {
    return finalize(input, state, events, "completed", state.llm, iteration, workflow, agents);
  }
  executeAccount(state, events, 1, emit);
  executeMarket(state, events, 1, emit);
  if (enableCollaboration) {
    executeChallenge(state, events, 1, emit);
  }
  let lastRiskVerdicts = executeRisk(state, events, 1, emit);

  while (state.risk?.level === "fail" && iteration < 3) {
    const nextIteration = iteration + 1;
    const planned = planAdjustment(state, nextIteration);
    if (planned === null) {
      break;
    }
    const before = captureSnapshot(state);
    addEvent(events, "loop.iteration", `进入第 ${String(nextIteration)} 轮 Self-Loop`, "验证失败结果反馈给调度器，允许调整参数并重跑受影响分支", "adjust-loop", "planner", emit);
    planned.apply();
    state.adjustments.push(planned.reason);
    addEvent(events, "loop.adjusted", "反馈优化：调整策略参数", planned.reason, "adjust-loop", "risk-auditor", emit);
    executeMarket(state, events, nextIteration, emit);
    if (enableCollaboration) {
      executeChallenge(state, events, nextIteration, emit);
    }
    const retryVerdicts = executeRisk(state, events, nextIteration, emit);
    const after = captureSnapshot(state);
    state.loops.push({
      role: planned.role,
      iteration: nextIteration,
      verdicts: [...lastRiskVerdicts],
      adjustment: planned.reason,
      action: planned.action,
      before,
      after,
    });
    lastRiskVerdicts = retryVerdicts;
    iteration = nextIteration;
  }

  // Model review consumes the final numeric reports once; economic repair loops do not multiply model calls.
  if (modelReview && live !== null && state.product !== null && state.collaboration !== undefined) {
    state.deliberation = await runDeliberation({ runId: input.id, round: iteration,
      product: state.product, candidates: state.candidates, collaboration: state.collaboration, live,
      onUpdate: (artifact, update) => {
        state.deliberation = artifact;
        const type: RunEvent["type"] = update.type === "finished" ? "node.output" : ("review." + update.type) as RunEvent["type"];
        addEvent(events, type, update.type === "finished" ? "模型会审汇总完成" : "模型会审 · " + update.nodeId,
          update.detail, update.nodeId, update.role === "chair" ? "risk-auditor" : update.role, emit);
      },
    });
    const decision = state.deliberation.decision;
    if (decision !== null) {
      const previous = state.collaboration.adjudicatedId;
      state.chosenId = decision.recommendedId;
      state.preferredCandidateId = decision.recommendedId;
      const labelOf = (id: string): string => state.candidates.find((item) => item.id === id)?.label ?? id;
      state.collaboration = { ...state.collaboration,
        adjudicatedId: decision.recommendedId,
        changed: decision.recommendedId !== state.collaboration.originalRecommendedId,
        summary: "数值初选「" + labelOf(previous) + "」，模型会审后选择「" + labelOf(decision.recommendedId) + "」。" + decision.reason,
        ...(state.collaboration.comparison === undefined ? {} : {
          comparison: state.collaboration.comparison.map((row) => ({ ...row, selected: row.candidateId === decision.recommendedId })),
        }),
        leftoverRisks: state.collaboration.objections.filter((row) => row.targetCandidateId === decision.recommendedId).map((row) => ({
          id: "collab-" + row.checkId + "-" + row.challenger, title: "会签质询 · " + row.title,
          status: row.status, detail: row.detail, owner: "market-analyst",
        })),
      };
      // A changed model preference receives a fresh independent numerical check.
      if (previous !== decision.recommendedId) executeRisk(state, events, iteration, emit);
    }
  }

  if (strictEvidence && state.product !== null) {
    const facts = parseTaskFacts(state.taskText);
    const extra = [
      ...(demandExceedsCash(facts) ? [demandDoubtRiskRow()] : []),
      ...(isUnprofitableAtMarket(state.product) ? marketRejectRiskRows() : []),
    ];
    if (extra.length > 0) {
      state.risk = mergeRiskRows(state.risk?.rows ?? [], extra);
    }
    if (isUnprofitableAtMarket(state.product)) {
      state.gateDecision = "reject";
      addEvent(
        events,
        "gate.decided",
        "系统驳回上架方案",
        "按竞品价核算无法保本且毛利为负；autoApprove 接受系统判定，而不是一律通过",
        "approval",
        "owner",
        emit,
      );
      return finalize(input, state, events, "rejected", state.llm, iteration, workflow, agents);
    }
  }

  const llm = await executeCopy(state, events, iteration, input.id, live, emit);
  if (!input.autoApprove) {
    status = "awaiting-approval";
  }
  addEvent(events, "gate.awaiting", "等待人工确认", "这是高风险动作的人工介入节点：请确认成本假设、未解析字段和推荐策略", "approval", "owner", emit);
  if (!input.autoApprove) {
    return finalize(input, state, events, "awaiting-approval", llm, iteration, workflow, agents);
  }
  state.gateNeeded = false;
  addEvent(events, "gate.autoApproved", "演示模式自动通过人工门", "autoApprove=true；正式部署应由用户点击确认", "approval", "owner", emit);
  completeAfterApproval(
    state,
    events,
    iteration,
    () => {
      status = "completed";
    },
    emit,
  );
  return finalize(input, state, events, "completed", llm, iteration, workflow, agents);
}

export async function resumeAgentWorkflow(
  run: AgentRun,
  decision: GateDecisionInput,
  onEvent?: RunEventListener,
): Promise<AgentRun> {
  const workflow = run.workflow;
  const agents = run.agents;
  if (run.status !== "awaiting-approval") {
    if ((run.status === "completed" || run.status === "rejected") && isSameDecision(run, decision)) {
      return run;
    }
    const code = run.gateDecision !== null ? "decision-conflict" : "run-not-awaiting-decision";
    throw new DecisionConflictError(
      code,
      run.status,
      code === "decision-conflict"
        ? `该运行已封存人工决策（${run.gateDecision ?? "none"}），不能用冲突决策覆盖`
        : `该运行当前状态为 ${run.status}，不在等待人工确认阶段`,
    );
  }

  await Promise.resolve();
  const { state, iteration } = restoreState(run);
  const events: RunEvent[] = [...run.events];
  const input = {
    id: run.id,
    taskText: run.task.text,
    autoApprove: run.task.autoApprove,
    createdAt: run.createdAt,
  };
  let status: AgentRun["status"] = "running";
  const emit: EmitEvent | undefined =
    onEvent === undefined
      ? undefined
      : (event) => {
          onEvent(event, finalize(input, state, [...events], status, state.llm, iteration, workflow, agents));
        };

  state.gateDecision = decision.action;
  state.decidedCandidateId = decision.candidateId ?? null;
  state.gateNeeded = false;

  if (decision.action === "reject") {
    state.report = [];
    status = "rejected";
    addEvent(
      events,
      "gate.decided",
      "人工门驳回上架方案",
      "action=reject；掌柜驳回当前评审方案，不生成通过报告并封存事件链",
      "approval",
      "owner",
      emit,
    );
    return finalize(input, state, events, "rejected", state.llm, iteration, workflow, agents);
  }

  const previousChosenId = state.chosenId;
  if (
    decision.candidateId !== undefined &&
    state.candidates.some((candidate) => candidate.id === decision.candidateId)
  ) {
    state.preferredCandidateId = decision.candidateId;
    state.chosenId = decision.candidateId;
    const candidate = state.candidates.find((item) => item.id === decision.candidateId);
    if (candidate !== undefined && decision.candidateId !== previousChosenId && state.product !== null && state.llm.mode !== "live") {
      const preset = PLATFORM_PRESETS[state.product.platform];
      state.copy = buildCopy(state.product, preset, candidate.priceCents, state.breakEvenCents);
      state.bullets = candidate.bullets.map((bullet) => bullet.text);
    }
  }

  const chosen = state.candidates.find((item) => item.id === state.chosenId) ?? state.candidates[0];
  addEvent(
    events,
    "gate.decided",
    "人工门确认通过",
    `action=approve；选定策略：${chosen?.label ?? state.chosenId ?? "默认"}（${chosen === undefined ? "—" : money(chosen.priceCents)}）`,
    "approval",
    "owner",
    emit,
  );
  completeAfterApproval(
    state,
    events,
    iteration,
    () => {
      status = "completed";
    },
    emit,
  );
  return finalize(input, state, events, "completed", state.llm, iteration, workflow, agents);
}

function finalize(
  input: { readonly id: string; readonly taskText: string; readonly autoApprove: boolean; readonly createdAt: string },
  state: InternalState,
  events: readonly RunEvent[],
  status: AgentRun["status"],
  llm: AgentRun["llm"],
  iteration: number = 1 + state.loops.length,
  workflow: WorkflowDocument = DEFAULT_WORKFLOW,
  agents: readonly AgentSpec[] = AGENTS,
): AgentRun {
  const currentArtifacts = artifacts(state);
  const fingerprint = sha256Hex(canonicalJson({ workflow, events, artifacts: currentArtifacts }));
  const loads = { ...state.loads };
  const calls = { ...state.calls };
  const failures = { ...state.failures };
  const runs = { ...state.runs };
  return {
    id: input.id,
    createdAt: input.createdAt,
    status,
    task: { text: input.taskText, autoApprove: input.autoApprove },
    workflow,
    agents,
    dispatches: [...state.dispatches],
    events,
    verifications: [...state.verifications],
    loops: [...state.loops],
    artifacts: currentArtifacts,
    llm,
    fingerprint,
    notes: [
      "商品链接识别是工具，不是 Agent 本身；每个 Agent 都有独立角色、工具、输出和验证责任。",
      "成本先交付保本价，市场据此报价；三方独立复核后交风控裁决。经济类风险失败最多触发 2 轮额外反馈循环（共最多 3 轮验证）。",
      "人工门在正式模式需要用户确认，autoApprove 仅用于可重复演示。",
    ],
    gateDecision: state.gateDecision,
    preferredCandidateId: state.preferredCandidateId,
    decidedCandidateId: state.decidedCandidateId,
    failures,
    loads,
    calls,
    scheduler: {
      loads,
      calls,
      failures,
      runs,
      preferredCandidateId: state.preferredCandidateId,
      gateDecision: state.gateDecision,
      decidedCandidateId: state.decidedCandidateId,
      iteration,
      adjustments: [...state.adjustments],
      facts: state.facts,
    },
  };
}
