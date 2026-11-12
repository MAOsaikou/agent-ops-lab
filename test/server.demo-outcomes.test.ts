import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { memoryAgentRunStore } from "../src/server/agent-runs.js";
import { openLlmSettingsStore } from "../src/server/llm-settings.js";
import { openPlanStore } from "../src/server/plans.js";
import { createPricingApp } from "../src/server/pricing-app.js";
import { BENCHMARK_CASES } from "../src/templates/agentops/eval/dataset.js";
import type { AgentRun } from "../src/templates/agentops/types.js";

function caseText(id: string): string {
  const found = BENCHMARK_CASES.find((item) => item.id === id);
  if (found === undefined) throw new Error(`missing case ${id}`);
  return found.taskText;
}

function setup(): ReturnType<typeof createPricingApp> {
  const dir = mkdtempSync(path.join(tmpdir(), "demo-outcomes-"));
  return createPricingApp({
    store: openPlanStore(path.join(dir, "plans")),
    agentRuns: memoryAgentRunStore(),
    llmSettings: openLlmSettingsStore(null, {}),
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  });
}

async function postRun(
  app: ReturnType<typeof createPricingApp>,
  task: string,
  options: { readonly autoApprove?: boolean; readonly id?: string } = {},
): Promise<AgentRun> {
  const body: Record<string, unknown> = { task, autoApprove: options.autoApprove ?? true };
  if (options.id !== undefined) body.id = options.id;
  const response = await app.request("/api/agentops/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as AgentRun;
}

function outcome(run: AgentRun): "approve" | "reject" | "clarify" {
  if (run.status === "rejected" || run.gateDecision === "reject") return "reject";
  if (run.artifacts.product === null && run.artifacts.chosenId === null) return "clarify";
  return "approve";
}

function questionIds(run: AgentRun): readonly string[] {
  return run.scheduler.facts?.questions.map((question) => question.id) ?? [];
}

function parseStreamDone(raw: string): AgentRun {
  const blocks = raw.split("\n\n").map((block) => block.trim()).filter((block) => block.length > 0);
  let done: AgentRun | null = null;
  for (const block of blocks) {
    let eventName = "message";
    let dataLine = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) eventName = line.slice("event: ".length).trim();
      else if (line.startsWith("data: ")) dataLine = line.slice("data: ".length).trim();
    }
    if (eventName === "done" && dataLine !== "") done = JSON.parse(dataLine) as AgentRun;
  }
  if (done === null) throw new Error("stream had no done event");
  return done;
}

describe("demo API uses the same honest outcomes as the frozen eval", () => {
  test("missing buy and shipping clarifies instead of filling demo costs", async () => {
    const run = await postRun(setup(), caseText("missing-buy-shipping"));
    expect(outcome(run)).toBe("clarify");
    expect(run.status).toBe("completed");
    expect(run.artifacts.product).toBeNull();
    expect(run.artifacts.chosenId).toBeNull();
    expect(run.artifacts.candidates).toEqual([]);
    expect(run.artifacts.risk?.rows.map((row) => row.id)).toContain("missing-cost-facts");
    expect(run.events.some((event) => event.title === "需要掌柜补充关键经营数据")).toBe(true);
    const spoken = run.events.map((event) => `${event.title}${event.detail}`).join("\n");
    expect(spoken).not.toMatch(/演示假设/);
    expect(questionIds(run)).toContain("ask-buy");
    expect(questionIds(run)).toContain("ask-shipping");
  });

  test("missing competitor clarifies and offers a competitor follow-up", async () => {
    const run = await postRun(setup(), caseText("missing-competitor-price"));
    expect(outcome(run)).toBe("clarify");
    expect(run.artifacts.product).toBeNull();
    expect(run.artifacts.risk?.rows.map((row) => row.id)).toContain("missing-market-anchor");
    expect(questionIds(run)).toContain("ask-competitor");
  });

  test("price inversion is rejected by the system even when autoApprove is false", async () => {
    const run = await postRun(setup(), caseText("conflict-price-inversion"), { autoApprove: false });
    expect(outcome(run)).toBe("reject");
    expect(run.status).toBe("rejected");
    expect(run.gateDecision).toBe("reject");
    expect(run.events.some((event) => event.title === "系统驳回上架方案")).toBe(true);
    expect(run.events.some((event) => event.type === "gate.awaiting")).toBe(false);
  });

  test("demand-cap is approved with a demand-doubt risk, not rejected", async () => {
    const run = await postRun(setup(), caseText("conflict-demand-cap"));
    expect(outcome(run)).toBe("approve");
    expect(run.status).toBe("completed");
    expect(run.gateDecision).not.toBe("reject");
    expect(run.artifacts.product).not.toBeNull();
    expect(run.artifacts.risk?.rows.map((row) => row.id)).toContain("market-demand-doubt");
  });

  test("a complete standard case still produces a real plan", async () => {
    const run = await postRun(setup(), caseText("std-apparel-pdd"));
    expect(outcome(run)).toBe("approve");
    expect(run.artifacts.product).not.toBeNull();
    expect(run.artifacts.chosenId).not.toBeNull();
    expect(run.artifacts.candidates?.length ?? 0).toBeGreaterThan(0);
  });

  test("the stream endpoint agrees with the sync endpoint on inversion", async () => {
    const app = setup();
    const response = await app.request("/api/agentops/runs/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task: caseText("conflict-price-inversion"),
        autoApprove: true,
        id: "stream-inversion",
      }),
    });
    expect(response.status).toBe(200);
    const done = parseStreamDone(await response.text());
    expect(outcome(done)).toBe("reject");
    expect(done.status).toBe("rejected");
    expect(done.gateDecision).toBe("reject");
  });
});
