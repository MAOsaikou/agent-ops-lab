import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createOpenAiCompatibleLlm } from "../engine/llm/openai-compatible.js";
import type { LiveLlm } from "../templates/agentops/llm.js";

export type LlmSettings = {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
};

export type LlmSettingsView = {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly model: string;
  readonly hasKey: boolean;
  readonly keyHint: string;
  readonly source: "saved" | "env" | "none";
  readonly active: boolean;
  readonly note: string;
};

export type LlmSettingsStore = {
  view(): LlmSettingsView;
  save(patch: unknown): LlmSettingsView;
  resolve(): LiveLlm | null;
  test(): Promise<{ readonly ok: boolean; readonly detail: string }>;
};

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-flash";

function mask(key: string): string {
  if (key.length === 0) return "";
  if (key.length <= 4) return "••••";
  return `••••${key.slice(-4)}`;
}

function baseUrlOf(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) return "";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Base URL 需要是完整地址，例如 http://localhost:11434/v1");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Base URL 只支持 http 或 https");
  }
  return trimmed;
}

function parseSettings(raw: unknown): LlmSettings {
  if (typeof raw !== "object" || raw === null) {
    return { enabled: false, baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL, apiKey: "" };
  }
  const record = raw as Record<string, unknown>;
  return {
    enabled: record["enabled"] === true,
    baseUrl: typeof record["baseUrl"] === "string" ? record["baseUrl"] : DEFAULT_BASE_URL,
    model: typeof record["model"] === "string" ? record["model"] : DEFAULT_MODEL,
    apiKey: typeof record["apiKey"] === "string" ? record["apiKey"] : "",
  };
}

export function openLlmSettingsStore(file: string | null, env: NodeJS.ProcessEnv): LlmSettingsStore {
  let current = (() => {
    if (file === null) {
      return parseSettings(null);
    }
    try {
      const parsed = parseSettings(JSON.parse(readFileSync(file, "utf8")));
      return parsed.enabled && parsed.model.trim().length === 0 ? { ...parsed, enabled: false } : parsed;
    } catch {
      return parseSettings(null);
    }
  })();

  const envKey = env["AGENTOPS_LLM_API_KEY"] ?? env["OPENAI_API_KEY"] ?? "";
  const envModel = env["AGENTOPS_LLM_MODEL"] ?? env["OPENAI_MODEL"] ?? "";
  const envBase = env["AGENTOPS_LLM_BASE_URL"] ?? env["OPENAI_BASE_URL"] ?? DEFAULT_BASE_URL;
  const hasEnv = envKey.trim().length > 0 && envModel.trim().length > 0;

  function live(): LiveLlm | null {
    if (current.enabled && current.model.trim().length > 0) {
      return {
        model: current.model.trim(),
        baseUrl: current.baseUrl,
        client: createOpenAiCompatibleLlm({
          baseUrl: current.baseUrl,
          apiKey: current.apiKey.trim().length > 0 ? current.apiKey.trim() : "local",
          model: current.model.trim(),
          fetch: (url, init) => fetch(url, init),
        }),
      };
    }
    if (current.enabled && hasEnv) {
      return {
        model: envModel.trim(),
        baseUrl: envBase,
        client: createOpenAiCompatibleLlm({
          baseUrl: envBase,
          apiKey: envKey.trim(),
          model: envModel.trim(),
          fetch: (url, init) => fetch(url, init),
        }),
      };
    }
    return null;
  }

  function view(): LlmSettingsView {
    const active = live() !== null;
    const source: LlmSettingsView["source"] = current.model.trim().length > 0 ? "saved" : hasEnv ? "env" : "none";
    const model = current.model.trim().length > 0 ? current.model : hasEnv ? envModel : "";
    const baseUrl = current.model.trim().length > 0 ? current.baseUrl : hasEnv ? envBase : current.baseUrl;
    const key = current.apiKey.trim().length > 0 ? current.apiKey : hasEnv ? envKey : "";
    const note = !current.enabled
      ? "当前关闭模型节点，全部使用确定性规则 Harness，演示可完全复现。"
      : active
        ? `文案节点会调用 ${model}，输出必须通过校验，否则回退规则。`
        : "已开启但缺少模型名，请补全后保存。";
    return { enabled: current.enabled, baseUrl, model, hasKey: key.length > 0, keyHint: mask(key), source, active, note };
  }

  return {
    view,
    save(patch) {
      if (typeof patch !== "object" || patch === null) {
        throw new Error("配置格式不正确");
      }
      const record = patch as Record<string, unknown>;
      const next = {
        enabled: typeof record["enabled"] === "boolean" ? record["enabled"] : current.enabled,
        baseUrl: typeof record["baseUrl"] === "string" ? baseUrlOf(record["baseUrl"]) : current.baseUrl,
        model: typeof record["model"] === "string" ? record["model"].trim().slice(0, 120) : current.model,
        apiKey: typeof record["apiKey"] === "string" && record["apiKey"].trim().length > 0 ? record["apiKey"].trim().slice(0, 400) : current.apiKey,
      };
      if (record["clearKey"] === true) next.apiKey = "";
      if (next.enabled && next.model.length === 0) {
        throw new Error("启用模型节点前请先填写模型名（如 deepseek-flash）");
      }
      current = next;
      if (file !== null) {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      }
      return view();
    },
    resolve() {
      return live();
    },
    async test() {
      const target = live();
      if (target === null) {
        return { ok: false, detail: "还没有启用模型或缺少模型名，先在面板里填好再点测试。" };
      }
      try {
        const completion = await target.client.complete({
          runId: "settings-test" as never,
          round: 0,
          nodeId: "settings",
          attempt: 1,
          prompt: "只回复两个字符：OK",
          maxTokens: 8,
        });
        return { ok: true, detail: `连接成功：${target.model} 返回「${completion.text.trim().slice(0, 20)}」` };
      } catch (error) {
        return { ok: false, detail: `连接失败：${error instanceof Error ? error.message : "未知错误"}` };
      }
    },
  };
}
