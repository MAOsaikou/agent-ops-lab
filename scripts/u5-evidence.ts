import { mkdirSync, writeFileSync } from "node:fs";

import { z } from "zod";

import { jsonValue } from "../src/engine/json.js";
import { allocateBudget } from "../src/engine/scheduler/select.js";
import { cents, qty, reputation, roundIndex } from "../src/templates/simshop/market/brand.js";
import { loadScenario } from "../src/templates/simshop/market/scenario.js";
import type { ShopState, Sku, SupplierId } from "../src/templates/simshop/market/types.js";
import { marginalBids } from "../src/templates/simshop/sandbox.js";
import { acceptOrCounter } from "../src/templates/simshop/supplier.js";
import { runShop, type PriceWarSnap, type ShopSimulation } from "../src/templates/simshop/workflows/round.js";

const EVIDENCE = "/opt/cursor/artifacts/evidence/U5";
const ARTIFACTS = "/opt/cursor/artifacts";

const quoteSchema = z.strictObject({
  capacity: z.number().int(),
  kind: z.enum(["accept", "counter", "walk"]),
  leadTime: z.number().int(),
  offerUnitCost: z.number().int(),
  qty: z.number().int(),
  quote: z.number().int(),
  round: z.number().int(),
  sku: z.enum(["tea", "snack"]),
  supplier: z.enum(["primary", "backup"]),
  talk: z.string(),
  talkAccepted: z.boolean(),
  unitCost: z.number().int(),
});

const finite = z.number().finite();
const budgetSchema = z.strictObject({
  allocation: z.strictObject({ ads: finite, priceCut: finite }),
  amounts: z.strictObject({ ads: finite, priceCut: finite }),
  cash: z.number().int(),
  round: z.number().int(),
});

const nodeSchema = z.strictObject({
  nodeId: z.string(),
  reason: z.string(),
});

type Quote = z.infer<typeof quoteSchema>;

function write(path: string, lines: readonly string[]): void {
  writeFileSync(path, `${lines.join("\n")}\n`);
}

function parseQuote(payloadJson: string): Quote {
  return quoteSchema.parse(jsonValue(payloadJson));
}

function quotesOf(run: ShopSimulation): Quote[] {
  return run.events.filter((event) => event.type === "SupplierQuote").map((event) => parseQuote(event.payloadJson));
}

function demandQty(sku: Sku): number {
  return loadScenario("supplycut").nominalBaseDemand[sku];
}

function ruleFor(quote: Quote) {
  const loaded = loadScenario("supplycut");
  const hidden = loaded.truth.suppliers[quote.supplier];
  const offerQty = quote.capacity <= 0 ? 0 : Math.min(quote.capacity, Math.max(1, demandQty(quote.sku)));
  return acceptOrCounter({
    floor: hidden.unitCost[quote.sku],
    capacity: quote.capacity,
    leadTime: hidden.leadTime,
    offer: {
      unitCost: quote.offerUnitCost,
      qty: offerQty,
      leadTime: hidden.leadTime,
    },
    round: quote.quote,
  });
}

function floorDigits(): string[] {
  const loaded = loadScenario("supplycut");
  const suppliers: readonly SupplierId[] = ["primary", "backup"];
  const skus: readonly Sku[] = ["tea", "snack"];
  const digits: string[] = [];
  for (const supplier of suppliers) {
    for (const sku of skus) {
      digits.push(String(loaded.truth.suppliers[supplier].unitCost[sku]));
    }
  }
  return digits;
}

function shopState(snap: PriceWarSnap): ShopState {
  return {
    cash: cents(snap.cash),
    inventory: { tea: qty(snap.inventory.tea), snack: qty(snap.inventory.snack) },
    reputation: reputation(snap.reputation),
    roundIndex: roundIndex(snap.roundIndex),
    pendingReceipts: snap.pending.map((receipt) => ({
      sku: receipt.sku,
      qty: qty(receipt.qty),
      arrivesAt: roundIndex(receipt.arrivesAt),
    })),
  };
}

function sameAmounts(
  left: { readonly ads: number; readonly priceCut: number },
  right: { readonly ads: number; readonly priceCut: number },
): boolean {
  return left.ads === right.ads && left.priceCut === right.priceCut;
}

const supplyA = await runShop({
  scenario: "supplycut",
  seed: 7,
  profile: "steady",
  callCap: null,
  p50Threshold: 1,
});
const supplyB = await runShop({
  scenario: "supplycut",
  seed: 7,
  profile: "steady",
  callCap: null,
  p50Threshold: 1,
});
if (supplyA.mode !== "mock" || supplyB.mode !== "mock") {
  throw new Error("supply replay left mock mode");
}
if (supplyA.hash !== supplyB.hash || supplyA.ledgerHash !== supplyB.ledgerHash) {
  throw new Error("supply-cut seed 7 diverged");
}
if (supplyA.minInventory < 0) {
  throw new Error("supply-cut inventory went negative");
}

const quotes = quotesOf(supplyA);
if (quotes.length === 0) throw new Error("supply-cut produced no supplier quotes");
const maxQuote = quotes.reduce((max, quote) => Math.max(max, quote.quote), 0);
if (maxQuote > 3) throw new Error(`quote round ${String(maxQuote)} exceeds 3`);
const digits = floorDigits();
const quoteLines = quotes.map((quote) => {
  const ruled = ruleFor(quote);
  if (
    ruled.kind !== quote.kind ||
    ruled.unitCost !== quote.unitCost ||
    ruled.qty !== quote.qty ||
    ruled.leadTime !== quote.leadTime
  ) {
    throw new Error(`quote price left the rule for ${quote.supplier} ${quote.sku} round ${String(quote.quote)}`);
  }
  for (const floor of digits) {
    if (quote.talk.includes(floor)) {
      throw new Error(`talk contains floor digits ${floor}`);
    }
  }
  const settled = loadScenario("supplycut").truth.suppliers[quote.supplier].unitCost[quote.sku];
  const settledMatches = quote.kind !== "accept" || quote.unitCost === settled;
  if (!settledMatches) {
    throw new Error(`accepted unit cost ${String(quote.unitCost)} is not the settled cost ${String(settled)}`);
  }
  return [
    `round ${String(quote.round)}`,
    quote.supplier,
    quote.sku,
    `quote ${String(quote.quote)}`,
    quote.kind,
    `offer ${String(quote.offerUnitCost)}`,
    `rule ${String(ruled.unitCost)}`,
    `event ${String(quote.unitCost)}`,
    `settled-cost ${String(settled)}`,
    `qty ${String(quote.qty)}`,
    `talk-accepted ${String(quote.talkAccepted)}`,
    `talk ${JSON.stringify(quote.talk)}`,
  ].join(" ");
});

const pricewar = await runShop({
  scenario: "pricewar",
  seed: 7,
  profile: "steady",
  callCap: null,
  p50Threshold: 1,
});
const budgetEvents = pricewar.events.filter((event) => event.type === "BudgetArbitration");
if (budgetEvents.length === 0 || pricewar.priceWars.length === 0) {
  throw new Error("price war produced no BudgetArbitration event");
}
const budgetLines: string[] = [];
for (const event of budgetEvents) {
  const body = budgetSchema.parse(jsonValue(event.payloadJson));
  const snap = pricewar.priceWars.find((item) => item.round === body.round);
  if (snap === undefined) throw new Error(`missing price-war snap for round ${String(body.round)}`);
  const recomputed = marginalBids({
    state: shopState(snap),
    view: snap.view,
    prices: snap.prices,
    supplier: snap.supplier,
  });
  const shares = allocateBudget({
    budget: snap.cash,
    bids: [
      { id: "ads", value: recomputed.ads },
      { id: "priceCut", value: recomputed.priceCut },
    ],
  });
  const allocation = {
    ads: shares.find((share) => share.id === "ads")?.amount ?? 0,
    priceCut: shares.find((share) => share.id === "priceCut")?.amount ?? 0,
  };
  if (!sameAmounts(body.amounts, recomputed) || !sameAmounts(body.amounts, snap.amounts)) {
    throw new Error("BudgetArbitration amounts do not match the sandbox");
  }
  if (!sameAmounts(body.allocation, allocation)) {
    throw new Error("BudgetArbitration allocation does not match allocateBudget");
  }
  budgetLines.push(
    `round ${String(body.round)} event ${event.payloadJson}`,
    `sandbox ads ${String(recomputed.ads)} priceCut ${String(recomputed.priceCut)}`,
    `allocation ads ${String(allocation.ads)} priceCut ${String(allocation.priceCut)} cash ${String(snap.cash)}`,
  );
}

const loopcap = await runShop({
  scenario: "supplycut",
  seed: 7,
  profile: "stressed",
  callCap: null,
  p50Threshold: Number.NEGATIVE_INFINITY,
});
if (loopcap.rounds.length === 0) throw new Error("loop cap run produced no rounds");
for (const round of loopcap.rounds) {
  if (round.stopReason !== "maxIterations" || !round.usedFallback) {
    throw new Error(`round ${String(round.round)} did not stop at the iteration cap and fall back`);
  }
}

const supplyNodes = supplyA.events.filter((event) => {
  if (event.type === "SupplierQuote") return true;
  if (event.type !== "NodeScheduled" && event.type !== "NodeStarted" && event.type !== "NodeFinished") {
    return false;
  }
  const node = nodeSchema.safeParse(jsonValue(event.payloadJson));
  return node.success && (node.data.nodeId === "quotes" || node.data.nodeId === "quote");
});

mkdirSync(EVIDENCE, { recursive: true });
mkdirSync(ARTIFACTS, { recursive: true });

write(`${EVIDENCE}/u5-replay.txt`, [
  "llm mode: mock",
  "scenario supplycut seed 7 profile steady",
  "This is not a live model. Both runs use the shop mock.",
  `run 1 final hash ${supplyA.hash}`,
  `run 2 final hash ${supplyB.hash}`,
  `run 1 ledger hash ${supplyA.ledgerHash}`,
  `run 2 ledger hash ${supplyB.ledgerHash}`,
  `same final hash ${String(supplyA.hash === supplyB.hash)}`,
]);

write(`${EVIDENCE}/u5-supply.txt`, [
  "llm mode: mock",
  "scenario supplycut seed 7 profile steady",
  `final hash ${supplyA.hash}`,
  `min inventory ${String(supplyA.minInventory)}`,
  `quote events ${String(quotes.length)}`,
  `max quote round ${String(maxQuote)}`,
  "deal price is acceptOrCounter, recomputed from the hidden floor, capacity, and lead time",
  ...quoteLines,
  "negotiation subflow events",
  ...supplyNodes.map((event) => `${event.type} ${event.payloadJson}`),
]);

write(`${EVIDENCE}/u5-pricewar.txt`, [
  "llm mode: mock",
  "scenario pricewar seed 7 profile steady",
  `final hash ${pricewar.hash}`,
  ...budgetLines,
]);

write(`${EVIDENCE}/u5-loopcap.txt`, [
  "llm mode: mock",
  "scenario supplycut seed 7 profile stressed",
  "p50 threshold -Infinity, so a sandbox improvement cannot be below the threshold",
  `rounds ${String(loopcap.rounds.length)}`,
  `mock calls ${String(loopcap.calls)}`,
  `min inventory ${String(loopcap.minInventory)}`,
  `final hash ${loopcap.hash}`,
  "finished yes",
  ...loopcap.rounds.map(
    (round) =>
      `round ${String(round.round)} stop ${String(round.stopReason)} fallback ${String(round.usedFallback)} calls ${String(round.calls)}`,
  ),
]);

write(`${EVIDENCE}/u5-supplier-rule.txt`, [
  "llm mode: mock",
  "scenario supplycut seed 7 profile steady",
  `floor digits checked ${digits.join(" ")}`,
  "none of those digit strings appear in a talk line",
  ...quoteLines,
]);

write(`${ARTIFACTS}/u5-review-supply.txt`, [
  "llm mode: mock",
  "Supply-cut seed 7, mock mode. Excerpt of the negotiation subflow.",
  `max quote round ${String(maxQuote)}. min inventory ${String(supplyA.minInventory)}.`,
  ...supplyNodes.map((event) => `${event.type} ${event.payloadJson}`),
]);

write(`${ARTIFACTS}/u5-review-pricewar.txt`, [
  "llm mode: mock",
  "Price-war seed 7, mock mode. BudgetArbitration amounts are the sandbox marginals.",
  ...budgetLines,
]);

process.stdout.write(
  [
    "llm mode: mock",
    `hash ${supplyA.hash}`,
    `hash ${supplyB.hash}`,
    `quotes ${String(quotes.length)} max ${String(maxQuote)}`,
    `pricewars ${String(budgetEvents.length)}`,
    `loop rounds ${String(loopcap.rounds.length)}`,
    "",
  ].join("\n"),
);
