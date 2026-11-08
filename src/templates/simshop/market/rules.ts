import {
  cashOnHand,
  cents,
  qty,
  reputation,
  roundIndex,
  type Cents,
  type Qty,
  type Reputation,
  type RoundIndex,
} from "./brand.js";
import { lognormalMeanOne, type Rng } from "./rng.js";
import { readAt } from "./schedule.js";
import {
  SKUS,
  type Decision,
  type Outcome,
  type PendingReceipt,
  type ScenarioTruth,
  type Settlement,
  type ShopState,
  type Sku,
  type SkuOutcome,
  type SupplierId,
} from "./types.js";

const SEASON_SCALE = 10000;
const REPUTATION_BASELINE = 500;
const REPUTATION_RECOVERY = 5;
const COMPETITOR_FLOOR = 0.5;
const COMPETITOR_CAP = 1.5;

function isDue(receipt: PendingReceipt, round: RoundIndex): boolean {
  return receipt.arrivesAt <= round;
}

export function incoming(
  receipts: readonly PendingReceipt[],
  round: RoundIndex,
  sku: Sku,
): { due: Qty; later: Qty } {
  let due = 0;
  let later = 0;
  for (const receipt of receipts) {
    if (receipt.sku !== sku) {
      continue;
    }
    if (isDue(receipt, round)) {
      due += receipt.qty;
    } else {
      later += receipt.qty;
    }
  }
  return { due: qty(due), later: qty(later) };
}

function takeReceipts(
  receipts: readonly PendingReceipt[],
  round: RoundIndex,
): { add: Record<Sku, Qty>; remaining: PendingReceipt[] } {
  const add: Record<Sku, number> = { tea: 0, snack: 0 };
  const remaining: PendingReceipt[] = [];
  for (const receipt of receipts) {
    if (isDue(receipt, round)) {
      add[receipt.sku] += receipt.qty;
    } else {
      remaining.push({
        sku: receipt.sku,
        qty: receipt.qty,
        arrivesAt: receipt.arrivesAt,
      });
    }
  }
  return {
    add: { tea: qty(add.tea), snack: qty(add.snack) },
    remaining,
  };
}

function spend(cash: Cents, want: Cents): { cash: Cents; paid: Cents } {
  const paid = Math.min(cash, Math.max(0, want));
  return { cash: cashOnHand(cash - paid), paid: cents(paid) };
}

function fillOrder(
  cash: Cents,
  requested: Qty,
  unitCost: Cents,
  capacity: Qty,
): { cash: Cents; qty: Qty; cost: Cents; remaining: Qty } {
  if (unitCost <= 0) {
    throw new Error("unit cost must be positive");
  }
  const affordable = Math.floor(cash / unitCost);
  const filled = Math.min(requested, capacity, affordable);
  const cost = filled * unitCost;
  return {
    cash: cashOnHand(cash - cost),
    qty: qty(filled),
    cost: cents(cost),
    remaining: qty(capacity - filled),
  };
}

function clamp(value: number, low: number, high: number): number {
  if (value < low) {
    return low;
  }
  if (value > high) {
    return high;
  }
  return value;
}

function demandUnits(input: {
  base: Qty;
  seasonBps: number;
  refPrice: Cents;
  price: Cents;
  competitorPrice: Cents;
  elasticity: number;
  adSpend: Cents;
  halfSat: Cents;
  reputation: Reputation;
  noise: number;
}): Qty {
  if (input.price <= 0 || input.halfSat <= 0) {
    return qty(0);
  }
  const season = input.seasonBps / SEASON_SCALE;
  const priceFactor = Math.pow(input.refPrice / input.price, input.elasticity);
  const competitorFactor = clamp(
    input.competitorPrice / input.price,
    COMPETITOR_FLOOR,
    COMPETITOR_CAP,
  );
  const adFactor = 1 + input.adSpend / (input.adSpend + input.halfSat);
  const reputationFactor = input.reputation / REPUTATION_BASELINE;
  const raw =
    input.base *
    season *
    priceFactor *
    competitorFactor *
    adFactor *
    reputationFactor *
    input.noise;
  if (!Number.isFinite(raw)) {
    return qty(0);
  }
  const rounded = Math.max(0, Math.round(raw));
  if (!Number.isSafeInteger(rounded)) {
    throw new Error("demand exceeds the safe integer range");
  }
  return qty(rounded);
}

function nextReputation(current: Reputation, missed: Qty, penalty: number): Reputation {
  const raw = missed > 0 ? current - penalty * missed : current + REPUTATION_RECOVERY;
  const clamped = Math.min(1000, Math.max(0, raw));
  return reputation(clamped);
}

type Draft = {
  price: Cents;
  supplier: SupplierId;
  ordered: Qty;
  received: Qty;
  onHand: Qty;
  demand: Qty;
  sales: Qty;
  missed: Qty;
  revenue: Cents;
  orderCost: Cents;
  holding: Cents;
  inventory: Qty;
};

function pullNoise(rng: Rng, round: RoundIndex, sku: Sku, sigma: number): number {
  return lognormalMeanOne(
    rng.uniform("settle", round, sku, 0),
    rng.uniform("settle", round, sku, 1),
    sigma,
  );
}

export function settle(
  state: ShopState,
  decision: Decision,
  truth: ScenarioTruth,
  rng: Rng,
): Settlement {
  const round = state.roundIndex;
  const noise: Record<Sku, number> = {
    tea: pullNoise(rng, round, "tea", truth.noiseSigma),
    snack: pullNoise(rng, round, "snack", truth.noiseSigma),
  };
  const opened = takeReceipts(state.pendingReceipts, round);
  const inventory: Record<Sku, Qty> = {
    tea: qty(state.inventory.tea + opened.add.tea),
    snack: qty(state.inventory.snack + opened.add.snack),
  };
  const received: Record<Sku, Qty> = {
    tea: opened.add.tea,
    snack: opened.add.snack,
  };
  const capacity: Record<SupplierId, Qty> = {
    primary: readAt(truth.suppliers.primary.capacityByRound, round, "primary capacity"),
    backup: readAt(truth.suppliers.backup.capacityByRound, round, "backup capacity"),
  };
  const pending = opened.remaining;

  // Ad is paid before purchase orders so an unbounded order cannot erase a stated ad budget.
  const ad = spend(state.cash, decision.adSpend);
  let cash = ad.cash;

  const drafts: { tea?: Draft; snack?: Draft } = {};
  for (const sku of SKUS) {
    const order = decision.orders[sku];
    const supplier = order.supplier;
    const unitCost = truth.suppliers[supplier].unitCost[sku];
    const lead = truth.suppliers[supplier].leadTime;
    const filled = fillOrder(cash, order.qty, unitCost, capacity[supplier]);
    cash = filled.cash;
    capacity[supplier] = filled.remaining;
    let onHand = inventory[sku];
    if (filled.qty > 0 && lead === 0) {
      onHand = qty(onHand + filled.qty);
      received[sku] = qty(received[sku] + filled.qty);
    } else if (filled.qty > 0) {
      pending.push({
        sku,
        qty: filled.qty,
        arrivesAt: roundIndex(round + lead),
      });
    }
    const demand = demandUnits({
      base: truth.skus[sku].baseDemand,
      seasonBps: readAt(truth.seasonBps, round, "season"),
      refPrice: truth.skus[sku].refPrice,
      price: order.price,
      competitorPrice: readAt(truth.competitorPrice[sku], round, `${sku} competitor price`),
      elasticity: truth.elasticity,
      adSpend: ad.paid,
      halfSat: truth.adHalfSat,
      reputation: state.reputation,
      noise: noise[sku],
    });
    const sales = qty(Math.min(demand, onHand));
    const missed = qty(demand - sales);
    const ending = qty(onHand - sales);
    inventory[sku] = ending;
    drafts[sku] = {
      price: order.price,
      supplier,
      ordered: filled.qty,
      received: received[sku],
      onHand,
      demand,
      sales,
      missed,
      revenue: cents(sales * order.price),
      orderCost: filled.cost,
      holding: cents(0),
      inventory: ending,
    };
  }

  const teaDraft = drafts.tea;
  const snackDraft = drafts.snack;
  if (teaDraft === undefined || snackDraft === undefined) {
    throw new Error("sku settlement missing");
  }

  const revenue = cents(teaDraft.revenue + snackDraft.revenue);
  cash = cashOnHand(cash + revenue);

  let holdingPaid = 0;
  for (const sku of SKUS) {
    const draft = drafts[sku];
    if (draft === undefined) {
      throw new Error(`holding missing for ${sku}`);
    }
    const want = cents(draft.inventory * truth.holdingCost);
    const paid = spend(cash, want);
    cash = paid.cash;
    holdingPaid += paid.paid;
    draft.holding = paid.paid;
  }

  const sales = qty(teaDraft.sales + snackDraft.sales);
  const missed = qty(teaDraft.missed + snackDraft.missed);
  const orderCost = cents(teaDraft.orderCost + snackDraft.orderCost);
  const holding = cents(holdingPaid);
  const profit = cents(revenue - orderCost - holding - ad.paid);
  const nextReputationValue = nextReputation(state.reputation, missed, truth.stockoutPenalty);
  const skuOutcome = (draft: Draft): SkuOutcome => ({
    price: draft.price,
    supplier: draft.supplier,
    ordered: draft.ordered,
    received: draft.received,
    onHand: draft.onHand,
    demand: draft.demand,
    sales: draft.sales,
    missed: draft.missed,
    revenue: draft.revenue,
    orderCost: draft.orderCost,
    holding: draft.holding,
    inventory: draft.inventory,
  });
  const outcome: Outcome = {
    round,
    revenue,
    orderCost,
    holding,
    adSpend: ad.paid,
    profit,
    sales,
    missed,
    cash,
    reputation: nextReputationValue,
    inventory: { tea: inventory.tea, snack: inventory.snack },
    skus: { tea: skuOutcome(teaDraft), snack: skuOutcome(snackDraft) },
  };
  const next: ShopState = {
    cash,
    inventory: { tea: inventory.tea, snack: inventory.snack },
    reputation: nextReputationValue,
    roundIndex: roundIndex(round + 1),
    pendingReceipts: pending,
  };
  return { state: next, outcome };
}
