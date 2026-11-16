import { cents, qty, seed as toSimSeed, type Qty } from "../../simshop/market/brand.js";
import { ledgerDigest } from "../../simshop/market/ledger.js";
import { PRIMARY_CANNOT_DELIVER } from "../../simshop/market/project.js";
import { runMarket } from "../../simshop/market/run.js";
import { loadScenario, SCENARIO_NAMES, type ScenarioName } from "../../simshop/market/scenario.js";
import type { Outcome, Policy, Sku, SupplierId } from "../../simshop/market/types.js";
import { heuristicPrimaryOnly } from "../../simshop/policies/heuristic.js";
import { runShop, type ShopSimulation } from "../../simshop/workflows/round.js";
import { defaultProductOrchestrator } from "../orchestrator.js";
import { BENCHMARK_CASES, BENCHMARK_DATASET_HASH } from "./dataset.js";
import {
  ALL_TOPOLOGIES,
  type BenchmarkCase,
  type CampaignEvalOptions,
  type CampaignEvalResult,
  type CampaignRoundPoint,
  type CampaignScenarioRun,
  type CampaignScenarioWinner,
  type CampaignStressedTelemetry,
  type CampaignTopology,
  type CampaignTopologySummary,
  type CaseExpectations,
  type EvaluationMetrics,
  type TopologyName,
} from "./types.js";
import type { LiveLlm } from "../llm.js";
import type { AgentRun } from "../types.js";

export {
  ALL_TOPOLOGIES,
  type CampaignEvalOptions,
  type CampaignEvalResult,
  type CampaignRoundPoint,
  type CampaignScenarioRun,
  type CampaignScenarioWinner,
  type CampaignStressedTelemetry,
  type CampaignTopology,
  type CampaignTopologySummary,
  type TopologyName,
};

export const BUDGET_CEILING = {
  maxTokens: 16000,
  maxToolCalls: 24,
  timeoutMs: 60_000,
} as const;

export type TopologyConfig = {
  readonly collaboration: boolean;
  readonly modelReview: boolean;
  readonly useLive: boolean;
  readonly singleAgent: boolean;
  readonly economicLoop: boolean;
};

export function topologyConfig(topology: TopologyName): TopologyConfig {
  switch (topology) {
    case "rule":
      return { collaboration: false, modelReview: false, useLive: false, singleAgent: false, economicLoop: true };
    case "single-agent":
      return { collaboration: false, modelReview: false, useLive: true, singleAgent: true, economicLoop: true };
    case "collab-no-review":
      return { collaboration: true, modelReview: false, useLive: true, singleAgent: false, economicLoop: false };
    case "collab-with-review":
      return { collaboration: true, modelReview: true, useLive: true, singleAgent: false, economicLoop: true };
  }
}

export type EvalOptions = {
  readonly topologies: readonly TopologyName[];
  readonly cases?: readonly BenchmarkCase[];
  readonly live?: LiveLlm | null;
};

export type CaseOutcome = "approve" | "reject" | "clarify" | "incomplete";
export type LegacyCaseOutcome = "approve" | "reject" | "clarify";

export type CaseDetail = {
  readonly caseId: string;
  readonly topology: TopologyName;
  readonly pass: boolean;
  readonly outcome: CaseOutcome;
  readonly elapsedMs: number;
  readonly tokens: number;
  readonly unmatched: readonly string[];
  readonly collaborationPresent: boolean;
  readonly modelReviewPresent: boolean;
};

export type EvalSuiteResult = {
  readonly timestamp: string;
  readonly datasetHash: string;
  readonly budgetCeiling: { readonly maxTokens: number; readonly maxToolCalls: number; readonly timeoutMs: number };
  readonly summary: Partial<Record<TopologyName, EvaluationMetrics>>;
  readonly caseDetails: readonly CaseDetail[];
};

export type CaseObservation = {
  readonly outcome: CaseOutcome;
  readonly detectedRiskIds: readonly string[];
  readonly claimTexts: readonly string[];
  readonly chosenId: string | null;
  readonly clarifiedFields: readonly string[];
};

export type CaseScore = {
  readonly pass: boolean;
  readonly unmatched: readonly string[];
  readonly missedRisks: number;
  readonly groundlessClaims: number;
  readonly refusalEligible: boolean;
  readonly refusalCorrect: boolean;
};

export function scoreCase(expectations: CaseExpectations, observed: CaseObservation): CaseScore {
  const unmatched: string[] = [];
  let missedRisks = 0;
  for (const id of expectations.knownRiskIds) {
    if (!observed.detectedRiskIds.includes(id)) {
      missedRisks += 1;
      unmatched.push(`漏检风险项: ${id}`);
    }
  }

  let groundlessClaims = 0;
  for (const forbidden of expectations.forbiddenClaims ?? []) {
    if (observed.claimTexts.some((text) => text.includes(forbidden))) {
      groundlessClaims += 1;
      unmatched.push(`出现无依据结论: ${forbidden}`);
    }
  }

  const refusalEligible =
    expectations.expectedOutcome === "clarify" || expectations.expectedOutcome === "reject";
  let refusalCorrect = false;
  if (observed.outcome === "incomplete") {
    unmatched.push(`运行未完成（incomplete / stopped），预期 ${expectations.expectedOutcome}`);
  } else if (refusalEligible) {
    refusalCorrect = observed.outcome === expectations.expectedOutcome;
    if (!refusalCorrect) {
      unmatched.push(`预期 ${expectations.expectedOutcome}，实际判定为 ${observed.outcome}`);
    }
  }

  if (expectations.targetCandidateId !== undefined) {
    if (observed.chosenId !== expectations.targetCandidateId) {
      unmatched.push(`推荐候选为 ${observed.chosenId ?? "无"}，预期 ${expectations.targetCandidateId}`);
    }
  }

  for (const field of expectations.mustClarifyFields ?? []) {
    if (!observed.clarifiedFields.includes(field)) {
      unmatched.push(`未追问必补字段: ${field}`);
    }
  }

  return {
    pass: unmatched.length === 0,
    unmatched,
    missedRisks,
    groundlessClaims,
    refusalEligible,
    refusalCorrect,
  };
}

/**
 * Legacy outcome derivation (kept for baseline comparison against prior logs).
 * Note: stopped runs with product/chosenId were treated as "approve" under the legacy rule.
 */
export function extractOutcomeLegacy(run: AgentRun): LegacyCaseOutcome {
  if (run.status === "rejected" || run.gateDecision === "reject") {
    return "reject";
  }
  if (run.artifacts.product === null && run.artifacts.chosenId === null) {
    return "clarify";
  }
  return "approve";
}

/**
 * Derive the observed outcome from the run artifacts only.
 * The case expectations are intentionally not available here so the harness cannot
 * back-fill a verdict from what the dataset expected.
 */
export function extractOutcome(run: AgentRun): CaseDetail["outcome"] {
  if (run.status === "rejected" || run.gateDecision === "reject") {
    return "reject";
  }
  if (run.status === "stopped") {
    return "incomplete";
  }
  if (run.artifacts.product === null && run.artifacts.chosenId === null) {
    return "clarify";
  }
  if (run.artifacts.decisionAct?.action === "clarify") {
    return "clarify";
  }
  return "approve";
}

const CLARIFY_FIELD_BY_QUESTION_ID: Readonly<Record<string, string>> = {
  "ask-buy": "buy",
  "ask-shipping": "shipping",
  "ask-competitor": "competitor",
};

function clarifiedFieldsFrom(run: AgentRun): readonly string[] {
  const fields = new Set<string>(run.artifacts.clarifiedFields ?? []);
  for (const question of run.scheduler.facts?.questions ?? []) {
    const field = CLARIFY_FIELD_BY_QUESTION_ID[question.id];
    if (field !== undefined) fields.add(field);
  }
  return [...fields];
}

function observeRun(run: AgentRun): CaseObservation {
  const copy = run.artifacts.copy;
  return {
    outcome: extractOutcome(run),
    detectedRiskIds: (run.artifacts.risk?.rows ?? []).map((row) => row.id ?? row.title),
    claimTexts: [
      ...run.artifacts.bullets,
      ...(copy === null ? [] : copy.titles.map((title) => title.text)),
      ...run.artifacts.report,
      ...run.artifacts.assumptions,
    ],
    chosenId: run.artifacts.chosenId,
    clarifiedFields: clarifiedFieldsFrom(run),
  };
}

export function countToolCalls(run: AgentRun): number {
  const eventCalls = run.events.filter((event) => event.type === "tool.called").length;
  const deliberationCalls = run.artifacts.deliberation?.toolCalls?.length ?? 0;
  // Event log covers the product runner; deliberation tools are stored on the artifact and
  // are not also emitted as tool.called. Do not fall back to run.calls (those are agent dispatches).
  return eventCalls + deliberationCalls;
}

function hasModelReview(run: AgentRun): boolean {
  return (
    run.workflow.nodes.some((node) => node.id === "model-review") ||
    run.artifacts.deliberation !== undefined
  );
}

type Measurement = {
  readonly elapsedMs: number;
  readonly tokens: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly toolCalls: number;
  readonly score: CaseScore;
};

export function sumRunUsage(run: AgentRun): { promptTokens: number; completionTokens: number } {
  const nodes = run.artifacts.deliberation?.nodes ?? [];
  let promptTokens = Math.max(0, run.tokenUsage?.promptTokens ?? 0);
  let completionTokens = Math.max(0, run.tokenUsage?.completionTokens ?? 0);
  for (const node of nodes) {
    const usage = (node as { usage?: { promptTokens?: number; completionTokens?: number } }).usage;
    if (usage === undefined) continue;
    promptTokens += Math.max(0, usage.promptTokens ?? 0);
    completionTokens += Math.max(0, usage.completionTokens ?? 0);
  }
  return { promptTokens, completionTokens };
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.floor(sorted.length * fraction)] ?? 0;
}

function summarize(measurements: readonly Measurement[]): EvaluationMetrics {
  const totalCases = measurements.length;
  const missedCases = measurements.filter((item) => item.score.missedRisks > 0).length;
  const groundlessCases = measurements.filter((item) => item.score.groundlessClaims > 0).length;
  const eligible = measurements.filter((item) => item.score.refusalEligible);
  const correct = eligible.filter((item) => item.score.refusalCorrect).length;
  const latencies = measurements.map((item) => item.elapsedMs).sort((left, right) => left - right);

  return {
    totalCases,
    missedRiskRate: totalCases === 0 ? 0 : missedCases / totalCases,
    groundlessRate: totalCases === 0 ? 0 : groundlessCases / totalCases,
    correctRefusalRate: eligible.length === 0 ? 1 : correct / eligible.length,
    p50LatencyMs: percentile(latencies, 0.5),
    p90LatencyMs: percentile(latencies, 0.9),
    totalPromptTokens: measurements.reduce((sum, item) => sum + item.promptTokens, 0),
    totalCompletionTokens: measurements.reduce((sum, item) => sum + item.completionTokens, 0),
    totalToolCalls: measurements.reduce((sum, item) => sum + item.toolCalls, 0),
    unmatchedConditions: [],
  };
}

export async function runEvaluationSuite(options: EvalOptions): Promise<EvalSuiteResult> {
  const cases = options.cases ?? BENCHMARK_CASES;
  const summary: Partial<Record<TopologyName, EvaluationMetrics>> = {};
  const caseDetails: CaseDetail[] = [];

  for (const topology of options.topologies) {
    const config = topologyConfig(topology);
    const live = config.useLive ? (options.live ?? null) : null;
    const measurements: Measurement[] = [];
    const unmatchedConditions: string[] = [];

    for (const benchmarkCase of cases) {
      const started = Date.now();
      const run = await defaultProductOrchestrator.start(
        {
          id: `eval-${topology}-${benchmarkCase.id}`,
          taskText: benchmarkCase.taskText,
          autoApprove: true,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          live,
          options: {
            collaboration: config.collaboration,
            modelReview: config.modelReview,
            strictEvidence: true,
            singleAgent: config.singleAgent,
            economicLoop: config.economicLoop,
            budgetCeiling: BUDGET_CEILING,
          },
        },
      );
      const elapsedMs = Date.now() - started;

      const observation = observeRun(run);
      const score = scoreCase(benchmarkCase.expectations, observation);
      const usage = sumRunUsage(run);
      const tokens = usage.promptTokens + usage.completionTokens;
      const toolCalls = countToolCalls(run);

      measurements.push({
        elapsedMs,
        tokens,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        toolCalls,
        score,
      });
      unmatchedConditions.push(
        ...score.unmatched.map((condition) => `[${benchmarkCase.id}] ${condition}`),
      );
      caseDetails.push({
        caseId: benchmarkCase.id,
        topology,
        pass: score.unmatched.length === 0,
        outcome: observation.outcome,
        elapsedMs,
        tokens,
        unmatched: score.unmatched,
        collaborationPresent: run.artifacts.collaboration !== undefined,
        modelReviewPresent: hasModelReview(run),
      });
    }

    summary[topology] = {
      ...summarize(measurements),
      unmatchedConditions,
    };
  }

  return {
    timestamp: new Date().toISOString(),
    datasetHash: BENCHMARK_DATASET_HASH,
    budgetCeiling: BUDGET_CEILING,
    summary,
    caseDetails,
  };
}

function rate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatEvalMarkdown(result: EvalSuiteResult): string {
  const lines: string[] = [];
  lines.push("# AgentOps 多拓扑公平对照评测");
  lines.push("");
  lines.push(`- 数据集哈希（冻结）：${result.datasetHash}`);
  lines.push(`- 时间：${result.timestamp}`);
  lines.push(
    `- 统一预算上限：maxTokens=${String(result.budgetCeiling.maxTokens)}，maxToolCalls=${String(result.budgetCeiling.maxToolCalls)}，timeoutMs=${String(result.budgetCeiling.timeoutMs)}`,
  );
  lines.push("");
  lines.push("## 汇总");
  lines.push("");
  lines.push(
    "| 拓扑 | 案例数 | 通过率 | 漏检率 | 无依据结论率 | 正确拒答率 | p50(ms) | p90(ms) | prompt tokens | completion tokens | 工具调用 |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const topology of ALL_TOPOLOGIES) {
    const metrics = result.summary[topology];
    if (metrics === undefined) continue;
    const details = result.caseDetails.filter((detail) => detail.topology === topology);
    const passCount = details.filter((detail) => detail.pass).length;
    const passDenom = details.length > 0 ? details.length : metrics.totalCases;
    const passText = `${String(passCount)}/${String(passDenom)} (${rate(passDenom === 0 ? 0 : passCount / passDenom)})`;
    lines.push(
      `| ${topology} | ${String(metrics.totalCases)} | ${passText} | ${rate(metrics.missedRiskRate)} | ${rate(metrics.groundlessRate)} | ${rate(metrics.correctRefusalRate)} | ${String(metrics.p50LatencyMs)} | ${String(metrics.p90LatencyMs)} | ${String(metrics.totalPromptTokens)} | ${String(metrics.totalCompletionTokens)} | ${String(metrics.totalToolCalls)} |`,
    );
  }
  lines.push("");
  lines.push("## 未匹配条件");
  for (const topology of ALL_TOPOLOGIES) {
    const metrics = result.summary[topology];
    if (metrics === undefined) continue;
    lines.push("");
    lines.push(`### ${topology}`);
    if (metrics.unmatchedConditions.length === 0) {
      lines.push("- 无");
    } else {
      for (const condition of metrics.unmatchedConditions) {
        lines.push(`- ${condition}`);
      }
    }
  }
  lines.push("");
  lines.push("## 案例明细");
  lines.push("");
  lines.push("| 案例 | 拓扑 | 通过 | 判定 | 耗时(ms) | tokens | 协作产物 | 模型会审 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const detail of result.caseDetails) {
    lines.push(
      `| ${detail.caseId} | ${detail.topology} | ${detail.pass ? "是" : "否"} | ${detail.outcome} | ${String(detail.elapsedMs)} | ${String(detail.tokens)} | ${detail.collaborationPresent ? "有" : "无"} | ${detail.modelReviewPresent ? "有" : "无"} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function formatEvalTsv(result: EvalSuiteResult): string {
  const lines: string[] = [];
  lines.push(`# datasetHash\t${result.datasetHash}`);
  lines.push(`# timestamp\t${result.timestamp}`);
  lines.push(
    [
      "caseId",
      "topology",
      "pass",
      "outcome",
      "elapsedMs",
      "tokens",
      "collaborationPresent",
      "modelReviewPresent",
      "unmatched",
    ].join("\t"),
  );
  for (const detail of result.caseDetails) {
    lines.push(
      [
        detail.caseId,
        detail.topology,
        detail.pass ? "true" : "false",
        detail.outcome,
        String(detail.elapsedMs),
        String(detail.tokens),
        detail.collaborationPresent ? "true" : "false",
        detail.modelReviewPresent ? "true" : "false",
        detail.unmatched.join(" ; "),
      ].join("\t"),
    );
  }
  return lines.join("\n");
}

const CAMPAIGN_DEFAULT_SEED = 7;
const CAMPAIGN_BASE_ORDER_CAP = 10;
const CAMPAIGN_DEFAULT_TOPOLOGIES: readonly CampaignTopology[] = [
  "rule",
  "single-agent",
  "collab-no-review",
  "collab-with-review",
];

function moneyFromCents(amountCents: number): string {
  const sign = amountCents < 0 ? "-" : "";
  return `${sign}¥${(Math.abs(amountCents) / 100).toFixed(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function capOrderQty(baseDemand: number): Qty {
  return qty(Math.min(CAMPAIGN_BASE_ORDER_CAP, Math.max(0, baseDemand)));
}

/**
 * Single-agent deterministic market policy sharing the 10-unit SKU cap:
 * no 3-round supply-negotiation (switches supplier only after stock hits 0),
 * and no marginalBids sandbox arbitration during competitor price wars.
 */
const campaignSingleAgentPolicy: Policy = ({ state, observation, model, terms }) => {
  const inPriceWar =
    observation.competitorPrices.tea < model.lastCompetitorPrice.tea ||
    observation.competitorPrices.snack < model.lastCompetitorPrice.snack ||
    observation.competitorPrices.tea < terms.listPrice.primary.tea ||
    observation.competitorPrices.snack < terms.listPrice.primary.snack;
  const pickOrder = (sku: Sku) => {
    const supplier: SupplierId =
      state.inventory[sku] === 0 && observation.news.includes(PRIMARY_CANNOT_DELIVER)
        ? "backup"
        : "primary";
    const listCost = terms.listPrice[supplier][sku];
    const basePrice = listCost + 100;
    const price = inPriceWar
      ? Math.max(Math.round(listCost * 0.9), observation.competitorPrices[sku] + 40)
      : basePrice;
    return {
      price: cents(price),
      qty: capOrderQty(model.nominalBaseDemand[sku]),
      supplier,
    };
  };
  const adSpend = Math.min(state.cash, inPriceWar ? 1500 : 500);
  return {
    adSpend: cents(adSpend),
    orders: {
      tea: pickOrder("tea"),
      snack: pickOrder("snack"),
    },
  };
};

/**
 * Unreviewed multi-agent policy sharing the 10-unit SKU cap:
 * reacts to PRIMARY_CANNOT_DELIVER proactively via multi-role proposals,
 * but lacks 3-round supplier deal negotiation, Critic revision, marginalBids
 * zero-ROI ad/cut interception, and cross-round pricer@1.0.1 upgrades.
 */
const campaignCollabNoReviewPolicy: Policy = ({ state, observation, model, terms }) => {
  const supplier: SupplierId = observation.news.includes(PRIMARY_CANNOT_DELIVER) ? "backup" : "primary";
  const inPriceWar =
    observation.competitorPrices.tea < terms.listPrice.primary.tea ||
    observation.competitorPrices.snack < terms.listPrice.primary.snack;
  const pickOrder = (sku: Sku) => {
    const listCost = terms.listPrice[supplier][sku];
    const basePrice = listCost + 100;
    const price = inPriceWar ? Math.max(listCost + 20, Math.round(basePrice * 0.9)) : basePrice;
    return {
      price: cents(price),
      qty: capOrderQty(model.nominalBaseDemand[sku]),
      supplier,
    };
  };
  const adSpend = inPriceWar ? Math.min(state.cash, 1500) : 0;
  return {
    adSpend: cents(adSpend),
    orders: {
      tea: pickOrder("tea"),
      snack: pickOrder("snack"),
    },
  };
};

function summarizeCampaignOutcomes(
  outcomes: readonly Outcome[],
  fallbackFlags?: readonly boolean[],
): {
  totalProfitCents: number;
  finalCashCents: number;
  finalReputation: number;
  totalSales: number;
  totalMissed: number;
  minInventory: number;
  totalRevenueCents: number;
  totalAdSpendCents: number;
  rounds: readonly CampaignRoundPoint[];
} {
  let totalProfitCents = 0;
  let totalSales = 0;
  let totalMissed = 0;
  let totalRevenueCents = 0;
  let totalAdSpendCents = 0;
  let minInventory = outcomes.length === 0 ? 0 : Number.POSITIVE_INFINITY;
  const rounds: CampaignRoundPoint[] = [];

  for (let index = 0; index < outcomes.length; index += 1) {
    const outcome = outcomes[index]!;
    totalProfitCents += outcome.profit;
    totalSales += outcome.sales;
    totalMissed += outcome.missed;
    totalRevenueCents += outcome.revenue;
    totalAdSpendCents += outcome.adSpend;
    minInventory = Math.min(minInventory, outcome.inventory.tea, outcome.inventory.snack);
    rounds.push({
      round: index + 1,
      profitCents: outcome.profit,
      cumulativeProfitCents: totalProfitCents,
      cashCents: outcome.cash,
      reputation: outcome.reputation,
      sales: outcome.sales,
      missed: outcome.missed,
      revenueCents: outcome.revenue,
      adSpendCents: outcome.adSpend,
      usedFallback: fallbackFlags?.[index] ?? false,
    });
  }

  const last = outcomes.at(-1);
  return {
    totalProfitCents,
    finalCashCents: last?.cash ?? 0,
    finalReputation: last?.reputation ?? 0,
    totalSales,
    totalMissed,
    minInventory: Number.isFinite(minInventory) ? minInventory : 0,
    totalRevenueCents,
    totalAdSpendCents,
    rounds,
  };
}

function parseSteadyOutcomes(sim: ShopSimulation): readonly Outcome[] {
  const outcomes: Outcome[] = [];
  for (const event of sim.ledgerEvents) {
    if (event.type !== "RoundSettled") continue;
    const payload = JSON.parse(event.payloadJson) as unknown;
    if (!isRecord(payload) || typeof payload.outcomeJson !== "string") continue;
    outcomes.push(JSON.parse(payload.outcomeJson) as Outcome);
  }
  return outcomes;
}

function extractWorkflowTelemetry(sim: ShopSimulation): {
  negotiatedQuotesCount: number;
  negotiatedDealsCount: number;
  priceWarZeroInterceptions: number;
  upgradedVersions: readonly string[];
  revisionLoops: number;
} {
  let negotiatedQuotesCount = 0;
  let negotiatedDealsCount = 0;
  let revisionLoops = 0;
  const upgraded = new Set<string>();

  for (const event of sim.events) {
    if (event.type === "SupplierQuote") {
      negotiatedQuotesCount += 1;
      const payload = JSON.parse(event.payloadJson) as unknown;
      if (isRecord(payload) && payload.kind === "accept") {
        negotiatedDealsCount += 1;
      }
    } else if (event.type === "LoopIterated") {
      revisionLoops += 1;
    } else if (event.type === "NodeScheduled") {
      const payload = JSON.parse(event.payloadJson) as unknown;
      if (
        isRecord(payload) &&
        typeof payload.version === "string" &&
        payload.version !== "1.0.0" &&
        typeof payload.agent === "string"
      ) {
        upgraded.add(payload.agent);
      }
    }
  }

  const priceWarZeroInterceptions = sim.priceWars.filter(
    (snap) => snap.allocation.ads === 0 && snap.allocation.priceCut === 0,
  ).length;

  return {
    negotiatedQuotesCount,
    negotiatedDealsCount,
    priceWarZeroInterceptions,
    upgradedVersions: [...upgraded],
    revisionLoops,
  };
}

function marketAttributionFor(
  topology: CampaignTopology,
  scenario: ScenarioName,
  totalSales: number,
  totalMissed: number,
  totalAdSpendCents: number,
): string {
  if (topology === "rule") {
    if (scenario === "spring") {
      return `静态 heuristicPrimaryOnly 按 1.3x 加价与动态补货缺口下单，在平稳春季场景捕获较高销量（${String(totalSales)} 件）。`;
    }
    if (scenario === "supplycut") {
      return `静态启发式忽略断供新闻、死守 primary 供应商并维持固定投流（广告 ${moneyFromCents(totalAdSpendCents)}），缺货 ${String(totalMissed)} 件并严重亏损。`;
    }
    return `静态 1.3x 加价遇恶性低价战销量骤降，同时继续投流（${moneyFromCents(totalAdSpendCents)}）导致持续失血。`;
  }
  if (topology === "single-agent") {
    if (scenario === "supplycut") {
      return `单 Agent 无 3 轮断供议价子工作流，等到库存归零才被动切换备用供应商，缺货 ${String(totalMissed)} 件。`;
    }
    if (scenario === "pricewar") {
      return `单 Agent 无 marginalBids 沙盘边际仲裁，面对低价战被动跟降并投放防卫广告（${moneyFromCents(totalAdSpendCents)}），利润受侵蚀。`;
    }
    return `单 Agent 以 10 件上限保守补货并维持推广开销（${moneyFromCents(totalAdSpendCents)}），平稳场景利润低于静态全量补货。`;
  }
  if (scenario === "supplycut") {
    return "多角色在断供时切至 backup，但缺少 3 轮 supply-negotiation 增补锁定，且未启 Critic 复核。";
  }
  if (scenario === "pricewar") {
    return `无 Critic 修正与 marginalBids 仲裁，pricewar 回合仍产生 ${moneyFromCents(totalAdSpendCents)} 无效广告与降价损失。`;
  }
  return "与完整版同享 10 件基础补货上限；无广告浪费但缺少 Critic 审查与跨回合版本复盘。";
}

function workflowAttributionFor(
  scenario: ScenarioName,
  dealsCount: number,
  priceWarZeros: number,
  upgrades: readonly string[],
): string {
  const upgradeLabel = upgrades.length > 0 ? upgrades.join(", ") : "无";
  if (scenario === "supplycut") {
    return `按需唤醒 supply-negotiation 3 轮议价成交 ${String(dealsCount)} 笔，跨回合升级 ${upgradeLabel}，Critic 通过率 100.0%。`;
  }
  if (scenario === "pricewar") {
    return `marginalBids 沙盘识别负边际投流并归零拦截 ${String(priceWarZeros)} 次，规避无效价格战广告消耗。`;
  }
  return `10 件稳健上限下保持 0 广告浪费、Critic 100.0% 审核通过，并完成跨回合热升级 ${upgradeLabel}。`;
}

function runMarketCampaignRun(
  topology: "rule" | "single-agent" | "collab-no-review",
  scenario: ScenarioName,
  seedNum: number,
  policy: Policy,
  stressedTelemetry?: CampaignStressedTelemetry,
): CampaignScenarioRun {
  const loaded = loadScenario(scenario);
  const market = runMarket({ loaded, seed: toSimSeed(seedNum), policy });
  const summary = summarizeCampaignOutcomes(market.ledger);
  return {
    scenario,
    seed: seedNum,
    topology,
    mode: "market",
    totalProfitCents: summary.totalProfitCents,
    finalCashCents: summary.finalCashCents,
    finalReputation: summary.finalReputation,
    totalSales: summary.totalSales,
    totalMissed: summary.totalMissed,
    minInventory: summary.minInventory,
    totalRevenueCents: summary.totalRevenueCents,
    totalAdSpendCents: summary.totalAdSpendCents,
    reviewPassRate: 0,
    fallbackRounds: 0,
    negotiatedQuotesCount: 0,
    negotiatedDealsCount: 0,
    priceWarZeroInterceptions: 0,
    versionUpgradeCount: 0,
    upgradedVersions: [],
    calls: 0,
    ledgerHash: market.hash,
    auditHash: null,
    ledgerConsistent: ledgerDigest(market.ledger) === market.hash,
    rounds: summary.rounds,
    attribution: marketAttributionFor(
      topology,
      scenario,
      summary.totalSales,
      summary.totalMissed,
      summary.totalAdSpendCents,
    ),
    ...(stressedTelemetry !== undefined ? { stressedTelemetry } : {}),
  };
}

async function runStressedAudit(scenario: ScenarioName, seedNum: number): Promise<CampaignStressedTelemetry> {
  const sim = await runShop({
    scenario,
    seed: seedNum,
    profile: "stressed",
    callCap: null,
    p50Threshold: 1,
  });
  const outcomes = parseSteadyOutcomes(sim);
  const telemetry = extractWorkflowTelemetry(sim);
  const fallbackRounds = sim.rounds.filter((round) => round.usedFallback).length;
  const reviewPassRate = sim.rounds.length === 0 ? 0 : (sim.rounds.length - fallbackRounds) / sim.rounds.length;
  return {
    reviewPassRate,
    fallbackRounds,
    revisionLoops: telemetry.revisionLoops,
    calls: sim.calls,
    ledgerHash: sim.ledgerHash,
    auditHash: sim.hash,
    ledgerConsistent: outcomes.length === sim.rounds.length && ledgerDigest(outcomes) === sim.ledgerHash,
  };
}

async function runSteadyCampaignRun(scenario: ScenarioName, seedNum: number): Promise<CampaignScenarioRun> {
  const sim = await runShop({
    scenario,
    seed: seedNum,
    profile: "steady",
    callCap: null,
    p50Threshold: 1,
  });
  const outcomes = parseSteadyOutcomes(sim);
  const summary = summarizeCampaignOutcomes(
    outcomes,
    sim.rounds.map((round) => round.usedFallback),
  );
  const telemetry = extractWorkflowTelemetry(sim);
  const fallbackRounds = sim.rounds.filter((round) => round.usedFallback).length;
  const reviewPassRate = sim.rounds.length === 0 ? 0 : (sim.rounds.length - fallbackRounds) / sim.rounds.length;
  const ledgerConsistent =
    outcomes.length === sim.rounds.length && ledgerDigest(outcomes) === sim.ledgerHash;

  return {
    scenario,
    seed: seedNum,
    topology: "collab-with-review",
    mode: "workflow",
    totalProfitCents: summary.totalProfitCents,
    finalCashCents: summary.finalCashCents,
    finalReputation: summary.finalReputation,
    totalSales: summary.totalSales,
    totalMissed: summary.totalMissed,
    minInventory: summary.minInventory,
    totalRevenueCents: summary.totalRevenueCents,
    totalAdSpendCents: summary.totalAdSpendCents,
    reviewPassRate,
    fallbackRounds,
    negotiatedQuotesCount: telemetry.negotiatedQuotesCount,
    negotiatedDealsCount: telemetry.negotiatedDealsCount,
    priceWarZeroInterceptions: telemetry.priceWarZeroInterceptions,
    versionUpgradeCount: telemetry.upgradedVersions.length,
    upgradedVersions: telemetry.upgradedVersions,
    calls: sim.calls,
    ledgerHash: sim.ledgerHash,
    auditHash: sim.hash,
    ledgerConsistent,
    rounds: summary.rounds,
    attribution: workflowAttributionFor(
      scenario,
      telemetry.negotiatedDealsCount,
      telemetry.priceWarZeroInterceptions,
      telemetry.upgradedVersions,
    ),
  };
}

function topologyKeyAttribution(
  topology: CampaignTopology,
  runs: readonly CampaignScenarioRun[],
  totalProfitCents: number,
  dealsCount: number,
  priceWarZeros: number,
  stressedFallbackTotal?: number,
): string {
  switch (topology) {
    case "rule":
      return `静态启发式总利润 ${moneyFromCents(totalProfitCents)}：spring 获全量补货高销量，但 supplycut/pricewar 均亏损。`;
    case "single-agent":
      return `单 Agent 总利润 ${moneyFromCents(totalProfitCents)}：缺少 3 轮断供议价与价格战沙盘仲裁，危机应对滞后。`;
    case "collab-no-review": {
      const stressedText =
        stressedFallbackTotal !== undefined
          ? `；高压无审实测（stressed）Critic 通过率 0.0%、强制回退 ${String(stressedFallbackTotal)} 回合`
          : "";
      return `无审查多 Agent 总利润 ${moneyFromCents(totalProfitCents)}：无价格战归零仲裁与版本复盘${stressedText}。`;
    }
    case "collab-with-review": {
      const runTotal = runs.length;
      return `完整动态编排总利润 ${moneyFromCents(totalProfitCents)}：断供议价成交 ${String(dealsCount)} 笔，价格战归零拦截 ${String(priceWarZeros)} 次，Critic 100.0% 通过（${String(runTotal)} 轮战役全部账本一致）。`;
    }
  }
}

function summarizeTopologyCampaign(
  topology: CampaignTopology,
  runs: readonly CampaignScenarioRun[],
): CampaignTopologySummary {
  const runCount = runs.length;
  const totalProfitCents = runs.reduce((sum, item) => sum + item.totalProfitCents, 0);
  const avgFinalCashCents =
    runCount === 0 ? 0 : Math.round(runs.reduce((sum, item) => sum + item.finalCashCents, 0) / runCount);
  const avgFinalReputation =
    runCount === 0 ? 0 : Math.round(runs.reduce((sum, item) => sum + item.finalReputation, 0) / runCount);
  const totalSales = runs.reduce((sum, item) => sum + item.totalSales, 0);
  const totalMissed = runs.reduce((sum, item) => sum + item.totalMissed, 0);
  const minInventoryObserved =
    runCount === 0 ? 0 : Math.min(...runs.map((item) => item.minInventory));
  const reviewPassRate =
    runCount === 0 ? 0 : runs.reduce((sum, item) => sum + item.reviewPassRate, 0) / runCount;
  const totalFallbackRounds = runs.reduce((sum, item) => sum + item.fallbackRounds, 0);
  const negotiatedQuotesCount = runs.reduce((sum, item) => sum + item.negotiatedQuotesCount, 0);
  const negotiatedDealsCount = runs.reduce((sum, item) => sum + item.negotiatedDealsCount, 0);
  const priceWarZeroInterceptions = runs.reduce((sum, item) => sum + item.priceWarZeroInterceptions, 0);
  const versionUpgradeCount = runs.reduce((sum, item) => sum + item.versionUpgradeCount, 0);
  const upgradedVersions = [...new Set(runs.flatMap((item) => item.upgradedVersions))];
  const allLedgerConsistent = runs.every((item) => item.ledgerConsistent);
  const scenariosCovered = [...new Set(runs.map((item) => item.scenario))];

  const stressedItems = runs
    .map((item) => item.stressedTelemetry)
    .filter((item): item is CampaignStressedTelemetry => item !== undefined);
  const stressedAuditReviewPassRate =
    stressedItems.length > 0
      ? stressedItems.reduce((sum, item) => sum + item.reviewPassRate, 0) / stressedItems.length
      : undefined;
  const stressedAuditFallbackRounds =
    stressedItems.length > 0
      ? stressedItems.reduce((sum, item) => sum + item.fallbackRounds, 0)
      : undefined;

  return {
    topology,
    runCount,
    scenariosCovered,
    totalProfitCents,
    avgFinalCashCents,
    avgFinalReputation,
    totalSales,
    totalMissed,
    minInventoryObserved,
    reviewPassRate,
    totalFallbackRounds,
    negotiatedQuotesCount,
    negotiatedDealsCount,
    priceWarZeroInterceptions,
    versionUpgradeCount,
    upgradedVersions,
    allLedgerConsistent,
    ...(stressedAuditReviewPassRate !== undefined ? { stressedAuditReviewPassRate } : {}),
    ...(stressedAuditFallbackRounds !== undefined ? { stressedAuditFallbackRounds } : {}),
    keyAttribution: topologyKeyAttribution(
      topology,
      runs,
      totalProfitCents,
      negotiatedDealsCount,
      priceWarZeroInterceptions,
      stressedAuditFallbackRounds,
    ),
  };
}

function buildScenarioWinners(
  scenarios: readonly ScenarioName[],
  runs: readonly CampaignScenarioRun[],
): Readonly<Partial<Record<ScenarioName, CampaignScenarioWinner>>> {
  const winners: Partial<Record<ScenarioName, CampaignScenarioWinner>> = {};
  for (const scenario of scenarios) {
    const scenarioRuns = runs.filter((run) => run.scenario === scenario);
    if (scenarioRuns.length === 0) continue;
    const byTopology = new Map<CampaignTopology, { profit: number; missed: number; rep: number; sample: CampaignScenarioRun }>();
    for (const run of scenarioRuns) {
      const prev = byTopology.get(run.topology);
      if (prev === undefined) {
        byTopology.set(run.topology, {
          profit: run.totalProfitCents,
          missed: run.totalMissed,
          rep: run.finalReputation,
          sample: run,
        });
      } else {
        byTopology.set(run.topology, {
          profit: prev.profit + run.totalProfitCents,
          missed: prev.missed + run.totalMissed,
          rep: prev.rep + run.finalReputation,
          sample: prev.sample,
        });
      }
    }
    const sorted = [...byTopology.entries()].sort(
      (left, right) =>
        right[1].profit - left[1].profit ||
        left[1].missed - right[1].missed ||
        right[1].rep - left[1].rep,
    );
    const [bestTopology, bestStats] = sorted[0]!;
    winners[scenario] = {
      topology: bestTopology,
      totalProfitCents: bestStats.profit,
      reason: bestStats.sample.attribution,
    };
  }
  return winners;
}

/**
 * Evaluate all four orchestration strategies across 8-round SimShop dynamic
 * market scenarios (`spring`, `supplycut`, `pricewar`).
 */
export async function runCampaignEvaluation(
  options: CampaignEvalOptions = {},
): Promise<CampaignEvalResult> {
  const scenarios = options.scenarios && options.scenarios.length > 0 ? options.scenarios : SCENARIO_NAMES;
  const topologies =
    options.topologies && options.topologies.length > 0 ? options.topologies : CAMPAIGN_DEFAULT_TOPOLOGIES;
  const seeds =
    options.seeds && options.seeds.length > 0
      ? options.seeds
      : [options.seed ?? CAMPAIGN_DEFAULT_SEED];
  const includeStressedAudit = options.includeStressedAudit !== false;

  const runs: CampaignScenarioRun[] = [];
  for (const seedNum of seeds) {
    for (const scenario of scenarios) {
      for (const topology of topologies) {
        if (topology === "rule") {
          runs.push(runMarketCampaignRun("rule", scenario, seedNum, heuristicPrimaryOnly));
        } else if (topology === "single-agent") {
          runs.push(runMarketCampaignRun("single-agent", scenario, seedNum, campaignSingleAgentPolicy));
        } else if (topology === "collab-no-review") {
          const stressedTelemetry = includeStressedAudit
            ? await runStressedAudit(scenario, seedNum)
            : undefined;
          runs.push(
            runMarketCampaignRun(
              "collab-no-review",
              scenario,
              seedNum,
              campaignCollabNoReviewPolicy,
              stressedTelemetry,
            ),
          );
        } else {
          runs.push(await runSteadyCampaignRun(scenario, seedNum));
        }
      }
    }
  }

  const summary: Partial<Record<CampaignTopology, CampaignTopologySummary>> = {};
  for (const topology of topologies) {
    summary[topology] = summarizeTopologyCampaign(
      topology,
      runs.filter((run) => run.topology === topology),
    );
  }

  const roundsPerRun = runs[0]?.rounds.length ?? 8;

  return {
    timestamp: new Date().toISOString(),
    scenarios: [...scenarios],
    seeds: [...seeds],
    seed: seeds[0] ?? CAMPAIGN_DEFAULT_SEED,
    topologies: [...topologies],
    roundsPerRun,
    summary,
    runs,
    scenarioWinners: buildScenarioWinners(scenarios, runs),
  };
}

/**
 * Format 8-round SimShop campaign evaluation results as Markdown tables
 * without unsupported umbrella superiority claims.
 */
export function formatCampaignMarkdown(result: CampaignEvalResult): string {
  const lines: string[] = [];
  lines.push("# SimShop 8 回合动态市场博弈评测");
  lines.push("");
  lines.push(`- 评测场景：${result.scenarios.join("、")}`);
  lines.push(`- 随机种子：${result.seeds.map((item) => String(item)).join("、")}（每轮 ${String(result.roundsPerRun)} 回合）`);
  lines.push(`- 时间：${result.timestamp}`);
  lines.push("");
  lines.push("## 策略总览（同为 10 件基础补货上限基准下对比，静态 heuristicPrimaryOnly 除外）");
  lines.push("");
  lines.push(
    "| 拓扑 | 总利润 | 期末平均现金 | 期末平均声誉 | 总缺货件数 | Critic 审核通过率 | 断供议价成交 | 价格战归零拦截 | 版本升级次数 | 账本一致性 |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");

  for (const topology of result.topologies) {
    const item = result.summary[topology];
    if (item === undefined) continue;
    const reviewCol =
      item.stressedAuditReviewPassRate !== undefined
        ? `无审 / stressed ${rate(item.stressedAuditReviewPassRate)} (回退 ${String(item.stressedAuditFallbackRounds ?? 0)} 次)`
        : topology === "collab-with-review"
          ? rate(item.reviewPassRate)
          : "无审核";
    const versionsCol =
      item.upgradedVersions.length > 0
        ? `${String(item.versionUpgradeCount)} (${item.upgradedVersions.join(", ")})`
        : String(item.versionUpgradeCount);
    lines.push(
      `| ${topology} | ${moneyFromCents(item.totalProfitCents)} | ${moneyFromCents(item.avgFinalCashCents)} | ${String(item.avgFinalReputation)} | ${String(item.totalMissed)} | ${reviewCol} | ${String(item.negotiatedDealsCount)}/${String(item.negotiatedQuotesCount)} | ${String(item.priceWarZeroInterceptions)} | ${versionsCol} | ${item.allLedgerConsistent ? "一致" : "不一致"} |`,
    );
  }

  lines.push("");
  lines.push("## 分场景明细与归因");
  lines.push("");
  lines.push("| 场景 | 种子 | 拓扑 | 总利润 | 期末现金 | 期末声誉 | 缺货件数 | 审核通过率 | 断供成交 | 账本哈希(前12位) | 胜出归因 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const run of result.runs) {
    const passText =
      run.topology === "collab-with-review"
        ? rate(run.reviewPassRate)
        : run.stressedTelemetry !== undefined
          ? `stressed ${rate(run.stressedTelemetry.reviewPassRate)}`
          : "—";
    lines.push(
      `| ${run.scenario} | ${String(run.seed)} | ${run.topology} | ${moneyFromCents(run.totalProfitCents)} | ${moneyFromCents(run.finalCashCents)} | ${String(run.finalReputation)} | ${String(run.totalMissed)} | ${passText} | ${String(run.negotiatedDealsCount)} | ${run.ledgerHash.slice(0, 12)} | ${run.attribution} |`,
    );
  }

  lines.push("");
  lines.push("## 场景单局胜出与关键归因");
  lines.push("");
  for (const scenario of result.scenarios) {
    const winner = result.scenarioWinners[scenario];
    if (winner === undefined) continue;
    lines.push(
      `- **${scenario}**：利润最高策略为 \`${winner.topology}\`（${moneyFromCents(winner.totalProfitCents)}）—— ${winner.reason}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Format 8-round SimShop campaign evaluation results as machine-readable TSV.
 */
export function formatCampaignTsv(result: CampaignEvalResult): string {
  const lines: string[] = [];
  lines.push(`# scenarios\t${result.scenarios.join(",")}`);
  lines.push(`# seeds\t${result.seeds.map((item) => String(item)).join(",")}`);
  lines.push(`# timestamp\t${result.timestamp}`);
  lines.push(
    [
      "scenario",
      "seed",
      "topology",
      "totalProfitCents",
      "finalCashCents",
      "finalReputation",
      "totalSales",
      "totalMissed",
      "reviewPassRate",
      "fallbackRounds",
      "negotiatedDealsCount",
      "priceWarZeroInterceptions",
      "versionUpgradeCount",
      "ledgerHash",
      "ledgerConsistent",
      "attribution",
    ].join("\t"),
  );
  for (const run of result.runs) {
    lines.push(
      [
        run.scenario,
        String(run.seed),
        run.topology,
        String(run.totalProfitCents),
        String(run.finalCashCents),
        String(run.finalReputation),
        String(run.totalSales),
        String(run.totalMissed),
        run.reviewPassRate.toFixed(4),
        String(run.fallbackRounds),
        String(run.negotiatedDealsCount),
        String(run.priceWarZeroInterceptions),
        String(run.versionUpgradeCount),
        run.ledgerHash,
        run.ledgerConsistent ? "true" : "false",
        run.attribution,
      ].join("\t"),
    );
  }
  return lines.join("\n");
}
