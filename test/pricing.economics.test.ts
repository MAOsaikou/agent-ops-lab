import { describe, expect, test } from "vitest";

import {
  breakEvenCents,
  buildPlan,
  buildCandidates,
  evaluate,
  lockPlan,
  nicePrice,
  organicOrders,
  PLATFORM_PRESETS,
  SAMPLES,
  simulate,
} from "../src/templates/pricing/index.js";
import type { ProductInput } from "../src/templates/pricing/index.js";

function base(): ProductInput {
  const sample = SAMPLES[0];
  if (sample === undefined) {
    throw new Error("sample missing");
  }
  return sample.input;
}

describe("pricing economics", () => {
  test("unit cost adds up and break-even nets roughly zero", () => {
    const input = base();
    const breakEven = breakEvenCents(input);
    const atBreakEven = evaluate(input, breakEven);
    expect(atBreakEven.unit.totalCents).toBe(
      input.buyCents +
        input.packagingCents +
        input.shippingCents +
        atBreakEven.unit.commissionCents +
        atBreakEven.unit.payFeeCents +
        atBreakEven.unit.returnLossCents,
    );
    expect(Math.abs(breakEven - atBreakEven.unit.totalCents)).toBeLessThanOrEqual(2);
  });

  test("prices below break-even lose money on every order", () => {
    const input = base();
    const breakEven = breakEvenCents(input);
    const below = evaluate(input, Math.round(breakEven * 0.8));
    expect(below.daily.netPerOrderCents).toBeLessThan(0);
    expect(below.daily.margin).toBeLessThan(0);
  });

  test("demand falls as the price rises", () => {
    const input = base();
    const cheap = organicOrders(input, 2000);
    const pricey = organicOrders(input, 4000);
    expect(cheap).toBeGreaterThan(pricey);
    expect(pricey).toBeGreaterThan(0);
  });

  test("nice prices keep the .90 tail and never undercut the input", () => {
    for (const cents of [3850, 4190, 4195, 99, 12345]) {
      const price = nicePrice(cents);
      expect(price % 100).toBe(90);
      expect(price).toBeGreaterThanOrEqual(cents);
    }
  });

  test("every candidate sits above break-even and produces a plan", () => {
    const input = base();
    const preset = PLATFORM_PRESETS[input.platform];
    const candidates = buildCandidates(input, preset);
    expect(candidates).toHaveLength(3);
    const breakEven = breakEvenCents(input);
    for (const candidate of candidates) {
      expect(candidate.priceCents).toBeGreaterThanOrEqual(breakEven);
      expect(candidate.bullets.length).toBe(5);
      expect(candidate.checks.length).toBeGreaterThanOrEqual(6);
    }
  });

  test("simulation is deterministic for the same seed and input", () => {
    const input = base();
    const first = simulate(input, 3990);
    const second = simulate(input, 3990);
    expect(first.p50Cents).toBe(second.p50Cents);
    expect(first.p10Cents).toBeLessThanOrEqual(first.p50Cents);
    expect(first.p50Cents).toBeLessThanOrEqual(first.p90Cents);
    expect(first.days).toHaveLength(30);
  });

  test("the same input always yields the same plan hash, and locking is final", () => {
    const input = base();
    const first = buildPlan(input, { id: "p-test", createdAt: "2026-11-10T00:00:00.000Z" });
    const second = buildPlan(input, { id: "p-test", createdAt: "2026-11-10T00:00:00.000Z" });
    expect(first.hash).toBe(second.hash);
    expect(first.trace.length).toBeGreaterThan(6);
    expect(new Set(first.trace.map((step) => step.hash)).size).toBe(first.trace.length);

    const locked = lockPlan(first, "match", "2026-11-10T01:00:00.000Z");
    expect(locked.locked?.candidateId).toBe("match");
    expect(locked.locked?.hash).not.toBe(first.hash);
    const again = lockPlan(locked, "profit", "2026-11-10T02:00:00.000Z");
    expect(again.locked?.candidateId).toBe("match");
  });

  test("recommended candidate is never the money-losing one", () => {
    for (const sample of SAMPLES) {
      const plan = buildPlan(sample.input, { id: sample.id, createdAt: "2026-11-10T00:00:00.000Z" });
      const recommended = plan.candidates.find((candidate) => candidate.id === plan.recommendedId);
      expect(recommended).toBeDefined();
      expect(recommended?.evaluation.daily.margin).toBeGreaterThan(0);
      expect(recommended?.sim.p10Cents).toBeGreaterThan(0);
    }
  });
});