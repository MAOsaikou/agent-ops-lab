import { expect, test } from "vitest";

import type { Json } from "../src/engine/json.js";
import { isHash } from "../src/engine/types.js";
import type { StepContext } from "../src/engine/workflow/executor.js";
import {
  bothSpoke,
  chairNodeId,
  constraintNodeId,
  meetingConstraint,
  runMeeting,
  scribeNodeId,
  sealNodeId,
} from "../src/templates/meeting/workflow.js";

function context(values: Record<string, Json>): StepContext {
  return {
    iteration: 1,
    output(id) {
      const value = values[id];
      return value === undefined ? null : value;
    },
  };
}

test("the hard constraint rejects an empty utterance", () => {
  expect(
    meetingConstraint(
      context({
        [chairNodeId]: "open the meeting",
        [scribeNodeId]: "notes",
      }),
    ),
  ).toBe(true);
  expect(
    meetingConstraint(
      context({
        [chairNodeId]: "",
        [scribeNodeId]: "notes",
      }),
    ),
  ).toBe(false);
  expect(bothSpoke).toBe("meeting.both-spoke");
});

test("the meeting workflow reaches the same terminal hash twice", async () => {
  const first = await runMeeting();
  const second = await runMeeting();
  expect(isHash(first.terminalHash)).toBe(true);
  expect(first.terminalHash).toBe(second.terminalHash);
  expect(first.usedFallback).toBe(false);
  expect(second.usedFallback).toBe(false);
  expect(first.finished).toEqual(second.finished);
  const ids = first.finished.map((event) => event.nodeId);
  expect(ids).toContain(chairNodeId);
  expect(ids).toContain(scribeNodeId);
  expect(ids).toContain(constraintNodeId);
  expect(ids).toContain(sealNodeId);
  const constraint = first.finished.find((event) => event.nodeId === constraintNodeId);
  expect(constraint?.reason).toBe("verifiers passed");
});
