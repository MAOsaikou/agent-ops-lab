import { canonicalJson } from "../engine/json.js";
import { genesisHash, roundRecordHash } from "../engine/hash.js";
import { isHash, type Hash } from "../engine/types.js";
import type { OutcomeRow, UiFrame } from "./frames.js";

function hashOf(value: string, label: string): Hash {
  if (!isHash(value)) {
    throw new Error(`${label} is not a sha256 hash`);
  }
  return value;
}

export type SealedRound = {
  readonly round: number;
  readonly locked: boolean;
  readonly source: string;
  readonly decisionHash: string;
  readonly observationHash: string;
  readonly beliefHash: string;
  readonly overlayHash: string;
  readonly hash: string;
  readonly prevHash: string;
  readonly outcome: OutcomeRow;
};
export type SealedLedger = {
  readonly rounds: readonly SealedRound[];
  readonly finalHash: Hash;
};

type OpenRound = {
  round: number;
  source?: string;
  decisionHash?: string;
  observationHash?: string;
  beliefHash?: string;
  overlayHash?: string;
  outcome?: OutcomeRow;
};

function write(or: OpenRound, frame: UiFrame): void {
  if (frame.kind === "commit") {
    or.source = frame.source;
    or.decisionHash = frame.decisionHash;
    or.observationHash = frame.observationHash;
    return;
  }
  if (frame.kind === "settle") {
    or.outcome = frame.outcome;
    return;
  }
  if (frame.kind === "reflect") {
    or.beliefHash = frame.beliefHash;
    or.overlayHash = frame.overlayHash;
  }
}

function isSealed(or: OpenRound): or is OpenRound & {
  source: string;
  decisionHash: string;
  observationHash: string;
  beliefHash: string;
  overlayHash: string;
  outcome: OutcomeRow;
} {
  return (
    or.source !== undefined &&
    or.decisionHash !== undefined &&
    or.observationHash !== undefined &&
    or.beliefHash !== undefined &&
    or.overlayHash !== undefined &&
    or.outcome !== undefined
  );
}

export function sealLedger(frames: readonly UiFrame[]): SealedLedger {
  const open = new Map<number, OpenRound>();
  for (const frame of frames) {
    if (frame.kind !== "commit" && frame.kind !== "settle" && frame.kind !== "reflect") {
      continue;
    }
    const existing = open.get(frame.round);
    if (existing === undefined) {
      open.set(frame.round, { round: frame.round });
    }
    const target = open.get(frame.round);
    if (target === undefined) {
      continue;
    }
    write(target, frame);
  }
  const numbers = [...open.keys()].sort((left, right) => left - right);
  const rounds: SealedRound[] = [];
  let prev = genesisHash();
  for (const number of numbers) {
    const or = open.get(number);
    if (or === undefined || !isSealed(or)) {
      continue;
    }
    const hash = roundRecordHash({
      prevHash: prev,
      round: number,
      observationHash: hashOf(or.observationHash, "observation hash"),
      decisionHash: hashOf(or.decisionHash, "decision hash"),
      outcomeJson: canonicalJson(or.outcome),
      beliefHash: hashOf(or.beliefHash, "belief hash"),
      overlayHash: hashOf(or.overlayHash, "overlay hash"),
    });
    rounds.push({
      round: number,
      locked: true,
      source: or.source,
      decisionHash: or.decisionHash,
      observationHash: or.observationHash,
      beliefHash: or.beliefHash,
      overlayHash: or.overlayHash,
      hash,
      prevHash: prev,
      outcome: or.outcome,
    });
    prev = hash;
  }
  return { rounds, finalHash: prev };
}
