export const ROUND_PHASES = [
  "Observing",
  "Scheduling",
  "Proposing",
  "Negotiating",
  "Verifying",
  "Revising",
  "AwaitingApproval",
  "Fallback",
  "FallbackApproval",
  "Committed",
  "Settled",
  "Reflected",
] as const;

export type RoundPhase = (typeof ROUND_PHASES)[number];

export const ROUND_EVENTS = [
  "ObservationPublished",
  "ScheduleChosen",
  "Conflict",
  "NoConflict",
  "NegotiationClosed",
  "VerificationFailed",
  "VerificationPassed",
  "RevisionSubmitted",
  "Return",
  "Veto",
  "Approve",
  "Timeout",
  "FallbackPrepared",
  "Settle",
  "Reflect",
] as const;

export type RoundEventName = (typeof ROUND_EVENTS)[number];

export type RoundState = {
  readonly phase: RoundPhase;
  readonly iterations: number;
  readonly returnsUsed: 0 | 1;
};

export type TransitionGuard =
  | { readonly kind: "always" }
  | { readonly kind: "iterationsUnderCap" }
  | { readonly kind: "iterationsAtCap" }
  | { readonly kind: "returnsUnused" };

export type TransitionEffect =
  | { readonly kind: "none" }
  | { readonly kind: "incrementIterations" }
  | { readonly kind: "useReturn" };

export type Transition = {
  readonly from: RoundPhase;
  readonly event: RoundEventName;
  readonly to: RoundPhase;
  readonly guard: TransitionGuard;
  readonly effect: TransitionEffect;
};

export const ROUND_TRANSITIONS: readonly Transition[] = [
  {
    from: "Observing",
    event: "ObservationPublished",
    to: "Scheduling",
    guard: { kind: "always" },
    effect: { kind: "none" },
  },
  {
    from: "Scheduling",
    event: "ScheduleChosen",
    to: "Proposing",
    guard: { kind: "always" },
    effect: { kind: "none" },
  },
  {
    from: "Proposing",
    event: "Conflict",
    to: "Negotiating",
    guard: { kind: "always" },
    effect: { kind: "none" },
  },
  {
    from: "Proposing",
    event: "NoConflict",
    to: "Verifying",
    guard: { kind: "always" },
    effect: { kind: "none" },
  },
  {
    from: "Negotiating",
    event: "NegotiationClosed",
    to: "Verifying",
    guard: { kind: "always" },
    effect: { kind: "none" },
  },
  {
    from: "Verifying",
    event: "VerificationFailed",
    to: "Revising",
    guard: { kind: "iterationsUnderCap" },
    effect: { kind: "incrementIterations" },
  },
  {
    from: "Verifying",
    event: "VerificationFailed",
    to: "Fallback",
    guard: { kind: "iterationsAtCap" },
    effect: { kind: "none" },
  },
  {
    from: "Verifying",
    event: "VerificationPassed",
    to: "AwaitingApproval",
    guard: { kind: "always" },
    effect: { kind: "none" },
  },
  {
    from: "Revising",
    event: "RevisionSubmitted",
    to: "Verifying",
    guard: { kind: "always" },
    effect: { kind: "none" },
  },
  {
    from: "AwaitingApproval",
    event: "Return",
    to: "Revising",
    guard: { kind: "returnsUnused" },
    effect: { kind: "useReturn" },
  },
  {
    from: "AwaitingApproval",
    event: "Veto",
    to: "Fallback",
    guard: { kind: "always" },
    effect: { kind: "none" },
  },
  {
    from: "AwaitingApproval",
    event: "Approve",
    to: "Committed",
    guard: { kind: "always" },
    effect: { kind: "none" },
  },
  {
    from: "AwaitingApproval",
    event: "Timeout",
    to: "Committed",
    guard: { kind: "always" },
    effect: { kind: "none" },
  },
  {
    from: "Fallback",
    event: "FallbackPrepared",
    to: "FallbackApproval",
    guard: { kind: "always" },
    effect: { kind: "none" },
  },
  {
    from: "FallbackApproval",
    event: "Approve",
    to: "Committed",
    guard: { kind: "always" },
    effect: { kind: "none" },
  },
  {
    from: "FallbackApproval",
    event: "Veto",
    to: "Committed",
    guard: { kind: "always" },
    effect: { kind: "none" },
  },
  {
    from: "FallbackApproval",
    event: "Timeout",
    to: "Committed",
    guard: { kind: "always" },
    effect: { kind: "none" },
  },
  {
    from: "Committed",
    event: "Settle",
    to: "Settled",
    guard: { kind: "always" },
    effect: { kind: "none" },
  },
  {
    from: "Settled",
    event: "Reflect",
    to: "Reflected",
    guard: { kind: "always" },
    effect: { kind: "none" },
  },
];

export class IllegalTransition extends Error {
  readonly phase: RoundPhase;
  readonly event: RoundEventName;
  readonly iterations: number;
  readonly returnsUsed: 0 | 1;
  readonly iterationCap: number;

  constructor(state: RoundState, event: RoundEventName, iterationCap: number) {
    super(`illegal transition ${state.phase} + ${event}`);
    this.name = "IllegalTransition";
    this.phase = state.phase;
    this.event = event;
    this.iterations = state.iterations;
    this.returnsUsed = state.returnsUsed;
    this.iterationCap = iterationCap;
  }
}

export function initialRound(): RoundState {
  return { phase: "Observing", iterations: 0, returnsUsed: 0 };
}

export function isRoundPhase(value: string): value is RoundPhase {
  for (const phase of ROUND_PHASES) {
    if (phase === value) {
      return true;
    }
  }
  return false;
}

function requireCap(iterationCap: number): number {
  if (!Number.isSafeInteger(iterationCap) || iterationCap < 0) {
    throw new RangeError("iteration cap must be a non-negative integer");
  }
  return iterationCap;
}

function requireState(state: RoundState): void {
  if (!isRoundPhase(state.phase)) {
    throw new Error("unknown round phase");
  }
  if (!Number.isSafeInteger(state.iterations) || state.iterations < 0) {
    throw new RangeError("iterations must be a non-negative integer");
  }
  if (state.returnsUsed !== 0 && state.returnsUsed !== 1) {
    throw new RangeError("returnsUsed must be 0 or 1");
  }
}

function guardAllows(guard: TransitionGuard, state: RoundState, cap: number): boolean {
  switch (guard.kind) {
    case "always":
      return true;
    case "iterationsUnderCap":
      return state.iterations < cap;
    case "iterationsAtCap":
      return state.iterations >= cap;
    case "returnsUnused":
      return state.returnsUsed === 0;
    default: {
      const _exhaustive: never = guard;
      return _exhaustive;
    }
  }
}

function applyEffect(state: RoundState, row: Transition): RoundState {
  switch (row.effect.kind) {
    case "none":
      return { phase: row.to, iterations: state.iterations, returnsUsed: state.returnsUsed };
    case "incrementIterations":
      return {
        phase: row.to,
        iterations: state.iterations + 1,
        returnsUsed: state.returnsUsed,
      };
    case "useReturn":
      return { phase: row.to, iterations: state.iterations, returnsUsed: 1 };
    default: {
      const _exhaustive: never = row.effect;
      return _exhaustive;
    }
  }
}

export function step(state: RoundState, event: RoundEventName, iterationCap: number): RoundState {
  const cap = requireCap(iterationCap);
  requireState(state);
  const matches = ROUND_TRANSITIONS.filter(
    (row) => row.from === state.phase && row.event === event && guardAllows(row.guard, state, cap),
  );
  if (matches.length > 1) {
    throw new Error(`ambiguous transition ${state.phase} + ${event}`);
  }
  const row = matches[0];
  if (row === undefined) {
    throw new IllegalTransition(state, event, cap);
  }
  return applyEffect(state, row);
}
