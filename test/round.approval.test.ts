import {
  IllegalTransition,
  ROUND_EVENTS,
  ROUND_TRANSITIONS,
  initialRound,
  step,
  type RoundEventName,
  type RoundState,
} from "../src/engine/round/machine.js";
import { expect, test } from "vitest";

const CAP = 3;

function walk(events: readonly RoundEventName[], start: RoundState = initialRound()): RoundState {
  let state = start;
  for (const event of events) {
    state = step(state, event, CAP);
  }
  return state;
}

function awaitingApproval(): RoundState {
  return walk(["ObservationPublished", "ScheduleChosen", "NoConflict", "VerificationPassed"]);
}

test("a round can return at most once", () => {
  const started = awaitingApproval();
  expect(started.returnsUsed).toBe(0);
  const returned = step(started, "Return", CAP);
  expect(returned).toEqual({ phase: "Revising", iterations: 0, returnsUsed: 1 });
  const back = walk(["RevisionSubmitted", "VerificationPassed"], returned);
  expect(back.phase).toBe("AwaitingApproval");
  expect(back.returnsUsed).toBe(1);
  expect(() => step(back, "Return", CAP)).toThrow(IllegalTransition);
});

test("a return keeps the iteration count", () => {
  let state = walk([
    "ObservationPublished",
    "ScheduleChosen",
    "NoConflict",
  ]);
  expect(state.phase).toBe("Verifying");
  state = step(state, "VerificationFailed", CAP);
  expect(state).toEqual({ phase: "Revising", iterations: 1, returnsUsed: 0 });
  state = walk(["RevisionSubmitted", "VerificationPassed"], state);
  state = step(state, "Return", CAP);
  expect(state).toEqual({ phase: "Revising", iterations: 1, returnsUsed: 1 });
  state = walk(["RevisionSubmitted", "VerificationPassed"], state);
  expect(() => step(state, "Return", CAP)).toThrow(IllegalTransition);
});

test("a veto goes to Fallback, then FallbackApproval, then Committed", () => {
  const vetoed = step(awaitingApproval(), "Veto", CAP);
  expect(vetoed.phase).toBe("Fallback");
  const prepared = step(vetoed, "FallbackPrepared", CAP);
  expect(prepared.phase).toBe("FallbackApproval");
  expect(prepared.returnsUsed).toBe(0);
  expect(step(prepared, "Approve", CAP).phase).toBe("Committed");
  expect(step(prepared, "Veto", CAP).phase).toBe("Committed");
  expect(step(prepared, "Timeout", CAP).phase).toBe("Committed");
});

test("FallbackApproval has no return edge", () => {
  const prepared = walk(
    ["Veto", "FallbackPrepared"],
    awaitingApproval(),
  );
  expect(prepared.phase).toBe("FallbackApproval");
  expect(ROUND_TRANSITIONS.filter((row) => row.from === "FallbackApproval" && row.event === "Return")).toEqual(
    [],
  );
  expect(() => step(prepared, "Return", CAP)).toThrow(IllegalTransition);
  expect(() => step({ ...prepared, returnsUsed: 0 }, "Return", CAP)).toThrow(IllegalTransition);
  for (const event of ROUND_EVENTS) {
    if (event === "Approve" || event === "Veto" || event === "Timeout") {
      expect(step(prepared, event, CAP).phase).toBe("Committed");
      continue;
    }
    expect(() => step(prepared, event, CAP)).toThrow(IllegalTransition);
  }
});

test("approval and timeout commit, and Committed only settles", () => {
  const committed = step(awaitingApproval(), "Approve", CAP);
  expect(committed.phase).toBe("Committed");
  expect(step(awaitingApproval(), "Timeout", CAP).phase).toBe("Committed");
  for (const event of ROUND_EVENTS) {
    if (event === "Settle") {
      const settled = step(committed, event, CAP);
      expect(settled.phase).toBe("Settled");
      expect(step(settled, "Reflect", CAP).phase).toBe("Reflected");
      continue;
    }
    expect(() => step(committed, event, CAP)).toThrow(IllegalTransition);
  }
  expect(() => step(committed, "NoConflict", CAP)).toThrow(IllegalTransition);
  expect(() => step(committed, "VerificationPassed", CAP)).toThrow(IllegalTransition);
  expect(() => step(committed, "Conflict", CAP)).toThrow(IllegalTransition);
});
