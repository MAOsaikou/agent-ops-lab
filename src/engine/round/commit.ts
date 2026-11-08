import { canonicalJson } from "../json.js";
import { isRunId, type RunId } from "../ids.js";
import { isHash, type Hash } from "../types.js";
import {
  DECISION_COMMITTED,
  ROUND_REFLECTED,
  ROUND_SETTLED,
  committedJson,
  parseCommittedJson,
  parseReflectedJson,
  parseSettledJson,
  reflectedJson,
  settledJson,
  type CommittedBody,
  type ReflectedBody,
  type SettledBody,
} from "../events/payload.js";
import type { EventStore, StoredEvent } from "../events/store.js";

export class RoundAlreadyCommitted extends Error {
  readonly runId: RunId;
  readonly round: number;
  readonly storedDecisionHash: Hash;
  readonly attemptedDecisionHash: Hash;

  constructor(input: {
    runId: RunId;
    round: number;
    storedDecisionHash: Hash;
    attemptedDecisionHash: Hash;
  }) {
    super(`round ${input.round} is already committed`);
    this.name = "RoundAlreadyCommitted";
    this.runId = input.runId;
    this.round = input.round;
    this.storedDecisionHash = input.storedDecisionHash;
    this.attemptedDecisionHash = input.attemptedDecisionHash;
  }
}

export class MissingDecisionCommit extends Error {
  readonly runId: RunId;
  readonly round: number;

  constructor(runId: RunId, round: number) {
    super(`round ${round} has no commit`);
    this.name = "MissingDecisionCommit";
    this.runId = runId;
    this.round = round;
  }
}

export class DecisionHashMismatch extends Error {
  readonly runId: RunId;
  readonly round: number;
  readonly storedDecisionHash: Hash;
  readonly attemptedDecisionHash: Hash;

  constructor(input: {
    runId: RunId;
    round: number;
    storedDecisionHash: Hash;
    attemptedDecisionHash: Hash;
  }) {
    super(`round ${input.round} is committed under a different decision hash`);
    this.name = "DecisionHashMismatch";
    this.runId = input.runId;
    this.round = input.round;
    this.storedDecisionHash = input.storedDecisionHash;
    this.attemptedDecisionHash = input.attemptedDecisionHash;
  }
}

export class MissingSettlement extends Error {
  readonly runId: RunId;
  readonly round: number;

  constructor(runId: RunId, round: number) {
    super(`round ${round} has no settlement`);
    this.name = "MissingSettlement";
    this.runId = runId;
    this.round = round;
  }
}

export type CommittedRecord = CommittedBody & { readonly event: StoredEvent };
export type SettleResult = SettledBody & { readonly event: StoredEvent };
export type ReflectResult = ReflectedBody & { readonly event: StoredEvent };

export type CommitPayload = {
  readonly observationHash: Hash;
  readonly body: unknown;
};

function requireRun(runId: RunId): RunId {
  if (!isRunId(runId)) {
    throw new Error("run id is invalid");
  }
  return runId;
}

function requireRound(round: number): number {
  if (!Number.isSafeInteger(round) || round < 0) {
    throw new RangeError("round must be a non-negative integer");
  }
  return round;
}

function requireHash(value: Hash, label: string): Hash {
  if (!isHash(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function commitKey(runId: RunId, round: number): string {
  return `${runId}|${round}|commit`;
}

function settleKey(runId: RunId, round: number, decisionHash: Hash): string {
  return `${runId}|${round}|${decisionHash}|settle`;
}

function reflectKey(runId: RunId, round: number): string {
  return `${runId}|${round}|reflect`;
}

function finishCommit(
  event: StoredEvent,
  runId: RunId,
  round: number,
  decisionHash: Hash,
): CommittedRecord {
  if (event.type !== DECISION_COMMITTED || event.runId !== runId) {
    throw new Error("commit record does not match the request");
  }
  const parsed = parseCommittedJson(event.payloadJson);
  if (parsed.round !== round) {
    throw new Error("commit record does not match the request");
  }
  if (parsed.decisionHash !== decisionHash) {
    throw new RoundAlreadyCommitted({
      runId,
      round,
      storedDecisionHash: parsed.decisionHash,
      attemptedDecisionHash: decisionHash,
    });
  }
  return { event, ...parsed };
}

function finishSettle(event: StoredEvent, runId: RunId, round: number, decisionHash: Hash): SettleResult {
  if (event.type !== ROUND_SETTLED || event.runId !== runId) {
    throw new Error("settlement record does not match the request");
  }
  const parsed = parseSettledJson(event.payloadJson);
  if (parsed.round !== round || parsed.decisionHash !== decisionHash) {
    throw new Error("settlement record does not match the request");
  }
  return { event, ...parsed };
}

function finishReflect(event: StoredEvent, runId: RunId, round: number): ReflectResult {
  if (event.type !== ROUND_REFLECTED || event.runId !== runId) {
    throw new Error("reflect record does not match the request");
  }
  const parsed = parseReflectedJson(event.payloadJson);
  if (parsed.round !== round) {
    throw new Error("reflect record does not match the request");
  }
  return { event, ...parsed };
}

function loadCommit(store: EventStore, runId: RunId, round: number): CommittedRecord {
  const existing = store.findByIdempotencyKey(commitKey(runId, round));
  if (existing === undefined) {
    throw new MissingDecisionCommit(runId, round);
  }
  if (existing.type !== DECISION_COMMITTED) {
    throw new Error("commit key points at another event");
  }
  const parsed = parseCommittedJson(existing.payloadJson);
  return { event: existing, ...parsed };
}

export function commitDecision(input: {
  store: EventStore;
  runId: RunId;
  round: number;
  decisionHash: Hash;
  payload: CommitPayload;
}): CommittedRecord {
  const runId = requireRun(input.runId);
  const round = requireRound(input.round);
  const decisionHash = requireHash(input.decisionHash, "decision hash");
  const observationHash = requireHash(input.payload.observationHash, "observation hash");
  const key = commitKey(runId, round);
  const existing = input.store.findByIdempotencyKey(key);
  if (existing !== undefined) {
    return finishCommit(existing, runId, round, decisionHash);
  }
  const body: CommittedBody = {
    round,
    decisionHash,
    observationHash,
    bodyJson: canonicalJson(input.payload.body),
  };
  const event = input.store.append({
    runId,
    type: DECISION_COMMITTED,
    payloadJson: committedJson(body),
    causationId: null,
    idempotencyKey: key,
  });
  return finishCommit(event, runId, round, decisionHash);
}

export function settleRound(input: {
  store: EventStore;
  runId: RunId;
  round: number;
  decisionHash: Hash;
  produce: () => unknown;
}): SettleResult {
  const runId = requireRun(input.runId);
  const round = requireRound(input.round);
  const decisionHash = requireHash(input.decisionHash, "decision hash");
  const committed = loadCommit(input.store, runId, round);
  if (committed.decisionHash !== decisionHash) {
    throw new DecisionHashMismatch({
      runId,
      round,
      storedDecisionHash: committed.decisionHash,
      attemptedDecisionHash: decisionHash,
    });
  }
  const key = settleKey(runId, round, decisionHash);
  const existing = input.store.findByIdempotencyKey(key);
  if (existing !== undefined) {
    return finishSettle(existing, runId, round, decisionHash);
  }
  const outcomeJson = canonicalJson(input.produce());
  const body: SettledBody = { round, decisionHash, outcomeJson };
  const event = input.store.append({
    runId,
    type: ROUND_SETTLED,
    payloadJson: settledJson(body),
    causationId: committed.event.id,
    idempotencyKey: key,
  });
  return finishSettle(event, runId, round, decisionHash);
}

export function reflectRound(input: {
  store: EventStore;
  runId: RunId;
  round: number;
  write: () => { readonly beliefHash: Hash; readonly overlayHash: Hash };
}): ReflectResult {
  const runId = requireRun(input.runId);
  const round = requireRound(input.round);
  const committed = loadCommit(input.store, runId, round);
  const settled = input.store.findByIdempotencyKey(settleKey(runId, round, committed.decisionHash));
  if (settled === undefined) {
    throw new MissingSettlement(runId, round);
  }
  const key = reflectKey(runId, round);
  const existing = input.store.findByIdempotencyKey(key);
  if (existing !== undefined) {
    return finishReflect(existing, runId, round);
  }
  const written = input.write();
  const body: ReflectedBody = {
    round,
    beliefHash: requireHash(written.beliefHash, "belief hash"),
    overlayHash: requireHash(written.overlayHash, "overlay hash"),
  };
  const event = input.store.append({
    runId,
    type: ROUND_REFLECTED,
    payloadJson: reflectedJson(body),
    causationId: settled.id,
    idempotencyKey: key,
  });
  return finishReflect(event, runId, round);
}
