import { z } from "zod";

import { assertCanonicalJson, canonicalJson, jsonValue } from "../json.js";
import { isHash, type Hash } from "../types.js";

export const DECISION_COMMITTED = "DecisionCommitted";
export const ROUND_SETTLED = "RoundSettled";
export const ROUND_REFLECTED = "RoundReflected";

export const EVENT_TYPES = [DECISION_COMMITTED, ROUND_SETTLED, ROUND_REFLECTED] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export function isEventType(value: string): value is EventType {
  for (const type of EVENT_TYPES) {
    if (type === value) {
      return true;
    }
  }
  return false;
}

const roundSchema = z.int().nonnegative();
const hashText = z.string();

const committedRaw = z.strictObject({
  bodyJson: z.string(),
  decisionHash: hashText,
  observationHash: hashText,
  round: roundSchema,
});

const settledRaw = z.strictObject({
  decisionHash: hashText,
  outcomeJson: z.string(),
  round: roundSchema,
});

const reflectedRaw = z.strictObject({
  beliefHash: hashText,
  overlayHash: hashText,
  round: roundSchema,
});

export type CommittedBody = {
  readonly round: number;
  readonly decisionHash: Hash;
  readonly observationHash: Hash;
  readonly bodyJson: string;
};

export type SettledBody = {
  readonly round: number;
  readonly decisionHash: Hash;
  readonly outcomeJson: string;
};

export type ReflectedBody = {
  readonly round: number;
  readonly beliefHash: Hash;
  readonly overlayHash: Hash;
};

function requireHash(value: string, label: string): Hash {
  if (!isHash(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function committedJson(input: CommittedBody): string {
  return canonicalJson({
    bodyJson: input.bodyJson,
    decisionHash: input.decisionHash,
    observationHash: input.observationHash,
    round: input.round,
  });
}

export function settledJson(input: SettledBody): string {
  return canonicalJson({
    decisionHash: input.decisionHash,
    outcomeJson: input.outcomeJson,
    round: input.round,
  });
}

export function reflectedJson(input: ReflectedBody): string {
  return canonicalJson({
    beliefHash: input.beliefHash,
    overlayHash: input.overlayHash,
    round: input.round,
  });
}

export function parseCommittedJson(text: string): CommittedBody {
  assertCanonicalJson(text);
  const raw = committedRaw.parse(jsonValue(text));
  return {
    round: raw.round,
    decisionHash: requireHash(raw.decisionHash, "decision hash"),
    observationHash: requireHash(raw.observationHash, "observation hash"),
    bodyJson: assertCanonicalJson(raw.bodyJson),
  };
}

export function parseSettledJson(text: string): SettledBody {
  assertCanonicalJson(text);
  const raw = settledRaw.parse(jsonValue(text));
  return {
    round: raw.round,
    decisionHash: requireHash(raw.decisionHash, "decision hash"),
    outcomeJson: assertCanonicalJson(raw.outcomeJson),
  };
}

export function parseReflectedJson(text: string): ReflectedBody {
  assertCanonicalJson(text);
  const raw = reflectedRaw.parse(jsonValue(text));
  return {
    round: raw.round,
    beliefHash: requireHash(raw.beliefHash, "belief hash"),
    overlayHash: requireHash(raw.overlayHash, "overlay hash"),
  };
}
