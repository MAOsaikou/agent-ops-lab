import { z } from "zod";

import { jsonValue } from "../engine/json.js";

export const SUPPLIERS = ["primary", "backup"] as const;
export const SKUS = ["tea", "snack"] as const;

export type SupplierId = (typeof SUPPLIERS)[number];
export type SkuId = (typeof SKUS)[number];

export type SkuOutcomeRow = {
  readonly price: number;
  readonly demand: number;
  readonly sales: number;
  readonly missed: number;
  readonly ordered: number;
  readonly received: number;
  readonly onHand: number;
  readonly inventory: number;
  readonly revenue: number;
  readonly orderCost: number;
  readonly holding: number;
  readonly supplier: string;
};

export type OutcomeRow = {
  readonly round: number;
  readonly cash: number;
  readonly revenue: number;
  readonly orderCost: number;
  readonly holding: number;
  readonly adSpend: number;
  readonly missed: number;
  readonly profit: number;
  readonly sales: number;
  readonly reputation: number;
  readonly inventory: { readonly tea: number; readonly snack: number };
  readonly skus: { readonly tea: SkuOutcomeRow; readonly snack: SkuOutcomeRow };
};

export type NodeEventName = "scheduled" | "started" | "finished" | "dead-letter";

type FrameCommon = {
  readonly seq: number;
  readonly runId: string;
};

export type NodeFrame = FrameCommon & {
  readonly kind: "node";
  readonly event: NodeEventName;
  readonly nodeId: string;
  readonly reason: string;
  readonly agent?: string;
  readonly version?: string;
  readonly promptHash?: string;
  readonly score?: number;
};

export type QuoteFrame = FrameCommon & {
  readonly kind: "quote";
  readonly round: number;
  readonly supplier: SupplierId;
  readonly sku: SkuId;
  readonly quoteRound: number;
  readonly ruling: "accept" | "counter" | "walk";
  readonly offerUnitCost: number;
  readonly unitCost: number;
  readonly qty: number;
  readonly capacity: number;
  readonly leadTime: number;
  readonly talk: string;
  readonly talkAccepted: boolean;
};

export type BudgetFrame = FrameCommon & {
  readonly kind: "budget";
  readonly round: number;
  readonly amounts: { readonly ads: number; readonly priceCut: number };
  readonly allocation: { readonly ads: number; readonly priceCut: number };
  readonly cash: number;
};

export type LoopFrame = FrameCommon & {
  readonly kind: "loop";
  readonly round: number;
  readonly iteration: number;
  readonly verdict: "pass" | "revise" | "reject";
  readonly p50: number;
  readonly stopReason: string | null;
  readonly callsUsed: number;
  readonly confidence: number | null;
  readonly decisionHash: string;
};

export type CommitFrame = FrameCommon & {
  readonly kind: "commit";
  readonly round: number;
  readonly decisionHash: string;
  readonly observationHash: string;
  readonly source: string;
  readonly adSpend: number;
  readonly orders: {
    readonly tea: { readonly price: number; readonly qty: number; readonly supplier: string };
    readonly snack: { readonly price: number; readonly qty: number; readonly supplier: string };
  };
};

export type SettleFrame = FrameCommon & {
  readonly kind: "settle";
  readonly round: number;
  readonly decisionHash: string;
  readonly outcome: OutcomeRow;
};

export type ReflectFrame = FrameCommon & {
  readonly kind: "reflect";
  readonly round: number;
  readonly beliefHash: string;
  readonly overlayHash: string;
};

export type UiFrame =
  | NodeFrame
  | QuoteFrame
  | BudgetFrame
  | LoopFrame
  | CommitFrame
  | SettleFrame
  | ReflectFrame;

// The SSE writer stamps each frame with its own write time so the perf lane can
// subtract it from the browser render time; frames from the store lack it.
export type WireFrame = UiFrame & { readonly emittedAt?: number };

export type FrameKind = UiFrame["kind"];

const skuOutcomeSchema = z.strictObject({
  price: z.number().int(),
  demand: z.number().int(),
  sales: z.number().int(),
  missed: z.number().int(),
  ordered: z.number().int(),
  received: z.number().int(),
  onHand: z.number().int(),
  inventory: z.number().int(),
  revenue: z.number().int(),
  orderCost: z.number().int(),
  holding: z.number().int(),
  supplier: z.string(),
});

const outcomeSchema = z.strictObject({
  round: z.number().int(),
  cash: z.number().int(),
  revenue: z.number().int(),
  orderCost: z.number().int(),
  holding: z.number().int(),
  adSpend: z.number().int(),
  missed: z.number().int(),
  profit: z.number().int(),
  sales: z.number().int(),
  reputation: z.number().int(),
  inventory: z.strictObject({ tea: z.number().int(), snack: z.number().int() }),
  skus: z.strictObject({ tea: skuOutcomeSchema, snack: skuOutcomeSchema }),
});

const orderLineSchema = z.strictObject({
  price: z.number().int(),
  qty: z.number().int(),
  supplier: z.string(),
});

const decisionBodySchema = z.strictObject({
  decision: z.strictObject({
    adSpend: z.number().int(),
    orders: z.strictObject({ tea: orderLineSchema, snack: orderLineSchema }),
  }),
  source: z.string(),
});

const committedPayloadSchema = z.strictObject({
  bodyJson: z.string(),
  decisionHash: z.string(),
  observationHash: z.string(),
  round: z.number().int().nonnegative(),
});

const settledPayloadSchema = z.strictObject({
  decisionHash: z.string(),
  outcomeJson: z.string(),
  round: z.number().int().nonnegative(),
});

const reflectedPayloadSchema = z.strictObject({
  beliefHash: z.string(),
  overlayHash: z.string(),
  round: z.number().int().nonnegative(),
});

const nodePayloadSchema = z.object({
  nodeId: z.string(),
  reason: z.string(),
  agent: z.string().optional(),
  version: z.string().optional(),
  promptHash: z.string().optional(),
  score: z.number().optional(),
});

const quotePayloadSchema = z.strictObject({
  capacity: z.number().int(),
  kind: z.enum(["accept", "counter", "walk"]),
  leadTime: z.number().int(),
  offerUnitCost: z.number().int(),
  qty: z.number().int(),
  quote: z.number().int(),
  round: z.number().int().nonnegative(),
  sku: z.enum(SKUS),
  supplier: z.enum(SUPPLIERS),
  talk: z.string(),
  talkAccepted: z.boolean(),
  unitCost: z.number().int(),
});

const budgetPayloadSchema = z.strictObject({
  allocation: z.strictObject({ ads: z.number(), priceCut: z.number() }),
  amounts: z.strictObject({ ads: z.number(), priceCut: z.number() }),
  cash: z.number().int(),
  round: z.number().int().nonnegative(),
});

const loopPayloadSchema = z.strictObject({
  callsUsed: z.number().int().nonnegative(),
  confidence: z.number().nullable(),
  decisionHash: z.string(),
  decisionJson: z.string(),
  iteration: z.number().int().positive(),
  nextJson: z.string().nullable(),
  p50: z.number(),
  round: z.number().int().nonnegative(),
  stopReason: z.string().nullable(),
  verdict: z.enum(["pass", "revise", "reject"]),
});

export type AuditEvent = { readonly type: string; readonly payloadJson: string };

export type LedgerEvent = { readonly type: string; readonly payloadJson: string };

export const DECISION_COMMITTED = "DecisionCommitted";
export const ROUND_SETTLED = "RoundSettled";
export const ROUND_REFLECTED = "RoundReflected";
export const SUPPLIER_QUOTE = "SupplierQuote";
export const BUDGET_ARBITRATION = "BudgetArbitration";
export const LOOP_ITERATED = "LoopIterated";

const NODE_EVENT_NAMES: Record<string, NodeEventName> = {
  NodeScheduled: "scheduled",
  NodeStarted: "started",
  NodeFinished: "finished",
  NodeDeadLetter: "dead-letter",
};

export function nodeEventName(type: string): NodeEventName | null {
  return Object.hasOwn(NODE_EVENT_NAMES, type) ? (NODE_EVENT_NAMES[type] ?? null) : null;
}

function payloadOf(payloadJson: string): unknown {
  return jsonValue(payloadJson);
}

export function isNodeEvent(type: string): boolean {
  return nodeEventName(type) !== null;
}

export function toFrame(runId: string, seq: number, event: AuditEvent): UiFrame | null {
  const name = nodeEventName(event.type);
  if (name !== null) {
    const parsed = nodePayloadSchema.parse(payloadOf(event.payloadJson));
    const frame: NodeFrame = {
      seq,
      runId,
      kind: "node",
      event: name,
      nodeId: parsed.nodeId,
      reason: parsed.reason,
      ...(parsed.agent === undefined ? {} : { agent: parsed.agent }),
      ...(parsed.version === undefined ? {} : { version: parsed.version }),
      ...(parsed.promptHash === undefined ? {} : { promptHash: parsed.promptHash }),
      ...(parsed.score === undefined ? {} : { score: parsed.score }),
    };
    return frame;
  }
  if (event.type === SUPPLIER_QUOTE) {
    const parsed = quotePayloadSchema.parse(payloadOf(event.payloadJson));
    const frame: QuoteFrame = {
      seq,
      runId,
      kind: "quote",
      round: parsed.round,
      supplier: parsed.supplier,
      sku: parsed.sku,
      quoteRound: parsed.quote,
      ruling: parsed.kind,
      offerUnitCost: parsed.offerUnitCost,
      unitCost: parsed.unitCost,
      qty: parsed.qty,
      capacity: parsed.capacity,
      leadTime: parsed.leadTime,
      talk: parsed.talk,
      talkAccepted: parsed.talkAccepted,
    };
    return frame;
  }
  if (event.type === BUDGET_ARBITRATION) {
    const parsed = budgetPayloadSchema.parse(payloadOf(event.payloadJson));
    const frame: BudgetFrame = {
      seq,
      runId,
      kind: "budget",
      round: parsed.round,
      amounts: { ads: parsed.amounts.ads, priceCut: parsed.amounts.priceCut },
      allocation: { ads: parsed.allocation.ads, priceCut: parsed.allocation.priceCut },
      cash: parsed.cash,
    };
    return frame;
  }
  if (event.type === LOOP_ITERATED) {
    const parsed = loopPayloadSchema.parse(payloadOf(event.payloadJson));
    const frame: LoopFrame = {
      seq,
      runId,
      kind: "loop",
      round: parsed.round,
      iteration: parsed.iteration,
      verdict: parsed.verdict,
      p50: parsed.p50,
      stopReason: parsed.stopReason,
      callsUsed: parsed.callsUsed,
      confidence: parsed.confidence,
      decisionHash: parsed.decisionHash,
    };
    return frame;
  }
  return null;
}

export function ledgerFrame(
  runId: string,
  seq: number,
  event: LedgerEvent,
): UiFrame {
  if (event.type === DECISION_COMMITTED) {
    const parsed = committedPayloadSchema.parse(payloadOf(event.payloadJson));
    const body = decisionBodySchema.parse(payloadOf(parsed.bodyJson));
    const frame: CommitFrame = {
      seq,
      runId,
      kind: "commit",
      round: parsed.round,
      decisionHash: parsed.decisionHash,
      observationHash: parsed.observationHash,
      source: body.source,
      adSpend: body.decision.adSpend,
      orders: {
        tea: body.decision.orders.tea,
        snack: body.decision.orders.snack,
      },
    };
    return frame;
  }
  if (event.type === ROUND_SETTLED) {
    const parsed = settledPayloadSchema.parse(payloadOf(event.payloadJson));
    const outcome = outcomeSchema.parse(payloadOf(parsed.outcomeJson));
    const frame: SettleFrame = {
      seq,
      runId,
      kind: "settle",
      round: parsed.round,
      decisionHash: parsed.decisionHash,
      outcome,
    };
    return frame;
  }
  if (event.type === ROUND_REFLECTED) {
    const parsed = reflectedPayloadSchema.parse(payloadOf(event.payloadJson));
    const frame: ReflectFrame = {
      seq,
      runId,
      kind: "reflect",
      round: parsed.round,
      beliefHash: parsed.beliefHash,
      overlayHash: parsed.overlayHash,
    };
    return frame;
  }
  throw new Error(`not a ledger event: ${event.type}`);
}

export function ledgerRoundOf(event: LedgerEvent): number {
  const parsed =
    event.type === DECISION_COMMITTED
      ? committedPayloadSchema.safeParse(payloadOf(event.payloadJson))
      : event.type === ROUND_SETTLED
        ? settledPayloadSchema.safeParse(payloadOf(event.payloadJson))
        : event.type === ROUND_REFLECTED
          ? reflectedPayloadSchema.safeParse(payloadOf(event.payloadJson))
          : null;
  if (parsed === null || !parsed.success) {
    throw new Error(`ledger event ${event.type} has no round`);
  }
  return parsed.data.round;
}
