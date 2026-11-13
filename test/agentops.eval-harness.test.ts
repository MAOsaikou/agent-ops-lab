import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import {
  ALL_TOPOLOGIES,
  BUDGET_CEILING,
  formatEvalMarkdown,
  formatEvalTsv,
  runEvaluationSuite,
  scoreCase,
  topologyConfig,
  type EvalSuiteResult,
  type TopologyName,
} from "../src/templates/agentops/eval/harness.js";
import {
  BENCHMARK_CASES,
  BENCHMARK_DATASET_HASH,
  validateBenchmarkDataset,
} from "../src/templates/agentops/eval/dataset.js";
import type { CaseExpectations } from "../src/templates/agentops/eval/types.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const METRIC_KEYS = [
  "totalCases",
  "missedRiskRate",
  "groundlessRate",
  "correctRefusalRate",
  "p50LatencyMs",
  "p90LatencyMs",
  "totalPromptTokens",
  "totalCompletionTokens",
  "totalToolCalls",
  "unmatchedConditions",
] as const;

const RATE_KEYS = ["missedRiskRate", "groundlessRate", "correctRefusalRate"] as const;

function assertMetricShape(
  metrics: NonNullable<EvalSuiteResult["summary"][TopologyName]>,
  totalCases: number,
): void {
  for (const key of METRIC_KEYS) {
    expect(metrics).toHaveProperty(key);
  }
  expect(metrics.totalCases).toBe(totalCases);
  for (const key of RATE_KEYS) {
    expect(metrics[key]).toBeGreaterThanOrEqual(0);
    expect(metrics[key]).toBeLessThanOrEqual(1);
  }
  expect(Number.isFinite(metrics.p50LatencyMs)).toBe(true);
  expect(Number.isFinite(metrics.p90LatencyMs)).toBe(true);
  expect(metrics.totalPromptTokens).toBeGreaterThanOrEqual(0);
  expect(metrics.totalCompletionTokens).toBeGreaterThanOrEqual(0);
  expect(metrics.totalToolCalls).toBeGreaterThanOrEqual(0);
  expect(Array.isArray(metrics.unmatchedConditions)).toBe(true);
}

describe("Task 5: Multi-Topology Evaluation Harness & pnpm exp", () => {
  test("exposes exactly four topologies and a shared budget ceiling", () => {
    expect(ALL_TOPOLOGIES).toEqual([
      "rule",
      "single-agent",
      "collab-with-review",
      "collab-no-review",
    ]);
    expect(BUDGET_CEILING).toEqual({ maxTokens: 16000, maxToolCalls: 24, timeoutMs: 60_000 });
  });

  test("maps each topology to runner options without touching the default collaboration:false path", () => {
    expect(topologyConfig("rule")).toEqual({
      collaboration: false,
      modelReview: false,
      useLive: false,
      singleAgent: false,
      economicLoop: true,
    });
    expect(topologyConfig("single-agent")).toEqual({
      collaboration: false,
      modelReview: false,
      useLive: true,
      singleAgent: true,
      economicLoop: true,
    });
    expect(topologyConfig("collab-no-review")).toEqual({
      collaboration: true,
      modelReview: false,
      useLive: true,
      singleAgent: false,
      economicLoop: false,
    });
    expect(topologyConfig("collab-with-review")).toEqual({
      collaboration: true,
      modelReview: true,
      useLive: true,
      singleAgent: false,
      economicLoop: true,
    });
  });

  test("scoreCase records missed risks and forbidden claims without a quality cap", () => {
    const conflictApprove: CaseExpectations = {
      expectedOutcome: "approve",
      knownRiskIds: ["cashflow", "market-demand-doubt"],
      forbiddenClaims: ["可轻松实现2000单"],
    };

    const missed = scoreCase(conflictApprove, {
      outcome: "approve",
      detectedRiskIds: ["cashflow"],
      claimTexts: ["周转金偏紧"],
      chosenId: "profit",
      clarifiedFields: [],
    });
    expect(missed.missedRisks).toBe(1);
    expect(missed.groundlessClaims).toBe(0);
    expect(missed.refusalEligible).toBe(false);
    expect(missed.pass).toBe(false);
    expect(missed.unmatched.some((item) => item.includes("market-demand-doubt"))).toBe(true);

    const clean = scoreCase(conflictApprove, {
      outcome: "approve",
      detectedRiskIds: ["cashflow", "market-demand-doubt"],
      claimTexts: ["周转金偏紧，需压低备货"],
      chosenId: "profit",
      clarifiedFields: [],
    });
    expect(clean.missedRisks).toBe(0);
    expect(clean.groundlessClaims).toBe(0);
    expect(clean.pass).toBe(true);
    expect(clean.unmatched).toEqual([]);

    const groundless = scoreCase(conflictApprove, {
      outcome: "approve",
      detectedRiskIds: ["cashflow", "market-demand-doubt"],
      claimTexts: ["可轻松实现2000单"],
      chosenId: "profit",
      clarifiedFields: [],
    });
    expect(groundless.groundlessClaims).toBe(1);
    expect(groundless.pass).toBe(false);
    expect(groundless.unmatched.some((item) => item.includes("可轻松实现2000单"))).toBe(true);
  });

  test("scoreCase treats clarify/reject as refusal checks and never reads a target rate", () => {
    const clarify: CaseExpectations = {
      expectedOutcome: "clarify",
      knownRiskIds: ["missing-cost-facts"],
      mustClarifyFields: ["buy", "shipping"],
    };

    const wrong = scoreCase(clarify, {
      outcome: "approve",
      detectedRiskIds: [],
      claimTexts: [],
      chosenId: "profit",
      clarifiedFields: [],
    });
    expect(wrong.refusalEligible).toBe(true);
    expect(wrong.refusalCorrect).toBe(false);
    expect(wrong.missedRisks).toBe(1);
    expect(wrong.pass).toBe(false);
    expect(wrong.unmatched.some((item) => item.includes("clarify"))).toBe(true);
    expect(wrong.unmatched.some((item) => item.includes("missing-cost-facts"))).toBe(true);

    const right = scoreCase(clarify, {
      outcome: "clarify",
      detectedRiskIds: ["missing-cost-facts"],
      claimTexts: [],
      chosenId: null,
      clarifiedFields: ["buy", "shipping"],
    });
    expect(right.refusalEligible).toBe(true);
    expect(right.refusalCorrect).toBe(true);
    expect(right.missedRisks).toBe(0);
    expect(right.pass).toBe(true);

    const rejectExp: CaseExpectations = {
      expectedOutcome: "reject",
      knownRiskIds: ["margin"],
    };
    const rejected = scoreCase(rejectExp, {
      outcome: "reject",
      detectedRiskIds: ["margin"],
      claimTexts: [],
      chosenId: null,
      clarifiedFields: [],
    });
    expect(rejected.refusalEligible).toBe(true);
    expect(rejected.refusalCorrect).toBe(true);
    expect(rejected.pass).toBe(true);
  });

  test("reports the frozen full-dataset hash and the same budget for every topology", async () => {
    const cases = BENCHMARK_CASES.slice(0, 2);
    const result = await runEvaluationSuite({
      topologies: ["rule", "collab-no-review"],
      cases,
    });

    expect(result.datasetHash).toBe(BENCHMARK_DATASET_HASH);
    expect(result.datasetHash).toBe("2a2710aadef149fc2fa050c49088a5ec996a28223415b13e64498550d10ab892");
    expect(validateBenchmarkDataset().valid).toBe(true);
    expect(result.budgetCeiling).toEqual(BUDGET_CEILING);
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);

    expect(result.summary.rule).toBeDefined();
    expect(result.summary["collab-no-review"]).toBeDefined();
    assertMetricShape(result.summary.rule!, 2);
    assertMetricShape(result.summary["collab-no-review"]!, 2);

    const ruleIds = result.caseDetails.filter((row) => row.topology === "rule").map((row) => row.caseId);
    const collabIds = result.caseDetails
      .filter((row) => row.topology === "collab-no-review")
      .map((row) => row.caseId);
    expect(ruleIds).toEqual(cases.map((item) => item.id));
    expect(collabIds).toEqual(cases.map((item) => item.id));
    expect(result.caseDetails).toHaveLength(4);
  });

  test("metrics stay in range and are not gated on collaboration beating rules", async () => {
    const result = await runEvaluationSuite({
      topologies: ["rule", "collab-no-review"],
      cases: [BENCHMARK_CASES[0]!],
    });
    assertMetricShape(result.summary.rule!, 1);
    assertMetricShape(result.summary["collab-no-review"]!, 1);
    expect(result.summary.rule!.totalToolCalls).toBeGreaterThan(0);
    expect(result.summary["collab-no-review"]!.totalToolCalls).toBeGreaterThan(0);
    expect(result.summary.rule!.p50LatencyMs).toBe(result.summary.rule!.p90LatencyMs);
  });

  test("rule and single-agent runs have no collaboration artifact; collab-no-review does", async () => {
    const result = await runEvaluationSuite({
      topologies: ["rule", "single-agent", "collab-no-review", "collab-with-review"],
      cases: [BENCHMARK_CASES[0]!],
    });
    const row = (topology: TopologyName) => {
      const found = result.caseDetails.find((item) => item.topology === topology);
      expect(found).toBeDefined();
      return found!;
    };
    expect(row("rule").collaborationPresent).toBe(false);
    expect(row("single-agent").collaborationPresent).toBe(false);
    expect(row("collab-no-review").collaborationPresent).toBe(true);
    expect(row("collab-with-review").collaborationPresent).toBe(true);
    expect(row("rule").modelReviewPresent).toBe(false);
    expect(row("single-agent").modelReviewPresent).toBe(false);
    expect(row("collab-no-review").modelReviewPresent).toBe(false);
    expect(row("collab-with-review").modelReviewPresent).toBe(false);
  });

  test("a standard completed recommendation is approve, not clarify, despite demo-assumption prose", async () => {
    const standard = BENCHMARK_CASES.find((item) => item.id === "std-apparel-pdd");
    expect(standard).toBeDefined();
    const result = await runEvaluationSuite({
      topologies: ["rule"],
      cases: [standard!],
    });
    const row = result.caseDetails[0]!;
    expect(row.outcome).toBe("approve");
    expect(result.summary.rule!.correctRefusalRate).toBe(1);
    expect(result.summary.rule!.missedRiskRate).toBe(0);
    expect(result.summary.rule!.groundlessRate).toBe(0);
    // Dataset expects profit; the current rule path may recommend match. Score the gap honestly.
    if (row.unmatched.length === 0) {
      expect(row.pass).toBe(true);
    } else {
      expect(row.pass).toBe(false);
      expect(row.unmatched.every((item) => item.includes("推荐候选"))).toBe(true);
    }
  });

  test("does not mutate the frozen dataset", async () => {
    const before = JSON.stringify(BENCHMARK_CASES);
    await runEvaluationSuite({
      topologies: ["rule"],
      cases: BENCHMARK_CASES.slice(0, 1),
    });
    expect(JSON.stringify(BENCHMARK_CASES)).toBe(before);
    expect(validateBenchmarkDataset().valid).toBe(true);
    expect(validateBenchmarkDataset().hash).toBe(BENCHMARK_DATASET_HASH);
  });

  test("defaults to all 12 frozen cases when cases are omitted", async () => {
    const result = await runEvaluationSuite({ topologies: ["rule"] });
    expect(result.summary.rule?.totalCases).toBe(12);
    expect(result.caseDetails).toHaveLength(12);
    expect(result.caseDetails.map((row) => row.caseId)).toEqual(BENCHMARK_CASES.map((item) => item.id));
    expect(result.datasetHash).toBe(BENCHMARK_DATASET_HASH);
    assertMetricShape(result.summary.rule!, 12);
  });

  test("formatEvalMarkdown and formatEvalTsv print the frozen hash and do not claim overall advantage", () => {
    const result: EvalSuiteResult = {
      timestamp: "2026-11-12T00:00:00.000Z",
      datasetHash: BENCHMARK_DATASET_HASH,
      budgetCeiling: BUDGET_CEILING,
      summary: {
        rule: {
          totalCases: 2,
          missedRiskRate: 0.5,
          groundlessRate: 0,
          correctRefusalRate: 1,
          p50LatencyMs: 10,
          p90LatencyMs: 12,
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          totalToolCalls: 8,
          unmatchedConditions: ["[std-x] 漏检风险项: cashflow"],
        },
        "collab-no-review": {
          totalCases: 2,
          missedRiskRate: 0.5,
          groundlessRate: 0,
          correctRefusalRate: 1,
          p50LatencyMs: 14,
          p90LatencyMs: 16,
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          totalToolCalls: 12,
          unmatchedConditions: ["[std-x] 漏检风险项: cashflow"],
        },
      },
      caseDetails: [
        {
          caseId: "std-x",
          topology: "rule",
          pass: false,
          outcome: "approve",
          elapsedMs: 10,
          tokens: 0,
          unmatched: ["漏检风险项: cashflow"],
          collaborationPresent: false,
          modelReviewPresent: false,
        },
        {
          caseId: "std-x",
          topology: "collab-no-review",
          pass: false,
          outcome: "approve",
          elapsedMs: 14,
          tokens: 0,
          unmatched: ["漏检风险项: cashflow"],
          collaborationPresent: true,
          modelReviewPresent: false,
        },
      ],
    };

    const markdown = formatEvalMarkdown(result);
    const tsv = formatEvalTsv(result);
    expect(markdown).toContain(BENCHMARK_DATASET_HASH);
    expect(markdown).toContain("rule");
    expect(markdown).toContain("collab-no-review");
    expect(markdown).toContain("50.0%");
    expect(markdown).toContain("漏检风险项: cashflow");
    expect(markdown).not.toMatch(/总体优势|协作优于|显著优于|一等奖/);
    expect(tsv).toContain(BENCHMARK_DATASET_HASH);
    expect(tsv).toContain("std-x");
    expect(tsv).toContain("rule");
    expect(tsv).toContain("collab-no-review");
    expect(tsv).not.toMatch(/总体优势|协作优于|显著优于|一等奖/);
  });

  test("scoreCase checks targetCandidateId and mustClarifyFields", () => {
    const withTarget: CaseExpectations = {
      expectedOutcome: "approve",
      targetCandidateId: "profit",
      knownRiskIds: [],
    };
    const missedCandidate = scoreCase(withTarget, {
      outcome: "approve",
      detectedRiskIds: [],
      claimTexts: [],
      chosenId: "match",
      clarifiedFields: [],
    });
    expect(missedCandidate.pass).toBe(false);
    expect(missedCandidate.unmatched.some((item) => item.includes("match") && item.includes("profit"))).toBe(true);

    const hit = scoreCase(withTarget, {
      outcome: "approve",
      detectedRiskIds: [],
      claimTexts: [],
      chosenId: "profit",
      clarifiedFields: [],
    });
    expect(hit.pass).toBe(true);

    const clarify: CaseExpectations = {
      expectedOutcome: "clarify",
      knownRiskIds: [],
      mustClarifyFields: ["buy", "shipping"],
    };
    const missingField = scoreCase(clarify, {
      outcome: "clarify",
      detectedRiskIds: [],
      claimTexts: [],
      chosenId: null,
      clarifiedFields: ["buy"],
    });
    expect(missingField.pass).toBe(false);
    expect(missingField.unmatched.some((item) => item.includes("shipping"))).toBe(true);
  });

  test("package.json wires pnpm exp to scripts/exp.ts, which reports the frozen hash", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: { exp: string };
    };
    expect(pkg.scripts.exp).toBe("tsx scripts/exp.ts");
    const source = readFileSync(join(REPO_ROOT, "scripts/exp.ts"), "utf8");
    expect(source).toContain("runEvaluationSuite");
    expect(source).toContain("formatEvalMarkdown");
    expect(source).toContain("formatEvalTsv");
    expect(source).toContain("BENCHMARK_DATASET_HASH");
    expect(source).toContain("ALL_TOPOLOGIES");
    expect(source).not.toMatch(/总体优势|协作优于|显著优于|一等奖/);
    expect(source).not.toContain("not-implemented");
  });
});
