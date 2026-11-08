import { z } from "zod";

import type { SchemaResult } from "../../engine/verify/pipeline.js";

export const CHECK_CASH = "cash-after";
export const CHECK_QTY = "order-qty";
export const CHECK_PRICE = "price-floor";
export const CHECK_AD = "ad-spend";

const SKUS = ["tea", "snack"] as const;
const SUPPLIERS = ["primary", "backup"] as const;

export type ShelfSku = (typeof SKUS)[number];
export type ShelfSupplier = (typeof SUPPLIERS)[number];

export type ShelfOrder = {
  readonly price: number;
  readonly qty: number;
  readonly supplier: ShelfSupplier;
};

export type ShopDecision = {
  readonly adSpend: number;
  readonly orders: {
    readonly tea: ShelfOrder;
    readonly snack: ShelfOrder;
  };
};

export type SupplierVisible = {
  readonly capacity: number;
  readonly unitCost: { readonly tea: number; readonly snack: number };
};

export type CheckState = {
  readonly cash: number;
  readonly suppliers: {
    readonly primary: SupplierVisible;
    readonly backup: SupplierVisible;
  };
};

const orderSchema = z.strictObject({
  price: z.number().int(),
  qty: z.number().int(),
  supplier: z.enum(SUPPLIERS),
});

const decisionSchema = z.strictObject({
  adSpend: z.number().int(),
  orders: z.strictObject({
    tea: orderSchema,
    snack: orderSchema,
  }),
});

export function parseShopDecision(raw: unknown): SchemaResult<ShopDecision> {
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, detail: parsed.error.message };
  }
  return { ok: true, decision: parsed.data };
}

function cashAfter(decision: ShopDecision, state: CheckState): number {
  let spend = decision.adSpend;
  for (const sku of SKUS) {
    const order = decision.orders[sku];
    spend += order.qty * state.suppliers[order.supplier].unitCost[sku];
  }
  return state.cash - spend;
}

export function cashAfterCheck(decision: ShopDecision, state: CheckState) {
  const after = cashAfter(decision, state);
  const relation = after >= 0 ? "remains" : "would be";
  return {
    id: CHECK_CASH,
    pass: after >= 0,
    detail: `cash after the decision ${relation} ${String(after)}`,
  };
}

export function orderQtyCheck(decision: ShopDecision, state: CheckState) {
  const totals: Record<ShelfSupplier, number> = { primary: 0, backup: 0 };
  const problems: string[] = [];
  for (const sku of SKUS) {
    const order = decision.orders[sku];
    if (order.qty < 0) problems.push(`${sku} qty ${String(order.qty)} is below 0`);
    if (order.qty > 0) totals[order.supplier] += order.qty;
  }
  for (const supplier of SUPPLIERS) {
    const capacity = state.suppliers[supplier].capacity;
    const qty = totals[supplier];
    if (qty > capacity) {
      problems.push(`${supplier} qty ${String(qty)} exceeds visible capacity ${String(capacity)}`);
    }
  }
  return {
    id: CHECK_QTY,
    pass: problems.length === 0,
    detail: problems.length === 0 ? "order qty is within visible capacity" : problems.join("; "),
  };
}

export function priceFloorCheck(decision: ShopDecision, state: CheckState) {
  const problems: string[] = [];
  for (const sku of SKUS) {
    const order = decision.orders[sku];
    const cost = state.suppliers[order.supplier].unitCost[sku];
    if (!Number.isInteger(order.price) || order.price < cost) {
      problems.push(`${sku} price ${String(order.price)} is below unit cost ${String(cost)}`);
    }
  }
  return {
    id: CHECK_PRICE,
    pass: problems.length === 0,
    detail: problems.length === 0 ? "price is an integer at or above unit cost" : problems.join("; "),
  };
}

export function adSpendCheck(decision: ShopDecision, state: CheckState) {
  const spend = decision.adSpend;
  const pass = Number.isInteger(spend) && spend >= 0 && spend <= state.cash;
  return {
    id: CHECK_AD,
    pass,
    detail: pass
      ? "ad spend is within cash"
      : `ad spend ${String(spend)} is outside 0..${String(state.cash)}`,
  };
}

export const SHOP_CHECKS = [cashAfterCheck, orderQtyCheck, priceFloorCheck, adSpendCheck] as const;

export function visibleCapacity(input: {
  readonly announced: number;
  readonly closed: boolean;
}): number {
  if (input.closed) return 0;
  return input.announced;
}
