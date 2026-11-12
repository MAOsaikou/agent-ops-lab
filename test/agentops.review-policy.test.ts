import { describe, expect, test } from "vitest";

import { BENCHMARK_CASES } from "../src/templates/agentops/eval/dataset.js";
import {
  DEMAND_CASH_MULTIPLE,
  demandExceedsCash,
  missingEvidence,
} from "../src/templates/agentops/review-policy.js";
import { parseTaskFacts } from "../src/templates/agentops/task-facts.js";

function factsOf(id: string) {
  const found = BENCHMARK_CASES.find((item) => item.id === id);
  if (found === undefined) throw new Error(`missing case ${id}`);
  return parseTaskFacts(found.taskText);
}

describe("Task 5c: honest review policy (pure, frozen texts)", () => {
  test("DEMAND_CASH_MULTIPLE is 20", () => {
    expect(DEMAND_CASH_MULTIPLE).toBe(20);
  });

  test("standard complete cases have no evidence gap", () => {
    expect(missingEvidence(factsOf("std-apparel-pdd"))).toBeNull();
    expect(missingEvidence(factsOf("std-pillow-jd"))).toBeNull();
    expect(missingEvidence(factsOf("cash-tight-volume-stockout"))).toBeNull();
    expect(missingEvidence(factsOf("conflict-demand-cap"))).toBeNull();
    expect(missingEvidence(factsOf("conflict-price-inversion"))).toBeNull();
    expect(missingEvidence(factsOf("reject-negative-margin"))).toBeNull();
    expect(missingEvidence(factsOf("reject-extreme-returns"))).toBeNull();
  });

  test("missing buy/shipping is a cost-facts gap, not a name gap", () => {
    const gap = missingEvidence(factsOf("missing-buy-shipping"));
    expect(gap).not.toBeNull();
    expect(gap?.riskIds).toEqual(["missing-cost-facts"]);
    expect(gap?.fields).toEqual(["buy", "shipping"]);
  });

  test("missing competitor is a market-anchor gap", () => {
    const gap = missingEvidence(factsOf("missing-competitor-price"));
    expect(gap).not.toBeNull();
    expect(gap?.riskIds).toEqual(["missing-market-anchor"]);
    expect(gap?.fields).toEqual(["competitor"]);
  });

  test("exaggerated demand exceeds stated cash; tight but honest cash does not", () => {
    expect(demandExceedsCash(factsOf("conflict-demand-cap"))).toBe(true);
    expect(demandExceedsCash(factsOf("cash-tight-volume-stockout"))).toBe(false);
    expect(demandExceedsCash(factsOf("std-apparel-pdd"))).toBe(false);
    expect(demandExceedsCash(factsOf("cash-long-settlement"))).toBe(false);
  });

  test("does not flag demand when cash or orders were not written", () => {
    expect(demandExceedsCash(factsOf("missing-buy-shipping"))).toBe(false);
    expect(demandExceedsCash(factsOf("reject-extreme-returns"))).toBe(false);
  });
});
