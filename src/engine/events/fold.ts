import { genesisHash, roundRecordHash } from "../hash.js";
import type { Hash, RoundRecord } from "../types.js";
import {
  DECISION_COMMITTED,
  ROUND_REFLECTED,
  ROUND_SETTLED,
  isEventType,
  parseCommittedJson,
  parseReflectedJson,
  parseSettledJson,
} from "./payload.js";
import type { StoredEvent } from "./store.js";

export type FoldedRun = {
  readonly lastSeq: number;
  readonly finalHash: Hash;
  readonly rounds: readonly RoundRecord[];
};

type HashField = "observationHash" | "decisionHash" | "beliefHash" | "overlayHash";

type OpenRound = {
  round: number;
  observationHash?: Hash;
  decisionHash?: Hash;
  outcomeJson?: string;
  beliefHash?: Hash;
  overlayHash?: Hash;
};

function ensure(partials: Map<number, OpenRound>, round: number): OpenRound {
  const existing = partials.get(round);
  if (existing !== undefined) {
    return existing;
  }
  const created: OpenRound = { round };
  partials.set(round, created);
  return created;
}

function readHash(part: OpenRound, field: HashField): Hash | undefined {
  switch (field) {
    case "observationHash":
      return part.observationHash;
    case "decisionHash":
      return part.decisionHash;
    case "beliefHash":
      return part.beliefHash;
    case "overlayHash":
      return part.overlayHash;
    default: {
      const _exhaustive: never = field;
      return _exhaustive;
    }
  }
}

function writeHash(part: OpenRound, field: HashField, value: Hash): void {
  switch (field) {
    case "observationHash":
      part.observationHash = value;
      return;
    case "decisionHash":
      part.decisionHash = value;
      return;
    case "beliefHash":
      part.beliefHash = value;
      return;
    case "overlayHash":
      part.overlayHash = value;
      return;
    default: {
      const _exhaustive: never = field;
      throw new Error(`unhandled hash field ${String(_exhaustive)}`);
    }
  }
}

function rememberHash(part: OpenRound, field: HashField, value: Hash): void {
  const current = readHash(part, field);
  if (current === undefined) {
    writeHash(part, field, value);
    return;
  }
  if (current !== value) {
    throw new Error(`round ${part.round} ${field} changed`);
  }
}

function rememberOutcome(part: OpenRound, outcomeJson: string): void {
  if (part.outcomeJson === undefined) {
    part.outcomeJson = outcomeJson;
    return;
  }
  if (part.outcomeJson !== outcomeJson) {
    throw new Error(`round ${part.round} outcome changed`);
  }
}

function applyEvent(partials: Map<number, OpenRound>, event: StoredEvent): void {
  if (!isEventType(event.type)) {
    throw new Error(`unknown event type ${event.type}`);
  }
  switch (event.type) {
    case DECISION_COMMITTED: {
      const parsed = parseCommittedJson(event.payloadJson);
      const part = ensure(partials, parsed.round);
      rememberHash(part, "decisionHash", parsed.decisionHash);
      rememberHash(part, "observationHash", parsed.observationHash);
      return;
    }
    case ROUND_SETTLED: {
      const parsed = parseSettledJson(event.payloadJson);
      const part = ensure(partials, parsed.round);
      rememberHash(part, "decisionHash", parsed.decisionHash);
      rememberOutcome(part, parsed.outcomeJson);
      return;
    }
    case ROUND_REFLECTED: {
      const parsed = parseReflectedJson(event.payloadJson);
      const part = ensure(partials, parsed.round);
      rememberHash(part, "beliefHash", parsed.beliefHash);
      rememberHash(part, "overlayHash", parsed.overlayHash);
      return;
    }
    default: {
      const _exhaustive: never = event.type;
      throw new Error(`unhandled event ${String(_exhaustive)}`);
    }
  }
}

function isSealed(part: OpenRound): part is OpenRound & {
  observationHash: Hash;
  decisionHash: Hash;
  outcomeJson: string;
  beliefHash: Hash;
  overlayHash: Hash;
} {
  return (
    part.observationHash !== undefined &&
    part.decisionHash !== undefined &&
    part.outcomeJson !== undefined &&
    part.beliefHash !== undefined &&
    part.overlayHash !== undefined
  );
}

function seal(partials: Map<number, OpenRound>): { rounds: RoundRecord[]; finalHash: Hash } {
  const numbers = [...partials.keys()].sort((left, right) => left - right);
  const rounds: RoundRecord[] = [];
  let prev = genesisHash();
  let expected: number | undefined;
  for (const round of numbers) {
    if (expected === undefined) {
      expected = round;
    }
    if (round !== expected) {
      break;
    }
    const part = partials.get(round);
    if (part === undefined || !isSealed(part)) {
      break;
    }
    const hash = roundRecordHash({
      prevHash: prev,
      round: part.round,
      observationHash: part.observationHash,
      decisionHash: part.decisionHash,
      outcomeJson: part.outcomeJson,
      beliefHash: part.beliefHash,
      overlayHash: part.overlayHash,
    });
    rounds.push({
      round: part.round,
      observationHash: part.observationHash,
      decisionHash: part.decisionHash,
      outcomeJson: part.outcomeJson,
      beliefHash: part.beliefHash,
      overlayHash: part.overlayHash,
      prevHash: prev,
      hash,
    });
    prev = hash;
    expected += 1;
  }
  return { rounds, finalHash: prev };
}

export function foldEvents(events: readonly StoredEvent[]): FoldedRun {
  let expectedSeq = 1;
  let runId: StoredEvent["runId"] | undefined;
  const partials = new Map<number, OpenRound>();
  for (const event of events) {
    if (event.seq !== expectedSeq) {
      throw new Error(`event sequence skipped ${expectedSeq}`);
    }
    expectedSeq += 1;
    if (runId === undefined) {
      runId = event.runId;
    } else if (runId !== event.runId) {
      throw new Error("fold received more than one run");
    }
    applyEvent(partials, event);
  }
  const sealed = seal(partials);
  const last = events.at(-1);
  return {
    lastSeq: last === undefined ? 0 : last.seq,
    finalHash: sealed.finalHash,
    rounds: sealed.rounds,
  };
}
