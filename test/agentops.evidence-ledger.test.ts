import { describe, expect, test } from "vitest";

import {
  assertNoInventedNumbers,
  createEvidenceLedger,
  verifyEvidenceReferences,
  type ProvenanceTag,
} from "../src/templates/agentops/evidence-ledger.js";
import { buildCandidates } from "../src/templates/pricing/candidates.js";
import type { Candidate, ProductInput } from "../src/templates/pricing/model.js";
import { PLATFORM_PRESETS } from "../src/templates/pricing/platform.js";
import { SAMPLES } from "../src/templates/pricing/sample.js";

describe("Task 3: Evidence Provenance Ledger & Anti-Hallucination Verification", () => {
  const sampleProduct: ProductInput = SAMPLES[0]!.input;
  const candidates: readonly Candidate[] = buildCandidates(sampleProduct, PLATFORM_PRESETS[sampleProduct.platform]);

  test("createEvidenceLedger creates structured entries for all candidates and specialist roles", () => {
    const ledger = createEvidenceLedger({
      product: sampleProduct,
      candidates,
      explicitFields: ["buyCents", "shippingCents", "competitorCents"],
    });

    expect(ledger.entries.length).toBeGreaterThanOrEqual(9);

    // Verify key specialist entries are present and retrievable by ID
    const pricingProfit = ledger.getEntry("pricing-lead/profit");
    expect(pricingProfit).toBeDefined();
    expect(pricingProfit?.role).toBe("pricing-lead");
    expect(pricingProfit?.candidateId).toBe("profit");

    const procurementVolume = ledger.getEntry("procurement-lead/volume");
    expect(procurementVolume).toBeDefined();
    expect(procurementVolume?.role).toBe("procurement-lead");
    expect(procurementVolume?.candidateId).toBe("volume");

    const growthMatch = ledger.getEntry("growth-operator/match");
    expect(growthMatch).toBeDefined();
    expect(growthMatch?.role).toBe("growth-operator");
    expect(growthMatch?.candidateId).toBe("match");
  });

  test("numeric values strictly match candidate evaluation and sim fields without rewriting formulas", () => {
    const ledger = createEvidenceLedger({
      product: sampleProduct,
      candidates,
    });

    const profitCandidate = candidates.find((c) => c.id === "profit")!;
    const pricingProfit = ledger.getEntry("pricing-lead/profit")!;

    expect(pricingProfit.priceCents).toBe(profitCandidate.priceCents);
    expect(pricingProfit.margin).toBe(profitCandidate.evaluation.daily.margin);
    expect(pricingProfit.p10Cents).toBe(profitCandidate.sim.p10Cents);
    expect(pricingProfit.stockoutDays).toBe(profitCandidate.sim.stockoutDays);
    expect(pricingProfit.minCashCents).toBe(profitCandidate.sim.minCashCents);
    expect(pricingProfit.orders).toBe(profitCandidate.evaluation.daily.orders);
  });

  test("tags provenance accurately: merchant explicit vs rule assumption", () => {
    const ledger = createEvidenceLedger({
      product: sampleProduct,
      candidates,
      explicitFields: ["buyCents", "shippingCents"],
    });

    const buyFact = ledger.getEntry("fact/buyCents");
    expect(buyFact).toBeDefined();
    expect(buyFact?.provenance).toBe("merchant_explicit" satisfies ProvenanceTag);

    const cashFact = ledger.getEntry("fact/cashCents");
    expect(cashFact).toBeDefined();
    expect(cashFact?.provenance).toBe("rule_assumption" satisfies ProvenanceTag);

    // Specialist role scenario simulations are marked rule_assumption
    const roleEntry = ledger.getEntry("procurement-lead/profit");
    expect(roleEntry?.provenance).toBe("rule_assumption" satisfies ProvenanceTag);

    const explicitEntries = ledger.getByProvenance("merchant_explicit");
    expect(explicitEntries.length).toBeGreaterThan(0);
  });

  test("assertNoInventedNumbers rejects prose with invented figures, currency, or percentages", () => {
    // Rejects digits in prose
    expect(() => assertNoInventedNumbers("我建议售价定为 45 元")).toThrow(/文字不得包含数值/);
    expect(() => assertNoInventedNumbers("预计可实现 50 单销量")).toThrow(/文字不得包含数值/);

    // Rejects currency signs
    expect(() => assertNoInventedNumbers("该商品进货价 ¥39 偏高")).toThrow(/文字不得包含数值/);
    expect(() => assertNoInventedNumbers("单件成本 ￥18.5")).toThrow(/文字不得包含数值/);

    // Rejects percentages
    expect(() => assertNoInventedNumbers("核算目标毛利 25% 无法达成")).toThrow(/文字不得包含数值/);
    expect(() => assertNoInventedNumbers("退货率高达 18％ 侵蚀利润")).toThrow(/文字不得包含数值/);
  });

  test("assertNoInventedNumbers allows qualitative statements and metric names (p10/p50/p90)", () => {
    expect(() =>
      assertNoInventedNumbers(
        "优先守住稳价方案的保本空间，兼顾 p10 表现与周转资金约束，避免放量导致断货风险",
      ),
    ).not.toThrow();

    expect(() =>
      assertNoInventedNumbers(
        "参考 p50 与 p90 利润分布，虽然冲量单量高，但断货天数增加，仍需商家核实履约能力",
      ),
    ).not.toThrow();

    expect(() =>
      assertNoInventedNumbers(
        "建议维持现有报价并补充运费与包材事实证据",
      ),
    ).not.toThrow();
  });

  test("verifyEvidenceReferences approves valid references and fails on unknown or empty citations", () => {
    const ledger = createEvidenceLedger({
      product: sampleProduct,
      candidates,
    });

    // Valid citations pass
    expect(() =>
      verifyEvidenceReferences(["pricing-lead/profit", "procurement-lead/volume"], ledger),
    ).not.toThrow();

    // Unknown reference throws
    expect(() =>
      verifyEvidenceReferences(["unknown-role/non-existent-candidate"], ledger),
    ).toThrow(/未知 evidenceRef/);

    expect(() =>
      verifyEvidenceReferences(["pricing-lead/profit", "fake-ref"], ledger),
    ).toThrow(/未知 evidenceRef: fake-ref/);

    // Empty references throw
    expect(() => verifyEvidenceReferences([], ledger)).toThrow(/至少需要引用/);
  });
});
