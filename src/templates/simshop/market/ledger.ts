import { createHash } from "node:crypto";

import { canonicalJson, type Canonical } from "./canonical.js";
import type { Outcome, SkuOutcome } from "./types.js";

function skuCanonical(row: SkuOutcome): Canonical {
  return {
    demand: row.demand,
    holding: row.holding,
    inventory: row.inventory,
    missed: row.missed,
    onHand: row.onHand,
    orderCost: row.orderCost,
    ordered: row.ordered,
    price: row.price,
    received: row.received,
    revenue: row.revenue,
    sales: row.sales,
    supplier: row.supplier,
  };
}

export function outcomeCanonical(outcome: Outcome): Canonical {
  return {
    adSpend: outcome.adSpend,
    cash: outcome.cash,
    holding: outcome.holding,
    inventory: {
      snack: outcome.inventory.snack,
      tea: outcome.inventory.tea,
    },
    missed: outcome.missed,
    orderCost: outcome.orderCost,
    profit: outcome.profit,
    reputation: outcome.reputation,
    revenue: outcome.revenue,
    round: outcome.round,
    sales: outcome.sales,
    skus: {
      snack: skuCanonical(outcome.skus.snack),
      tea: skuCanonical(outcome.skus.tea),
    },
  };
}

export function ledgerLine(outcome: Outcome): string {
  return canonicalJson(outcomeCanonical(outcome));
}

export function ledgerDigest(ledger: readonly Outcome[]): string {
  const body = canonicalJson(ledger.map((outcome) => outcomeCanonical(outcome)));
  return createHash("sha256").update(body, "utf8").digest("hex");
}
