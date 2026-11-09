import type { UiFrame } from "../../../src/server/frames.js";
import type { LedgerResponse, ModeInfo, RunMeta, RunProfile, ScenarioName } from "./contract.js";

export const API_BASE = "http://127.0.0.1:47321";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${String(response.status)}`);
  }
  return (await response.json()) as T;
}

export function fetchMode(): Promise<ModeInfo> {
  return getJson<ModeInfo>("/api/mode");
}

export async function fetchRuns(): Promise<readonly RunMeta[]> {
  const body = await getJson<{ runs: readonly RunMeta[] }>("/api/runs");
  return body.runs;
}

export async function createRun(input: {
  readonly scenario: ScenarioName;
  readonly seed: number;
  readonly profile: RunProfile;
}): Promise<RunMeta> {
  const response = await fetch(`${API_BASE}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as { runId?: string; meta?: RunMeta; detail?: string };
  if (!response.ok || body.meta === undefined) {
    throw new Error(body.detail ?? `create run failed with ${String(response.status)}`);
  }
  return body.meta;
}

export function fetchRun(runId: string): Promise<{ meta: RunMeta; frames: readonly UiFrame[] }> {
  return getJson<{ meta: RunMeta; frames: readonly UiFrame[] }>(`/api/runs/${runId}`);
}

export function fetchLedger(runId: string): Promise<LedgerResponse> {
  return getJson<LedgerResponse>(`/api/runs/${runId}/ledger`);
}

export function fetchEventsSince(runId: string, since: number): Promise<{ frames: readonly UiFrame[]; lastSeq: number }> {
  return getJson<{ frames: readonly UiFrame[]; lastSeq: number }>(`/api/runs/${runId}/events?since=${String(since)}`);
}

export async function tryCommitRound(
  runId: string,
  round: number,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${API_BASE}/api/runs/${runId}/rounds/${String(round)}/commit`, {
    method: "POST",
  });
  const body: unknown = await response.json().catch(() => null);
  return { status: response.status, body };
}

export function streamUrl(runId: string, lastEventId: number, pace: number): string {
  return `${API_BASE}/api/runs/${runId}/stream?pace=${String(pace)}&lastEventId=${String(lastEventId)}`;
}
