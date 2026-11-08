import type { CheckState, ShelfSku, ShelfSupplier, ShopDecision } from "./constraints.js";

export type FallbackInput = CheckState & {
  readonly inventory: { readonly tea: number; readonly snack: number };
  readonly nominalBaseDemand: { readonly tea: number; readonly snack: number };
  readonly previousPrices: { readonly tea: number; readonly snack: number };
};

function affordable(cash: number, unitCost: number): number {
  if (unitCost <= 0) return 0;
  return Math.floor(cash / unitCost);
}

export function fallbackDecision(input: FallbackInput): ShopDecision {
  const remaining: Record<ShelfSupplier, number> = {
    primary: input.suppliers.primary.capacity,
    backup: input.suppliers.backup.capacity,
  };
  let cash = input.cash;
  const place = (sku: ShelfSku) => {
    const supplier: ShelfSupplier = remaining.primary > 0 ? "primary" : "backup";
    const cost = input.suppliers[supplier].unitCost[sku];
    const gap = Math.max(0, input.nominalBaseDemand[sku] - input.inventory[sku]);
    const qty = Math.min(gap, Math.max(0, remaining[supplier]), affordable(cash, cost));
    remaining[supplier] -= qty;
    cash -= qty * cost;
    return {
      price: input.previousPrices[sku],
      qty,
      supplier,
    };
  };
  return {
    adSpend: 0,
    orders: {
      tea: place("tea"),
      snack: place("snack"),
    },
  };
}
