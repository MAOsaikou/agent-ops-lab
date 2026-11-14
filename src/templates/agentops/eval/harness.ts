import { defaultProductOrchestrator } from "../orchestrator.js";
import { BENCHMARK_CASES, BENCHMARK_DATASET_HASH } from "./dataset.js";
import type { BenchmarkCase, CaseExpectations, EvaluationMetrics } from "./types.js";
import type { LiveLlm } from "../llm.js";
import type { AgentRun } from "../types.js";

export const ALL_TOPOLOGIES = [
  "rule",
  "single-agent",
  "collab-with-review",
  "collab-no-review",
] as const;

export type TopologyName = (typeof ALL_TOPOLOGIES)[number];

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
    "| 拓扑 | 案例数 | 漏检率 | 无依据结论率 | 正确拒答率 | p50(ms) | p90(ms) | prompt tokens | completion tokens | 工具调用 |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const topology of ALL_TOPOLOGIES) {
    const metrics = result.summary[topology];
    if (metrics === undefined) continue;
    lines.push(
      `| ${topology} | ${String(metrics.totalCases)} | ${rate(metrics.missedRiskRate)} | ${rate(metrics.groundlessRate)} | ${rate(metrics.correctRefusalRate)} | ${String(metrics.p50LatencyMs)} | ${String(metrics.p90LatencyMs)} | ${String(metrics.totalPromptTokens)} | ${String(metrics.totalCompletionTokens)} | ${String(metrics.totalToolCalls)} |`,
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
