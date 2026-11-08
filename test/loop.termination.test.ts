import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

import { openEventStore } from "../src/engine/events/store.js";
import { sha256Hex } from "../src/engine/hash.js";
import { parseRunId } from "../src/engine/ids.js";
import { canonicalJson, jsonValue } from "../src/engine/json.js";
import { LOOP_ITERATED, revisionLoop, STOP_REASONS, type StopReason } from "../src/engine/verify/loop.js";
import type { VerifyReport } from "../src/engine/verify/pipeline.js";

type Packet = { readonly n: number };

function tempDb(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "u5-loop-")), "events.sqlite");
}

function report(input: { readonly pass: boolean; readonly p50: number; readonly confidence: number; readonly decision: Packet }): VerifyReport<Packet> {
  return {
    verdict: input.pass ? "pass" : "revise",
    decision: input.decision,
    checks: [
      { id: "schema", pass: true, detail: "ok" },
      { id: "cash-after", pass: input.pass, detail: input.pass ? "cash holds" : "cash would go negative" },
    ],
    forecast: { profitCents: { p10: input.p50, p50: input.p50, p90: input.p50 }, stockoutRisk: 0, samples: 1 },
    objections: input.pass ? [] : [{ claim: "cash breaks", evidence: "cash-after" }],
    dropped: [],
    confidence: input.confidence,
  };
}

async function drive(input: {
  readonly steps: readonly { readonly n: number; readonly p50: number; readonly pass: boolean; readonly calls: number }[];
  readonly maxIterations: number;
  readonly callBudget: number;
  readonly p50Threshold: number;
  readonly confidence: number;
}) {
  const store = openEventStore(tempDb());
  const seen = { verify: 0, revise: 0 };
  let cursor = 0;
  const run = () =>
    revisionLoop<Packet>({
      events: store,
      runId: parseRunId("loop"),
      round: 0,
      maxIterations: input.maxIterations,
      callBudget: input.callBudget,
      p50Threshold: input.p50Threshold,
      initial: { n: input.steps[0]?.n ?? 0 },
      async verify() {
        seen.verify += 1;
        const step = input.steps[cursor];
        if (step === undefined) throw new Error("verify ran past the script");
        return {
          report: report({ pass: step.pass, p50: step.p50, confidence: input.confidence, decision: { n: step.n } }),
          calls: step.calls,
          decisionHash: sha256Hex(canonicalJson({ n: step.n })),
        };
      },
      async revise() {
        seen.revise += 1;
        cursor += 1;
        const step = input.steps[cursor];
        if (step === undefined) throw new Error("revise ran past the script");
        return { raw: { n: step.n }, calls: 0 };
      },
    });
  try {
    const first = await run();
    const events = store.list(parseRunId("loop")).filter((event) => event.type === LOOP_ITERATED);
    return { first, events, seen, again: run };
  } finally {
    store.close();
  }
}

function readReason(value: unknown): StopReason | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("stop reason is not text");
  for (const reason of STOP_REASONS) {
    if (reason === value) return reason;
  }
  throw new Error(`unknown stop reason ${value}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function eventField(payloadJson: string, key: string): unknown {
  const body = jsonValue(payloadJson);
  if (!isRecord(body) || !Object.hasOwn(body, key)) {
    throw new Error(`loop event missing ${key}`);
  }
  return body[key];
}

test("the loop stops at the iteration cap", async () => {
  const { first, events } = await drive({
    steps: [
      { n: 1, p50: 10, pass: false, calls: 1 },
      { n: 2, p50: 40, pass: false, calls: 1 },
      { n: 3, p50: 80, pass: false, calls: 1 },
    ],
    maxIterations: 3,
    callBudget: 20,
    p50Threshold: Number.NEGATIVE_INFINITY,
    confidence: 0.99,
  });
  expect(first.stopReason).toBe("maxIterations");
  expect(first.passed).toBe(false);
  expect(events.map((event) => readReason(eventField(event.payloadJson, "stopReason")))).toEqual([
    null,
    null,
    "maxIterations",
  ]);
  expect(events.map((event) => eventField(event.payloadJson, "confidence"))).toEqual([0.99, 0.99, 0.99]);
});

test("the loop stops when the call budget is already spent", async () => {
  const empty = await drive({
    steps: [{ n: 1, p50: 10, pass: false, calls: 1 }],
    maxIterations: 3,
    callBudget: 0,
    p50Threshold: Number.NEGATIVE_INFINITY,
    confidence: 1,
  });
  expect(empty.first.stopReason).toBe("budget");
  expect(empty.seen.verify).toBe(0);
  expect(empty.first.passed).toBe(false);

  const spent = await drive({
    steps: [
      { n: 1, p50: 10, pass: false, calls: 1 },
      { n: 2, p50: 50, pass: false, calls: 1 },
    ],
    maxIterations: 5,
    callBudget: 1,
    p50Threshold: Number.NEGATIVE_INFINITY,
    confidence: 0.2,
  });
  expect(spent.first.stopReason).toBe("budget");
  expect(spent.seen.verify).toBe(1);
  expect(spent.first.iterations).toHaveLength(1);
});

test("the loop stops when two iterations miss the p50 threshold", async () => {
  const { first } = await drive({
    steps: [
      { n: 1, p50: 100, pass: false, calls: 1 },
      { n: 2, p50: 105, pass: false, calls: 1 },
      { n: 3, p50: 200, pass: false, calls: 1 },
    ],
    maxIterations: 5,
    callBudget: 20,
    p50Threshold: 10,
    confidence: 0.4,
  });
  expect(first.stopReason).toBe("p50Plateau");
  expect(first.iterations).toHaveLength(2);
  expect(first.passed).toBe(false);
});

test("the loop stops when a decision hash repeats", async () => {
  const { first } = await drive({
    steps: [
      { n: 7, p50: 10, pass: false, calls: 1 },
      { n: 7, p50: 90, pass: false, calls: 1 },
    ],
    maxIterations: 5,
    callBudget: 20,
    p50Threshold: Number.NEGATIVE_INFINITY,
    confidence: 0.8,
  });
  expect(first.stopReason).toBe("repeatedDecision");
  expect(first.iterations).toHaveLength(2);
});

test("hard checks and cited objections stop the loop, and confidence does not", async () => {
  const passed = await drive({
    steps: [{ n: 4, p50: 12, pass: true, calls: 1 }],
    maxIterations: 3,
    callBudget: 1,
    p50Threshold: 100,
    confidence: 0,
  });
  expect(passed.first.stopReason).toBe("passed");
  expect(passed.first.passed).toBe(true);
  expect(passed.first.iterations).toHaveLength(1);
  expect(passed.seen.revise).toBe(0);

  const doubted = await drive({
    steps: [
      { n: 1, p50: 1, pass: false, calls: 1 },
      { n: 2, p50: 2, pass: false, calls: 1 },
      { n: 3, p50: 3, pass: false, calls: 1 },
    ],
    maxIterations: 3,
    callBudget: 20,
    p50Threshold: Number.NEGATIVE_INFINITY,
    confidence: 1,
  });
  expect(doubted.first.stopReason).toBe("maxIterations");
  expect(doubted.first.passed).toBe(false);
});

test("a finished loop appends nothing and calls nothing the second time", async () => {
  const store = openEventStore(tempDb());
  const runId = parseRunId("loop-again");
  let verifies = 0;
  const once = () =>
    revisionLoop<Packet>({
      events: store,
      runId,
      round: 1,
      maxIterations: 3,
      callBudget: 10,
      p50Threshold: Number.NEGATIVE_INFINITY,
      initial: { n: 1 },
      async verify() {
        verifies += 1;
        return {
          report: report({ pass: true, p50: 5, confidence: 0.1, decision: { n: verifies } }),
          calls: 1,
          decisionHash: sha256Hex(canonicalJson({ n: verifies })),
        };
      },
      async revise() {
        throw new Error("revise should not run");
      },
    });
  try {
    const first = await once();
    const second = await once();
    expect(first.stopReason).toBe("passed");
    expect(second.stopReason).toBe("passed");
    expect(verifies).toBe(1);
    expect(store.list(runId).filter((event) => event.type === LOOP_ITERATED)).toHaveLength(1);
    expect(second.decision).toBeNull();
    expect(jsonValue(second.decisionJson)).toEqual({ n: 1 });
  } finally {
    store.close();
  }
});
