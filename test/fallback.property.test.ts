import fc from "fast-check";
import { expect, test } from "vitest";

import { SHOP_CHECKS, type CheckState } from "../src/templates/simshop/constraints.js";
import { fallbackDecision, type FallbackInput } from "../src/templates/simshop/fallback.js";

const supplier = fc.record({
  capacity: fc.integer({ min: 0, max: 80 }),
  unitCost: fc.record({
    tea: fc.integer({ min: 1, max: 1500 }),
    snack: fc.integer({ min: 1, max: 1500 }),
  }),
});

const legal: fc.Arbitrary<FallbackInput> = fc
  .record({
    cash: fc.integer({ min: 0, max: 400000 }),
    inventory: fc.record({
      tea: fc.integer({ min: 0, max: 120 }),
      snack: fc.integer({ min: 0, max: 120 }),
    }),
    nominalBaseDemand: fc.record({
      tea: fc.integer({ min: 0, max: 60 }),
      snack: fc.integer({ min: 0, max: 60 }),
    }),
    suppliers: fc.record({ primary: supplier, backup: supplier }),
  })
  .chain((state) => {
    const teaFloor = Math.max(state.suppliers.primary.unitCost.tea, state.suppliers.backup.unitCost.tea);
    const snackFloor = Math.max(state.suppliers.primary.unitCost.snack, state.suppliers.backup.unitCost.snack);
    return fc
      .record({
        tea: fc.integer({ min: teaFloor, max: teaFloor + 4000 }),
        snack: fc.integer({ min: snackFloor, max: snackFloor + 4000 }),
      })
      .map((previousPrices) => ({ ...state, previousPrices }));
  });

test("the safety fallback passes every hard check on a legal state", () => {
  fc.assert(
    fc.property(legal, (state) => {
      const decision = fallbackDecision(state);
      expect(decision.adSpend).toBe(0);
      expect(decision.orders.tea.price).toBe(state.previousPrices.tea);
      expect(decision.orders.snack.price).toBe(state.previousPrices.snack);
      const checks: CheckState = { cash: state.cash, suppliers: state.suppliers };
      for (const check of SHOP_CHECKS) {
        const result = check(decision, checks);
        expect(result.pass, result.detail).toBe(true);
      }
    }),
    { numRuns: 100 },
  );
});
