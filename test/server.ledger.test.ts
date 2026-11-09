import { describe, expect, test } from "vitest";

import { buildRecord } from "../src/server/capture.js";
import { sealLedger } from "../src/server/ledger-chain.js";
import { runShop } from "../src/templates/simshop/workflows/round.js";

async function capture(scenario: "spring" | "supplycut" | "pricewar", profile: "steady" | "stressed") {
  const sim = await runShop({ scenario, seed: 7, profile, callCap: null, p50Threshold: 1 });
  const record = buildRecord({
    sim,
    scenario,
    seed: 7,
    profile,
    createdAt: "2026-11-08T16:00:00.000Z",
    replayVerified: true,
  });
  return { sim, record };
}

describe("console ledger chain", () => {
  test("the folded chain over console frames equals the run final hash", async () => {
    const { sim, record } = await capture("supplycut", "steady");
    const ledger = sealLedger(record.frames);

    expect(ledger.rounds).toHaveLength(sim.rounds.length);
    expect(ledger.rounds.every((round) => round.locked)).toBe(true);
    expect(ledger.finalHash).toBe(sim.hash);
    expect(ledger.rounds.at(-1)?.hash).toBe(sim.hash);

    let previous = ledger.rounds[0]?.prevHash;
    for (const round of ledger.rounds) {
      expect(round.prevHash).toBe(previous);
      previous = round.hash;
    }
  });

  test("every ledger frame carries a round the chain can seal", async () => {
    const { record } = await capture("supplycut", "steady");
    const ledgerFrames = record.frames.filter(
      (frame) => frame.kind === "commit" || frame.kind === "settle" || frame.kind === "reflect",
    );
    expect(ledgerFrames).toHaveLength(record.meta.rounds * 3);
    const ledger = sealLedger(record.frames);
    expect(ledger.rounds.map((round) => round.round)).toEqual(
      Array.from({ length: record.meta.rounds }, (_value, index) => index),
    );
  });

  test("the supply-cut run exposes real quotes and the price-war run a zero allocation", async () => {
    const supply = await capture("supplycut", "steady");
    const quotes = supply.record.frames.filter((frame) => frame.kind === "quote");
    expect(quotes.length).toBeGreaterThan(0);

    const pricewar = await capture("pricewar", "steady");
    const budgets = pricewar.record.frames.filter((frame) => frame.kind === "budget");
    expect(budgets.length).toBeGreaterThan(0);
    const first = budgets[0];
    if (first !== undefined && first.kind === "budget") {
      expect(first.allocation.ads).toBe(0);
      expect(first.allocation.priceCut).toBe(0);
      expect(first.amounts.ads).toBeLessThanOrEqual(0);
      expect(first.amounts.priceCut).toBeLessThanOrEqual(0);
    }
  });

  test("the stressed profile keeps revising until the iteration cap", async () => {
    const { record } = await capture("supplycut", "stressed");
    const loops = record.frames.filter((frame) => frame.kind === "loop");
    expect(loops.length).toBeGreaterThan(0);
    expect(loops.some((frame) => frame.kind === "loop" && frame.verdict === "revise")).toBe(true);
    expect(loops.some((frame) => frame.kind === "loop" && frame.stopReason === "maxIterations")).toBe(true);
    expect(record.meta.summary.every((round) => round.usedFallback)).toBe(true);
  });
});
