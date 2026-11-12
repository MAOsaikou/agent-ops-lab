import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { memoryAgentRunStore } from "../src/server/agent-runs.js";
import { openLlmSettingsStore } from "../src/server/llm-settings.js";
import { openPlanStore } from "../src/server/plans.js";
import { createPricingApp } from "../src/server/pricing-app.js";
import { BENCHMARK_CASES } from "../src/templates/agentops/eval/dataset.js";
import { BUDGET_CEILING } from "../src/templates/agentops/eval/harness.js";

const FROZEN_DATASET_HASH = "2a2710aadef149fc2fa050c49088a5ec996a28223415b13e64498550d10ab892";

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

function setup(): {
  readonly app: ReturnType<typeof createPricingApp>;
  readonly agentRuns: ReturnType<typeof memoryAgentRunStore>;
} {
  const dir = mkdtempSync(path.join(tmpdir(), "pricing-eval-"));
  const agentRuns = memoryAgentRunStore();
  const app = createPricingApp({
    store: openPlanStore(path.join(dir, "plans")),
    agentRuns,
    llmSettings: openLlmSettingsStore(null, {}),
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  });
  return { app, agentRuns };
}

function assertMetricShape(metrics: Record<string, unknown>, totalCases: number): void {
  for (const key of METRIC_KEYS) {
    expect(metrics).toHaveProperty(key);
  }
  expect(metrics.totalCases).toBe(totalCases);
  for (const key of RATE_KEYS) {
    const value = metrics[key];
    expect(typeof value).toBe("number");
    expect(value as number).toBeGreaterThanOrEqual(0);
    expect(value as number).toBeLessThanOrEqual(1);
  }
  expect(Number.isFinite(metrics.p50LatencyMs)).toBe(true);
  expect(Number.isFinite(metrics.p90LatencyMs)).toBe(true);
  expect(metrics.totalPromptTokens).toBeGreaterThanOrEqual(0);
  expect(metrics.totalCompletionTokens).toBeGreaterThanOrEqual(0);
  expect(metrics.totalToolCalls).toBeGreaterThanOrEqual(0);
  expect(Array.isArray(metrics.unmatchedConditions)).toBe(true);
}

describe("POST /api/agentops/eval", () => {
  test("returns structured benchmark results for a rule subset", async () => {
    const { app, agentRuns } = setup();
    const started = Date.now();
    const response = await app.request("/api/agentops/eval", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topologies: ["rule"], limit: 2 }),
    });
    const elapsedMs = Date.now() - started;

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      datasetHash: string;
      budgetCeiling: unknown;
      summary: { rule?: Record<string, unknown> };
      caseDetails: readonly { caseId: string; topology: string }[];
    };

    expect(body.datasetHash).toBe(FROZEN_DATASET_HASH);
    expect(body.budgetCeiling).toEqual(BUDGET_CEILING);
    expect(body.summary.rule).toBeDefined();
    assertMetricShape(body.summary.rule!, 2);
    expect(body.caseDetails).toHaveLength(2);
    expect(body.caseDetails.map((item) => item.caseId)).toEqual(
      BENCHMARK_CASES.slice(0, 2).map((item) => item.id),
    );
    expect(body.caseDetails.every((item) => item.topology === "rule")).toBe(true);
    expect(Object.keys(body.summary)).toEqual(["rule"]);
    expect(agentRuns.list()).toEqual([]);
    expect(elapsedMs).toBeLessThan(5_000);
  });

  test("defaults to the offline rule topology and does not invent a collab advantage field", async () => {
    const { app } = setup();
    const response = await app.request("/api/agentops/eval", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 1 }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    const summary = body.summary as Record<string, unknown>;
    expect(Object.keys(summary)).toEqual(["rule"]);
    expect(body).not.toHaveProperty("winner");
    expect(body).not.toHaveProperty("collabAdvantage");
    expect(summary.rule).not.toHaveProperty("betterThan");
  });

  test("rejects unknown topologies and out-of-range limits", async () => {
    const { app } = setup();
    const badTopology = await app.request("/api/agentops/eval", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topologies: ["rule", "winner"] }),
    });
    expect(badTopology.status).toBe(400);

    const badLimit = await app.request("/api/agentops/eval", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topologies: ["rule"], limit: 0 }),
    });
    expect(badLimit.status).toBe(400);

    const overLimit = await app.request("/api/agentops/eval", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topologies: ["rule"], limit: 13 }),
    });
    expect(overLimit.status).toBe(400);
  });
});
