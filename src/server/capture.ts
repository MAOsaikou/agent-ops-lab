import path from "node:path";

import { foldEvents } from "../engine/events/fold.js";
import { defaultEventDbPath, openEventStore } from "../engine/events/store.js";
import type { StoredEvent } from "../engine/events/store.js";
import type { ShopProfile } from "../templates/simshop/agents.js";
import type { ScenarioName } from "../templates/simshop/market/scenario.js";
import { loadScenario } from "../templates/simshop/market/scenario.js";
import { runShop, type ShopSimulation } from "../templates/simshop/workflows/round.js";
import {
  DECISION_COMMITTED,
  ROUND_SETTLED,
  ledgerFrame,
  ledgerRoundOf,
  toFrame,
  type AuditEvent,
  type UiFrame,
} from "./frames.js";

import { parseRunId, type RunId } from "../engine/ids.js";

export type RunProfile = ShopProfile;

export type RunMeta = {
  readonly runId: string;
  readonly scenario: ScenarioName;
  readonly seed: number;
  readonly profile: RunProfile;
  readonly rounds: number;
  readonly plannedRounds: number;
  readonly llmMode: "mock";
  readonly finalHash: string;
  readonly ledgerHash: string;
  readonly calls: number;
  readonly callRoles: readonly string[];
  readonly minInventory: number;
  readonly priceWars: number;
  readonly quotes: number;
  readonly replayVerified: boolean;
  readonly orchestrationNote: string;
  readonly createdAt: string;
  readonly eventSource: "u5-runShop";
  readonly summary: readonly {
    readonly round: number;
    readonly calls: number;
    readonly stopReason: string | null;
    readonly usedFallback: boolean;
    readonly supply: boolean;
  }[];
};

export type RunRecord = {
  readonly meta: RunMeta;
  readonly frames: readonly UiFrame[];
};

export const ORCHESTRATION_NOTE =
  "U5 的节点事件按 runId|type|node#nonce 去重，跨回合重复的节点事件不会再次落盘，所以编排轨是首现流、不逐回合归属；报价、预算、循环与账本帧的回合号取自事件载荷本身。";

export function consoleRunId(scenario: ScenarioName, seed: number, profile: RunProfile): RunId {
  return parseRunId(`u7-${scenario}-s${String(seed)}-${profile}`);
}

function ledgerByRound(sim: ShopSimulation): Map<number, AuditEvent[]> {
  const grouped = new Map<number, AuditEvent[]>();
  for (const event of sim.ledgerEvents) {
    const round = ledgerRoundOf(event);
    const bucket = grouped.get(round);
    if (bucket === undefined) {
      grouped.set(round, [event]);
      continue;
    }
    bucket.push(event);
  }
  return grouped;
}

function mirrorLedger(runId: RunId, sim: ShopSimulation): boolean {
  const store = openEventStore(defaultEventDbPath());
  try {
    sim.ledgerEvents.forEach((event, index) => {
      store.append({
        runId,
        type: event.type,
        payloadJson: event.payloadJson,
        causationId: null,
        idempotencyKey: `${runId}|u7-mirror|${String(index)}`,
      });
    });
    const stored: readonly StoredEvent[] = store.list(runId);
    const folded = foldEvents(stored);
    if (folded.finalHash !== sim.hash) {
      throw new Error(`ledger replay mismatch: ${folded.finalHash} != ${sim.hash}`);
    }
    if (folded.rounds.length !== sim.rounds.length) {
      throw new Error(`ledger replay sealed ${String(folded.rounds.length)} rounds`);
    }
    return true;
  } finally {
    store.close();
  }
}

export function buildRecord(input: {
  readonly sim: ShopSimulation;
  readonly scenario: ScenarioName;
  readonly seed: number;
  readonly profile: RunProfile;
  readonly createdAt: string;
  readonly replayVerified: boolean;
}): RunRecord {
  const runId = consoleRunId(input.scenario, input.seed, input.profile);
  const ledger = ledgerByRound(input.sim);
  const frames: UiFrame[] = [];
  let seq = 0;

  for (const event of input.sim.events) {
    seq += 1;
    const frame = toFrame(runId, seq, event);
    if (frame !== null) {
      frames.push(frame);
    }
  }

  for (const summary of input.sim.rounds) {
    const roundEvents = ledger.get(summary.round);
    if (roundEvents === undefined) {
      continue;
    }
    const commits = roundEvents.filter((event) => event.type === DECISION_COMMITTED).length;
    const settles = roundEvents.filter((event) => event.type === ROUND_SETTLED).length;
    if (commits !== 1 || settles !== 1) {
      throw new Error(`round ${String(summary.round)} ledger is incomplete`);
    }
    for (const event of roundEvents) {
      seq += 1;
      frames.push(ledgerFrame(runId, seq, event));
    }
  }

  const quoteCount = frames.filter((frame) => frame.kind === "quote").length;
  const meta: RunMeta = {
    runId,
    scenario: input.scenario,
    seed: input.seed,
    profile: input.profile,
    rounds: input.sim.rounds.length,
    plannedRounds: loadScenario(input.scenario).truth.rounds,
    llmMode: "mock",
    finalHash: input.sim.hash,
    ledgerHash: input.sim.ledgerHash,
    calls: input.sim.calls,
    callRoles: input.sim.callRoles,
    minInventory: input.sim.minInventory,
    priceWars: input.sim.priceWars.length,
    quotes: quoteCount,
    replayVerified: input.replayVerified,
    orchestrationNote: ORCHESTRATION_NOTE,
    createdAt: input.createdAt,
    eventSource: "u5-runShop",
    summary: input.sim.rounds.map((round) => ({
      round: round.round,
      calls: round.calls,
      stopReason: round.stopReason,
      usedFallback: round.usedFallback,
      supply: round.supply,
    })),
  };
  return { meta, frames };
}

export async function captureRun(input: {
  readonly scenario: ScenarioName;
  readonly seed: number;
  readonly profile: RunProfile;
  readonly now?: () => Date;
}): Promise<RunRecord> {
  const sim = await runShop({
    scenario: input.scenario,
    seed: input.seed,
    profile: input.profile,
    callCap: null,
    p50Threshold: 1,
  });
  const runId = consoleRunId(input.scenario, input.seed, input.profile);
  const replayVerified = mirrorLedger(runId, sim);
  return buildRecord({
    sim,
    scenario: input.scenario,
    seed: input.seed,
    profile: input.profile,
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    replayVerified,
  });
}

export function runDirectory(from: string = process.cwd()): string {
  return path.join(path.dirname(defaultEventDbPath(from)), "u7-runs");
}
