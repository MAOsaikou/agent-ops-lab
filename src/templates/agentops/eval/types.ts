import type { CandidateId } from "../../pricing/model.js";
import type { ScenarioName } from "../../simshop/market/scenario.js";

export const ALL_TOPOLOGIES = [
  "rule",
  "single-agent",
  "collab-with-review",
  "collab-no-review",
] as const;

export type TopologyName = (typeof ALL_TOPOLOGIES)[number];
export type CampaignTopology = TopologyName;

export const BENCHMARK_ARCHETYPES = [
  "standard",
  "missing_facts",
  "conflict_evidence",
  "cash_constraint",
  "failure_recovery",
  "should_reject",
] as const;

export type BenchmarkArchetype = (typeof BENCHMARK_ARCHETYPES)[number];

export type CaseExpectations = {
  readonly expectedOutcome: "approve" | "reject" | "clarify";
  readonly targetCandidateId?: CandidateId | undefined;
  readonly knownRiskIds: readonly string[];
  readonly mustClarifyFields?: readonly string[] | undefined;
  readonly forbiddenClaims?: readonly string[] | undefined;
};

export type BenchmarkCase = {
  readonly id: string;
  readonly title: string;
  readonly archetype: BenchmarkArchetype;
  readonly taskText: string;
  readonly constructed: true;
  readonly note: string;
  readonly expectations: CaseExpectations;
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
  readonly scenario: ScenarioName;
  readonly seed: number;
  readonly topology: CampaignTopology;
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
  readonly stressedTelemetry?: CampaignStressedTelemetry | undefined;
};

export type CampaignTopologySummary = {
  readonly topology: CampaignTopology;
  readonly runCount: number;
  readonly scenariosCovered: readonly ScenarioName[];
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
  readonly stressedAuditReviewPassRate?: number | undefined;
  readonly stressedAuditFallbackRounds?: number | undefined;
  readonly keyAttribution: string;
};

export type CampaignEvalOptions = {
  readonly scenarios?: readonly ScenarioName[] | undefined;
  readonly topologies?: readonly CampaignTopology[] | undefined;
  readonly seed?: number | undefined;
  readonly seeds?: readonly number[] | undefined;
  readonly includeStressedAudit?: boolean | undefined;
};

export type CampaignScenarioWinner = {
  readonly topology: CampaignTopology;
  readonly totalProfitCents: number;
  readonly reason: string;
};

export type CampaignEvalResult = {
  readonly timestamp: string;
  readonly scenarios: readonly ScenarioName[];
  readonly seeds: readonly number[];
  readonly seed: number;
  readonly topologies: readonly CampaignTopology[];
  readonly roundsPerRun: number;
  readonly summary: Readonly<Partial<Record<CampaignTopology, CampaignTopologySummary>>>;
  readonly runs: readonly CampaignScenarioRun[];
  readonly scenarioWinners: Readonly<Partial<Record<ScenarioName, CampaignScenarioWinner>>>;
};
