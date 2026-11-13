import { readFileSync } from "node:fs";
import path from "node:path";

import type { Page, Route } from "@playwright/test";

export const API_ORIGIN = process.env["E2E_API_ORIGIN"] ?? "http://127.0.0.1:47321";

export type FixtureName =
  | "pillow-awaiting-2loops"
  | "pillow-completed-2loops"
  | "pdd-awaiting"
  | "pdd-completed"
  | "pdd-rejected";

export type RawRun = Record<string, unknown> & {
  id: string;
  status: string;
  createdAt: string;
  task: { text: string };
  artifacts: { prices: { id: string; priceCents: number; margin: number }[]; chosenId: string | null };
  loops: unknown[];
};

/** Real persisted runs copied from `.data/agent-runs` (compact JSON). */
export function loadFixture(name: FixtureName): RawRun {
  const file = path.join(process.cwd(), "test", "fixtures", "agent-runs", `${name}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as RawRun;
}

export function summaryOf(run: RawRun): Record<string, unknown> {
  const chosen = run.artifacts.prices.find((price) => price.id === run.artifacts.chosenId);
  return {
    id: run.id,
    createdAt: run.createdAt,
    status: run.status,
    taskText: run.task.text,
    chosenId: run.artifacts.chosenId,
    priceCents: chosen?.priceCents ?? 0,
    margin: chosen?.margin ?? 0,
    loops: run.loops.length,
    failures: 0,
  };
}

/** Strip everything an older schema did not write. Derived from a real persisted run, not invented. */
export function toLegacyShape(run: RawRun): RawRun {
  const copy = JSON.parse(JSON.stringify(run)) as Record<string, unknown>;
  for (const key of ["calls", "failures", "loads", "scheduler", "llm", "notes", "agents", "dispatches", "verifications"]) {
    delete copy[key];
  }
  copy.loops = (copy.loops as Record<string, unknown>[]).map((loop) => {
    const rest = { ...loop };
    delete rest.before;
    delete rest.after;
    return rest;
  });
  return copy as RawRun;
}

export type Served =
  | { readonly kind: "json"; readonly body: unknown; readonly status?: number }
  | { readonly kind: "raw"; readonly body: string; readonly status?: number; readonly contentType?: string }
  | { readonly kind: "abort" }
  | { readonly kind: "delay"; readonly ms: number; readonly body: unknown };

/**
 * Serves a deterministic history list plus per-id dossiers. These are MOCK API responses
 * (real persisted runs replayed, or deliberately malformed payloads); the UI under test is real.
 */
export async function mockHistory(
  page: Page,
  items: readonly { readonly summary: Record<string, unknown>; readonly serve: Served }[],
): Promise<void> {
  const byId = new Map(items.map((item) => [String(item.summary.id), item.serve]));
  const historyPath = /^\/api\/agentops\/runs(\/[A-Za-z0-9_-]+)?$/;
  await page.route(
    (url) => {
      if (!historyPath.test(url.pathname)) return false;
      // Official e2e talks to 47321; a same-origin /api frontend (or an isolated port) must also be mocked.
      return url.origin === API_ORIGIN || (url.hostname === "127.0.0.1" && url.pathname.startsWith("/api/"));
    },
    async (route: Route) => {
      const request = route.request();
      if (request.method() !== "GET") {
        await route.continue();
        return;
      }
      const url = new URL(request.url());
      if (url.pathname === "/api/agentops/runs") {
        await route.fulfill({ json: { runs: items.map((item) => item.summary) } });
        return;
      }
      const id = url.pathname.split("/").at(-1) ?? "";
      const served = byId.get(id);
      if (served === undefined) {
        await route.fulfill({ status: 404, json: { code: "run-not-found" } });
        return;
      }
      if (served.kind === "abort") {
        await route.abort("failed");
      } else if (served.kind === "raw") {
        await route.fulfill({
          status: served.status ?? 200,
          contentType: served.contentType ?? "application/json",
          body: served.body,
        });
      } else if (served.kind === "delay") {
        await new Promise((resolve) => setTimeout(resolve, served.ms));
        await route.fulfill({ json: served.body });
      } else {
        await route.fulfill({ status: served.status ?? 200, json: served.body });
      }
    },
  );
}

export async function rootIsBlank(page: Page): Promise<boolean> {
  return page.evaluate(() => (document.getElementById("root")?.innerText ?? "").trim().length < 40);
}

export async function overflowX(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
