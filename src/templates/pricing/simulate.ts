import { adOrders, organicOrders, unitCost } from "./economics.js";
import type { ProductInput, SimDay, SimResult } from "./model.js";

export const SIM_DAYS = 30;
export const SIM_RUNS = 200;
const NOISE_SIGMA = 0.28;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number): number {
  const u1 = Math.min(Math.max(rng(), 1e-9), 1 - 1e-9);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

type RunResult = {
  readonly days: readonly SimDay[];
  readonly totalOrders: number;
  readonly totalRevenueCents: number;
  readonly totalProfitCents: number;
  readonly minCashCents: number;
  readonly endCashCents: number;
  readonly receivableCents: number;
  readonly stockoutDays: number;
};

function runOnce(input: ProductInput, priceCents: number, seed: number, days: number): RunResult {
  const unit = unitCost(input, priceCents);
  const stockCost = input.buyCents + input.packagingCents;
  const baseOrganic = organicOrders(input, priceCents);
  const ad = adOrders(input);
  const settle = Math.max(0, Math.round(input.settleDays));
  const rng = mulberry32(seed);
  const receivables = new Array<number>(days + settle + 2).fill(0);
  const rows: SimDay[] = [];
  let cash = input.cashCents;
  let cumProfit = 0;
  let totalOrders = 0;
  let totalRevenue = 0;
  let minCash = cash;
  let stockoutDays = 0;

  for (let day = 1; day <= days; day += 1) {
    cash += receivables[day] ?? 0;
    const noise = Math.exp(NOISE_SIGMA * gauss(rng));
    const demand = baseOrganic * noise + ad;
    const capacity = stockCost > 0 ? Math.floor(cash / stockCost) : 0;
    const orders = Math.max(0, Math.floor(Math.min(demand, capacity)));
    const stockout = demand > capacity + 0.5;
    cash -= orders * stockCost;
    const adSpend = demand > 0 ? Math.min(input.adDailyBudgetCents, Math.max(0, cash)) : 0;
    cash -= adSpend;
    const revenue = orders * priceCents;
    const slot = day + settle;
    receivables[slot] = (receivables[slot] ?? 0) + revenue;
    const profit = revenue - orders * unit.totalCents - adSpend;
    cumProfit += profit;
    totalOrders += orders;
    totalRevenue += revenue;
    minCash = Math.min(minCash, cash);
    if (stockout) {
      stockoutDays += 1;
    }
    rows.push({ day, orders, profitCents: profit, cumProfitCents: cumProfit, cashCents: cash, stockout });
  }

  let receivable = 0;
  for (let day = days + 1; day < receivables.length; day += 1) {
    receivable += receivables[day] ?? 0;
  }
  return {
    days: rows,
    totalOrders,
    totalRevenueCents: totalRevenue,
    totalProfitCents: cumProfit,
    minCashCents: minCash,
    endCashCents: cash,
    receivableCents: receivable,
    stockoutDays,
  };
}

function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)));
  return sorted[index] ?? 0;
}

export function simulate(input: ProductInput, priceCents: number, days = SIM_DAYS): SimResult {
  const runs: RunResult[] = [];
  for (let index = 0; index < SIM_RUNS; index += 1) {
    runs.push(runOnce(input, priceCents, input.seed + index * 7919 + 13, days));
  }
  const totals = runs.map((run) => run.totalProfitCents).sort((left, right) => left - right);
  const p50 = percentile(totals, 0.5);
  let representative = runs[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const run of runs) {
    const distance = Math.abs(run.totalProfitCents - p50);
    if (distance < bestDistance) {
      bestDistance = distance;
      representative = run;
    }
  }
  const chosen = representative ?? runs[0];
  if (chosen === undefined) {
    throw new Error("simulation produced no runs");
  }
  const totalOrders = Math.round(chosen.totalOrders);
  return {
    days: chosen.days,
    totalOrders,
    totalRevenueCents: chosen.totalRevenueCents,
    totalProfitCents: chosen.totalProfitCents,
    avgDailyProfitCents: Math.round(chosen.totalProfitCents / days),
    minCashCents: chosen.minCashCents,
    endCashCents: chosen.endCashCents,
    receivableCents: chosen.receivableCents,
    stockoutDays: chosen.stockoutDays,
    p10Cents: percentile(totals, 0.1),
    p50Cents: p50,
    p90Cents: percentile(totals, 0.9),
  };
}