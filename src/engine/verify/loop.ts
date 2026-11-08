import { z } from "zod";

import type { EventStore } from "../events/store.js";
import type { RunId } from "../ids.js";
import { canonicalJson, jsonValue } from "../json.js";
import type { Hash } from "../types.js";
import type { Verdict, VerifyReport } from "./pipeline.js";

export const LOOP_ITERATED = "LoopIterated";
export const DEFAULT_MAX_ITERATIONS = 3;

export const STOP_REASONS = [
  "maxIterations",
  "budget",
  "p50Plateau",
  "repeatedDecision",
  "passed",
] as const;

export type StopReason = (typeof STOP_REASONS)[number];

export type LoopIteration = {
  readonly iteration: number;
  readonly decisionHash: string;
  readonly p50: number;
  readonly verdict: Verdict;
  readonly stopReason: StopReason | null;
  readonly callsUsed: number;
  readonly confidence: number | null;
};

export type LoopStep<Decision> = {
  readonly report: VerifyReport<Decision>;
  readonly calls: number;
  readonly decisionHash: Hash;
};

export type LoopResult<Decision> = {
  readonly stopReason: StopReason;
  readonly passed: boolean;
  readonly iterations: readonly LoopIteration[];
  readonly decision: Decision | null;
  readonly decisionJson: string;
};

const stopSchema = z.enum(STOP_REASONS);
const verdictSchema = z.enum(["pass", "revise", "reject"]);

const storedSchema = z.strictObject({
  callsUsed: z.number().int().nonnegative(),
  confidence: z.number().nullable(),
  decisionHash: z.string(),
  decisionJson: z.string(),
  iteration: z.number().int().positive(),
  nextJson: z.string().nullable(),
  p50: z.number(),
  round: z.number().int().nonnegative(),
  stopReason: stopSchema.nullable(),
  verdict: verdictSchema,
});

type StoredIteration = z.infer<typeof storedSchema>;

export function revisionStop(input: {
  readonly iteration: number;
  readonly maxIterations: number;
  readonly callsUsed: number;
  readonly callBudget: number;
  readonly p50: number;
  readonly previousP50: number | null;
  readonly p50Threshold: number;
  readonly decisionHash: string;
  readonly seenHashes: readonly string[];
  readonly passed: boolean;
}): StopReason | null {
  if (input.passed) return "passed";
  if (input.iteration >= input.maxIterations) return "maxIterations";
  if (input.callsUsed >= input.callBudget) return "budget";
  if (input.previousP50 !== null && input.p50 - input.previousP50 < input.p50Threshold) {
    return "p50Plateau";
  }
  if (input.seenHashes.includes(input.decisionHash)) return "repeatedDecision";
  return null;
}

function loopKey(runId: RunId, round: number, iteration: number): string {
  return `${runId}|${String(round)}|${LOOP_ITERATED}|${String(iteration)}`;
}

function readStored(events: EventStore, runId: RunId, round: number): StoredIteration[] {
  const stored: StoredIteration[] = [];
  for (const event of events.list(runId)) {
    if (event.type !== LOOP_ITERATED) continue;
    const parsed = storedSchema.safeParse(jsonValue(event.payloadJson));
    if (!parsed.success) {
      throw new Error(`LoopIterated payload is invalid: ${parsed.error.message}`);
    }
    if (parsed.data.round !== round) continue;
    stored.push(parsed.data);
  }
  stored.sort((left, right) => left.iteration - right.iteration);
  return stored;
}

function toIteration(stored: StoredIteration): LoopIteration {
  return {
    iteration: stored.iteration,
    decisionHash: stored.decisionHash,
    p50: stored.p50,
    verdict: stored.verdict,
    stopReason: stored.stopReason,
    callsUsed: stored.callsUsed,
    confidence: stored.confidence,
  };
}

function finished(stored: readonly StoredIteration[]): LoopResult<never> | null {
  if (stored.length === 0) return null;
  for (let index = 0; index < stored.length; index += 1) {
    const row = stored[index];
    if (row === undefined || row.iteration !== index + 1) {
      throw new Error("LoopIterated iterations are not contiguous");
    }
  }
  const last = stored[stored.length - 1];
  if (last === undefined || last.stopReason === null) return null;
  return {
    stopReason: last.stopReason,
    passed: last.stopReason === "passed",
    iterations: stored.map(toIteration),
    decision: null,
    decisionJson: last.decisionJson,
  };
}

function writeIteration(
  events: EventStore,
  runId: RunId,
  row: StoredIteration,
): void {
  events.append({
    runId,
    type: LOOP_ITERATED,
    payloadJson: canonicalJson({
      callsUsed: row.callsUsed,
      confidence: row.confidence,
      decisionHash: row.decisionHash,
      decisionJson: row.decisionJson,
      iteration: row.iteration,
      nextJson: row.nextJson,
      p50: row.p50,
      round: row.round,
      stopReason: row.stopReason,
      verdict: row.verdict,
    }),
    causationId: null,
    idempotencyKey: loopKey(runId, row.round, row.iteration),
  });
}

function p50Of<Decision>(report: VerifyReport<Decision>): number {
  return report.forecast?.profitCents.p50 ?? 0;
}

function openRaw(stored: readonly StoredIteration[], initial: unknown): unknown {
  const last = stored[stored.length - 1];
  if (last === undefined || last.stopReason !== null) return initial;
  if (last.nextJson === null) {
    throw new Error("open revision is missing its next decision");
  }
  return jsonValue(last.nextJson);
}

export async function revisionLoop<Decision>(input: {
  readonly events: EventStore;
  readonly runId: RunId;
  readonly round: number;
  readonly maxIterations?: number;
  readonly callBudget: number;
  readonly p50Threshold: number;
  readonly initial: unknown;
  readonly verify: (raw: unknown, iteration: number) => LoopStep<Decision> | Promise<LoopStep<Decision>>;
  readonly revise: (
    report: VerifyReport<Decision>,
    iteration: number,
  ) => Promise<{ readonly raw: unknown; readonly calls: number }>;
}): Promise<LoopResult<Decision>> {
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  if (!Number.isInteger(maxIterations) || maxIterations < 1) {
    throw new RangeError("maxIterations must be a positive integer");
  }
  if (!Number.isInteger(input.callBudget) || input.callBudget < 0) {
    throw new RangeError("callBudget must be a non-negative integer");
  }
  const existing = readStored(input.events, input.runId, input.round);
  const resumed = finished(existing);
  if (resumed !== null) return resumed;

  const iterations: LoopIteration[] = existing.map(toIteration);
  let callsUsed = iterations.length === 0 ? 0 : (iterations[iterations.length - 1]?.callsUsed ?? 0);
  let raw = openRaw(existing, input.initial);
  let decision: Decision | null = null;
  const seen: string[] = [];
  for (const row of iterations) {
    if (row.decisionHash.length > 0) seen.push(row.decisionHash);
  }

  for (let iteration = iterations.length + 1; iteration <= maxIterations; iteration += 1) {
    if (callsUsed >= input.callBudget) {
      const row: StoredIteration = {
        callsUsed,
        confidence: null,
        decisionHash: "",
        decisionJson: "null",
        iteration,
        nextJson: null,
        p50: 0,
        round: input.round,
        stopReason: "budget",
        verdict: "reject",
      };
      writeIteration(input.events, input.runId, row);
      iterations.push(toIteration(row));
      return {
        stopReason: "budget",
        passed: false,
        iterations,
        decision: null,
        decisionJson: "null",
      };
    }
    const step = await input.verify(raw, iteration);
    callsUsed += step.calls;
    decision = step.report.decision;
    const decisionJson = canonicalJson(step.report.decision ?? null);
    const currentP50 = p50Of(step.report);
    const previous = iterations[iterations.length - 1];
    const reason = revisionStop({
      iteration,
      maxIterations,
      callsUsed,
      callBudget: input.callBudget,
      p50: currentP50,
      previousP50: previous === undefined ? null : previous.p50,
      p50Threshold: input.p50Threshold,
      decisionHash: step.decisionHash,
      seenHashes: seen,
      passed: step.report.verdict === "pass",
    });
    let nextJson: string | null = null;
    if (reason === null) {
      const revised = await input.revise(step.report, iteration);
      callsUsed += revised.calls;
      nextJson = canonicalJson(revised.raw);
      raw = revised.raw;
    }
    const row: StoredIteration = {
      callsUsed,
      confidence: step.report.confidence,
      decisionHash: step.decisionHash,
      decisionJson,
      iteration,
      nextJson,
      p50: currentP50,
      round: input.round,
      stopReason: reason,
      verdict: step.report.verdict,
    };
    writeIteration(input.events, input.runId, row);
    iterations.push(toIteration(row));
    seen.push(step.decisionHash);
    if (reason !== null) {
      return {
        stopReason: reason,
        passed: reason === "passed",
        iterations,
        decision,
        decisionJson,
      };
    }
  }
  throw new Error("revision loop ended without a stop reason");
}
