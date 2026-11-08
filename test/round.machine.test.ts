import {
  IllegalTransition,
  ROUND_EVENTS,
  ROUND_PHASES,
  ROUND_TRANSITIONS,
  initialRound,
  step,
  type RoundEventName,
  type RoundPhase,
  type RoundState,
  type Transition,
} from "../src/engine/round/machine.js";
import { expect, test } from "vitest";

const EXPECTED: readonly Transition[] = [
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

function guardAllows(row: Transition, state: RoundState, cap: number): boolean {
  switch (row.guard.kind) {
    case "always":
      return true;
    case "iterationsUnderCap":
      return state.iterations < cap;
    case "iterationsAtCap":
      return state.iterations >= cap;
    case "returnsUnused":
      return state.returnsUsed === 0;
    default: {
      const _exhaustive: never = row.guard;
      return _exhaustive;
    }
  }
}

function applyExpected(state: RoundState, row: Transition): RoundState {
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

function expectedNext(state: RoundState, event: RoundEventName, cap: number): RoundState | undefined {
  const rows = EXPECTED.filter(
    (row) => row.from === state.phase && row.event === event && guardAllows(row, state, cap),
  );
  if (rows.length > 1) {
    throw new Error(`spec has two rows for ${state.phase} + ${event}`);
  }
  const row = rows[0];
  if (row === undefined) {
    return undefined;
  }
  return applyExpected(state, row);
}

test("the exported table is the round spec", () => {
  expect(ROUND_TRANSITIONS).toEqual(EXPECTED);
  expect(ROUND_PHASES).toHaveLength(12);
  expect(ROUND_EVENTS).toHaveLength(15);
});

test("no edge leaves Committed toward Proposing or Verifying", () => {
  const leaving = ROUND_TRANSITIONS.filter(
    (row) => row.from === "Committed" && (row.to === "Proposing" || row.to === "Verifying"),
  );
  expect(leaving).toEqual([]);
  const outgoing = ROUND_TRANSITIONS.filter((row) => row.from === "Committed");
  expect(outgoing.map((row) => row.to)).toEqual(["Settled"]);
  expect(outgoing.map((row) => row.event)).toEqual(["Settle"]);
});

test("every phase against every event honors the spec", () => {
  const contexts: readonly { iterations: number; returnsUsed: 0 | 1; cap: number }[] = [
    { iterations: 0, returnsUsed: 0, cap: 3 },
    { iterations: 3, returnsUsed: 0, cap: 3 },
    { iterations: 0, returnsUsed: 1, cap: 3 },
    { iterations: 0, returnsUsed: 0, cap: 0 },
  ];
  for (const phase of ROUND_PHASES) {
    for (const event of ROUND_EVENTS) {
      for (const context of contexts) {
        const state: RoundState = {
          phase,
          iterations: context.iterations,
          returnsUsed: context.returnsUsed,
        };
        const label = `${phase} + ${event} iterations=${context.iterations} returns=${context.returnsUsed} cap=${context.cap}`;
        const expected = expectedNext(state, event, context.cap);
        if (expected === undefined) {
          expect(() => step(state, event, context.cap), label).toThrow(IllegalTransition);
        } else {
          expect(step(state, event, context.cap), label).toEqual(expected);
          if (phase === "Committed") {
            expect(expected.phase, label).not.toBe("Proposing");
            expect(expected.phase, label).not.toBe("Verifying");
          }
        }
      }
    }
  }
});

test("a failed verification under the cap revises once and then falls back", () => {
  let state = step(
    { phase: "Verifying", iterations: 0, returnsUsed: 0 },
    "VerificationFailed",
    1,
  );
  expect(state).toEqual({ phase: "Revising", iterations: 1, returnsUsed: 0 });
  state = step(state, "RevisionSubmitted", 1);
  expect(state.phase).toBe("Verifying");
  state = step(state, "VerificationFailed", 1);
  expect(state).toEqual({ phase: "Fallback", iterations: 1, returnsUsed: 0 });
});

test("Committed cannot step to Proposing or Verifying", () => {
  const committed: RoundState = { phase: "Committed", iterations: 0, returnsUsed: 0 };
  for (const event of ROUND_EVENTS) {
    if (event === "Settle") {
      expect(step(committed, event, 3).phase).toBe("Settled");
      continue;
    }
    expect(() => step(committed, event, 3)).toThrow(IllegalTransition);
  }
  expect(step(initialRound(), "ObservationPublished", 3).phase).toBe("Scheduling");
});

test("a negative iteration cap is rejected", () => {
  expect(() => step(initialRound(), "ObservationPublished", -1)).toThrow(RangeError);
});

test("later phases stay off the proposal loop", () => {
  const blocked: readonly RoundPhase[] = ["Committed", "Settled", "Reflected"];
  for (const phase of blocked) {
    for (const row of ROUND_TRANSITIONS) {
      if (row.from === phase) {
        expect(row.to).not.toBe("Proposing");
        expect(row.to).not.toBe("Verifying");
      }
    }
  }
});
