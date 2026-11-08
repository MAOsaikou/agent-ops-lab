import { cents, qty, roundIndex, seed, type Seed } from "../src/templates/simshop/market/brand.js";
import { hashDraw, uniformAt, type Rng } from "../src/templates/simshop/market/rng.js";
import { settle } from "../src/templates/simshop/market/rules.js";
import { loadScenario } from "../src/templates/simshop/market/scenario.js";
import { SKUS, type Decision } from "../src/templates/simshop/market/types.js";
import { expect, test } from "vitest";

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

test("settle draw bytes are pinned", () => {
  const drawn = seed(42);
  const round = roundIndex(0);
  expect(hex(hashDraw(drawn, "settle", round, "tea", 0))).toBe(
    "e6d909f01d6e5c53c758403e3dba68d2e9ca9d9b41ee81e126c8428c351e56d8",
  );
  expect(hex(hashDraw(drawn, "settle", round, "tea", 1))).toBe(
    "4a37b0974639b1e861b6dc91131c3b62b3b83a9daf1b7d8d38478c051209fd70",
  );
  expect(hex(hashDraw(drawn, "forecast", round, "tea", 0))).toBe(
    "01eaea5c74036a18151173a9aa58318ea339fec06b3ee2d5f9b689919597fba7",
  );
  expect(hex(hashDraw(drawn, "events", round, "tea", 0))).toBe(
    "2b7a5d6cb0118d5d74cccb5eb356d8a4ccd04cdd8e89284815c7b58028c9d56f",
  );
});

test("uniforms from a digest sit in (0, 1)", () => {
  const value = uniformAt(seed(42), "settle", roundIndex(0), "tea", 0);
  expect(value).toBeGreaterThan(0);
  expect(value).toBeLessThan(1);
});

test("settle and forecast streams differ on the first 1000 draws", () => {
  const drawn = seed(42);
  let count = 0;
  for (let round = 0; count < 1000; round += 1) {
    const roundId = roundIndex(round);
    for (const sku of SKUS) {
      for (let k = 0; k < 2 && count < 1000; k += 1) {
        const settleDraw = uniformAt(drawn, "settle", roundId, sku, k);
        const forecastDraw = uniformAt(drawn, "forecast", roundId, sku, k);
        const eventDraw = uniformAt(drawn, "events", roundId, sku, k);
        expect(settleDraw).not.toBe(forecastDraw);
        expect(settleDraw).not.toBe(eventDraw);
        expect(forecastDraw).not.toBe(eventDraw);
        count += 1;
      }
    }
  }
  expect(count).toBe(1000);
});

function recording(drawn: Seed): { rng: Rng; calls: string[] } {
  const calls: string[] = [];
  const rng: Rng = {
    uniform(stream, round, sku, k) {
      const value = uniformAt(drawn, stream, round, sku, k);
      calls.push(`${stream}:${String(round)}:${sku}:${String(k)}=${value}`);
      return value;
    },
  };
  return { rng, calls };
}

function decision(price: number, orderQty: number, ad: number, supplier: "primary" | "backup"): Decision {
  const order = () => ({
    price: cents(price),
    qty: qty(orderQty),
    supplier,
  });
  return {
    adSpend: cents(ad),
    orders: { tea: order(), snack: order() },
  };
}

test("two decisions consume the same noise sequence for a seed, round, and sku", () => {
  const loaded = loadScenario("spring");
  const drawn = seed(7);
  const left = recording(drawn);
  const right = recording(drawn);
  const cheap = settle(
    loaded.initial,
    decision(500, 1, 0, "primary"),
    loaded.truth,
    left.rng,
  );
  const dear = settle(
    loaded.initial,
    decision(8000, 80, 5000, "backup"),
    loaded.truth,
    right.rng,
  );
  expect(left.calls).toEqual(right.calls);
  expect(left.calls.map((call) => call.slice(0, call.indexOf("=")))).toEqual([
    "settle:0:tea:0",
    "settle:0:tea:1",
    "settle:0:snack:0",
    "settle:0:snack:1",
  ]);
  expect(cheap.outcome).not.toEqual(dear.outcome);
});
