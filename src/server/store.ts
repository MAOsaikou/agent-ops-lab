import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { isRunId } from "../engine/ids.js";
import type { RunMeta, RunRecord } from "./capture.js";

export type RunStore = {
  save(record: RunRecord): void;
  load(runId: string): RunRecord | undefined;
  list(): readonly RunMeta[];
};

function isRecord(value: unknown): value is RunRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { meta?: unknown; frames?: unknown };
  return typeof candidate.meta === "object" && Array.isArray(candidate.frames);
}

export function openRunStore(directory: string): RunStore {
  mkdirSync(directory, { recursive: true });

  function fileOf(runId: string): string {
    if (!isRunId(runId)) {
      throw new Error(`run id rejected: ${runId}`);
    }
    return path.join(directory, `${runId}.json`);
  }

  return {
    save(record) {
      writeFileSync(fileOf(record.meta.runId), `${JSON.stringify(record, null, 2)}\n`, "utf8");
    },
    load(runId) {
      const file = fileOf(runId);
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        return undefined;
      }
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed)) {
        throw new Error(`stored run ${runId} is malformed`);
      }
      return parsed;
    },
    list() {
      const metas: RunMeta[] = [];
      for (const name of readdirSync(directory)) {
        if (!name.endsWith(".json")) {
          continue;
        }
        const runId = name.slice(0, -".json".length);
        if (!isRunId(runId)) {
          continue;
        }
        const record = this.load(runId);
        if (record !== undefined) {
          metas.push(record.meta);
        }
      }
      metas.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      return metas;
    },
  };
}
