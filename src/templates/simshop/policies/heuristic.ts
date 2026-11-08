import { cents, qty, type Cents, type Qty } from "../market/brand.js";
import { PRIMARY_CANNOT_DELIVER } from "../market/project.js";
import { incoming } from "../market/rules.js";
import type {
  Policy,
  PolicyInput,
  PublicTerms,
  ShopState,
  Sku,
  SkuOrder,
  SupplierId,
} from "../market/types.js";

const GOOD_PRICE_NUMERATOR = 13;
const GOOD_PRICE_DENOMINATOR = 10;
const GOOD_AD_CASH_PERCENT = 5;
const GOOD_AD_CAP_CENTS = 2000;
const BAD_PRICE_MULTIPLE = 8;
const BAD_AD_CASH_PERCENT = 60;

function percentOf(amount: Cents, percent: number): Cents {
  return cents(Math.floor((amount * percent) / 100));
}

function requirePrice(cost: Cents, label: string): Cents {
  if (cost <= 0) {
    throw new Error(`${label} is not a positive list price`);
  }
  return cost;
}

function coverQty(state: ShopState, sku: Sku, base: Qty): Qty {
  const stock = incoming(state.pendingReceipts, state.roundIndex, sku);
  const onHand = state.inventory[sku] + stock.due;
  const gap = Math.max(0, base - onHand - stock.later);
  return qty(base + gap);
}

function orderFor(
  state: ShopState,
  sku: Sku,
  supplier: SupplierId,
  model: PolicyInput["model"],
  terms: PublicTerms,
): SkuOrder {
  const cost = requirePrice(terms.listPrice[supplier][sku], `${supplier} ${sku}`);
  const price = cents(Math.round((cost * GOOD_PRICE_NUMERATOR) / GOOD_PRICE_DENOMINATOR));
  return {
    price,
    qty: coverQty(state, sku, model.nominalBaseDemand[sku]),
    supplier,
  };
}

function stockPolicy(choose: (news: string) => SupplierId): Policy {
  return ({ state, observation, model, terms }) => {
    const supplier = choose(observation.news);
    const ad = Math.min(GOOD_AD_CAP_CENTS, percentOf(state.cash, GOOD_AD_CASH_PERCENT));
    return {
      adSpend: cents(ad),
      orders: {
        tea: orderFor(state, "tea", supplier, model, terms),
        snack: orderFor(state, "snack", supplier, model, terms),
      },
    };
  };
}

export const heuristicGood = stockPolicy((news) =>
  news.includes(PRIMARY_CANNOT_DELIVER) ? "backup" : "primary",
);

export const heuristicPrimaryOnly = stockPolicy(() => "primary");

function maxOrder(state: ShopState, sku: Sku, terms: PublicTerms): SkuOrder {
  const cost = requirePrice(terms.listPrice.primary[sku], `primary ${sku}`);
  return {
    price: cents(cost * BAD_PRICE_MULTIPLE),
    qty: qty(Math.floor(state.cash / cost)),
    supplier: "primary",
  };
}

export const heuristicBad: Policy = ({ state, terms }) => ({
  adSpend: percentOf(state.cash, BAD_AD_CASH_PERCENT),
  orders: {
    tea: maxOrder(state, "tea", terms),
    snack: maxOrder(state, "snack", terms),
  },
});

export const POLICIES = {
  "heuristic-good": heuristicGood,
  "heuristic-bad": heuristicBad,
  "heuristic-primary-only": heuristicPrimaryOnly,
};

export type PolicyName = keyof typeof POLICIES;

export function isPolicyName(value: string): value is PolicyName {
  return Object.prototype.hasOwnProperty.call(POLICIES, value);
}
