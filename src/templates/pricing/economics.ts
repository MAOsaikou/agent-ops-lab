import type { PriceEvaluation, ProductInput, UnitCost } from "./model.js";

export const MAX_DEMAND_MULTIPLE = 8;

export function returnLossPerOrder(input: ProductInput): number {
  const roundTrip = input.shippingCents * 2 + input.packagingCents;
  const damaged = input.buyCents * (1 - input.returnSalvage);
  return Math.round(input.returnRate * (roundTrip + damaged));
}

export function unitCost(input: ProductInput, priceCents: number): UnitCost {
  const commissionCents = Math.round(priceCents * input.commissionRate);
  const payFeeCents = Math.round(priceCents * input.payFeeRate);
  const returnLossCents = returnLossPerOrder(input);
  const totalCents =
    input.buyCents +
    input.packagingCents +
    input.shippingCents +
    commissionCents +
    payFeeCents +
    returnLossCents;
  return {
    buyCents: input.buyCents,
    packagingCents: input.packagingCents,
    shippingCents: input.shippingCents,
    commissionCents,
    payFeeCents,
    returnLossCents,
    totalCents,
  };
}

export function netRate(input: ProductInput): number {
  return 1 - input.commissionRate - input.payFeeRate;
}

export function breakEvenCents(input: ProductInput): number {
  const fixed = input.buyCents + input.packagingCents + input.shippingCents + returnLossPerOrder(input);
  const rate = netRate(input);
  if (rate <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.ceil(fixed / rate);
}

export function priceForMargin(input: ProductInput, margin: number): number {
  const fixed = input.buyCents + input.packagingCents + input.shippingCents + returnLossPerOrder(input);
  const denominator = netRate(input) - margin;
  if (denominator <= 0.0001) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.ceil(fixed / denominator);
}

export function nicePrice(cents: number): number {
  const floored = Math.max(99, cents);
  const base = Math.floor(floored / 100) * 100 + 90;
  return base >= floored ? base : base + 100;
}

export function organicOrders(input: ProductInput, priceCents: number): number {
  if (priceCents <= 0) {
    return 0;
  }
  const ratio = input.competitorCents / priceCents;
  const raw = input.marketOrders * Math.pow(ratio, input.elasticity);
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return Math.min(raw, input.marketOrders * MAX_DEMAND_MULTIPLE);
}

export function adOrders(input: ProductInput): number {
  if (input.adCpcCents <= 0 || input.adDailyBudgetCents <= 0) {
    return 0;
  }
  return (input.adDailyBudgetCents / input.adCpcCents) * input.adCvr;
}

export function dailyCapacity(input: ProductInput): number {
  const stockCost = input.buyCents + input.packagingCents;
  if (stockCost <= 0) {
    return 0;
  }
  return Math.floor(input.cashCents / stockCost);
}

export function evaluate(input: ProductInput, priceCents: number): PriceEvaluation {
  if (!Number.isFinite(priceCents) || priceCents <= 0) {
    throw new Error("price must be a positive number of cents");
  }
  const price = Math.round(priceCents);
  const unit = unitCost(input, price);
  const organic = organicOrders(input, price);
  const ad = adOrders(input);
  const demand = organic + ad;
  const capacity = dailyCapacity(input);
  const orders = Math.min(demand, capacity);
  const stockoutOrders = Math.max(0, demand - capacity);
  const adSpendCents = demand > 0 ? input.adDailyBudgetCents : 0;
  const revenueCents = orders * price;
  const profitCents = revenueCents - orders * unit.totalCents - adSpendCents;
  const adPerOrderCents = orders > 0 ? adSpendCents / orders : 0;
  const netPerOrderCents = orders > 0 ? profitCents / orders : -adSpendCents;
  return {
    priceCents: price,
    breakEvenCents: breakEvenCents(input),
    unit,
    daily: {
      orders,
      demand,
      capacity,
      stockoutOrders,
      adSpendCents,
      adPerOrderCents,
      netPerOrderCents,
      margin: orders > 0 ? netPerOrderCents / price : 0,
      revenueCents,
      profitCents,
    },
  };
}