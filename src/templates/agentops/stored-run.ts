import type { Candidate, CandidateId, CheckRow, PlanCopy } from "../pricing/model.js";
import type { IntakeResult } from "../intake/types.js";
import type {
  AgentRun,
  AgentSpec,
  Artifacts,
  Dispatch,
  GateAction,
  LoopIteration,
  LoopSnapshot,
  RiskRow,
  RunEvent,
  RunStatus,
  RunSummary,
  SchedulerState,
  Verification,
  VerificationStatus,
} from "./types.js";

/**
 * Tolerant reader for persisted / fetched runs.
 *
 * Pure (no node imports) so the server store and the browser share one definition of
 * "a dossier we can safely show". It never mutates its input and never recomputes a
 * fingerprint: legacy runs keep the exact bytes they were sealed with.
 */

export const RUN_STATUSES: readonly RunStatus[] = ["running", "awaiting-approval", "completed", "rejected", "stopped"];

export type StoredRunResult =
  | { readonly ok: true; readonly run: AgentRun }
  | { readonly ok: false; readonly reason: string };

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function recs(value: unknown): Rec[] {
  return Array.isArray(value) ? value.filter(isRec) : [];
}

function numberMap(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRec(value)) return out;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "number" && Number.isFinite(item)) out[key] = item;
  }
  return out;
}

function isVerification(value: unknown): value is VerificationStatus {
  return value === "pass" || value === "warn" || value === "fail";
}

function isCandidateId(value: unknown): value is CandidateId {
  return value === "profit" || value === "match" || value === "volume";
}

function gate(value: unknown): GateAction | null {
  return value === "approve" || value === "reject" ? value : null;
}

function candidateOrNull(value: unknown): CandidateId | null {
  return isCandidateId(value) ? value : null;
}

function checkRows(value: unknown): CheckRow[] {
  return recs(value)
    .filter((row) => isVerification(row.status))
    .map((row) => ({
      id: str(row.id, str(row.label, "check")),
      label: str(row.label, str(row.id)),
      status: row.status as VerificationStatus,
      detail: str(row.detail),
    }));
}

/** A candidate is only kept when every nested block the cards and charts dereference exists. */
function candidateOf(value: Rec): Candidate | null {
  const evaluation = value.evaluation;
  const sim = value.sim;
  if (!isCandidateId(value.id) || !isRec(evaluation) || !isRec(sim)) return null;
  if (!isRec(evaluation.unit) || !isRec(evaluation.daily)) return null;
  if (!Array.isArray(sim.days)) return null;
  return {
    ...(value as unknown as Candidate),
    id: value.id,
    label: str(value.label, value.id),
    tagline: str(value.tagline),
    priceCents: num(value.priceCents),
    promoPriceCents: num(value.promoPriceCents, num(value.priceCents)),
    checks: checkRows(value.checks),
    bullets: recs(value.bullets).map((bullet) => ({
      text: str(bullet.text),
      basis: str(bullet.basis),
      needsReview: bullet.needsReview === true,
    })),
    verdict: str(value.verdict),
    risks: strings(value.risks),
  };
}

function riskOf(value: unknown): Artifacts["risk"] {
  if (!isRec(value) || !isVerification(value.level)) return null;
  const rows: RiskRow[] = recs(value.rows)
    .filter((row) => isVerification(row.status))
    .map((row) => ({
      ...(typeof row.id === "string" ? { id: row.id } : {}),
      title: str(row.title, str(row.id, "检查项")),
      status: row.status as VerificationStatus,
      detail: str(row.detail),
      ...(typeof row.owner === "string" ? { owner: row.owner } : {}),
    }));
  return { level: value.level, rows };
}

function copyOf(value: unknown): PlanCopy | null {
  if (!isRec(value) || !Array.isArray(value.titles)) return null;
  return {
    titles: recs(value.titles).map((title) => ({
      label: str(title.label),
      text: str(title.text),
      length: num(title.length, [...str(title.text)].length),
    })),
    keywords: strings(value.keywords),
    searchTerms: strings(value.searchTerms),
    notes: strings(value.notes),
  };
}

function factsOf(value: unknown): IntakeResult | null {
  if (!isRec(value) || !Array.isArray(value.fields) || !Array.isArray(value.questions)) return null;
  const fields = recs(value.fields).map((field) => ({
    ...(field as unknown as IntakeResult["fields"][number]),
    id: field.id as IntakeResult["fields"][number]["id"],
    label: str(field.label),
    display: str(field.display),
    needsConfirm: field.needsConfirm === true,
  }));
  const questions = recs(value.questions).map((question) => ({
    id: str(question.id, "question"),
    ask: str(question.ask),
    why: str(question.why),
    options: recs(question.options) as unknown as IntakeResult["questions"][number]["options"],
  }));
  return {
    ...(value as unknown as IntakeResult),
    headline: str(value.headline),
    links: Array.isArray(value.links) ? (value.links as IntakeResult["links"]) : [],
    fields,
    questions,
    salesHint: typeof value.salesHint === "number" ? value.salesHint : null,
  };
}

function snapshotOf(value: unknown): LoopSnapshot | null {
  if (!isRec(value)) return null;
  return {
    chosenId: typeof value.chosenId === "string" ? value.chosenId : null,
    priceCents: num(value.priceCents),
    promoPriceCents: num(value.promoPriceCents),
    margin: num(value.margin),
    p10Cents: num(value.p10Cents),
    adDailyBudgetCents: num(value.adDailyBudgetCents),
    promoDiscount: num(value.promoDiscount, 1),
    stockoutDays: num(value.stockoutDays),
    failTitles: strings(value.failTitles),
  };
}

function verificationsOf(value: unknown): Verification[] {
  return recs(value)
    .filter((item) => isVerification(item.status))
    .map((item) => ({
      stage: str(item.stage),
      verifier: str(item.verifier),
      title: str(item.title),
      status: item.status as VerificationStatus,
      detail: str(item.detail),
    }));
}

function loopsOf(value: unknown): LoopIteration[] {
  const out: LoopIteration[] = [];
  for (const loop of recs(value)) {
    const before = snapshotOf(loop.before);
    const after = snapshotOf(loop.after);
    if (before === null || after === null) continue;
    out.push({
      role: str(loop.role),
      iteration: num(loop.iteration, out.length + 2),
      verdicts: verificationsOf(loop.verdicts),
      adjustment: typeof loop.adjustment === "string" ? loop.adjustment : null,
      ...(loop.action === "ad-budget" || loop.action === "promo-discount" || loop.action === "switch-candidate"
        ? { action: loop.action }
        : {}),
      before,
      after,
    });
  }
  return out;
}

function eventsOf(value: unknown): RunEvent[] {
  return recs(value)
    .filter((event) => typeof event.seq === "number" && typeof event.type === "string")
    .map((event) => ({
      seq: event.seq as number,
      type: event.type as RunEvent["type"],
      nodeId: typeof event.nodeId === "string" ? event.nodeId : null,
      agentId: typeof event.agentId === "string" ? event.agentId : null,
      title: str(event.title),
      detail: str(event.detail),
      hash: str(event.hash),
      prevHash: str(event.prevHash),
    }));
}

function agentsOf(value: unknown): AgentSpec[] {
  return recs(value)
    .filter((agent) => typeof agent.id === "string")
    .map((agent) => ({
      id: agent.id as string,
      name: str(agent.name, agent.id as string),
      role: str(agent.role),
      version: str(agent.version, "0"),
      capabilities: isRec(agent.capabilities) ? (agent.capabilities as AgentSpec["capabilities"]) : {},
      tools: strings(agent.tools),
      maxCallsPerRun: num(agent.maxCallsPerRun, 1),
    }));
}

function dispatchesOf(value: unknown): Dispatch[] {
  return recs(value)
    .filter((item) => typeof item.nodeId === "string" && typeof item.chosen === "string")
    .map((item) => ({
      nodeId: item.nodeId as string,
      need: item.need as Dispatch["need"],
      chosen: item.chosen as string,
      rationale: str(item.rationale),
      candidates: recs(item.candidates).map((candidate) => ({
        agentId: str(candidate.agentId),
        score: num(candidate.score),
        note: str(candidate.note),
      })),
    }));
}

function artifactsOf(raw: Rec): Artifacts {
  const candidates = Array.isArray(raw.candidates)
    ? recs(raw.candidates).flatMap((candidate) => {
        const kept = candidateOf(candidate);
        return kept === null ? [] : [kept];
      })
    : undefined;
  return {
    ...(raw as unknown as Artifacts),
    product: isRec(raw.product) ? (raw.product as unknown as Artifacts["product"]) : null,
    unit: isRec(raw.unit) ? (raw.unit as unknown as Artifacts["unit"]) : null,
    breakEvenCents: num(raw.breakEvenCents),
    ...(candidates === undefined ? {} : { candidates }),
    prices: recs(raw.prices)
      .filter((row) => typeof row.id === "string")
      .map((row) => ({
        id: row.id as string,
        label: str(row.label, row.id as string),
        priceCents: num(row.priceCents),
        margin: num(row.margin),
        profitP50Cents: num(row.profitP50Cents),
        profitP10Cents: num(row.profitP10Cents),
      })),
    chosenId: typeof raw.chosenId === "string" ? raw.chosenId : null,
    risk: riskOf(raw.risk),
    copy: copyOf(raw.copy),
    bullets: strings(raw.bullets),
    report: strings(raw.report),
    assumptions: strings(raw.assumptions),
    ...(Array.isArray(raw.citations)
      ? {
          citations: recs(raw.citations).map((c) => ({
            refId: str(c.refId),
            title: str(c.title),
            detail: str(c.detail),
            source: (c.source === "custom" ? "custom" : "knowledge.search") as "knowledge.search" | "custom",
          })),
        }
      : {}),
  };
}

function schedulerOf(value: unknown, fallback: { loads: Record<string, number>; calls: Record<string, number>; failures: Record<string, number> }, run: Rec): SchedulerState {
  const sched = isRec(value) ? value : {};
  return {
    loads: isRec(sched.loads) ? numberMap(sched.loads) : fallback.loads,
    calls: isRec(sched.calls) ? numberMap(sched.calls) : fallback.calls,
    failures: isRec(sched.failures) ? numberMap(sched.failures) : fallback.failures,
    runs: numberMap(sched.runs),
    preferredCandidateId: candidateOrNull(sched.preferredCandidateId ?? run.preferredCandidateId),
    gateDecision: gate(sched.gateDecision ?? run.gateDecision),
    decidedCandidateId: candidateOrNull(sched.decidedCandidateId ?? run.decidedCandidateId),
    iteration: num(sched.iteration, 1),
    adjustments: strings(sched.adjustments),
    facts: factsOf(sched.facts),
  };
}

function tokenUsageOf(value: unknown): { promptTokens: number; completionTokens: number } | undefined {
  if (!isRec(value)) return undefined;
  const promptTokens = num(value.promptTokens, 0);
  const completionTokens = num(value.completionTokens, 0);
  return { promptTokens, completionTokens };
}

export function parseStoredRun(raw: unknown): StoredRunResult {
  if (!isRec(raw)) return { ok: false, reason: "卷宗内容不是一个对象" };
  if (typeof raw.id !== "string" || raw.id.length === 0) return { ok: false, reason: "卷宗缺少编号" };
  if (typeof raw.status !== "string" || !RUN_STATUSES.includes(raw.status as RunStatus)) {
    return { ok: false, reason: `未知的评审状态「${typeof raw.status === "string" ? raw.status : "空"}」` };
  }
  if (!isRec(raw.task) || typeof raw.task.text !== "string") return { ok: false, reason: "卷宗缺少评审任务描述" };
  if (!isRec(raw.artifacts)) return { ok: false, reason: "卷宗缺少核算结果" };

  const loads = numberMap(raw.loads);
  const calls = numberMap(raw.calls);
  const failures = numberMap(raw.failures);
  const rawMode = isRec(raw.llm) ? raw.llm.mode : undefined;
  const llm: AgentRun["llm"] =
    isRec(raw.llm) && (rawMode === "rule" || rawMode === "live" || rawMode === "fallback")
      ? {
          mode: rawMode,
          model: typeof raw.llm.model === "string" ? raw.llm.model : null,
          note: str(raw.llm.note),
        }
      : { mode: "rule", model: null, note: "旧卷宗没有记录模型信息，按本地规则处理。" };
  const workflow = isRec(raw.workflow) && Array.isArray(raw.workflow.nodes)
    ? (raw.workflow as unknown as AgentRun["workflow"])
    : { id: "legacy", title: "旧版评审流程", intent: "", nodes: [] };

  const tokenUsage = tokenUsageOf(raw.tokenUsage);
  const stopReason =
    raw.stopReason === "budget.tool_calls" ||
    raw.stopReason === "budget.tokens" ||
    raw.stopReason === "budget.timeout" ||
    raw.stopReason === "budget.completions"
      ? raw.stopReason
      : undefined;
  const usageAccounting = isRec(raw.usageAccounting)
    ? (raw.usageAccounting as AgentRun["usageAccounting"])
    : undefined;
  const run: AgentRun = {
    id: raw.id,
    createdAt: str(raw.createdAt),
    status: raw.status as RunStatus,
    task: { text: raw.task.text, autoApprove: raw.task.autoApprove === true },
    workflow,
    agents: agentsOf(raw.agents),
    dispatches: dispatchesOf(raw.dispatches),
    events: eventsOf(raw.events),
    verifications: verificationsOf(raw.verifications),
    loops: loopsOf(raw.loops),
    artifacts: artifactsOf(raw.artifacts),
    llm,
    fingerprint: str(raw.fingerprint),
    notes: strings(raw.notes),
    gateDecision: gate(raw.gateDecision),
    preferredCandidateId: candidateOrNull(raw.preferredCandidateId),
    decidedCandidateId: candidateOrNull(raw.decidedCandidateId),
    failures,
    loads,
    calls,
    scheduler: schedulerOf(raw.scheduler, { loads, calls, failures }, raw),
    ...(tokenUsage === undefined ? {} : { tokenUsage }),
    ...(stopReason === undefined ? {} : { stopReason }),
    ...(usageAccounting === undefined ? {} : { usageAccounting }),
    ...(Array.isArray(raw.protocolTraces)
      ? { protocolTraces: raw.protocolTraces as AgentRun["protocolTraces"] }
      : {}),
    ...(Array.isArray(raw.protocolErrors)
      ? { protocolErrors: raw.protocolErrors as AgentRun["protocolErrors"] }
      : {}),
  };
  return { ok: true, run };
}

/** Cheap summary that never throws; `undefined` means the run is not usable at all. */
export function summarizeStoredRun(raw: unknown): RunSummary | undefined {
  const parsed = parseStoredRun(raw);
  if (!parsed.ok) return undefined;
  const run = parsed.run;
  const chosen = run.artifacts.prices.find((price) => price.id === run.artifacts.chosenId);
  return {
    id: run.id,
    createdAt: run.createdAt,
    status: run.status,
    taskText: run.task.text,
    chosenId: run.artifacts.chosenId,
    priceCents: chosen?.priceCents ?? 0,
    margin: chosen?.margin ?? 0,
    loops: run.loops.length,
    failures: run.verifications.filter((item) => item.status === "fail").length,
  };
}
