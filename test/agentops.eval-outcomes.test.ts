import { describe, expect, test } from "vitest";

import { BENCHMARK_CASES, BENCHMARK_DATASET_HASH } from "../src/templates/agentops/eval/dataset.js";
import { runEvaluationSuite } from "../src/templates/agentops/eval/harness.js";
import { runAgentWorkflow } from "../src/templates/agentops/runner.js";

describe("Task 5c: honest eval outcomes with strictEvidence (dataset frozen)", () => {
  test("dataset hash stays the frozen literal", () => {
    expect(BENCHMARK_DATASET_HASH).toBe(
      "2a2710aadef149fc2fa050c49088a5ec996a28223415b13e64498550d10ab892",
    );
  });

  test("without the flag, a structurally unprofitable case still follows the v1 complete path", async () => {
    const inversion = BENCHMARK_CASES.find((item) => item.id === "conflict-price-inversion");
    if (inversion === undefined) throw new Error("missing inversion case");
    const run = await runAgentWorkflow(
      {
        id: "v1-inversion",
        taskText: inversion.taskText,
        autoApprove: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      null,
      undefined,
      { collaboration: false },
    );
    expect(run.status).toBe("completed");
    expect(run.gateDecision).toBeNull();
    expect(run.artifacts.product).not.toBeNull();
    expect(run.artifacts.chosenId).not.toBeNull();
  });

  test("rule and collab-no-review close the frozen outcome gaps, with the same decisions", async () => {
    const result = await runEvaluationSuite({ topologies: ["rule", "collab-no-review"] });
    expect(result.datasetHash).toBe(BENCHMARK_DATASET_HASH);
    expect(result.caseDetails).toHaveLength(24);

    const byKey = new Map(result.caseDetails.map((row) => [`${row.topology}:${row.caseId}`, row]));
    const expected = new Map(BENCHMARK_CASES.map((item) => [item.id, item.expectations.expectedOutcome]));

    for (const topology of ["rule", "collab-no-review"] as const) {
      const metrics = result.summary[topology];
      expect(metrics?.totalCases).toBe(12);
      expect(metrics?.missedRiskRate).toBe(0);
      expect(metrics?.groundlessRate).toBe(0);
      expect(metrics?.correctRefusalRate).toBe(1);
      for (const item of BENCHMARK_CASES) {
        const row = byKey.get(`${topology}:${item.id}`);
        expect(row, `${topology} ${item.id} missing`).toBeDefined();
        expect(row?.outcome, `${topology} ${item.id}`).toBe(expected.get(item.id));
        const unmatched = row?.unmatched ?? [];
        const onlyCandidateGap = unmatched.length > 0 && unmatched.every((itemText) => itemText.includes("推荐候选"));
        if (item.expectations.targetCandidateId !== undefined && onlyCandidateGap) {
          expect(row?.pass, `${topology} ${item.id}: ${unmatched.join("; ")}`).toBe(false);
        } else {
          expect(row?.pass, `${topology} ${item.id}: ${unmatched.join("; ")}`).toBe(true);
        }
      }
    }

    for (const item of BENCHMARK_CASES) {
      const rule = byKey.get(`rule:${item.id}`);
      const collab = byKey.get(`collab-no-review:${item.id}`);
      expect(collab?.outcome).toBe(rule?.outcome);
    }
  });

  test("does not treat a single topology as overall collaboration advantage", async () => {
    const result = await runEvaluationSuite({ topologies: ["rule", "collab-no-review"] });
    const markdown = (await import("../src/templates/agentops/eval/harness.js")).formatEvalMarkdown(result);
    expect(markdown).not.toMatch(/总体优势|协作优于|显著优于|一等奖/);
  });
});
