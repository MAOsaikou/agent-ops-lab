import { describe, expect, test } from "vitest";

import type { LlmCompletion, LlmRequest } from "../src/engine/llm/client.js";
import { BENCHMARK_CASES } from "../src/templates/agentops/eval/dataset.js";
import { runEvaluationSuite } from "../src/templates/agentops/eval/harness.js";
import type { LiveLlm } from "../src/templates/agentops/llm.js";

// 借鉴 test/agentops.deliberation-loop.test.ts 的 mockModel：固定 usage，
// 且即便模型输出无法通过会审校验，deliberation.ts 在校验前也已累加 usage。
function mockLiveLlm(output: (req: LlmRequest) => unknown): LiveLlm {
  return {
    model: "mock-live-tokens-model",
    baseUrl: "http://mock.invalid",
    client: {
      complete: async (req: LlmRequest): Promise<LlmCompletion> => {
        const res = await output(req);
        return {
          text: typeof res === "string" ? res : JSON.stringify(res),
          usage: { promptTokens: 30, completionTokens: 20 },
        };
      },
    },
  };
}

// 模型输出故意不满足会审协议（summary 过短等），确保断言不依赖输出是否通过校验。
const ALWAYS_INVALID = (): unknown => ({
  candidateId: "profit",
  summary: "太短",
  evidenceRefs: [],
  concerns: [],
});

describe("Unit 2: eval harness reports live token usage", () => {
  test("collab-with-review with live model accumulates prompt/completion tokens > 0", async () => {
    const live = mockLiveLlm(ALWAYS_INVALID);
    const result = await runEvaluationSuite({
      topologies: ["collab-with-review"],
      cases: [BENCHMARK_CASES[0]!],
      live,
    });

    expect(result.summary["collab-with-review"]!.totalPromptTokens).toBeGreaterThan(0);
    expect(result.summary["collab-with-review"]!.totalCompletionTokens).toBeGreaterThan(0);
    const detail = result.caseDetails.find(
      (row) => row.topology === "collab-with-review" && row.caseId === BENCHMARK_CASES[0]!.id,
    );
    expect(detail).toBeDefined();
    expect(detail!.tokens).toBeGreaterThan(0);
  });

  test("same parameters without live report zeros", async () => {
    const result = await runEvaluationSuite({
      topologies: ["collab-with-review"],
      cases: [BENCHMARK_CASES[0]!],
    });

    expect(result.summary["collab-with-review"]!.totalPromptTokens).toBe(0);
    expect(result.summary["collab-with-review"]!.totalCompletionTokens).toBe(0);
    for (const detail of result.caseDetails) {
      expect(detail.tokens).toBe(0);
    }
  });

  test("rule topology ignores a passed live model and stays at zero (useLive=false)", async () => {
    const live = mockLiveLlm(ALWAYS_INVALID);
    const result = await runEvaluationSuite({
      topologies: ["rule"],
      cases: [BENCHMARK_CASES[0]!],
      live,
    });

    expect(result.summary.rule!.totalPromptTokens).toBe(0);
    expect(result.summary.rule!.totalCompletionTokens).toBe(0);
    for (const detail of result.caseDetails) {
      expect(detail.tokens).toBe(0);
    }
  });
});
