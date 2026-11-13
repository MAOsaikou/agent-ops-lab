import { describe, expect, test } from "vitest";

import type { LlmCompletion, LlmRequest } from "../src/engine/llm/client.js";
import { GENERALIST_AGENT } from "../src/templates/agentops/catalog.js";
import { BENCHMARK_CASES } from "../src/templates/agentops/eval/dataset.js";
import { countToolCalls, sumRunUsage } from "../src/templates/agentops/eval/harness.js";
import { runAgentWorkflow } from "../src/templates/agentops/runner.js";
import type { AgentRun } from "../src/templates/agentops/types.js";
import type { LiveLlm } from "../src/templates/agentops/llm.js";

const v1Task =
  "分析拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。纯棉短袖，券后价 ¥39.90，已拼 10 万+ 件。采购价 16 元，包材 1.5 元，快递 6.5 元，竞品主流价 39.90 元，日单量 50，目标毛利 25%，推广预算 30 元，可周转资金 300 元。";

const preset1 =
  "分析这个拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。分享文案：纯棉短袖女夏季宽松，券后 ¥39.90，已拼 10 万+，包邮、七天无理由。采购 16 元，包材 1.5 元，快递 6.5 元，目标毛利 25%，可周转资金 300 元。";

const adConflictTask =
  "分析拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。商品名：纯棉短袖，券后价 ¥39.90。采购价 16 元，包材 1.5 元，快递 6.5 元，竞品主流价 39.90 元，日单量 15，目标毛利 25%，推广预算 220 元，可周转资金 5000 元。";

// Frozen on dc5a528 before this patch; collaboration:false v1 path must keep these hashes.
const V1_FINGERPRINTS = {
  "test-run-v1": "59346b6d7ac56447cd37a72d9b31d00c20318d76005c0b48b72688c00edceaa3",
  "v1-inversion": "e14f14ef6056b3bb90f30f3a7b4574e91081ff6ac05f3320e34d03df090d4b64",
} as const;

function mockLive(output: (req: LlmRequest) => unknown): LiveLlm {
  return {
    model: "mock-baseline-model",
    baseUrl: "http://mock.invalid",
    client: {
      complete: async (req: LlmRequest): Promise<LlmCompletion> => {
        const res = await output(req);
        return {
          text: typeof res === "string" ? res : JSON.stringify(res),
          usage: { promptTokens: 11, completionTokens: 7 },
        };
      },
    },
  };
}

describe("baseline options, load semantics, and usage accounting", () => {
  test("collaboration:false v1 fingerprints stay sealed to the frozen hashes", async () => {
    const v1Run = await runAgentWorkflow(
      { id: "test-run-v1", taskText: v1Task, autoApprove: true, createdAt: "2026-01-01T00:00:00.000Z" },
      null,
      undefined,
      { collaboration: false },
    );
    expect(v1Run.fingerprint).toBe(V1_FINGERPRINTS["test-run-v1"]);

    const inversion = BENCHMARK_CASES.find((item) => item.id === "conflict-price-inversion");
    expect(inversion).toBeDefined();
    const inversionRun = await runAgentWorkflow(
      {
        id: "v1-inversion",
        taskText: inversion!.taskText,
        autoApprove: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      null,
      undefined,
      { collaboration: false },
    );
    expect(inversionRun.fingerprint).toBe(V1_FINGERPRINTS["v1-inversion"]);
  });

  test("loads equal cumulative dispatches in the run and do not reset after nodes finish", async () => {
    const run = await runAgentWorkflow(
      { id: "load-cumulative", taskText: v1Task, autoApprove: true, createdAt: "2026-01-01T00:00:00.000Z" },
      null,
      undefined,
      { collaboration: false },
    );
    const counted: Record<string, number> = {};
    for (const dispatch of run.dispatches) {
      counted[dispatch.chosen] = (counted[dispatch.chosen] ?? 0) + 1;
    }
    expect(run.loads).toEqual(counted);
    expect(Object.values(counted).reduce((sum, value) => sum + value, 0)).toBe(run.dispatches.length);
    expect(run.dispatches.length).toBeGreaterThan(0);
    // Later notes for a repeated agent, if any, must still show a positive cumulative load.
    const seen: Record<string, number> = {};
    for (const dispatch of run.dispatches) {
      const prior = seen[dispatch.chosen] ?? 0;
      const self = dispatch.candidates.find((candidate) => candidate.agentId === dispatch.chosen);
      expect(self?.note).toContain(`负载 ${String(prior)}`);
      seen[dispatch.chosen] = prior + 1;
    }
  });

  test("singleAgent dispatches only the generalist and leaves the default catalog unused", async () => {
    const run = await runAgentWorkflow(
      { id: "single-agent-baseline", taskText: v1Task, autoApprove: true, createdAt: "2026-01-01T00:00:00.000Z" },
      null,
      undefined,
      { collaboration: false, singleAgent: true, strictEvidence: true },
    );
    expect(run.agents).toEqual([GENERALIST_AGENT]);
    expect(run.dispatches.length).toBeGreaterThan(0);
    expect(run.dispatches.every((dispatch) => dispatch.chosen === "generalist")).toBe(true);
    expect(run.artifacts.collaboration).toBeUndefined();
    expect(new Set(run.dispatches.map((dispatch) => dispatch.chosen)).size).toBe(1);
  });

  test("economicLoop:false skips repair iterations on a task that otherwise loops", async () => {
    const withLoop = await runAgentWorkflow(
      { id: "ad-conflict-loop-on", taskText: adConflictTask, autoApprove: true, createdAt: "2026-01-01T00:00:00.000Z" },
      null,
      undefined,
      { collaboration: false },
    );
    expect(withLoop.loops.length).toBeGreaterThanOrEqual(1);

    const noLoop = await runAgentWorkflow(
      { id: "ad-conflict-loop-off", taskText: adConflictTask, autoApprove: true, createdAt: "2026-01-01T00:00:00.000Z" },
      null,
      undefined,
      { collaboration: false, economicLoop: false },
    );
    expect(noLoop.loops).toHaveLength(0);
    expect(noLoop.events.some((event) => event.type === "loop.adjusted")).toBe(false);
    // Default v1 path is unchanged when the flag is omitted.
    expect(withLoop.fingerprint).not.toBe(noLoop.fingerprint);
  });

  test("copy live usage is recorded on the run and included by the eval usage helper", async () => {
    const live = mockLive(() => ({ titles: ["too-short"], bullets: ["x"] }));
    const run = await runAgentWorkflow(
      { id: "copy-usage", taskText: v1Task, autoApprove: true, createdAt: "2026-01-01T00:00:00.000Z" },
      live,
      undefined,
      { collaboration: false },
    );
    expect(run.tokenUsage?.promptTokens).toBeGreaterThan(0);
    expect(run.tokenUsage?.completionTokens).toBeGreaterThan(0);
    const summed = sumRunUsage(run);
    expect(summed.promptTokens).toBe(run.tokenUsage!.promptTokens);
    expect(summed.completionTokens).toBe(run.tokenUsage!.completionTokens);
  });

  test("countToolCalls adds deliberation tools and does not treat agent dispatches as tools", () => {
    const run = {
      events: [{ type: "tool.called" }, { type: "tool.called" }, { type: "node.output" }],
      artifacts: { deliberation: { toolCalls: [{ tool: "knowledge.search" }, { tool: "pricing.verify" }] } },
      calls: { planner: 9, "risk-auditor": 4 },
    } as unknown as AgentRun;
    expect(countToolCalls(run)).toBe(4);
  });

  test("omitting new options on collaboration:false still uses the seven-agent v1 catalog", async () => {
    const run = await runAgentWorkflow(
      { id: "v1-compat-test", taskText: preset1, autoApprove: true, createdAt: "2026-01-01T00:00:00.000Z" },
      null,
      undefined,
      { collaboration: false },
    );
    expect(run.agents).toHaveLength(7);
    expect(run.agents.some((agent) => agent.id === "generalist")).toBe(false);
    expect(run.artifacts.collaboration).toBeUndefined();
  });
});
