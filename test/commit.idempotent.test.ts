import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { canonicalJson } from "../src/engine/json.js";
import { sha256Hex } from "../src/engine/hash.js";
import { openEventStore } from "../src/engine/events/store.js";
import {
  DecisionHashMismatch,
  MissingDecisionCommit,
  RoundAlreadyCommitted,
  commitDecision,
  reflectRound,
  settleRound,
} from "../src/engine/round/commit.js";
import { parseRunId } from "../src/engine/ids.js";
import { expect, test } from "vitest";

function tempDb(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "u2-commit-")), "events.sqlite");
}

test("append is the only write, seq grows per run, and a duplicate key returns the row", () => {
  const store = openEventStore(tempDb());
  const runA = parseRunId("run-a");
  const runB = parseRunId("run-b");
  const first = store.append({
    runId: runA,
    type: "Note",
    payloadJson: "{\"n\":1}",
    causationId: null,
    idempotencyKey: null,
  });
  const second = store.append({
    runId: runA,
    type: "Note",
    payloadJson: "{\"n\":2}",
    causationId: null,
    idempotencyKey: null,
  });
  const other = store.append({
    runId: runB,
    type: "Note",
    payloadJson: "{\"n\":1}",
    causationId: null,
    idempotencyKey: "shared-looking",
  });
  expect(first.seq).toBe(1);
  expect(second.seq).toBe(2);
  expect(other.seq).toBe(1);
  expect(store.journalMode()).toBe("wal");
  expect(store.synchronous()).toBe(1);
  const duplicate = store.append({
    runId: runB,
    type: "Note",
    payloadJson: "{\"n\":9}",
    causationId: null,
    idempotencyKey: "shared-looking",
  });
  expect(duplicate.seq).toBe(other.seq);
  expect(duplicate.payloadJson).toBe(other.payloadJson);
  expect(store.count(runB)).toBe(1);
  expect(store.fold(runA, 0, (count) => count + 1)).toBe(2);
  expect(() =>
    store.append({
      runId: runA,
      type: "Note",
      payloadJson: "nope",
      causationId: null,
      idempotencyKey: null,
    }),
  ).toThrow(/json/);
  store.close();
  expect(() => store.count(runA)).toThrow(/closed/);
});

test("the same decision returns the stored commit and a different hash does not append", () => {
  const store = openEventStore(tempDb());
  const runId = parseRunId("commit-run");
  const decisionHash = sha256Hex("decision-a");
  const otherHash = sha256Hex("decision-b");
  const observationHash = sha256Hex("observation");
  const first = commitDecision({
    store,
    runId,
    round: 2,
    decisionHash,
    payload: { observationHash, body: { b: 1, a: 2 } },
  });
  const second = commitDecision({
    store,
    runId,
    round: 2,
    decisionHash,
    payload: { observationHash, body: { b: 1, a: 2 } },
  });
  expect(second.event.seq).toBe(first.event.seq);
  expect(second.decisionHash).toBe(decisionHash);
  expect(first.bodyJson).toBe('{"a":2,"b":1}');
  expect(first.event.idempotencyKey).toBe(`${runId}|2|commit`);
  const before = store.count(runId);
  expect(() =>
    commitDecision({
      store,
      runId,
      round: 2,
      decisionHash: otherHash,
      payload: { observationHash, body: { a: 2 } },
    }),
  ).toThrow(RoundAlreadyCommitted);
  expect(store.count(runId)).toBe(before);
  expect(store.list(runId).filter((event) => event.type === "DecisionCommitted")).toHaveLength(1);
  store.close();
});

test("settle calls produce once and reflect calls the writer once", () => {
  const store = openEventStore(tempDb());
  const runId = parseRunId("settle-run");
  const decisionHash = sha256Hex("decision");
  const observationHash = sha256Hex("seen");
  const committed = commitDecision({
    store,
    runId,
    round: 0,
    decisionHash,
    payload: { observationHash, body: { item: 1 } },
  });
  let produced = 0;
  const first = settleRound({
    store,
    runId,
    round: 0,
    decisionHash,
    produce() {
      produced += 1;
      return { b: 1, a: 2 };
    },
  });
  const second = settleRound({
    store,
    runId,
    round: 0,
    decisionHash,
    produce() {
      produced += 1;
      return { a: 9 };
    },
  });
  expect(produced).toBe(1);
  expect(second.outcomeJson).toBe(first.outcomeJson);
  expect(first.outcomeJson).toBe('{"a":2,"b":1}');
  expect(first.event.idempotencyKey).toBe(`${runId}|0|${decisionHash}|settle`);
  expect(first.event.causationId).toBe(committed.event.id);
  expect(store.list(runId).filter((event) => event.type === "RoundSettled")).toHaveLength(1);
  const beliefHash = sha256Hex("belief");
  const overlayHash = sha256Hex("overlay");
  let writes = 0;
  const reflected = reflectRound({
    store,
    runId,
    round: 0,
    write() {
      writes += 1;
      return { beliefHash, overlayHash };
    },
  });
  reflectRound({
    store,
    runId,
    round: 0,
    write() {
      writes += 1;
      return { beliefHash: sha256Hex("other"), overlayHash };
    },
  });
  expect(writes).toBe(1);
  expect(reflected.beliefHash).toBe(beliefHash);
  expect(reflected.event.idempotencyKey).toBe(`${runId}|0|reflect`);
  expect(reflected.event.causationId).toBe(first.event.id);
  expect(store.list(runId).filter((event) => event.type === "RoundReflected")).toHaveLength(1);
  expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  store.close();
});

test("a writer failure does not append, and a later call can finish", () => {
  const store = openEventStore(tempDb());
  const runId = parseRunId("reflect-retry");
  const decisionHash = sha256Hex("decision");
  commitDecision({
    store,
    runId,
    round: 4,
    decisionHash,
    payload: { observationHash: sha256Hex("obs"), body: { ok: true } },
  });
  settleRound({
    store,
    runId,
    round: 4,
    decisionHash,
    produce: () => ({ ok: true }),
  });
  let writes = 0;
  expect(() =>
    reflectRound({
      store,
      runId,
      round: 4,
      write() {
        writes += 1;
        throw new Error("reflect failed");
      },
    }),
  ).toThrow(/reflect failed/);
  expect(store.list(runId).filter((event) => event.type === "RoundReflected")).toHaveLength(0);
  reflectRound({
    store,
    runId,
    round: 4,
    write() {
      writes += 1;
      return { beliefHash: sha256Hex("belief"), overlayHash: sha256Hex("overlay") };
    },
  });
  expect(writes).toBe(2);
  expect(store.list(runId).filter((event) => event.type === "RoundReflected")).toHaveLength(1);
  store.close();
});

test("settle refuses a missing commit and a different decision hash", () => {
  const store = openEventStore(tempDb());
  const runId = parseRunId("settle-guard");
  const decisionHash = sha256Hex("kept");
  expect(() =>
    settleRound({
      store,
      runId,
      round: 1,
      decisionHash,
      produce: () => ({ ok: true }),
    }),
  ).toThrow(MissingDecisionCommit);
  commitDecision({
    store,
    runId,
    round: 1,
    decisionHash,
    payload: { observationHash: sha256Hex("obs"), body: {} },
  });
  const before = store.count(runId);
  expect(() =>
    settleRound({
      store,
      runId,
      round: 1,
      decisionHash: sha256Hex("other"),
      produce: () => ({ ok: false }),
    }),
  ).toThrow(DecisionHashMismatch);
  expect(store.count(runId)).toBe(before);
  store.close();
});
