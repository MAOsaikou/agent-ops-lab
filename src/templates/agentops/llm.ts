import { z } from "zod";

import type { LlmClient } from "../../engine/llm/client.js";
import { createOpenAiCompatibleLlm } from "../../engine/llm/openai-compatible.js";

export type LiveLlm = { readonly client: LlmClient; readonly model: string; readonly baseUrl: string };

export function llmConfigFromEnv(env: NodeJS.ProcessEnv): LiveLlm | null {
  const apiKey = env["AGENTOPS_LLM_API_KEY"] ?? env["OPENAI_API_KEY"] ?? "";
  const model = env["AGENTOPS_LLM_MODEL"] ?? env["OPENAI_MODEL"] ?? "";
  const baseUrl = env["AGENTOPS_LLM_BASE_URL"] ?? env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1";
  if (apiKey.trim() === "" || model.trim() === "") return null;
  return { model, baseUrl, client: createOpenAiCompatibleLlm({ baseUrl, apiKey, model, fetch: (url, init) => fetch(url, init) }) };
}

const copySchema = z.object({ titles: z.array(z.string()).min(1).max(3), bullets: z.array(z.string()).min(1).max(5) });
const FORBIDDEN = ["全网最低", "销量第一", "绝对", "100%"];

export function copyPrompt(input: { readonly name: string; readonly platform: string; readonly maxTitle: number; readonly keywords: string; readonly price: number }): string {
  return `你是商品文案 Agent。仅用已给事实，严禁编造销量、认证或排名。标题最多${String(input.maxTitle)}字；避免极限词。只返回 JSON {"titles":["..."],"bullets":["..."]}。商品：${input.name}；平台：${input.platform}；关键词：${input.keywords}；建议价：${(input.price / 100).toFixed(2)}元。`;
}

export function validateCopy(text: string, maxTitle: number): { readonly ok: true; readonly value: z.infer<typeof copySchema> } | { readonly ok: false; readonly reason: string } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, reason: "模型未返回 JSON" };
  let raw: unknown;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return { ok: false, reason: "模型 JSON 解析失败" }; }
  const parsed = copySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "模型输出结构校验失败" };
  for (const title of parsed.data.titles) {
    if ([...title].length > maxTitle) return { ok: false, reason: `标题超过 ${String(maxTitle)} 字限制` };
  }
  const all = [...parsed.data.titles, ...parsed.data.bullets];
  const forbidden = FORBIDDEN.find((word) => all.some((item) => item.includes(word)));
  if (forbidden !== undefined) return { ok: false, reason: `输出包含风险词「${forbidden}」` };
  return { ok: true, value: parsed.data };
}
