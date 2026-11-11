import { z } from "zod";
import type { LlmClient } from "./client.js";

export type LlmFetchInit = {
  method: "POST";
  headers: { "content-type": "application/json"; authorization: string };
  body: string;
  signal?: AbortSignal;
};
export type LlmFetchResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
export type LlmFetch = (url: string, init: LlmFetchInit) => Promise<LlmFetchResponse>;

const chatSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string().nullable().optional() }),
    finish_reason: z.string().nullable().optional(),
  })),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
});

export function createOpenAiCompatibleLlm(options: { fetch: LlmFetch; baseUrl: string; apiKey: string; model: string }): LlmClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const deepseek = new URL(baseUrl).hostname === "api.deepseek.com";
  return {
    async complete(request) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 60_000);
      try {
        const response = await options.fetch(baseUrl + "/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer " + options.apiKey },
          body: JSON.stringify({
            model: options.model,
            messages: [{ role: "user", content: request.prompt }],
            max_tokens: request.maxTokens,
            ...(request.responseFormat ? { response_format: { type: request.responseFormat } } : {}),
            ...(deepseek && request.reasoningEffort ? {
              thinking: { type: request.reasoningEffort === "none" ? "disabled" : "enabled" },
              ...(request.reasoningEffort !== "none" ? { reasoning_effort: request.reasoningEffort } : {}),
            } : {}),
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("模型接口请求失败（HTTP " + String(response.status) + "）");
        const parsed = chatSchema.parse(await response.json());
        const choice = parsed.choices[0];
        if (choice === undefined) throw new Error("模型接口没有返回候选结果");
        if (choice.finish_reason === "length") throw new Error("模型输出被 token 上限截断，未取得完整答案；请增加输出预算");
        const text = choice.message.content ?? "";
        if (text.trim() === "") throw new Error("模型返回空答案（可能只生成了推理内容），请核对模型与输出预算");
        return { text, usage: { promptTokens: parsed.usage?.prompt_tokens ?? 0, completionTokens: parsed.usage?.completion_tokens ?? 0 } };
      } catch (error) {
        if (controller.signal.aborted) throw new Error("模型调用超时，请重试或检查模型服务");
        throw error;
      } finally { clearTimeout(timeout); }
    },
  };
}
