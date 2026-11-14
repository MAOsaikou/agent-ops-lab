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

const TASK =
  "分析拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。纯棉短袖，券后价 ¥39.90，已拼 10 万+ 件。采购价 16 元，包材 1.5 元，快递 6.5 元，竞品主流价 39.90 元，日单量 50，目标毛利 25%，推广预算 30 元，可周转资金 300 元。";

function appWithEmptyLlm() {
  const dir = mkdtempSync(path.join(tmpdir(), "agentops-run-options-"));
  const app = createPricingApp({
    store: openPlanStore(path.join(dir, "plans")),
    agentRuns: memoryAgentRunStore(),
    llmSettings: openLlmSettingsStore(null, {}),
    now: () => new Date("2026-11-14T00:00:00.000Z"),
  });
  return app;
}

async function postRun(app: ReturnType<typeof createPricingApp>, body: unknown, accept?: string) {
  return app.request("/api/agentops/runs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(accept !== undefined ? { accept } : {}),
    },
    body: JSON.stringify(body),
  });
}

function caseTask(id: string): string {
  const found = BENCHMARK_CASES.find((item) => item.id === id);
  if (found === undefined) throw new Error(`missing case ${id}`);
  return found.taskText;
}

describe("POST /api/agentops/runs accepts bounded budget and retrieval options", () => {
  test("omitting new options keeps the default offline completed path", async () => {
    const app = appWithEmptyLlm();
    const res = await postRun(app, { task: TASK, autoApprove: true, collaboration: false });
    expect(res.status).toBe(201);
    const run = (await res.json()) as AgentRun;
    expect(run.status).toBe("completed");
    expect(run.stopReason).toBeUndefined();
    expect(run.artifacts.product).not.toBeNull();
  });

  test("budgetCeiling maxToolCalls 0 returns a terminal stopped run, not a disguised approve", async () => {
    const app = appWithEmptyLlm();
    const res = await postRun(app, {
      task: TASK,
      autoApprove: true,
      collaboration: false,
      budgetCeiling: { maxTokens: 16000, maxToolCalls: 0, timeoutMs: 60_000 },
    });
    expect(res.status).toBe(201);
    const run = (await res.json()) as AgentRun;
    expect(run.status).toBe("stopped");
    expect(run.stopReason).toBe("budget.tool_calls");
    expect(run.events.some((event) => event.type === "budget.exceeded")).toBe(true);
    expect(run.events.some((event) => event.type === "run.completed")).toBe(false);
  });

  test("unprofitable task still system-rejects through the HTTP entry when no model review runs", async () => {
    const app = appWithEmptyLlm();
    const res = await postRun(app, {
      task: caseTask("reject-negative-margin"),
      autoApprove: true,
      collaboration: false,
      budgetCeiling: { maxTokens: 16000, maxToolCalls: 24, timeoutMs: 60_000 },
    });
    expect(res.status).toBe(201);
    const run = (await res.json()) as AgentRun;
    expect(run.status).toBe("rejected");
    expect(run.gateDecision).toBe("reject");
  });

  test("retrieval opt-in uses built-in knowledge.search and records citations or a protocol trace", async () => {
    const app = appWithEmptyLlm();
    const res = await postRun(app, {
      task: TASK,
      autoApprove: true,
      collaboration: false,
      retrieval: { enabled: true, query: "拼多多 费率", platform: "pdd", timeoutMs: 2000 },
    });
    expect(res.status).toBe(201);
    const run = (await res.json()) as AgentRun;
    expect(run.status).toBe("completed");
    expect((run.artifacts.citations ?? []).length).toBeGreaterThan(0);
    expect(run.protocolTraces?.some((trace) => trace.protocol === "retrieval" && trace.ok)).toBe(true);
  });

  test("illegal budget and retrieval values are 400 and do not start a run", async () => {
    const app = appWithEmptyLlm();
    const illegalBodies: unknown[] = [
      { task: TASK, budgetCeiling: { maxTokens: -1, maxToolCalls: 24, timeoutMs: 1000 } },
      { task: TASK, budgetCeiling: { maxTokens: Number.NaN, maxToolCalls: 24, timeoutMs: 1000 } },
      { task: TASK, budgetCeiling: { maxTokens: 1000, maxToolCalls: 24, timeoutMs: Number.POSITIVE_INFINITY } },
      { task: TASK, budgetCeiling: { maxTokens: 1000 } },
      { task: TASK, retrieval: { enabled: true } },
      { task: TASK, retrieval: { enabled: true, query: "费率", retriever: "file:///etc/passwd" } },
      { task: TASK, retrieval: { enabled: true, query: "费率", url: "http://127.0.0.1/" } },
      { task: TASK, protocols: { mcp: { enabled: true, command: "echo pwned" } } },
      { task: TASK, baseUrl: "http://127.0.0.1:9" },
      { task: TASK, apiKey: "sk-test" },
      { task: TASK, liveEndpoint: "https://example.invalid" },
    ];
    for (const body of illegalBodies) {
      const res = await postRun(app, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      const payload = (await res.json()) as { code?: string };
      expect(payload.code).toBe("bad-request");
    }
    const list = await app.request("/api/agentops/runs");
    const listing = (await list.json()) as { runs: unknown[] };
    expect(listing.runs).toHaveLength(0);
  });

  test("the stream endpoint accepts the same budgetCeiling schema", async () => {
    const app = appWithEmptyLlm();
    const res = await postRun(
      app,
      {
        task: TASK,
        autoApprove: true,
        collaboration: false,
        budgetCeiling: { maxTokens: 16000, maxToolCalls: 0, timeoutMs: 60_000 },
      },
      "text/event-stream",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/text\/event-stream/);
    const raw = await res.text();
    expect(raw).toMatch(/budget\.exceeded|stopped/);
  });
});
