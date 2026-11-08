import type { Forecast } from "../../engine/verify/pipeline.js";
import type { ShopDecision, ShelfSku, ShelfSupplier } from "./constraints.js";
import type { Observation, PublicModel, PublicTerms, ShopState } from "./market/types.js";

const PUBLIC_AD_HALF_SAT = 30000;
const REPUTATION_BASELINE = 500;
const NOISES = [0.9, 1, 1.1] as const;
const AD_STEP_CENTS = 5000;

export type SandboxView = {
  readonly cash: number;
  readonly inventory: { readonly tea: number; readonly snack: number };
  readonly reputation: number;
  readonly nominalElasticity: number;
  readonly nominalBaseDemand: { readonly tea: number; readonly snack: number };
  readonly competitorPrice: { readonly tea: number; readonly snack: number };
  readonly unitCost: {
    readonly primary: { readonly tea: number; readonly snack: number };
    readonly backup: { readonly tea: number; readonly snack: number };
  };
};

export function publicSandboxView(input: {
  readonly observation: Observation;
  readonly model: PublicModel;
  readonly terms: PublicTerms;
}): SandboxView {
  return {
    cash: input.observation.cash,
    inventory: {
      tea: input.observation.inventory.tea,
      snack: input.observation.inventory.snack,
    },
    reputation: input.observation.reputation,
    nominalElasticity: input.model.nominalElasticity,
    nominalBaseDemand: {
      tea: input.model.nominalBaseDemand.tea,
      snack: input.model.nominalBaseDemand.snack,
    },
    competitorPrice: {
      tea: input.observation.competitorPrices.tea,
      snack: input.observation.competitorPrices.snack,
    },
    unitCost: {
      primary: {
        tea: input.terms.listPrice.primary.tea,
        snack: input.terms.listPrice.primary.snack,
      },
      backup: {
        tea: input.terms.listPrice.backup.tea,
        snack: input.terms.listPrice.backup.snack,
      },
    },
  };
}

function demandUnits(input: {
  readonly view: SandboxView;
  readonly sku: ShelfSku;
  readonly price: number;
  readonly adSpend: number;
  readonly reputation: number;
  readonly noise: number;
}): number {
  if (input.price <= 0) return 0;
  const competitor = input.view.competitorPrice[input.sku];
  const priceFactor = Math.pow(competitor / input.price, input.view.nominalElasticity);
  const adFactor = 1 + input.adSpend / (input.adSpend + PUBLIC_AD_HALF_SAT);
  const reputationFactor = input.reputation / REPUTATION_BASELINE;
  const raw =
    input.view.nominalBaseDemand[input.sku] * priceFactor * adFactor * reputationFactor * input.noise;
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.round(raw));
}

function sampleProfit(input: {
  readonly decision: ShopDecision;
  readonly view: SandboxView;
  readonly cash: number;
  readonly inventory: { readonly tea: number; readonly snack: number };
  readonly reputation: number;
  readonly noise: number;
}): { readonly profit: number; readonly stockout: boolean } {
  const adPaid = Math.min(Math.max(0, input.decision.adSpend), input.cash);
  let cashLeft = input.cash - adPaid;
  let orderCost = 0;
  let revenue = 0;
  let stockout = false;
  const skus: readonly ShelfSku[] = ["tea", "snack"];
  for (const sku of skus) {
    const order = input.decision.orders[sku];
    const cost = input.view.unitCost[order.supplier][sku];
    const affordable = cost > 0 ? Math.floor(cashLeft / cost) : 0;
    const qty = Math.max(0, Math.min(order.qty, affordable));
    cashLeft -= qty * cost;
    orderCost += qty * cost;
    const demand = demandUnits({
      view: input.view,
      sku,
      price: order.price,
      adSpend: adPaid,
      reputation: input.reputation,
      noise: input.noise,
    });
    if (demand > input.inventory[sku]) stockout = true;
    const sold = Math.min(demand, input.inventory[sku]);
    revenue += sold * order.price;
  }
  return { profit: revenue - orderCost - adPaid, stockout };
}

function sellable(state: ShopState): { tea: number; snack: number } {
  const onHand: { tea: number; snack: number } = {
    tea: state.inventory.tea,
    snack: state.inventory.snack,
  };
  for (const receipt of state.pendingReceipts) {
    if (receipt.arrivesAt <= state.roundIndex) onHand[receipt.sku] += receipt.qty;
  }
  return onHand;
}

export function forecastShop(input: {
  readonly decision: ShopDecision;
  readonly state: ShopState;
  readonly view: SandboxView;
}): Forecast {
  const cash = input.state.cash;
  const inventory = sellable(input.state);
  const reputation = input.state.reputation;
  const profits: number[] = [];
  let stockouts = 0;
  for (const noise of NOISES) {
    const sample = sampleProfit({
      decision: input.decision,
      view: input.view,
      cash,
      inventory,
      reputation,
      noise,
    });
    profits.push(sample.profit);
    if (sample.stockout) stockouts += 1;
  }
  const sorted = [...profits].sort((left, right) => left - right);
  const low = sorted[0] ?? 0;
  const mid = sorted[1] ?? low;
  const high = sorted[2] ?? mid;
  return {
    profitCents: { p10: low, p50: mid, p90: high },
    stockoutRisk: stockouts / NOISES.length,
    samples: NOISES.length,
  };
}

function shelf(input: {
  readonly adSpend: number;
  readonly prices: { readonly tea: number; readonly snack: number };
  readonly supplier: ShelfSupplier;
}): ShopDecision {
  return {
    adSpend: input.adSpend,
    orders: {
      tea: { price: input.prices.tea, qty: 0, supplier: input.supplier },
      snack: { price: input.prices.snack, qty: 0, supplier: input.supplier },
    },
  };
}

export function marginalBids(input: {
  readonly state: ShopState;
  readonly view: SandboxView;
  readonly prices: { readonly tea: number; readonly snack: number };
  readonly supplier: ShelfSupplier;
}): { readonly ads: number; readonly priceCut: number } {
  const base = forecastShop({
    decision: shelf({ adSpend: 0, prices: input.prices, supplier: input.supplier }),
    state: input.state,
    view: input.view,
  }).profitCents.p50;
  const adSpend = Math.min(input.state.cash, AD_STEP_CENTS);
  const ads = forecastShop({
    decision: shelf({ adSpend, prices: input.prices, supplier: input.supplier }),
    state: input.state,
    view: input.view,
  }).profitCents.p50;
  const cut = {
    tea: Math.max(input.view.unitCost[input.supplier].tea, input.prices.tea - Math.max(1, Math.floor(input.prices.tea / 5))),
    snack: Math.max(
      input.view.unitCost[input.supplier].snack,
      input.prices.snack - Math.max(1, Math.floor(input.prices.snack / 5)),
    ),
  };
  const priceCut = forecastShop({
    decision: shelf({ adSpend: 0, prices: cut, supplier: input.supplier }),
    state: input.state,
    view: input.view,
  }).profitCents.p50;
  return { ads: ads - base, priceCut: priceCut - base };
}
