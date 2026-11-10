import type { PlatformId, ServiceTag } from "./platform.js";

export type ProductInput = {
  readonly platform: PlatformId;
  readonly name: string;
  readonly category: string;
  readonly keywords: string;
  readonly buyCents: number;
  readonly packagingCents: number;
  readonly shippingCents: number;
  readonly commissionRate: number;
  readonly payFeeRate: number;
  readonly returnRate: number;
  readonly returnSalvage: number;
  readonly adDailyBudgetCents: number;
  readonly adCpcCents: number;
  readonly adCvr: number;
  readonly competitorCents: number;
  readonly marketOrders: number;
  readonly elasticity: number;
  readonly targetMargin: number;
  readonly cashCents: number;
  readonly settleDays: number;
  readonly services: readonly ServiceTag[];
  readonly promoEnabled: boolean;
  readonly promoDiscount: number;
  readonly seed: number;
};

export type UnitCost = {
  readonly buyCents: number;
  readonly packagingCents: number;
  readonly shippingCents: number;
  readonly commissionCents: number;
  readonly payFeeCents: number;
  readonly returnLossCents: number;
  readonly totalCents: number;
};

export type DailyView = {
  readonly orders: number;
  readonly demand: number;
  readonly capacity: number;
  readonly stockoutOrders: number;
  readonly adSpendCents: number;
  readonly adPerOrderCents: number;
  readonly netPerOrderCents: number;
  readonly margin: number;
  readonly revenueCents: number;
  readonly profitCents: number;
};

export type PriceEvaluation = {
  readonly priceCents: number;
  readonly breakEvenCents: number;
  readonly unit: UnitCost;
  readonly daily: DailyView;
};

export type SimDay = {
  readonly day: number;
  readonly orders: number;
  readonly profitCents: number;
  readonly cumProfitCents: number;
  readonly cashCents: number;
  readonly stockout: boolean;
};

export type SimResult = {
  readonly days: readonly SimDay[];
  readonly totalOrders: number;
  readonly totalRevenueCents: number;
  readonly totalProfitCents: number;
  readonly avgDailyProfitCents: number;
  readonly minCashCents: number;
  readonly endCashCents: number;
  readonly receivableCents: number;
  readonly stockoutDays: number;
  readonly p10Cents: number;
  readonly p50Cents: number;
  readonly p90Cents: number;
};

export type CheckStatus = "pass" | "warn" | "fail";

export type CheckRow = {
  readonly id: string;
  readonly label: string;
  readonly status: CheckStatus;
  readonly detail: string;
};

export const CANDIDATE_IDS = ["profit", "match", "volume"] as const;
export type CandidateId = (typeof CANDIDATE_IDS)[number];

export type Bullet = {
  readonly text: string;
  readonly basis: string;
  readonly needsReview: boolean;
};

export type Candidate = {
  readonly id: CandidateId;
  readonly label: string;
  readonly tagline: string;
  readonly priceCents: number;
  readonly promoPriceCents: number;
  readonly evaluation: PriceEvaluation;
  readonly sim: SimResult;
  readonly checks: readonly CheckRow[];
  readonly bullets: readonly Bullet[];
  readonly verdict: string;
  readonly risks: readonly string[];
};

export type TitleVariant = {
  readonly label: string;
  readonly text: string;
  readonly length: number;
};

export type PlanCopy = {
  readonly titles: readonly TitleVariant[];
  readonly keywords: readonly string[];
  readonly searchTerms: readonly string[];
  readonly notes: readonly string[];
};

export const AGENT_KEYS = [
  "accountant",
  "pricer",
  "risk",
  "copywriter",
  "owner",
  "ledger",
] as const;

export type AgentKey = (typeof AGENT_KEYS)[number];

export type TraceStep = {
  readonly index: number;
  readonly agent: AgentKey;
  readonly title: string;
  readonly detail: string;
  readonly hash: string;
};

export type RevisionRow = {
  readonly attempt: number;
  readonly reason: string;
  readonly change: string;
  readonly beforeCents: number;
  readonly afterCents: number;
  readonly profitDeltaCents: number;
};

export type PlanLock = {
  readonly candidateId: CandidateId;
  readonly at: string;
  readonly hash: string;
};

export type PlanResult = {
  readonly id: string;
  readonly createdAt: string;
  readonly input: ProductInput;
  readonly candidates: readonly Candidate[];
  readonly recommendedId: CandidateId;
  readonly copy: PlanCopy;
  readonly checks: readonly CheckRow[];
  readonly trace: readonly TraceStep[];
  readonly revisions: readonly RevisionRow[];
  readonly notes: readonly string[];
  readonly hash: string;
  readonly locked: PlanLock | null;
};

export type PlanSummary = {
  readonly id: string;
  readonly createdAt: string;
  readonly name: string;
  readonly platform: PlatformId;
  readonly priceCents: number;
  readonly recommendedId: CandidateId;
  readonly monthProfitCents: number;
  readonly margin: number;
  readonly locked: boolean;
};