import { parseStoredRun } from "../../../src/templates/agentops/stored-run.js";
import type {
  AgentRun,
  GateDecisionInput,
  LoopAction,
  LoopIteration,
  LoopSnapshot,
  RunEvent,
  RunStatus,
  RunSummary,
} from "../../../src/templates/agentops/types.js";

export type {
  AgentRun,
  GateDecisionInput,
  LoopAction,
  LoopIteration,
  LoopSnapshot,
  RunEvent,
  RunStatus,
  RunSummary,
};

const BASE = "http://127.0.0.1:47321";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = (body as { detail?: string } | null)?.detail;
    throw new Error(detail ?? `请求失败（${String(response.status)}）`);
  }
  return body as T;
}

export type AgentCatalog = {
  readonly agents: AgentRun["agents"];
  readonly tools: readonly { readonly name: string; readonly title: string; readonly kind: string }[];
  readonly workflow: AgentRun["workflow"];
};

export function fetchAgentCatalog(): Promise<AgentCatalog> {
  return request<AgentCatalog>("/api/agentops/catalog");
}

export function prepareMerchantIntake(task: string, signal?: AbortSignal): Promise<import("../../../src/templates/agentops/preflight.js").Preflight> {
  return request("/api/agentops/intake", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task }),
    ...(signal === undefined ? {} : { signal }),
  });
}

export async function fetchAgentRuns(): Promise<readonly RunSummary[]> {
  return (await request<{ runs: readonly RunSummary[] }>("/api/agentops/runs")).runs;
}

export function runAgentTask(
  task: string,
  options?: { readonly autoApprove?: boolean },
): Promise<AgentRun> {
  const payload =
    options?.autoApprove === undefined ? { task } : { task, autoApprove: options.autoApprove };
  return request<AgentRun>("/api/agentops/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function streamAgentTask(
  input: { readonly task: string; readonly autoApprove: boolean },
  onEvent?: (event: RunEvent) => void,
  onSnapshot?: (snapshot: AgentRun) => void,
  signal?: AbortSignal,
): Promise<AgentRun> {
  const response = await fetch(`${BASE}/api/agentops/runs/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify(input),
    ...(signal === undefined ? {} : { signal }),
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = (body as { detail?: string } | null)?.detail;
    throw new Error(detail ?? `流式请求失败（${String(response.status)}）`);
  }

  if (response.body === null) {
    return runAgentTask(input.task, { autoApprove: input.autoApprove });
  }

  const reader = response.body.getReader();
  if (signal?.aborted) {
    await reader.cancel().catch(() => undefined);
    throw new DOMException("流式请求已取消", "AbortError");
  }
  const onAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const decoder = new TextDecoder();
  let buffer = "";
  let doneRun: AgentRun | null = null;

  const processBlock = (block: string): void => {
    const trimmed = block.trim();
    if (trimmed.length === 0) return;
    let eventName = "message";
    const dataLines: string[] = [];
    for (const rawLine of trimmed.split("\n")) {
      const line = rawLine.trim();
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }
    if (dataLines.length === 0) return;
    const rawData = dataLines.join("\n");
    const parsed: unknown = JSON.parse(rawData);
    if (eventName === "event") {
      onEvent?.(parsed as RunEvent);
    } else if (eventName === "snapshot") {
      onSnapshot?.(parsed as AgentRun);
    } else if (eventName === "done") {
      doneRun = parsed as AgentRun;
    } else if (eventName === "error") {
      const detail = (parsed as { detail?: string } | null)?.detail;
      throw new Error(detail ?? "流式执行中断");
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (signal?.aborted) {
        throw new DOMException("流式请求已取消", "AbortError");
      }
      if (done) {
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        processBlock(block);
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  if (signal?.aborted) {
    throw new DOMException("流式请求已取消", "AbortError");
  }

  if (buffer.trim().length > 0) {
    for (const part of buffer.split("\n\n")) {
      processBlock(part);
    }
  }

  if (doneRun === null) {
    throw new Error("未收到完整运行结果");
  }
  return doneRun;
}

export function submitRunDecision(
  id: string,
  decision: GateDecisionInput,
): Promise<AgentRun> {
  return request<AgentRun>(`/api/agentops/runs/${id}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(decision),
  });
}

export async function fetchAgentRun(
  id: string,
  options?: { readonly signal?: AbortSignal },
): Promise<AgentRun> {
  let response: Response;
  try {
    response = await fetch(
      `${BASE}/api/agentops/runs/${id}`,
      options?.signal === undefined ? undefined : { signal: options.signal },
    );
  } catch (err) {
    if (options?.signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      throw new Error("连不上后端服务（请求被中止）");
    }
    throw new Error("连不上后端服务，请检查网络或后端状态");
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new Error("连不上后端服务");
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("无法打开这份卷宗：返回内容不是有效的 JSON");
  }

  if (body === null || typeof body !== "object") {
    throw new Error("无法打开这份卷宗：返回内容为空或格式错误");
  }

  if (!response.ok) {
    const detail = (body as { detail?: string } | null)?.detail;
    if (response.status === 404) {
      throw new Error(detail ?? "找不到这份评审卷宗");
    }
    if (response.status === 422) {
      throw new Error(detail ?? "卷宗文件已损坏");
    }
    throw new Error(detail ?? `无法打开这份卷宗（HTTP ${response.status}）`);
  }

  const parsed = parseStoredRun(body);
  if (!parsed.ok) {
    throw new Error(`无法打开这份卷宗：${parsed.reason}`);
  }
  return parsed.run;
}

export type LlmSettingsView = {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly model: string;
  readonly hasKey: boolean;
  readonly keyHint: string;
  readonly source: "saved" | "env" | "none";
  readonly active: boolean;
  readonly note: string;
};

export type LlmSettingsPatch = {
  readonly enabled?: boolean;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly apiKey?: string;
  readonly clearKey?: boolean;
};

export function fetchLlmSettings(): Promise<LlmSettingsView> {
  return request<LlmSettingsView>("/api/agentops/llm");
}

export function saveLlmSettings(patch: LlmSettingsPatch): Promise<LlmSettingsView> {
  return request<LlmSettingsView>("/api/agentops/llm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function testLlmSettings(): Promise<{ readonly ok: boolean; readonly detail: string }> {
  return request<{ ok: boolean; detail: string }>("/api/agentops/llm/test", { method: "POST" });
}

export const SIMSHOP_SCENARIO_NAMES = ["spring", "supplycut", "pricewar"] as const;
export type SimShopScenarioName = (typeof SIMSHOP_SCENARIO_NAMES)[number];
export type SimShopProfile = "steady" | "stressed";

export const ALL_EVAL_TOPOLOGIES = [
  "rule",
  "single-agent",
  "collab-no-review",
  "collab-with-review",
] as const;
export type EvalTopologyName = (typeof ALL_EVAL_TOPOLOGIES)[number];

export type SimShopSourceProduct = {
  readonly name?: string;
  readonly priceCents?: number;
  readonly buyCents?: number;
  readonly competitorCents?: number;
};

export type SimShopScenarioDetail = {
  readonly name: SimShopScenarioName;
  readonly title: string;
  readonly highlight: string;
  readonly description: string;
  readonly rounds: number;
  readonly primaryCapacity: readonly number[];
  readonly backupCapacity: readonly number[];
  readonly competitorPrice: {
    readonly tea: readonly number[];
    readonly snack: readonly number[];
  };
  readonly suppliers: {
    readonly primary: {
      readonly label: string;
      readonly leadTime: number;
      readonly unitCost: { readonly tea: number; readonly snack: number };
      readonly capacityByRound: readonly number[];
    };
    readonly backup: {
      readonly label: string;
      readonly leadTime: number;
      readonly unitCost: { readonly tea: number; readonly snack: number };
      readonly capacityByRound: readonly number[];
    };
  };
  readonly skus: {
    readonly tea: { readonly label: string; readonly baseDemand: number; readonly refPrice: number };
    readonly snack: { readonly label: string; readonly baseDemand: number; readonly refPrice: number };
  };
  readonly initial: {
    readonly cash: number;
    readonly reputation: number;
    readonly inventory: { readonly tea: number; readonly snack: number };
  };
};

export type SimShopSkuOutcomeRow = {
  readonly price: number;
  readonly demand: number;
  readonly sales: number;
  readonly missed: number;
  readonly ordered: number;
  readonly received: number;
  readonly onHand: number;
  readonly inventory: number;
  readonly revenue: number;
  readonly orderCost: number;
  readonly holding: number;
  readonly supplier: string;
};

export type SimShopOutcomeRow = {
  readonly round: number;
  readonly cash: number;
  readonly revenue: number;
  readonly orderCost: number;
  readonly holding: number;
  readonly adSpend: number;
  readonly missed: number;
  readonly profit: number;
  readonly sales: number;
  readonly reputation: number;
  readonly inventory: { readonly tea: number; readonly snack: number };
  readonly skus: { readonly tea: SimShopSkuOutcomeRow; readonly snack: SimShopSkuOutcomeRow };
};

export type SimShopQuoteView = {
  readonly seq: number;
  readonly runId: string;
  readonly kind: "quote";
  readonly round: number;
  readonly supplier: "primary" | "backup";
  readonly sku: "tea" | "snack";
  readonly quoteRound: number;
  readonly ruling: "accept" | "counter" | "walk";
  readonly offerUnitCost: number;
  readonly unitCost: number;
  readonly qty: number;
  readonly capacity: number;
  readonly leadTime: number;
  readonly talk: string;
  readonly talkAccepted: boolean;
  readonly roundLabel: string;
  readonly supplierLabel: string;
  readonly skuLabel: string;
  readonly rulingLabel: string;
  readonly talkLabel: string;
};

export type SimShopPriceWarView = {
  readonly seq: number;
  readonly runId: string;
  readonly kind: "budget";
  readonly round: number;
  readonly amounts: { readonly ads: number; readonly priceCut: number };
  readonly allocation: { readonly ads: number; readonly priceCut: number };
  readonly cash: number;
  readonly roundLabel: string;
  readonly rationale: string;
};

export type SimShopLoopView = {
  readonly seq: number;
  readonly runId: string;
  readonly kind: "loop";
  readonly round: number;
  readonly iteration: number;
  readonly verdict: "pass" | "revise" | "reject";
  readonly p50: number;
  readonly stopReason: string | null;
  readonly callsUsed: number;
  readonly confidence: number | null;
  readonly decisionHash: string;
  readonly roundLabel: string;
  readonly verdictLabel: string;
  readonly stopReasonLabel: string;
};

export type SimShopVersionUpgradeView = {
  readonly seq: number;
  readonly round: number;
  readonly roundLabel: string;
  readonly agentId: string;
  readonly agentLabel: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly fromPromptHash: string;
  readonly toPromptHash: string;
  readonly reason: string;
};

export type SimShopAgentVersionSnapshot = {
  readonly agentId: string;
  readonly agentLabel: string;
  readonly version: string;
  readonly promptHash: string;
};

export type SimShopNodeTraceItem = {
  readonly seq: number;
  readonly nodeId: string;
  readonly nodeLabel: string;
  readonly event: "scheduled" | "started" | "finished" | "dead-letter";
  readonly reason: string;
  readonly agent?: string;
  readonly version?: string;
  readonly promptHash?: string;
  readonly score?: number;
};

export type SimShopSealedRoundView = {
  readonly round: number;
  readonly roundLabel: string;
  readonly locked: boolean;
  readonly source: string;
  readonly sourceLabel: string;
  readonly hash: string;
  readonly prevHash: string;
  readonly decisionHash: string;
  readonly observationHash: string;
  readonly beliefHash: string;
  readonly overlayHash: string;
  readonly outcome: SimShopOutcomeRow;
};

export type SimShopRoundView = {
  readonly round: number;
  readonly roundLabel: string;
  readonly calls: number;
  readonly plannedCalls: number;
  readonly stopReason: string | null;
  readonly stopReasonLabel: string;
  readonly usedFallback: boolean;
  readonly supplyTriggered: boolean;
  readonly priceWarTriggered: boolean;
  readonly activatedSubflows: readonly string[];
  readonly activatedNodes: readonly SimShopNodeTraceItem[];
  readonly agentVersions: readonly SimShopAgentVersionSnapshot[];
  readonly competitorPrice: { readonly tea: number; readonly snack: number };
  readonly supplierCapacity: { readonly primary: number; readonly backup: number };
  readonly commit: {
    readonly decisionHash: string;
    readonly observationHash: string;
    readonly source: string;
    readonly sourceLabel: string;
    readonly adSpend: number;
    readonly orders: {
      readonly tea: { readonly price: number; readonly qty: number; readonly supplier: string };
      readonly snack: { readonly price: number; readonly qty: number; readonly supplier: string };
    };
  } | null;
  readonly outcome: SimShopOutcomeRow | null;
  readonly reflect: {
    readonly beliefHash: string;
    readonly overlayHash: string;
  } | null;
  readonly ledger: {
    readonly locked: boolean;
    readonly hash: string;
    readonly prevHash: string;
    readonly decisionHash: string;
  } | null;
  readonly loops: readonly SimShopLoopView[];
  readonly quotes: readonly SimShopQuoteView[];
  readonly priceWars: readonly SimShopPriceWarView[];
};

export type SimShopRunMeta = {
  readonly runId: string;
  readonly scenario: SimShopScenarioName;
  readonly seed: number;
  readonly profile: SimShopProfile;
  readonly rounds: number;
  readonly plannedRounds: number;
  readonly llmMode: "mock";
  readonly finalHash: string;
  readonly ledgerHash: string;
  readonly calls: number;
  readonly callRoles: readonly string[];
  readonly minInventory: number;
  readonly priceWars: number;
  readonly quotes: number;
  readonly replayVerified: boolean;
  readonly orchestrationNote: string;
  readonly createdAt: string;
  readonly eventSource: "u5-runShop";
  readonly sourceProduct?: SimShopSourceProduct;
};

export type SimShopRunTotals = {
  readonly totalProfit: number;
  readonly totalRevenue: number;
  readonly totalOrderCost: number;
  readonly totalHolding: number;
  readonly totalAdSpend: number;
  readonly totalSales: number;
  readonly totalMissed: number;
  readonly finalCash: number;
  readonly finalReputation: number;
  readonly minInventory: number;
  readonly totalCalls: number;
  readonly totalQuotes: number;
  readonly acceptedQuotes: number;
  readonly priceWarCount: number;
  readonly versionUpgradeCount: number;
  readonly fallbackRounds: number;
};

export type SimShopRunView = {
  readonly meta: SimShopRunMeta;
  readonly frames: readonly Record<string, unknown>[];
  readonly sourceProduct: SimShopSourceProduct | null;
  readonly sourceContextNote: string | null;
  readonly scenarioInfo: SimShopScenarioDetail;
  readonly ledger: {
    readonly finalHash: string;
    readonly matchesRunHash: boolean;
    readonly ledgerHash: string;
    readonly rounds: readonly SimShopSealedRoundView[];
  };
  readonly rounds: readonly SimShopRoundView[];
  readonly quotes: readonly SimShopQuoteView[];
  readonly priceWars: readonly SimShopPriceWarView[];
  readonly loops: readonly SimShopLoopView[];
  readonly versionUpgrades: readonly SimShopVersionUpgradeView[];
  readonly totals: SimShopRunTotals;
};

export type SimShopCommitConflict = {
  readonly code: "round-locked";
  readonly round: number;
  readonly roundLabel: string;
  readonly storedDecisionHash: string;
  readonly hash: string;
  readonly prevHash: string;
  readonly detail: string;
};

export type CampaignRoundPoint = {
  readonly round: number;
  readonly profitCents: number;
  readonly cumulativeProfitCents: number;
  readonly cashCents: number;
  readonly reputation: number;
  readonly sales: number;
  readonly missed: number;
  readonly revenueCents: number;
  readonly adSpendCents: number;
  readonly usedFallback: boolean;
};

export type CampaignStressedTelemetry = {
  readonly reviewPassRate: number;
  readonly fallbackRounds: number;
  readonly revisionLoops: number;
  readonly calls: number;
  readonly ledgerHash: string;
  readonly auditHash: string;
  readonly ledgerConsistent: boolean;
};

export type CampaignScenarioRun = {
  readonly scenario: SimShopScenarioName;
  readonly seed: number;
  readonly topology: EvalTopologyName;
  readonly mode: "market" | "workflow";
  readonly totalProfitCents: number;
  readonly finalCashCents: number;
  readonly finalReputation: number;
  readonly totalSales: number;
  readonly totalMissed: number;
  readonly minInventory: number;
  readonly totalRevenueCents: number;
  readonly totalAdSpendCents: number;
  readonly reviewPassRate: number;
  readonly fallbackRounds: number;
  readonly negotiatedQuotesCount: number;
  readonly negotiatedDealsCount: number;
  readonly priceWarZeroInterceptions: number;
  readonly versionUpgradeCount: number;
  readonly upgradedVersions: readonly string[];
  readonly calls: number;
  readonly ledgerHash: string;
  readonly auditHash: string | null;
  readonly ledgerConsistent: boolean;
  readonly rounds: readonly CampaignRoundPoint[];
  readonly attribution: string;
  readonly stressedTelemetry?: CampaignStressedTelemetry;
};

export type CampaignTopologySummary = {
  readonly topology: EvalTopologyName;
  readonly runCount: number;
  readonly scenariosCovered: readonly SimShopScenarioName[];
  readonly totalProfitCents: number;
  readonly avgFinalCashCents: number;
  readonly avgFinalReputation: number;
  readonly totalSales: number;
  readonly totalMissed: number;
  readonly minInventoryObserved: number;
  readonly reviewPassRate: number;
  readonly totalFallbackRounds: number;
  readonly negotiatedQuotesCount: number;
  readonly negotiatedDealsCount: number;
  readonly priceWarZeroInterceptions: number;
  readonly versionUpgradeCount: number;
  readonly upgradedVersions: readonly string[];
  readonly allLedgerConsistent: boolean;
  readonly stressedAuditReviewPassRate?: number;
  readonly stressedAuditFallbackRounds?: number;
  readonly keyAttribution: string;
};

export type CampaignScenarioWinner = {
  readonly topology: EvalTopologyName;
  readonly totalProfitCents: number;
  readonly reason: string;
};

export type SimShopCompareRoundMetric = {
  readonly profitCents: number;
  readonly cumulativeProfitCents: number;
  readonly cashCents: number;
  readonly reputation: number;
  readonly sales: number;
  readonly missed: number;
};

export type SimShopCompareScenarioSeries = {
  readonly scenario: SimShopScenarioName;
  readonly title: string;
  readonly winner: CampaignScenarioWinner | null;
  readonly rounds: readonly {
    readonly round: number;
    readonly roundLabel: string;
    readonly byTopology: Readonly<Partial<Record<EvalTopologyName, SimShopCompareRoundMetric>>>;
  }[];
};

export type SimShopCompareResponse = {
  readonly timestamp: string;
  readonly scenarios: readonly SimShopScenarioName[];
  readonly seeds: readonly number[];
  readonly seed: number;
  readonly topologies: readonly EvalTopologyName[];
  readonly roundsPerRun: number;
  readonly summary: Readonly<Partial<Record<EvalTopologyName, CampaignTopologySummary>>>;
  readonly runs: readonly CampaignScenarioRun[];
  readonly scenarioWinners: Readonly<Partial<Record<SimShopScenarioName, CampaignScenarioWinner>>>;
  readonly topologyLabels: Readonly<Record<EvalTopologyName, string>>;
  readonly roundSeries: readonly SimShopCompareScenarioSeries[];
};

export type EvaluationMetrics = {
  readonly totalCases: number;
  readonly missedRiskRate: number;
  readonly groundlessRate: number;
  readonly correctRefusalRate: number;
  readonly p50LatencyMs: number;
  readonly p90LatencyMs: number;
  readonly totalPromptTokens: number;
  readonly totalCompletionTokens: number;
  readonly totalToolCalls: number;
  readonly unmatchedConditions: readonly string[];
};

export type EvalCaseDetail = {
  readonly caseId: string;
  readonly topology: EvalTopologyName;
  readonly pass: boolean;
  readonly outcome: "approve" | "reject" | "clarify" | "incomplete";
  readonly elapsedMs: number;
  readonly tokens: number;
  readonly unmatched: readonly string[];
  readonly collaborationPresent: boolean;
  readonly modelReviewPresent: boolean;
};

export type EvalTopologyPassStat = {
  readonly totalCases: number;
  readonly passedCases: number;
  readonly passRate: number;
};

export type EvalCaseComparisonEntry = {
  readonly caseId: string;
  readonly title: string;
  readonly archetype: string;
  readonly expectedOutcome: "approve" | "reject" | "clarify";
  readonly targetCandidateId: string | null;
  readonly results: Readonly<Partial<Record<EvalTopologyName, Omit<EvalCaseDetail, "caseId" | "topology">>>>;
  readonly attribution: string;
};

export type AgentOpsEvalResponse = {
  readonly timestamp: string;
  readonly datasetHash: string;
  readonly budgetCeiling: {
    readonly maxTokens: number;
    readonly maxToolCalls: number;
    readonly timeoutMs: number;
  };
  readonly summary: Readonly<Partial<Record<EvalTopologyName, EvaluationMetrics>>>;
  readonly caseDetails: readonly EvalCaseDetail[];
  readonly topologyStats: Readonly<Partial<Record<EvalTopologyName, EvalTopologyPassStat>>>;
  readonly caseComparisons: readonly EvalCaseComparisonEntry[];
  readonly campaignEvaluation?: SimShopCompareResponse;
};

export async function fetchSimShopScenarios(): Promise<readonly SimShopScenarioDetail[]> {
  return (await request<{ scenarios: readonly SimShopScenarioDetail[] }>("/api/simshop/scenarios"))
    .scenarios;
}

export async function fetchSimShopRuns(): Promise<readonly SimShopRunMeta[]> {
  return (await request<{ runs: readonly SimShopRunMeta[] }>("/api/simshop/runs")).runs;
}

export function createSimShopRun(input: {
  readonly scenario: SimShopScenarioName;
  readonly seed?: number;
  readonly profile?: SimShopProfile;
  readonly sourceProduct?: SimShopSourceProduct;
}): Promise<SimShopRunView> {
  const payload: Record<string, unknown> = { scenario: input.scenario };
  if (input.seed !== undefined) payload.seed = input.seed;
  if (input.profile !== undefined) payload.profile = input.profile;
  if (input.sourceProduct !== undefined) payload.sourceProduct = input.sourceProduct;
  return request<SimShopRunView>("/api/simshop/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function fetchSimShopRun(runId: string): Promise<SimShopRunView> {
  return request<SimShopRunView>(`/api/simshop/runs/${encodeURIComponent(runId)}`);
}

export async function attemptSimShopRoundCommit(
  runId: string,
  round: number,
  body: Record<string, unknown> = { price: 9999, tamperAttempt: true },
): Promise<
  | { readonly locked: true; readonly status: 409; readonly conflict: SimShopCommitConflict }
  | { readonly locked: false; readonly status: number; readonly detail: string }
> {
  const response = await fetch(
    `${BASE}/api/simshop/runs/${encodeURIComponent(runId)}/rounds/${String(round)}/commit`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const parsed: unknown = await response.json().catch(() => null);
  if (response.status === 409 && parsed !== null && typeof parsed === "object") {
    const conflict = parsed as SimShopCommitConflict;
    if (conflict.code === "round-locked") {
      return { locked: true, status: 409, conflict };
    }
  }
  const detail = (parsed as { detail?: string } | null)?.detail ?? `请求返回状态 ${String(response.status)}`;
  return { locked: false, status: response.status, detail };
}

export function compareSimShopCampaign(input?: {
  readonly scenario?: SimShopScenarioName;
  readonly scenarios?: readonly SimShopScenarioName[];
  readonly seed?: number;
  readonly includeStressedAudit?: boolean;
}): Promise<SimShopCompareResponse> {
  const payload: Record<string, unknown> = {};
  if (input?.scenario !== undefined) payload.scenario = input.scenario;
  if (input?.scenarios !== undefined) payload.scenarios = input.scenarios;
  if (input?.seed !== undefined) payload.seed = input.seed;
  if (input?.includeStressedAudit !== undefined) payload.includeStressedAudit = input.includeStressedAudit;
  return request<SimShopCompareResponse>("/api/simshop/compare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function runAgentOpsEval(input?: {
  readonly topologies?: readonly EvalTopologyName[];
  readonly limit?: number;
  readonly includeCampaign?: boolean;
  readonly campaignScenario?: SimShopScenarioName;
  readonly campaignSeed?: number;
}): Promise<AgentOpsEvalResponse> {
  const payload: Record<string, unknown> = {};
  if (input?.topologies !== undefined) payload.topologies = input.topologies;
  if (input?.limit !== undefined) payload.limit = input.limit;
  if (input?.includeCampaign !== undefined) payload.includeCampaign = input.includeCampaign;
  if (input?.campaignScenario !== undefined) payload.campaignScenario = input.campaignScenario;
  if (input?.campaignSeed !== undefined) payload.campaignSeed = input.campaignSeed;
  return request<AgentOpsEvalResponse>("/api/agentops/eval", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
