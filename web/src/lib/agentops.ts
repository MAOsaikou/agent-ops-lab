import type { AgentRun, RunSummary } from "../../../src/templates/agentops/types.js";

const BASE = "http://127.0.0.1:47321";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = (body as { detail?: string } | null)?.detail;
    throw new Error(detail ?? `请求失败（${String(response.status)}）`);
  }
  return body as T;
}

export type AgentCatalog = {
  readonly agents: AgentRun["agents"];
  readonly tools: readonly { readonly name: string; readonly title: string; readonly kind: string }[];
  readonly workflow: AgentRun["workflow"];
};

export function fetchAgentCatalog(): Promise<AgentCatalog> {
  return request<AgentCatalog>("/api/agentops/catalog");
}

export async function fetchAgentRuns(): Promise<readonly RunSummary[]> {
  return (await request<{ runs: readonly RunSummary[] }>("/api/agentops/runs")).runs;
}

export function runAgentTask(task: string): Promise<AgentRun> {
  return request<AgentRun>("/api/agentops/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task }),
  });
}

export function fetchAgentRun(id: string): Promise<AgentRun> {
  return request<AgentRun>(`/api/agentops/runs/${id}`);
}

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

export type LlmSettingsPatch = {
  readonly enabled?: boolean;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly apiKey?: string;
  readonly clearKey?: boolean;
};

export function fetchLlmSettings(): Promise<LlmSettingsView> {
  return request<LlmSettingsView>("/api/agentops/llm");
}

export function saveLlmSettings(patch: LlmSettingsPatch): Promise<LlmSettingsView> {
  return request<LlmSettingsView>("/api/agentops/llm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function testLlmSettings(): Promise<{ readonly ok: boolean; readonly detail: string }> {
  return request<{ ok: boolean; detail: string }>("/api/agentops/llm/test", { method: "POST" });
}
