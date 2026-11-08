import { expect, test } from "vitest";

import { verifyDecision } from "../src/engine/verify/pipeline.js";
import {
  CHECK_AD,
  CHECK_PRICE,
  CHECK_QTY,
  parseShopDecision,
  SHOP_CHECKS,
  type CheckState,
  type ShopDecision,
} from "../src/templates/simshop/constraints.js";

const state: CheckState = {
  cash: 100000,
  suppliers: {
    primary: { capacity: 10, unitCost: { tea: 600, snack: 300 } },
    backup: { capacity: 8, unitCost: { tea: 720, snack: 360 } },
  },
};

function decision(patch: Partial<ShopDecision> & { tea?: Partial<ShopDecision["orders"]["tea"]>; snack?: Partial<ShopDecision["orders"]["snack"]> }): ShopDecision {
  return {
    adSpend: patch.adSpend ?? 0,
    orders: {
      tea: { price: 800, qty: 1, supplier: "primary", ...patch.tea },
      snack: { price: 400, qty: 1, supplier: "primary", ...patch.snack },
    },
  };
}

function run(raw: unknown, forecastCalls: { n: number }) {
  return verifyDecision({
    raw,
    state,
    schema: parseShopDecision,
    checks: SHOP_CHECKS,
    forecast(value, checkState) {
      forecastCalls.n += 1;
      expect(checkState.cash).toBe(state.cash);
      expect(value.adSpend).toBeTypeOf("number");
      return { profitCents: { p10: 1, p50: 2, p90: 3 }, stockoutRisk: 0, samples: 3 };
    },
    critic(input) {
      const failed = input.checks.find((check) => !check.pass && check.id !== "schema");
      const evidence = failed === undefined ? "forecast" : failed.id;
      return {
        confidence: 0.99,
        objections: [
          { claim: "the package breaks a hard check", evidence },
          { claim: "it feels risky", evidence: "vibes" },
        ],
      };
    },
  });
}

test("over-stock, below-cost price, and ad spend above cash each fail a hard check", () => {
  const overStock = run(decision({ tea: { qty: 50, price: 800, supplier: "primary" }, snack: { qty: 0, price: 400, supplier: "primary" } }), { n: 0 });
  expect(overStock.checks.find((check) => check.id === CHECK_QTY)?.pass).toBe(false);
  expect(overStock.verdict).toBe("revise");
  expect(overStock.dropped.map((item) => item.evidence)).toEqual(["vibes"]);
  expect(overStock.confidence).toBe(0.99);

  const belowCost = run(decision({ tea: { price: 599, qty: 0, supplier: "primary" }, snack: { price: 400, qty: 0, supplier: "primary" } }), { n: 0 });
  expect(belowCost.checks.find((check) => check.id === CHECK_PRICE)?.pass).toBe(false);
  expect(belowCost.verdict).toBe("revise");
  expect(belowCost.objections.map((item) => item.evidence)).toContain(CHECK_PRICE);

  const overAd = run(decision({ adSpend: state.cash + 1, tea: { qty: 0, price: 800, supplier: "primary" }, snack: { qty: 0, price: 400, supplier: "primary" } }), { n: 0 });
  expect(overAd.checks.find((check) => check.id === CHECK_AD)?.pass).toBe(false);
  expect(overAd.verdict).toBe("revise");
});

test("a schema failure rejects the package before the sandbox runs", () => {
  const calls = { n: 0 };
  const report = run({ adSpend: "many" }, calls);
  expect(report.verdict).toBe("reject");
  expect(report.forecast).toBeNull();
  expect(calls.n).toBe(0);
});
