import { isRunId, type RunId } from "./ids.js";

export type Hash = string & { readonly __brand: "Hash" };
export type EventId = string & { readonly __brand: "EventId" };

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const EVENT_ID_PATTERN = /^([A-Za-z0-9][A-Za-z0-9_-]{0,127}):([1-9][0-9]*)$/;

export function isHash(input: string): input is Hash {
  return HASH_PATTERN.test(input);
}

export function isEventId(input: string): input is EventId {
  const match = EVENT_ID_PATTERN.exec(input);
  if (match === null) {
    return false;
  }
  const run = match[1];
  const seqText = match[2];
  if (run === undefined || seqText === undefined || !isRunId(run)) {
    return false;
  }
  const seq = Number(seqText);
  return Number.isSafeInteger(seq) && seq > 0;
}

export function eventIdOf(runId: RunId, seq: number): EventId {
  if (!Number.isSafeInteger(seq) || seq <= 0) {
    throw new RangeError("event seq must be a positive integer");
  }
  const text = `${runId}:${String(seq)}`;
  if (!isEventId(text)) {
    throw new Error("event id is invalid");
  }
  return text;
}

export type RoundRecord = {
  readonly round: number;
  readonly observationHash: Hash;
  readonly decisionHash: Hash;
  readonly outcomeJson: string;
  readonly beliefHash: Hash;
  readonly overlayHash: Hash;
  readonly prevHash: Hash;
  readonly hash: Hash;
};
