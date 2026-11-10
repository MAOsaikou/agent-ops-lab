import type {
  AgentRun,
  GateDecisionInput,
  LoopAction,
  LoopIteration,
  LoopSnapshot,
  RunEvent,
  RunStatus,
  RunSummary,
} from "../../../src/templates/agentops/types.js";

export type {
  AgentRun,
  GateDecisionInput,
  LoopAction,
  LoopIteration,
  LoopSnapshot,
  RunEvent,
  RunStatus,
  RunSummary,
};

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

export function runAgentTask(
  task: string,
  options?: { readonly autoApprove?: boolean },
): Promise<AgentRun> {
  const payload =
    options?.autoApprove === undefined ? { task } : { task, autoApprove: options.autoApprove };
  return request<AgentRun>("/api/agentops/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function streamAgentTask(
  input: { readonly task: string; readonly autoApprove: boolean },
  onEvent?: (event: RunEvent) => void,
): Promise<AgentRun> {
  const response = await fetch(`${BASE}/api/agentops/runs/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = (body as { detail?: string } | null)?.detail;
    throw new Error(detail ?? `流式请求失败（${String(response.status)}）`);
  }

  if (response.body === null) {
    return runAgentTask(input.task, { autoApprove: input.autoApprove });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneRun: AgentRun | null = null;

  const processBlock = (block: string): void => {
    const trimmed = block.trim();
    if (trimmed.length === 0) return;
    let eventName = "message";
    const dataLines: string[] = [];
    for (const rawLine of trimmed.split("\n")) {
      const line = rawLine.trim();
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }
    if (dataLines.length === 0) return;
    const rawData = dataLines.join("\n");
    const parsed: unknown = JSON.parse(rawData);
    if (eventName === "event") {
      onEvent?.(parsed as RunEvent);
    } else if (eventName === "done") {
      doneRun = parsed as AgentRun;
    } else if (eventName === "error") {
      const detail = (parsed as { detail?: string } | null)?.detail;
      throw new Error(detail ?? "流式执行中断");
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      processBlock(block);
      boundary = buffer.indexOf("\n\n");
    }
  }

  if (buffer.trim().length > 0) {
    for (const part of buffer.split("\n\n")) {
      processBlock(part);
    }
  }

  if (doneRun === null) {
    throw new Error("未收到完整运行结果");
  }
  return doneRun;
}

export function submitRunDecision(
  id: string,
  decision: GateDecisionInput,
): Promise<AgentRun> {
  return request<AgentRun>(`/api/agentops/runs/${id}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(decision),
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
