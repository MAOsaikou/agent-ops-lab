import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parseStoredRun, summarizeStoredRun } from "../templates/agentops/stored-run.js";
import type { AgentRun, RunSummary } from "../templates/agentops/types.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function agentRunsDirectory(from: string = process.cwd()): string {
  return path.join(from, ".data", "agent-runs");
}

export type RunInspection =
  | { readonly kind: "ok"; readonly run: AgentRun }
  | { readonly kind: "missing" }
  | { readonly kind: "corrupt"; readonly reason: string };

export type AgentRunStore = {
  save(run: AgentRun): void;
  load(id: string): AgentRun | undefined;
  /** Like `load`, but says *why* a run is unavailable so callers can answer 404 vs 422. */
  inspect(id: string): RunInspection;
  list(): readonly RunSummary[];
};

function readRun(file: string, id: string): RunInspection {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { kind: "missing" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: "corrupt", reason: "卷宗文件不是有效的 JSON，已损坏" };
  }
  const parsed = parseStoredRun(raw);
  if (!parsed.ok) return { kind: "corrupt", reason: parsed.reason };
  if (parsed.run.id !== id) return { kind: "corrupt", reason: "卷宗编号与文件名不一致" };
  // Hand back the stored object itself: sealed fingerprints must keep matching the bytes on disk.
  return { kind: "ok", run: raw as AgentRun };
}

export function openAgentRunStore(directory: string): AgentRunStore {
  mkdirSync(directory, { recursive: true });
  const items = new Map<string, AgentRun>();
  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith(".json")) continue;
    const id = entry.slice(0, -5);
    if (!ID_PATTERN.test(id)) continue;
    const inspected = readRun(path.join(directory, entry), id);
    if (inspected.kind === "ok") items.set(id, inspected.run);
  }
  const inspect = (id: string): RunInspection => {
    if (!ID_PATTERN.test(id)) return { kind: "missing" };
    const cached = items.get(id);
    if (cached !== undefined) return { kind: "ok", run: cached };
    const inspected = readRun(path.join(directory, `${id}.json`), id);
    if (inspected.kind === "ok") items.set(id, inspected.run);
    return inspected;
  };
  return {
    save(run) {
      items.set(run.id, run);
      writeFileSync(path.join(directory, `${run.id}.json`), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    },
    load(id) {
      const inspected = inspect(id);
      return inspected.kind === "ok" ? inspected.run : undefined;
    },
    inspect,
    list() {
      return summarize([...items.values()]);
    },
  };
}

export function memoryAgentRunStore(): AgentRunStore {
  const items = new Map<string, AgentRun>();
  return {
    save(run) {
      items.set(run.id, run);
    },
    load(id) {
      return items.get(id);
    },
    inspect(id) {
      const run = items.get(id);
      return run === undefined ? { kind: "missing" } : { kind: "ok", run };
    },
    list() {
      return summarize([...items.values()]);
    },
  };
}

function summarize(runs: readonly AgentRun[]): readonly RunSummary[] {
  const rows: RunSummary[] = [];
  for (const run of runs) {
    const row = summarizeStoredRun(run);
    if (row !== undefined) rows.push(row);
  }
  rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return rows.slice(0, 50);
}
