import type { RunId } from "../ids.js";

export type LlmRequest = {
  readonly runId: RunId;
  readonly round: number;
  readonly nodeId: string;
  readonly attempt: number;
  readonly prompt: string;
  readonly maxTokens: number;
};

export type LlmUsage = {
  readonly promptTokens: number;
  readonly completionTokens: number;
};

export type LlmCompletion = {
  readonly text: string;
  readonly usage: LlmUsage;
};

export type LlmClient = {
  complete(request: LlmRequest): Promise<LlmCompletion>;
};
