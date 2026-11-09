import { describe, expect, test } from "vitest";

import { createApp, detectMode } from "../src/server/app.js";
import type { RunMeta, RunRecord } from "../src/server/capture.js";
import type { UiFrame } from "../src/server/frames.js";
import type { RunStore } from "../src/server/store.js";

function frame(seq: number): UiFrame {
  return {
    seq,
    runId: "u7-spring-s1-steady",
    kind: "node",
    event: "started",
    nodeId: "plan",
    reason: "started",
  };
}

const ROUND = {
  commit: (seq: number, round: number): UiFrame => ({
    seq,
    runId: "u7-spring-s1-steady",
    kind: "commit",
    round,
    decisionHash: "a".repeat(64),
    observationHash: "b".repeat(64),
    source: "verified",
    adSpend: 0,
    orders: {
      tea: { price: 700, qty: 10, supplier: "primary" },
      snack: { price: 400, qty: 8, supplier: "primary" },
    },
  }),
  settle: (seq: number, round: number): UiFrame => ({
    seq,
    runId: "u7-spring-s1-steady",
    kind: "settle",
    round,
    decisionHash: "a".repeat(64),
    outcome: {
      round,
      cash: 500000,
      revenue: 10000,
      orderCost: 8000,
      holding: 0,
      adSpend: 0,
      missed: 0,
      profit: 2000,
      sales: 20,
      reputation: 500,
      inventory: { tea: 40, snack: 30 },
      skus: {
        tea: {
          price: 700,
          demand: 12,
          sales: 12,
          missed: 0,
          ordered: 10,
          received: 0,
          onHand: 40,
          inventory: 40,
          revenue: 8400,
          orderCost: 6000,
          holding: 0,
          supplier: "primary",
        },
        snack: {
          price: 400,
          demand: 8,
          sales: 8,
          missed: 0,
          ordered: 8,
          received: 0,
          onHand: 30,
          inventory: 30,
          revenue: 3200,
          orderCost: 2400,
          holding: 0,
          supplier: "primary",
        },
      },
    },
  }),
  reflect: (seq: number, round: number): UiFrame => ({
    seq,
    runId: "u7-spring-s1-steady",
    kind: "reflect",
    round,
    beliefHash: "c".repeat(64),
    overlayHash: "d".repeat(64),
  }),
};

function records(): RunRecord {
  const frames: UiFrame[] = [
    frame(1),
    frame(2),
    frame(3),
    ROUND.commit(4, 0),
    ROUND.settle(5, 0),
    ROUND.reflect(6, 0),
    frame(7),
  ];
  const meta = {
    runId: "u7-spring-s1-steady",
    scenario: "spring",
    seed: 1,
    profile: "steady",
    rounds: 1,
    plannedRounds: 8,
    llmMode: "mock",
    finalHash: "e".repeat(64),
    ledgerHash: "f".repeat(64),
    calls: 7,
    callRoles: ["planner", "buyer"],
    minInventory: 30,
    priceWars: 0,
    quotes: 0,
    replayVerified: true,
    orchestrationNote: "test",
    createdAt: "2026-11-08T16:00:00.000Z",
    eventSource: "u5-runShop",
    summary: [{ round: 0, calls: 7, stopReason: "passed", usedFallback: false, supply: false }],
  } satisfies RunMeta;
  return { meta, frames };
}

function appWith(record: RunRecord): ReturnType<typeof createApp> {
  const store: RunStore = {
    save: () => undefined,
    load: (runId) => (runId === record.meta.runId ? record : undefined),
    list: () => [record.meta],
  };
  return createApp({ store, mode: detectMode({}) });
}

function idsOf(text: string): number[] {
  const ids: number[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("id: ")) {
      ids.push(Number(line.slice(4)));
    }
  }
  return ids;
}

describe("console SSE stream", () => {
  test("a fresh subscriber receives every frame in seq order", async () => {
    const app = appWith(records());
    const response = await app.request("/api/runs/u7-spring-s1-steady/stream?pace=0");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();

    expect(idsOf(text)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(text).toContain("event: done");
    expect(text).toContain('"lastSeq":7');
  });

  test("a reconnect with Last-Event-ID only receives later events", async () => {
    const app = appWith(records());
    const response = await app.request("/api/runs/u7-spring-s1-steady/stream?pace=0", {
      headers: { "last-event-id": "4" },
    });
    const text = await response.text();

    expect(idsOf(text)).toEqual([5, 6, 7]);
    expect(text).not.toContain("id: 4\n");
    expect(text).toContain('"lastSeq":7');
  });

  test("Last-Event-ID at the tail yields no frames but still closes cleanly", async () => {
    const app = appWith(records());
    const response = await app.request("/api/runs/u7-spring-s1-steady/stream?pace=0", {
      headers: { "last-event-id": "7" },
    });
    const text = await response.text();

    expect(idsOf(text)).toEqual([]);
    expect(text).toContain('"lastSeq":7');
  });

  test("the events endpoint honours since and reports the tail seq", async () => {
    const app = appWith(records());
    const response = await app.request("/api/runs/u7-spring-s1-steady/events?since=5");
    const body = (await response.json()) as { frames: readonly UiFrame[]; lastSeq: number; since: number };

    expect(body.since).toBe(5);
    expect(body.lastSeq).toBe(7);
    expect(body.frames.map((item) => item.seq)).toEqual([6, 7]);
  });

  test("an unknown run id is a 404 rather than an empty stream", async () => {
    const app = appWith(records());
    const response = await app.request("/api/runs/u7-missing-s1-steady/stream?pace=0");
    expect(response.status).toBe(404);
  });
});

describe("locked ledger commits", () => {
  test("re-committing a settled round is a 409 conflict", async () => {
    const app = appWith(records());
    const response = await app.request("/api/runs/u7-spring-s1-steady/rounds/0/commit", { method: "POST" });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { code: string; round: number; storedDecisionHash: string };
    expect(body.code).toBe("round-locked");
    expect(body.round).toBe(0);
    expect(body.storedDecisionHash).toBe("a".repeat(64));
  });

  test("the ledger endpoint rebuilds the hash chain from frames", async () => {
    const app = appWith(records());
    const response = await app.request("/api/runs/u7-spring-s1-steady/ledger");
    const body = (await response.json()) as {
      rounds: readonly { round: number; locked: boolean; hash: string }[];
      matchesRunHash: boolean;
    };
    expect(body.rounds).toHaveLength(1);
    expect(body.rounds[0]?.locked).toBe(true);
    expect(body.rounds[0]?.hash).toHaveLength(64);
    expect(typeof body.matchesRunHash).toBe("boolean");
  });
});
