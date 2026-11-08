import type { Cents, Qty, Reputation, RoundIndex } from "./brand.js";

export const SKUS = ["tea", "snack"] as const;
export const SUPPLIERS = ["primary", "backup"] as const;

export type Sku = (typeof SKUS)[number];
export type SupplierId = (typeof SUPPLIERS)[number];

export type PendingReceipt = {
  sku: Sku;
  qty: Qty;
  arrivesAt: RoundIndex;
};

export type ShopState = {
  cash: Cents;
  inventory: Record<Sku, Qty>;
  reputation: Reputation;
  roundIndex: RoundIndex;
  pendingReceipts: readonly PendingReceipt[];
};

export type SkuTruth = {
  baseDemand: Qty;
  refPrice: Cents;
};

export type SupplierTruth = {
  unitCost: Record<Sku, Cents>;
  leadTime: number;
  capacityByRound: readonly Qty[];
};

export type ScenarioTruth = {
  rounds: number;
  elasticity: number;
  noiseSigma: number;
  seasonBps: readonly number[];
  competitorPrice: Record<Sku, readonly Cents[]>;
  skus: Record<Sku, SkuTruth>;
  suppliers: Record<SupplierId, SupplierTruth>;
  stockoutPenalty: number;
  holdingCost: Cents;
  adHalfSat: Cents;
};

export type Observation = {
  cash: Cents;
  inventory: Record<Sku, Qty>;
  reputation: Reputation;
  round: RoundIndex;
  competitorPrices: Record<Sku, Cents>;
  news: string;
};

export type PublicModel = {
  nominalElasticity: number;
  nominalBaseDemand: Record<Sku, Qty>;
  lastCompetitorPrice: Record<Sku, Cents>;
};

export type PublicTerms = {
  listPrice: Record<SupplierId, Record<Sku, Cents>>;
};

export type SkuOrder = {
  price: Cents;
  qty: Qty;
  supplier: SupplierId;
};

export type Decision = {
  adSpend: Cents;
  orders: Record<Sku, SkuOrder>;
};

export type PolicyInput = {
  state: ShopState;
  observation: Observation;
  model: PublicModel;
  terms: PublicTerms;
};

export type Policy = (input: PolicyInput) => Decision;

export type SkuOutcome = {
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

export type Outcome = {
  round: RoundIndex;
  revenue: Cents;
  orderCost: Cents;
  holding: Cents;
  adSpend: Cents;
  profit: Cents;
  sales: Qty;
  missed: Qty;
  cash: Cents;
  reputation: Reputation;
  inventory: Record<Sku, Qty>;
  skus: Record<Sku, SkuOutcome>;
};

export type Settlement = {
  state: ShopState;
  outcome: Outcome;
};
