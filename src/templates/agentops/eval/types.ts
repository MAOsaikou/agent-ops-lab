import type { CandidateId } from "../../pricing/model.js";

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
