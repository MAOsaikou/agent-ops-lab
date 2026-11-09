import { describe, expect, test } from "vitest";

import type { UiFrame } from "../../../src/server/frames.js";
import { enqueue, foldFrames, initialUiState, nodeCounts } from "./reducer.js";

type Fixture = {
  readonly meta: { readonly runId: string; readonly rounds: number; readonly finalHash: string };
  readonly frames: readonly UiFrame[];
};

async function loadFixture(): Promise<Fixture> {
  const module = (await import("./__fixtures__/recorded-frames.json", { with: { type: "json" } })) as {
    default: Fixture;
  };
  return module.default;
}

describe("console reducer over a recorded U5 event fixture", () => {
  test("folds the recorded run into eight locked ledger rounds", async () => {
    const fixture = await loadFixture();
    const state = foldFrames(fixture.frames);

    expect(state.lastSeq).toBe(fixture.frames.length);
    expect(state.duplicates).toBe(0);
    expect(state.outOfOrder).toBe(0);
    expect(state.rounds).toHaveLength(fixture.meta.rounds);
    expect(state.rounds.every((round) => round.committed && round.settled && round.reflected)).toBe(true);
    expect(state.rounds.every((round) => round.locked)).toBe(true);
    expect(state.rounds.map((round) => round.round)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(state.rounds.every((round) => round.outcome !== undefined)).toBe(true);
  });

  test("keeps the supply-cut quotes and the sealed node out of the idle state", async () => {
    const fixture = await loadFixture();
    const state = foldFrames(fixture.frames);

    expect(state.quotes.length).toBeGreaterThan(0);
    expect(state.quotes.every((quote) => quote.round === 1 || quote.round === 2)).toBe(true);
    expect(state.nodes["seal"]?.status).toBe("done");
    expect(state.nodes["negotiate"]?.status).toBe("done");
    expect(nodeCounts(state).dead).toBe(0);
  });

  test("drops duplicate events instead of double counting", async () => {
    const fixture = await loadFixture();
    const once = foldFrames(fixture.frames);
    const twice = foldFrames([...fixture.frames, ...fixture.frames]);

    expect(twice.duplicates).toBe(fixture.frames.length);
    expect(twice.lastSeq).toBe(once.lastSeq);
    expect(twice.rounds).toEqual(once.rounds);
    expect(twice.quotes.length).toBe(once.quotes.length);
  });

  test("buffers out-of-order events and converges to the same state", async () => {
    const fixture = await loadFixture();
    const sequential = foldFrames(fixture.frames);

    let state = initialUiState();
    const reversed = [...fixture.frames].reverse();
    let outOfOrderSeen = 0;
    for (const frame of reversed) {
      state = enqueue(state, frame);
      outOfOrderSeen = Math.max(outOfOrderSeen, state.outOfOrder);
    }
    expect(outOfOrderSeen).toBeGreaterThan(0);
    expect(state.buffered).toHaveLength(0);
    expect(state.lastSeq).toBe(sequential.lastSeq);
    expect(state.rounds).toEqual(sequential.rounds);
    expect(state.quotes.length).toBe(sequential.quotes.length);
    expect(state.log.at(-1)?.seq).toBe(sequential.log.at(-1)?.seq);
  });

  test("is deterministic across two folds of the same fixture", async () => {
    const fixture = await loadFixture();
    expect(foldFrames(fixture.frames)).toEqual(foldFrames(fixture.frames));
  });
});
