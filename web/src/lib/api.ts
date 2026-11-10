import type { CandidateId, PlanResult, PlanSummary, ProductInput } from "../../../src/templates/pricing/model.js";
import type { IntakeResult } from "../../../src/templates/intake/types.js";
import type { PlatformPreset, ServiceTag } from "../../../src/templates/pricing/platform.js";

export const API_BASE = "http://127.0.0.1:47321";

export type PlatformCatalog = {
  readonly platforms: readonly PlatformPreset[];
  readonly serviceTags: readonly ServiceTag[];
  readonly rateDisclaimer: string;
};

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`请求 ${path} 失败（${String(response.status)}）`);
  }
  return (await response.json()) as T;
}

export function fetchPlatforms(): Promise<PlatformCatalog> {
  return getJson<PlatformCatalog>("/api/platforms");
}

export async function analyzeProduct(text: string): Promise<IntakeResult> {
  const response = await fetch(`${API_BASE}/api/intake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = (body as { detail?: string } | null)?.detail;
    throw new Error(detail ?? `链接识别失败（${String(response.status)}）`);
  }
  return body as IntakeResult;
}

export async function createPlan(input: ProductInput): Promise<PlanResult> {
  const response = await fetch(`${API_BASE}/api/plans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = (body as { detail?: string } | null)?.detail;
    throw new Error(detail ?? `核算失败（${String(response.status)}）`);
  }
  return body as PlanResult;
}

export async function fetchPlans(): Promise<readonly PlanSummary[]> {
  const body = await getJson<{ plans: readonly PlanSummary[] }>("/api/plans");
  return body.plans;
}

export function fetchPlan(id: string): Promise<PlanResult> {
  return getJson<PlanResult>(`/api/plans/${id}`);
}

export async function lockPlan(id: string, candidateId: CandidateId): Promise<PlanResult> {
  const response = await fetch(`${API_BASE}/api/plans/${id}/lock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ candidateId }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = (body as { detail?: string } | null)?.detail;
    throw new Error(detail ?? `锁定失败（${String(response.status)}）`);
  }
  return body as PlanResult;
}

export function csvUrl(id: string): string {
  return `${API_BASE}/api/plans/${id}/export.csv`;
}