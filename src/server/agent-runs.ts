import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { AgentRun, RunSummary } from "../templates/agentops/types.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function agentRunsDirectory(from: string = process.cwd()): string {
  return path.join(from, ".data", "agent-runs");
}

export type AgentRunStore = {
  save(run: AgentRun): void;
  load(id: string): AgentRun | undefined;
  list(): readonly RunSummary[];
};

export function openAgentRunStore(directory: string): AgentRunStore {
  mkdirSync(directory, { recursive: true });
  const items = new Map<string, AgentRun>();
  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith(".json")) continue;
    const id = entry.slice(0, -5);
    if (!ID_PATTERN.test(id)) continue;
    try {
      const raw: unknown = JSON.parse(readFileSync(path.join(directory, entry), "utf8"));
      if (typeof raw === "object" && raw !== null && "id" in raw && raw.id === id) {
        items.set(id, raw as AgentRun);
      }
    } catch {
      // Ignore malformed files on startup.
    }
  }
  return {
    save(run) {
      items.set(run.id, run);
      writeFileSync(path.join(directory, `${run.id}.json`), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    },
    load(id) {
      if (!ID_PATTERN.test(id)) return undefined;
      const cached = items.get(id);
      if (cached !== undefined) return cached;
      try {
        const raw: unknown = JSON.parse(readFileSync(path.join(directory, `${id}.json`), "utf8"));
        if (typeof raw !== "object" || raw === null || !("id" in raw) || raw.id !== id) return undefined;
        const run = raw as AgentRun;
        items.set(id, run);
        return run;
      } catch {
        return undefined;
      }
    },
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
    list() {
      return summarize([...items.values()]);
    },
  };
}

function summarize(runs: readonly AgentRun[]): readonly RunSummary[] {
  const rows: RunSummary[] = runs.map((run) => {
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
      failures: run.verifications.filter((item) => item.status === "fail").length,
    };
  });
  rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return rows.slice(0, 50);
}
