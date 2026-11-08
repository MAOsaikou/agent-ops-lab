import { z } from "zod";
import type { LlmClient } from "./client.js";

export type LlmFetchInit = {
  method: "POST";
  headers: {
    "content-type": "application/json";
    authorization: string;
  };
  body: string;
};

export type LlmFetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

export type LlmFetch = (url: string, init: LlmFetchInit) => Promise<LlmFetchResponse>;

const chatSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string(),
      }),
    }),
  ),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
  }),
});

export function createOpenAiCompatibleLlm(options: {
  fetch: LlmFetch;
  baseUrl: string;
  apiKey: string;
  model: string;
}): LlmClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  return {
    async complete(request) {
      const response = await options.fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          messages: [{ role: "user", content: request.prompt }],
          max_tokens: request.maxTokens,
        }),
      });
      if (!response.ok) {
        throw new Error(`openai compatible request failed: ${response.status}`);
      }
      const body = await response.json();
      const parsed = chatSchema.parse(body);
      const choice = parsed.choices[0];
      if (choice === undefined) {
        throw new Error("openai compatible response had no choices");
      }
      return {
        text: choice.message.content,
        usage: {
          promptTokens: parsed.usage.prompt_tokens,
          completionTokens: parsed.usage.completion_tokens,
        },
      };
    },
  };
}
