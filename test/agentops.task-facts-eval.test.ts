import { describe, expect, test } from "vitest";

import { BENCHMARK_CASES } from "../src/templates/agentops/eval/dataset.js";
import { parseTaskFacts } from "../src/templates/agentops/task-facts.js";

function task(id: string): string {
  const found = BENCHMARK_CASES.find((item) => item.id === id);
  if (found === undefined) throw new Error(`missing case ${id}`);
  return found.taskText;
}

describe("Task 5b: Frozen benchmark texts parse only the numbers they actually contain", () => {
  test("standard apparel wording (采购价 / 竞品价 / 周转金) is unchanged", () => {
    expect(parseTaskFacts(task("std-apparel-pdd"))).toMatchObject({
      buyCents: 1600,
      packagingCents: 150,
      shippingCents: 650,
      competitorCents: 3990,
      marketOrders: 50,
      targetMargin: 0.25,
      adDailyBudgetCents: 3000,
      cashCents: 300_000,
    });
  });

  test("parses 采购 N 元 and 竞品 N 元 without requiring the 价 suffix", () => {
    expect(parseTaskFacts(task("std-pillow-jd"))).toMatchObject({
      buyCents: 2800,
      packagingCents: 300,
      shippingCents: 800,
      competitorCents: 8900,
      marketOrders: 40,
      targetMargin: 0.3,
      adDailyBudgetCents: 6000,
      cashCents: 800_000,
    });
    expect(parseTaskFacts(task("conflict-demand-cap"))).toMatchObject({
      buyCents: 4000,
      shippingCents: 800,
      competitorCents: 12_000,
      marketOrders: 2000,
      adDailyBudgetCents: 5000,
      cashCents: 200_000,
    });
  });

  test("parses 采购成本 and 竞品售价 on the cost-inversion case", () => {
    expect(parseTaskFacts(task("conflict-price-inversion"))).toMatchObject({
      buyCents: 8500,
      packagingCents: 300,
      shippingCents: 700,
      competitorCents: 4990,
      marketOrders: 100,
      adDailyBudgetCents: 5000,
    });
  });

  test("parses 竞品卖 on the missing-cost case and leaves buy/shipping absent", () => {
    const facts = parseTaskFacts(task("missing-buy-shipping"));
    expect(facts.buyCents).toBeNull();
    expect(facts.shippingCents).toBeNull();
    expect(facts.packagingCents).toBeNull();
    expect(facts.competitorCents).toBe(4900);
    expect(facts.marketOrders).toBe(30);
    expect(facts.adDailyBudgetCents).toBe(2000);
  });

  test("leaves competitor and volume absent when the text does not give them", () => {
    const facts = parseTaskFacts(task("missing-competitor-price"));
    expect(facts.buyCents).toBe(1200);
    expect(facts.packagingCents).toBe(200);
    expect(facts.shippingCents).toBe(600);
    expect(facts.competitorCents).toBeNull();
    expect(facts.marketOrders).toBeNull();
    expect(facts.targetMargin).toBe(0.35);
  });

  test("parses 可周转金仅 N 元 on the cash-constraint case", () => {
    expect(parseTaskFacts(task("cash-tight-volume-stockout"))).toMatchObject({
      buyCents: 6500,
      packagingCents: 300,
      shippingCents: 800,
      competitorCents: 15_900,
      marketOrders: 60,
      cashCents: 40_000,
      adDailyBudgetCents: 3000,
    });
  });

  test("parses stated return rate and salvage on the extreme-returns case", () => {
    const facts = parseTaskFacts(task("reject-extreme-returns"));
    expect(facts).toMatchObject({
      buyCents: 2500,
      packagingCents: 800,
      shippingCents: 1500,
      competitorCents: 5900,
      marketOrders: 20,
    });
    expect(facts.returnRate).toBe(0.6);
    expect(facts.returnSalvage).toBe(0.2);
  });

  test("does not invent a return rate when the text does not state one", () => {
    expect(parseTaskFacts(task("std-apparel-pdd")).returnRate).toBeNull();
    expect(parseTaskFacts(task("std-apparel-pdd")).returnSalvage).toBeNull();
    expect(parseTaskFacts(task("reject-negative-margin")).returnRate).toBeNull();
  });
});
