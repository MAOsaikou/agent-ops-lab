/**
 * Opt-in honest outcome policy, used only when `strictEvidence` is true.
 * Default runner behaviour and v1 fingerprints must stay identical.
 * Arithmetic stays in pricing/economics; this module only reads those results.
 */

import { breakEvenCents, evaluate } from "../pricing/economics.js";
import type { ProductInput } from "../pricing/model.js";
import type { TaskFacts } from "./task-facts.js";
import type { RiskRow, VerificationStatus } from "./types.js";

/** Claimed daily restock (stated goods cost × stated orders) vs stated cash. */
export const DEMAND_CASH_MULTIPLE = 20;

export type EvidenceGap = {
  readonly riskIds: readonly string[];
  readonly fields: readonly string[];
};

/**
 * Clarify when buy, shipping, or competitor is missing from the written text.
 * A missing product name must not trigger this — standard cases have no formal name.
 */
export function missingEvidence(facts: TaskFacts): EvidenceGap | null {
  const riskIds: string[] = [];
  const fields: string[] = [];
  if (facts.buyCents === null || facts.shippingCents === null) {
    riskIds.push("missing-cost-facts");
    if (facts.buyCents === null) fields.push("buy");
    if (facts.shippingCents === null) fields.push("shipping");
  }
  if (facts.competitorCents === null) {
    riskIds.push("missing-market-anchor");
    fields.push("competitor");
  }
  if (riskIds.length === 0) return null;
  return { riskIds, fields };
}

/**
 * Structurally unprofitable: selling at the competitor price cannot break even
 * or yields a negative margin. Cash tightness alone is not this condition.
 */
export function isUnprofitableAtMarket(product: ProductInput): boolean {
  if (product.competitorCents <= 0) return false;
  const market = evaluate(product, product.competitorCents);
  const floor = breakEvenCents(product);
  return market.daily.margin < 0 || floor > product.competitorCents;
}

/**
 * Only uses numbers the merchant actually wrote. Optional packaging defaults to 0.
 */
export function demandExceedsCash(facts: TaskFacts): boolean {
  if (facts.cashCents === null || facts.marketOrders === null || facts.buyCents === null) {
    return false;
  }
  const goods = facts.buyCents + (facts.packagingCents ?? 0) + (facts.shippingCents ?? 0);
  return facts.marketOrders * goods > facts.cashCents * DEMAND_CASH_MULTIPLE;
}

export function evidenceRiskRows(gap: EvidenceGap): readonly RiskRow[] {
  return gap.riskIds.map((id) =>
    id === "missing-cost-facts"
      ? {
          id,
          title: "缺少采购或运费成本",
          status: "fail" as const,
          detail: "采购价或快递费未在任务中给出，不能用演示数字代替核算，需要掌柜补充后再判定。",
          owner: "link-researcher",
        }
      : {
          id,
          title: "缺少竞品价格锚点",
          status: "fail" as const,
          detail: "没有竞品参考价，不能凭空生成市场价，需要掌柜补充后再判定。",
          owner: "market-analyst",
        },
  );
}

export function marketRejectRiskRows(): readonly RiskRow[] {
  return [
    {
      id: "break-even",
      title: "按竞品价无法保本",
      status: "fail",
      detail: "按竞品价核算，保本价高于市场可接受价格，跟价会卖一单亏一单。",
      owner: "cost-accountant",
    },
    {
      id: "margin",
      title: "按竞品价毛利为负",
      status: "fail",
      detail: "按竞品价核算毛利为负；只有把售价抬到市场带之外才能做出正毛利，因此不能上架。",
      owner: "cost-accountant",
    },
  ];
}

export function demandDoubtRiskRow(): RiskRow {
  return {
    id: "market-demand-doubt",
    title: "宣称日单量与周转金严重背离",
    status: "fail",
    detail: "按已给出的采购成本和周转金，宣称日单量所需备货远远超过可周转资金，该需求假设不可信。",
    owner: "market-analyst",
  };
}

export function mergeRiskRows(
  existing: readonly RiskRow[],
  extra: readonly RiskRow[],
): { readonly level: VerificationStatus; readonly rows: readonly RiskRow[] } {
  const override = new Map<string, RiskRow>();
  for (const row of extra) {
    if (row.id !== undefined) override.set(row.id, row);
  }
  const seen = new Set<string>();
  const rows: RiskRow[] = [];
  for (const row of existing) {
    if (row.id === undefined) {
      rows.push(row);
      continue;
    }
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(override.get(row.id) ?? row);
  }
  for (const row of extra) {
    if (row.id === undefined || seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  const level: VerificationStatus = rows.some((row) => row.status === "fail")
    ? "fail"
    : rows.some((row) => row.status === "warn")
      ? "warn"
      : "pass";
  return { level, rows };
}
