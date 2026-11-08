import {
  cents,
  qty,
  reputation,
  roundIndex,
  seed,
  type Seed,
} from "../src/templates/simshop/market/brand.js";
import { deriveRng } from "../src/templates/simshop/market/rng.js";
import { settle } from "../src/templates/simshop/market/rules.js";
import {
  SKUS,
  type Decision,
  type ScenarioTruth,
  type ShopState,
  type Sku,
} from "../src/templates/simshop/market/types.js";
import fc from "fast-check";
import { expect, test } from "vitest";

const positiveCents = fc.integer({ min: 100, max: 1500 }).map((value) => cents(value));
const quantity = fc.integer({ min: 0, max: 80 }).map((value) => qty(value));
const reputationValue = fc.integer({ min: 0, max: 1000 }).map((value) => reputation(value));

const supplierArb = fc.record({
  unitCost: fc.record({ tea: positiveCents, snack: positiveCents }),
  leadTime: fc.integer({ min: 0, max: 2 }),
  capacityByRound: fc.array(fc.integer({ min: 0, max: 100 }).map((value) => qty(value)), {
    minLength: 8,
    maxLength: 8,
  }),
});

const truthArb: fc.Arbitrary<ScenarioTruth> = fc.record({
  rounds: fc.constant(8),
  elasticity: fc.double({ min: 0.5, max: 1.5, noNaN: true }),
  noiseSigma: fc.double({ min: 0.02, max: 0.15, noNaN: true }),
  stockoutPenalty: fc.integer({ min: 0, max: 12 }),
  holdingCost: fc.integer({ min: 0, max: 50 }).map((value) => cents(value)),
  adHalfSat: fc.integer({ min: 100, max: 8000 }).map((value) => cents(value)),
  seasonBps: fc.array(fc.integer({ min: 8000, max: 12000 }), { minLength: 8, maxLength: 8 }),
  skus: fc.record({
    tea: fc.record({
      baseDemand: fc.integer({ min: 1, max: 40 }).map((value) => qty(value)),
      refPrice: positiveCents,
    }),
    snack: fc.record({
      baseDemand: fc.integer({ min: 1, max: 40 }).map((value) => qty(value)),
      refPrice: positiveCents,
    }),
  }),
  competitorPrice: fc.record({
    tea: fc.array(positiveCents, { minLength: 8, maxLength: 8 }),
    snack: fc.array(positiveCents, { minLength: 8, maxLength: 8 }),
  }),
  suppliers: fc.record({
    primary: supplierArb,
    backup: supplierArb,
  }),
});

const receiptArb = fc.record({
  sku: fc.constantFrom("tea", "snack"),
  qty: fc.integer({ min: 0, max: 20 }).map((value) => qty(value)),
  arrivesAt: fc.integer({ min: 0, max: 10 }).map((value) => roundIndex(value)),
});

const stateArb: fc.Arbitrary<ShopState> = fc.record({
  cash: fc.integer({ min: 0, max: 200000 }).map((value) => cents(value)),
  inventory: fc.record({ tea: quantity, snack: quantity }),
  reputation: reputationValue,
  roundIndex: fc.integer({ min: 0, max: 7 }).map((value) => roundIndex(value)),
  pendingReceipts: fc.array(receiptArb, { maxLength: 3 }),
});

const decisionArb: fc.Arbitrary<Decision> = fc.record({
  adSpend: fc.integer({ min: 0, max: 20000 }).map((value) => cents(value)),
  orders: fc.record({
    tea: fc.record({
      price: positiveCents,
      qty: fc.integer({ min: 0, max: 60 }).map((value) => qty(value)),
      supplier: fc.constantFrom("primary", "backup"),
    }),
    snack: fc.record({
      price: positiveCents,
      qty: fc.integer({ min: 0, max: 60 }).map((value) => qty(value)),
      supplier: fc.constantFrom("primary", "backup"),
    }),
  }),
});

const seedArb = fc.integer({ min: 1, max: 500 }).map((value) => seed(value));

function at(values: readonly number[], index: number): number {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`missing value at ${index}`);
  }
  return value;
}

function dueUnits(state: ShopState, sku: Sku): number {
  let total = 0;
  for (const receipt of state.pendingReceipts) {
    if (receipt.sku === sku && receipt.arrivesAt <= state.roundIndex) {
      total += receipt.qty;
    }
  }
  return total;
}

function expectSettlement(
  state: ShopState,
  decision: Decision,
  truth: ScenarioTruth,
  drawn: Seed,
): void {
  const stateCopy = structuredClone(state);
  const decisionCopy = structuredClone(decision);
  const truthCopy = structuredClone(truth);
  const first = settle(state, decision, truth, deriveRng(drawn));
  const second = settle(state, decision, truth, deriveRng(drawn));
  expect(second).toEqual(first);
  expect(state).toEqual(stateCopy);
  expect(decision).toEqual(decisionCopy);
  expect(truth).toEqual(truthCopy);

  const { state: next, outcome } = first;
  expect(next.cash).toBeGreaterThanOrEqual(0);
  expect(next.inventory.tea).toBeGreaterThanOrEqual(0);
  expect(next.inventory.snack).toBeGreaterThanOrEqual(0);
  expect(next.reputation).toBeGreaterThanOrEqual(0);
  expect(next.reputation).toBeLessThanOrEqual(1000);
  expect(next.cash).toBe(outcome.cash);
  expect(next.reputation).toBe(outcome.reputation);
  expect(next.inventory).toEqual(outcome.inventory);
  expect(next.cash - state.cash).toBe(outcome.profit);
  expect(outcome.profit).toBe(
    outcome.revenue - outcome.orderCost - outcome.holding - outcome.adSpend,
  );

  let primaryUsed = 0;
  let backupUsed = 0;
  for (const sku of SKUS) {
    const row = outcome.skus[sku];
    const order = decision.orders[sku];
    expect(row.sales).toBeLessThanOrEqual(row.demand);
    expect(row.sales).toBeLessThanOrEqual(row.onHand);
    expect(row.missed).toBe(row.demand - row.sales);
    expect(row.inventory).toBe(row.onHand - row.sales);
    expect(row.inventory).toBeGreaterThanOrEqual(0);
    expect(row.revenue).toBe(row.sales * row.price);
    expect(row.supplier).toBe(order.supplier);
    expect(row.price).toBe(order.price);
    expect(row.ordered).toBeLessThanOrEqual(order.qty);
    const unit = truth.suppliers[order.supplier].unitCost[sku];
    expect(row.orderCost).toBe(row.ordered * unit);
    const lead = truth.suppliers[order.supplier].leadTime;
    const extra = lead === 0 ? order.qty : 0;
    expect(row.sales).toBeLessThanOrEqual(state.inventory[sku] + dueUnits(state, sku) + extra);
    if (row.supplier === "primary") {
      primaryUsed += row.ordered;
    } else {
      backupUsed += row.ordered;
    }
  }
  expect(primaryUsed).toBeLessThanOrEqual(
    at(truth.suppliers.primary.capacityByRound, state.roundIndex),
  );
  expect(backupUsed).toBeLessThanOrEqual(
    at(truth.suppliers.backup.capacityByRound, state.roundIndex),
  );
  expect(outcome.sales).toBe(outcome.skus.tea.sales + outcome.skus.snack.sales);
  expect(outcome.missed).toBe(outcome.skus.tea.missed + outcome.skus.snack.missed);
  expect(outcome.revenue).toBe(outcome.skus.tea.revenue + outcome.skus.snack.revenue);
  expect(outcome.orderCost).toBe(outcome.skus.tea.orderCost + outcome.skus.snack.orderCost);
  expect(outcome.holding).toBe(outcome.skus.tea.holding + outcome.skus.snack.holding);
  if (outcome.missed === 0) {
    expect(next.reputation).toBe(Math.min(1000, state.reputation + 5));
  } else {
    const raw = state.reputation - truth.stockoutPenalty * outcome.missed;
    expect(next.reputation).toBe(Math.max(0, Math.min(1000, raw)));
  }
}

test("settlement preserves the shop invariants", () => {
  fc.assert(
    fc.property(stateArb, decisionArb, truthArb, seedArb, (state, decision, truth, drawn) => {
      expectSettlement(state, decision, truth, drawn);
    }),
    { numRuns: 100, seed: 7 },
  );
});

test("a short run never drives cash or inventory negative", () => {
  fc.assert(
    fc.property(
      stateArb.map((state) => ({ ...state, roundIndex: roundIndex(0) })),
      fc.array(decisionArb, { minLength: 4, maxLength: 4 }),
      truthArb,
      seedArb,
      (state, decisions, truth, drawn) => {
        let current = state;
        for (const decision of decisions) {
          expectSettlement(current, decision, truth, drawn);
          current = settle(current, decision, truth, deriveRng(drawn)).state;
          expect(current.cash).toBeGreaterThanOrEqual(0);
          expect(current.inventory.tea).toBeGreaterThanOrEqual(0);
          expect(current.inventory.snack).toBeGreaterThanOrEqual(0);
        }
      },
    ),
    { numRuns: 40, seed: 7 },
  );
});
