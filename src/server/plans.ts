import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { defaultEventDbPath } from "../engine/events/store.js";
import type { PlanResult, PlanSummary } from "../templates/pricing/model.js";
import { summarize } from "../templates/pricing/plan.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function plansDirectory(from: string = process.cwd()): string {
  return path.join(path.dirname(defaultEventDbPath(from)), "plans");
}

export type PlanStore = {
  save(plan: PlanResult): void;
  load(id: string): PlanResult | undefined;
  list(): readonly PlanSummary[];
};

function isPlan(value: unknown): value is PlanResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { id?: unknown; candidates?: unknown; hash?: unknown };
  return (
    typeof candidate.id === "string" &&
    typeof candidate.hash === "string" &&
    Array.isArray(candidate.candidates)
  );
}

export function openPlanStore(directory: string): PlanStore {
  mkdirSync(directory, { recursive: true });

  function fileOf(id: string): string {
    if (!ID_PATTERN.test(id)) {
      throw new Error(`plan id rejected: ${id}`);
    }
    return path.join(directory, `${id}.json`);
  }

  return {
    save(plan) {
      writeFileSync(fileOf(plan.id), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    },
    load(id) {
      if (!ID_PATTERN.test(id)) {
        return undefined;
      }
      let text: string;
      try {
        text = readFileSync(fileOf(id), "utf8");
      } catch {
        return undefined;
      }
      const parsed: unknown = JSON.parse(text);
      if (!isPlan(parsed)) {
        throw new Error(`stored plan ${id} is malformed`);
      }
      return parsed;
    },
    list() {
      const rows: PlanSummary[] = [];
      for (const name of readdirSync(directory)) {
        if (!name.endsWith(".json")) {
          continue;
        }
        const id = name.slice(0, -".json".length);
        if (!ID_PATTERN.test(id)) {
          continue;
        }
        const plan = this.load(id);
        if (plan === undefined) {
          continue;
        }
        const brief = summarize(plan);
        rows.push({
          id: plan.id,
          createdAt: plan.createdAt,
          name: plan.input.name,
          platform: plan.input.platform,
          priceCents: brief.priceCents,
          recommendedId: plan.locked?.candidateId ?? plan.recommendedId,
          monthProfitCents: brief.monthProfitCents,
          margin: brief.margin,
          locked: plan.locked !== null,
        });
      }
      rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      return rows.slice(0, 40);
    },
  };
}