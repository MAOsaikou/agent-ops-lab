import { breakEvenCents } from "../../../src/templates/pricing/economics.js";
import type { ProductInput } from "../../../src/templates/pricing/model.js";
import {
  PLATFORM_PRESETS,
  type PlatformId,
  type ServiceTag,
} from "../../../src/templates/pricing/platform.js";
import { SAMPLES } from "../../../src/templates/pricing/sample.js";

export type Draft = {
  readonly platform: PlatformId;
  readonly name: string;
  readonly category: string;
  readonly keywords: string;
  readonly buy: string;
  readonly packaging: string;
  readonly shipping: string;
  readonly commissionPct: string;
  readonly payFeePct: string;
  readonly returnPct: string;
  readonly salvagePct: string;
  readonly competitor: string;
  readonly marketOrders: string;
  readonly targetMarginPct: string;
  readonly adBudget: string;
  readonly adCpc: string;
  readonly adCvrPct: string;
  readonly cash: string;
  readonly settleDays: string;
  readonly promoEnabled: boolean;
  readonly promoDiscountPct: string;
  readonly services: readonly ServiceTag[];
  readonly elasticity: string;
  readonly seed: string;
};

function toNum(text: string, fallback: number): number {
  const value = Number(text.replace(/[^\d.-]/g, ""));
  return Number.isFinite(value) ? value : fallback;
}

function yuan(text: string, fallbackCents: number): number {
  const value = Number(text.replace(/[^\d.-]/g, ""));
  return Number.isFinite(value) ? Math.round(value * 100) : fallbackCents;
}

function rate(text: string, fallback: number): number {
  const value = Number(text.replace(/[^\d.-]/g, ""));
  return Number.isFinite(value) ? value / 100 : fallback;
}

function text(cents: number): string {
  return (cents / 100).toFixed(2);
}

function percent(ratio: number): string {
  return (ratio * 100).toFixed(2).replace(/\.?0+$/, "");
}

export function draftFromInput(input: ProductInput): Draft {
  return {
    platform: input.platform,
    name: input.name,
    category: input.category,
    keywords: input.keywords,
    buy: text(input.buyCents),
    packaging: text(input.packagingCents),
    shipping: text(input.shippingCents),
    commissionPct: percent(input.commissionRate),
    payFeePct: percent(input.payFeeRate),
    returnPct: percent(input.returnRate),
    salvagePct: percent(input.returnSalvage),
    competitor: text(input.competitorCents),
    marketOrders: String(input.marketOrders),
    targetMarginPct: percent(input.targetMargin),
    adBudget: text(input.adDailyBudgetCents),
    adCpc: text(input.adCpcCents),
    adCvrPct: percent(input.adCvr),
    cash: text(input.cashCents),
    settleDays: String(input.settleDays),
    promoEnabled: input.promoEnabled,
    promoDiscountPct: percent(input.promoDiscount),
    services: input.services,
    elasticity: input.elasticity.toFixed(1),
    seed: String(input.seed),
  };
}

export const DEFAULT_DRAFT: Draft = draftFromInput(
  SAMPLES[0]?.input ?? {
    platform: "taobao",
    name: "新商品",
    category: "",
    keywords: "",
    buyCents: 1000,
    packagingCents: 50,
    shippingCents: 250,
    commissionRate: 0.005,
    payFeeRate: 0.006,
    returnRate: 0.1,
    returnSalvage: 0.6,
    adDailyBudgetCents: 0,
    adCpcCents: 60,
    adCvr: 0.04,
    competitorCents: 2990,
    marketOrders: 30,
    elasticity: 2.2,
    targetMargin: 0.25,
    cashCents: 500000,
    settleDays: 7,
    services: ["包邮"],
    promoEnabled: false,
    promoDiscount: 0.9,
    seed: 7,
  },
);

export function applyPlatform(draft: Draft, platform: PlatformId): Draft {
  const preset = PLATFORM_PRESETS[platform];
  return {
    ...draft,
    platform,
    commissionPct: percent(preset.commissionRate),
    payFeePct: percent(preset.payFeeRate),
    settleDays: String(preset.settleDays),
    returnPct: draft.returnPct,
  };
}

export function toProductInput(draft: Draft): ProductInput {
  return {
    platform: draft.platform,
    name: draft.name.trim().length > 0 ? draft.name.trim() : "未命名商品",
    category: draft.category.trim(),
    keywords: draft.keywords.trim(),
    buyCents: yuan(draft.buy, 1000),
    packagingCents: yuan(draft.packaging, 0),
    shippingCents: yuan(draft.shipping, 0),
    commissionRate: rate(draft.commissionPct, 0.005),
    payFeeRate: rate(draft.payFeePct, 0.006),
    returnRate: rate(draft.returnPct, 0.1),
    returnSalvage: rate(draft.salvagePct, 0.6),
    adDailyBudgetCents: yuan(draft.adBudget, 0),
    adCpcCents: Math.max(1, yuan(draft.adCpc, 60)),
    adCvr: rate(draft.adCvrPct, 0.04),
    competitorCents: Math.max(100, yuan(draft.competitor, 2990)),
    marketOrders: Math.max(0, Math.round(toNum(draft.marketOrders, 30))),
    elasticity: Math.max(1, Math.min(4, toNum(draft.elasticity, 2.2))),
    targetMargin: Math.max(0.02, Math.min(0.6, rate(draft.targetMarginPct, 0.25))),
    cashCents: Math.max(0, yuan(draft.cash, 500000)),
    settleDays: Math.max(0, Math.min(30, Math.round(toNum(draft.settleDays, 7)))),
    services: draft.services,
    promoEnabled: draft.promoEnabled,
    promoDiscount: Math.max(0.4, Math.min(1, rate(draft.promoDiscountPct, 0.9))),
    seed: Math.max(0, Math.round(toNum(draft.seed, 7))),
  };
}

export function missingFields(draft: Draft): readonly string[] {
  const missing: string[] = [];
  if (draft.name.trim().length === 0) {
    missing.push("商品名");
  }
  if (yuan(draft.buy, 0) <= 0) {
    missing.push("采购价");
  }
  if (yuan(draft.competitor, 0) <= 0) {
    missing.push("竞品价");
  }
  if (toNum(draft.marketOrders, 0) <= 0) {
    missing.push("竞品价下的日单量");
  }
  return missing;
}

export function liveBreakEven(draft: Draft): number | null {
  try {
    const value = breakEvenCents(toProductInput(draft));
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}