import type { LlmClient, LlmRequest } from "./client.js";
import { promptHash } from "./hash.js";

export type MockLlm = LlmClient & {
  readonly calls: readonly LlmRequest[];
};

export function createMockLlm(): MockLlm {
  const calls: LlmRequest[] = [];
  return {
    get calls() {
      return [...calls];
    },
    async complete(request) {
      calls.push({
        runId: request.runId,
        round: request.round,
        nodeId: request.nodeId,
        attempt: request.attempt,
        prompt: request.prompt,
        maxTokens: request.maxTokens,
      });
      return {
        text: promptHash(request.prompt),
        usage: { promptTokens: 10, completionTokens: 10 },
      };
    },
  };
}
