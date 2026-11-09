import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

import type { AgentSpec } from "../../../engine/agents/registry.js";
import { openEventStore, type EventStore } from "../../../engine/events/store.js";
import { foldEvents } from "../../../engine/events/fold.js";
import { sha256Bytes, sha256Hex } from "../../../engine/hash.js";
import {
  parseNodeId,
  parsePredicateId,
  parseRunId,
  parseTaskTemplateId,
  parseToolName,
  parseWorkflowId,
  type RunId,
} from "../../../engine/ids.js";
import { canonicalJson, jsonValue } from "../../../engine/json.js";
import type { PromptHash } from "../../../engine/ids.js";
import { commitDecision, reflectRound, settleRound } from "../../../engine/round/commit.js";
import { allocateBudget, recordSelection, select, type AgentCandidate } from "../../../engine/scheduler/select.js";
import { createToolRegistry } from "../../../engine/tools/registry.js";
import type { Hash } from "../../../engine/types.js";
import { revisionLoop, type StopReason } from "../../../engine/verify/loop.js";
import { verifyDecision } from "../../../engine/verify/pipeline.js";
import { runWorkflow, type AgentSource } from "../../../engine/workflow/executor.js";
import { parseWorkflowDocument } from "../../../engine/workflow/schema.js";
import {
  basePromptHash,
  createShopMock,
  createShopRegistry,
  lastCompletion,
  parseCriticText,
  parsePlanner,
  parseReflect,
  readPrompt,
  PRICER_ID,
  PRICER_PATCH,
  registerPricerPatch,
  type ShopMock,
  type ShopProfile,
} from "../agents.js";
import {
  parseShopDecision,
  SHOP_CHECKS,
  visibleCapacity,
  type CheckState,
  type ShopDecision,
} from "../constraints.js";
import { fallbackDecision } from "../fallback.js";
import { cents, qty, roundIndex, seed, type Cents, type Qty } from "../market/brand.js";
import { ledgerDigest } from "../market/ledger.js";
import { observationBytes, PRIMARY_CANNOT_DELIVER, project, publicModel } from "../market/project.js";
import { deriveRng, type Rng } from "../market/rng.js";
import { settle } from "../market/rules.js";
import { loadScenario, type LoadedScenario, type ScenarioName } from "../market/scenario.js";
import { readAt } from "../market/schedule.js";
import type { Observation, Outcome, PublicModel, PublicTerms, ShopState, Sku } from "../market/types.js";
import { createRoundMemory, roundNoteId, type RoundMemory } from "../memory.js";
import { forecastShop, marginalBids, publicSandboxView, type SandboxView } from "../sandbox.js";
import {
  freshSeats,
  quoteOpenSuppliers,
  supplySettled,
  supplyWorkflowBody,
  type SupplyDeal,
  type SupplySeat,
} from "./supply-negotiation.js";

const emptyInput = z.strictObject({});
const okOutput = z.strictObject({ ok: z.boolean() });
const forecastOutput = z.strictObject({ p50: z.number().int() });

const WORK_ROUND = parseWorkflowId("round");
const TOOL_PLAN = parseToolName("shop.plan");
const TOOL_ARBITRATE = parseToolName("shop.arbitrate");
const TOOL_HOLD = parseToolName("shop.hold");
const TOOL_SKIP = parseToolName("shop.skip-supply");
const TOOL_REVISE = parseToolName("shop.revise");
const TOOL_SEAL = parseToolName("shop.seal");
const TOOL_QUOTE = parseToolName("supply.quote");
const TOOL_FORECAST = parseToolName("shop.forecast");
const PRED_PRICE = parsePredicateId("shop.pricewar");
const PRED_SUPPLY = parsePredicateId("shop.supply");
const PRED_DONE = parsePredicateId("supply.done");

export function plannedRoundCalls(input: { readonly supplyCut: boolean; readonly stressed: boolean }): number {
  const talks = input.supplyCut ? 4 : 0;
  const verifyCalls = input.stressed ? 5 : 1;
  return 1 + 3 + talks + verifyCalls + 1;
}

export type PriceWarSnap = {
  readonly round: number;
  readonly amounts: { readonly ads: number; readonly priceCut: number };
  readonly allocation: { readonly ads: number; readonly priceCut: number };
  readonly view: SandboxView;
  readonly cash: number;
  readonly inventory: { readonly tea: number; readonly snack: number };
  readonly reputation: number;
  readonly pending: ShopState["pendingReceipts"];
  readonly roundIndex: number;
  readonly prices: { readonly tea: number; readonly snack: number };
  readonly supplier: "primary" | "backup";
};

export type RoundSummary = {
  readonly round: number;
  readonly calls: number;
  readonly stopReason: StopReason | null;
  readonly usedFallback: boolean;
  readonly supply: boolean;
};

export type ShopSimulation = {
  readonly mode: "mock";
  readonly hash: Hash;
  readonly ledgerHash: string;
  readonly calls: number;
  readonly callRoles: readonly string[];
  readonly rounds: readonly RoundSummary[];
  readonly events: readonly { readonly type: string; readonly payloadJson: string }[];
  readonly ledgerEvents: readonly { readonly type: string; readonly payloadJson: string }[];
  readonly priceWars: readonly PriceWarSnap[];
  readonly minInventory: number;
};

type Active = {
  audit: EventStore;
  ledger: EventStore;
  runId: RunId;
  round: number;
  observation: Observation;
  model: PublicModel;
  terms: PublicTerms;
  state: ShopState;
  loaded: LoadedScenario;
  previousPrices: { tea: number; snack: number };
  previousCompetitor: { tea: Cents; snack: Cents } | null;
  mock: ShopMock;
  memory: RoundMemory;
  specs: AgentSpec[];
  registry: ReturnType<typeof createShopRegistry>["registry"];
  profile: ShopProfile;
  p50Threshold: number;
  deals: SupplyDeal[];
  seats: Record<"primary" | "backup", SupplySeat>;
  activated: string[];
  decision: ShopDecision | null;
  usedFallback: boolean;
  stopReason: StopReason | null;
  priceWars: PriceWarSnap[];
  ledgerRows: Outcome[];
  rng: Rng;
};

function copyState(state: ShopState): ShopState {
  return {
    cash: state.cash,
    inventory: { tea: state.inventory.tea, snack: state.inventory.snack },
    reputation: state.reputation,
    roundIndex: state.roundIndex,
    pendingReceipts: state.pendingReceipts.map((receipt) => ({
      sku: receipt.sku,
      qty: receipt.qty,
      arrivesAt: receipt.arrivesAt,
    })),
  };
}

function newer(left: string, right: string): boolean {
  const a = left.split(".");
  const b = right.split(".");
  for (let index = 0; index < 3; index += 1) {
    const delta = Number(a[index] ?? "0") - Number(b[index] ?? "0");
    if (delta > 0) return true;
    if (delta < 0) return false;
  }
  return false;
}

function document() {
  return parseWorkflowDocument({
    workflows: [
      {
        id: WORK_ROUND,
        nodes: [
          { kind: "tool", id: parseNodeId("plan"), tool: TOOL_PLAN },
          {
            kind: "parallel",
            id: parseNodeId("proposals"),
            branches: [parseNodeId("buyer"), parseNodeId("pricer"), parseNodeId("marketer")],
            join: "all",
            dependsOn: [parseNodeId("plan")],
          },
          {
            kind: "agent",
            id: parseNodeId("buyer"),
            agent: parseNodeId("buyer"),
            task: parseTaskTemplateId("propose"),
          },
          {
            kind: "agent",
            id: parseNodeId("pricer"),
            agent: parseNodeId("pricer"),
            task: parseTaskTemplateId("propose"),
          },
          {
            kind: "agent",
            id: parseNodeId("marketer"),
            agent: parseNodeId("marketer"),
            task: parseTaskTemplateId("propose"),
          },
          {
            kind: "condition",
            id: parseNodeId("price-war"),
            predicate: PRED_PRICE,
            then: parseNodeId("arbitrate"),
            else: parseNodeId("hold-budget"),
            dependsOn: [parseNodeId("proposals")],
          },
          { kind: "tool", id: parseNodeId("arbitrate"), tool: TOOL_ARBITRATE },
          { kind: "tool", id: parseNodeId("hold-budget"), tool: TOOL_HOLD },
          {
            kind: "condition",
            id: parseNodeId("supply"),
            predicate: PRED_SUPPLY,
            then: parseNodeId("negotiate"),
            else: parseNodeId("skip-supply"),
            dependsOn: [parseNodeId("price-war")],
          },
          { kind: "subflow", id: parseNodeId("negotiate"), workflow: parseWorkflowId("supply-negotiation") },
          { kind: "tool", id: parseNodeId("skip-supply"), tool: TOOL_SKIP },
          {
            kind: "tool",
            id: parseNodeId("revise"),
            tool: TOOL_REVISE,
            dependsOn: [parseNodeId("supply")],
          },
          {
            kind: "agent",
            id: parseNodeId("reflect"),
            agent: parseNodeId("reflect"),
            task: parseTaskTemplateId("note"),
            dependsOn: [parseNodeId("revise")],
          },
          {
            kind: "tool",
            id: parseNodeId("seal"),
            tool: TOOL_SEAL,
            dependsOn: [parseNodeId("reflect")],
          },
        ],
      },
      supplyWorkflowBody(),
    ],
  });
}

function checkState(active: Active): CheckState {
  const round = active.state.roundIndex;
  const primaryClosed = active.observation.news.includes(PRIMARY_CANNOT_DELIVER);
  const backupClosed = active.observation.news.includes("backup cannot deliver");
  return {
    cash: active.state.cash,
    suppliers: {
      primary: {
        capacity: visibleCapacity({
          announced: readAt(active.loaded.truth.suppliers.primary.capacityByRound, round, "primary capacity"),
          closed: primaryClosed,
        }),
        unitCost: {
          tea: active.terms.listPrice.primary.tea,
          snack: active.terms.listPrice.primary.snack,
        },
      },
      backup: {
        capacity: visibleCapacity({
          announced: readAt(active.loaded.truth.suppliers.backup.capacityByRound, round, "backup capacity"),
          closed: backupClosed,
        }),
        unitCost: {
          tea: active.terms.listPrice.backup.tea,
          snack: active.terms.listPrice.backup.snack,
        },
      },
    },
  };
}

function supplyCut(observation: Observation): boolean {
  return observation.news.includes(PRIMARY_CANNOT_DELIVER) || observation.news.includes("backup cannot deliver");
}

function priceDropped(active: Active): boolean {
  if (active.previousCompetitor === null) return false;
  return (
    active.observation.competitorPrices.tea < active.previousCompetitor.tea ||
    active.observation.competitorPrices.snack < active.previousCompetitor.snack
  );
}

function promptHashOf(active: Active, spec: AgentSpec): PromptHash {
  if (spec.id === PRICER_ID && spec.version === PRICER_PATCH) {
    return active.registry.recordedPromptHash(spec.id, spec.version);
  }
  return basePromptHash(spec);
}

function agentSource(active: Active): AgentSource {
  return {
    resolve(id) {
      let best: AgentSpec | undefined;
      for (const spec of active.specs) {
        if (spec.id !== id) continue;
        if (best === undefined || newer(spec.version, best.version)) best = spec;
      }
      if (best === undefined) throw new Error(`agent is not registered: ${id}`);
      return best;
    },
    promptHashOf(spec) {
      return promptHashOf(active, spec);
    },
  };
}

function candidates(active: Active): AgentCandidate[] {
  return active.specs.map((spec) => ({
    spec,
    promptHash: promptHashOf(active, spec),
    remainingCalls: spec.budget.maxCallsPerRound,
    ready: true,
  }));
}

function openingPrices(terms: PublicTerms): { tea: number; snack: number } {
  return {
    tea: Math.max(terms.listPrice.primary.tea, terms.listPrice.backup.tea) + 100,
    snack: Math.max(terms.listPrice.primary.snack, terms.listPrice.backup.snack) + 100,
  };
}

function toMarket(decision: ShopDecision): {
  adSpend: Cents;
  orders: Record<Sku, { price: Cents; qty: Qty; supplier: "primary" | "backup" }>;
} {
  return {
    adSpend: cents(decision.adSpend),
    orders: {
      tea: {
        price: cents(decision.orders.tea.price),
        qty: qty(decision.orders.tea.qty),
        supplier: decision.orders.tea.supplier,
      },
      snack: {
        price: cents(decision.orders.snack.price),
        qty: qty(decision.orders.snack.qty),
        supplier: decision.orders.snack.supplier,
      },
    },
  };
}

function fallbackFor(active: Active): ShopDecision {
  const checks = checkState(active);
  return fallbackDecision({
    ...checks,
    inventory: { tea: active.state.inventory.tea, snack: active.state.inventory.snack },
    nominalBaseDemand: {
      tea: active.model.nominalBaseDemand.tea,
      snack: active.model.nominalBaseDemand.snack,
    },
    previousPrices: active.previousPrices,
  });
}

function applyDeals(decision: ShopDecision, deals: readonly SupplyDeal[]): ShopDecision {
  let tea = decision.orders.tea;
  let snack = decision.orders.snack;
  for (const deal of deals) {
    if (deal.qty <= 0) continue;
    if (deal.sku === "tea") tea = { price: tea.price, qty: deal.qty, supplier: deal.supplier };
    if (deal.sku === "snack") snack = { price: snack.price, qty: deal.qty, supplier: deal.supplier };
  }
  return { adSpend: decision.adSpend, orders: { tea, snack } };
}

function viewOf(active: Active): SandboxView {
  return publicSandboxView({
    observation: active.observation,
    model: active.model,
    terms: active.terms,
  });
}

async function planRound(active: Active): Promise<{ ok: boolean }> {
  const completion = await active.mock.complete({
    runId: active.runId,
    round: active.round,
    nodeId: "plan",
    attempt: 1,
    prompt: canonicalJson({ news: active.observation.news, role: "planner", round: active.round }),
    maxTokens: 80,
  });
  const pick = parsePlanner(completion.text);
  const selection = select({
    observation: {
      round: active.round,
      signals: supplyCut(active.observation) ? ["supply-cut"] : [],
    },
    agents: candidates(active),
    subflows: [{ id: "supply-negotiation", ready: true }],
    callBudget: 10,
    planner: () => pick,
    requiredSkill: null,
    minScore: 0,
  });
  recordSelection(active.audit, active.runId, active.round, selection);
  active.activated = [...selection.activatedSubflows];
  return { ok: true };
}

function arbitrate(active: Active): { ok: boolean } {
  const supplier = active.observation.news.includes(PRIMARY_CANNOT_DELIVER) ? "backup" : "primary";
  const view = viewOf(active);
  const bids = marginalBids({
    state: active.state,
    view,
    prices: active.previousPrices,
    supplier,
  });
  const shares = allocateBudget({
    budget: active.state.cash,
    bids: [
      { id: "ads", value: bids.ads },
      { id: "priceCut", value: bids.priceCut },
    ],
  });
  const adsShare = shares.find((share) => share.id === "ads")?.amount ?? 0;
  const cutShare = shares.find((share) => share.id === "priceCut")?.amount ?? 0;
  const snap: PriceWarSnap = {
    round: active.round,
    amounts: { ads: bids.ads, priceCut: bids.priceCut },
    allocation: { ads: adsShare, priceCut: cutShare },
    view,
    cash: active.state.cash,
    inventory: { tea: active.state.inventory.tea, snack: active.state.inventory.snack },
    reputation: active.state.reputation,
    pending: copyState(active.state).pendingReceipts,
    roundIndex: active.state.roundIndex,
    prices: { tea: active.previousPrices.tea, snack: active.previousPrices.snack },
    supplier,
  };
  active.priceWars.push(snap);
  active.audit.append({
    runId: active.runId,
    type: "BudgetArbitration",
    payloadJson: canonicalJson({
      allocation: snap.allocation,
      amounts: snap.amounts,
      cash: snap.cash,
      round: snap.round,
    }),
    causationId: null,
    idempotencyKey: `${active.runId}|${String(active.round)}|BudgetArbitration`,
  });
  return { ok: true };
}

async function reviseRound(active: Active): Promise<{ ok: boolean }> {
  const buyerText = lastCompletion(active.mock, "buyer", active.round);
  const parsed = buyerText === null ? null : parseShopDecision(jsonValue(buyerText));
  const initial = parsed !== null && parsed.ok ? applyDeals(parsed.decision, active.deals) : fallbackFor(active);
  const result = await revisionLoop({
    events: active.audit,
    runId: active.runId,
    round: active.round,
    maxIterations: 3,
    callBudget: 100,
    p50Threshold: active.p50Threshold,
    initial,
    async verify(raw) {
      const critique = await askCritic(active);
      const report = verifyDecision({
        raw,
        state: checkState(active),
        schema: parseShopDecision,
        checks: SHOP_CHECKS,
        forecast(decision, state) {
          const shop = copyState(active.state);
          return forecastShop({
            decision,
            state: { ...shop, cash: cents(state.cash) },
            view: viewOf(active),
          });
        },
        critic() {
          return critique;
        },
      });
      return {
        report,
        calls: 1,
        decisionHash: sha256Hex(canonicalJson(report.decision ?? raw)),
      };
    },
    async revise(_report, iteration) {
      const completion = await active.mock.complete({
        runId: active.runId,
        round: active.round,
        nodeId: "revision",
        attempt: 1,
        prompt: canonicalJson({ iteration: iteration + 1, role: "revision" }),
        maxTokens: 120,
      });
      return { raw: jsonValue(completion.text), calls: 1 };
    },
  });
  active.stopReason = result.stopReason;
  if (result.passed && result.decision !== null) {
    active.decision = result.decision;
    active.usedFallback = false;
  } else {
    active.decision = fallbackFor(active);
    active.usedFallback = true;
  }
  return { ok: true };
}

async function askCritic(active: Active) {
  const completion = await active.mock.complete({
    runId: active.runId,
    round: active.round,
    nodeId: "critic",
    attempt: 1,
    prompt: canonicalJson({ iteration: 1, role: "critic" }),
    maxTokens: 80,
  });
  const parsed = parseCriticText(completion.text);
  return { objections: parsed.objections, confidence: parsed.confidence };
}

function sealRound(active: Active, note: string, patch: string): { ok: boolean } {
  const decision = active.decision ?? fallbackFor(active);
  active.decision = decision;
  const text = note.includes(String(active.round)) ? note : `round ${String(active.round)} ${note}`;
  active.memory.write(active.runId, {
    id: roundNoteId(active.round, "reflect"),
    text,
    round: active.round,
  });
  registerPricerPatch({ registry: active.registry, specs: active.specs, patch });
  const decisionHash = sha256Hex(canonicalJson(decision));
  const observationHash = sha256Bytes(observationBytes(active.observation));
  commitDecision({
    store: active.ledger,
    runId: active.runId,
    round: active.round,
    decisionHash,
    payload: {
      observationHash,
      body: { decision, source: active.usedFallback ? "fallback" : "verified" },
    },
  });
  const settled = settleRound({
    store: active.ledger,
    runId: active.runId,
    round: active.round,
    decisionHash,
    produce: () => {
      const next = settle(copyState(active.state), toMarket(decision), active.loaded.truth, active.rng);
      active.state = next.state;
      active.ledgerRows.push(next.outcome);
      return next.outcome;
    },
  });
  reflectRound({
    store: active.ledger,
    runId: active.runId,
    round: active.round,
    write: () => ({
      beliefHash: sha256Hex(canonicalJson({ nominalElasticity: active.model.nominalElasticity })),
      overlayHash: sha256Hex(canonicalJson(active.memory.overlayIds(active.runId))),
    }),
  });
  if (settled.decisionHash !== decisionHash) {
    throw new Error("settled decision hash drifted");
  }
  active.previousPrices = {
    tea: decision.orders.tea.price,
    snack: decision.orders.snack.price,
  };
  active.previousCompetitor = {
    tea: cents(active.observation.competitorPrices.tea),
    snack: cents(active.observation.competitorPrices.snack),
  };
  return { ok: true };
}

function installTools(tools: ReturnType<typeof createToolRegistry>, box: { current: Active | null }): void {
  const requireActive = (): Active => {
    if (box.current === null) throw new Error("shop round is not active");
    return box.current;
  };
  tools.register(
    { name: TOOL_FORECAST, effect: "sandbox", input: emptyInput, output: forecastOutput, transport: { kind: "inproc" } },
    () => {
      const active = requireActive();
      const decision = active.decision ?? fallbackFor(active);
      return { p50: forecastShop({ decision, state: active.state, view: viewOf(active) }).profitCents.p50 };
    },
  );
  tools.register(
    { name: TOOL_PLAN, effect: "read", input: emptyInput, output: okOutput, transport: { kind: "inproc" } },
    () => planRound(requireActive()),
  );
  tools.register(
    { name: TOOL_ARBITRATE, effect: "sandbox", input: emptyInput, output: okOutput, transport: { kind: "inproc" } },
    () => arbitrate(requireActive()),
  );
  tools.register(
    { name: TOOL_HOLD, effect: "read", input: emptyInput, output: okOutput, transport: { kind: "inproc" } },
    () => ({ ok: true }),
  );
  tools.register(
    { name: TOOL_SKIP, effect: "read", input: emptyInput, output: okOutput, transport: { kind: "inproc" } },
    () => ({ ok: true }),
  );
  tools.register(
    { name: TOOL_QUOTE, effect: "read", input: emptyInput, output: okOutput, transport: { kind: "inproc" } },
    () => {
      const active = requireActive();
      return quoteOpenSuppliers({
        audit: active.audit,
        runId: active.runId,
        round: active.round,
        mock: active.mock,
        seats: active.seats,
        deals: active.deals,
        floor: {
          primary: {
            tea: active.loaded.truth.suppliers.primary.unitCost.tea,
            snack: active.loaded.truth.suppliers.primary.unitCost.snack,
          },
          backup: {
            tea: active.loaded.truth.suppliers.backup.unitCost.tea,
            snack: active.loaded.truth.suppliers.backup.unitCost.snack,
          },
        },
        capacity: {
          primary: checkState(active).suppliers.primary.capacity,
          backup: checkState(active).suppliers.backup.capacity,
        },
        leadTime: {
          primary: active.loaded.truth.suppliers.primary.leadTime,
          backup: active.loaded.truth.suppliers.backup.leadTime,
        },
        listPrice: {
          primary: {
            tea: active.terms.listPrice.primary.tea,
            snack: active.terms.listPrice.primary.snack,
          },
          backup: {
            tea: active.terms.listPrice.backup.tea,
            snack: active.terms.listPrice.backup.snack,
          },
        },
        demand: {
          tea: active.model.nominalBaseDemand.tea,
          snack: active.model.nominalBaseDemand.snack,
        },
      }).then(() => ({ ok: true }));
    },
  );
  tools.register(
    { name: TOOL_REVISE, effect: "read", input: emptyInput, output: okOutput, transport: { kind: "inproc" } },
    () => reviseRound(requireActive()),
  );
  tools.register(
    { name: TOOL_SEAL, effect: "read", input: emptyInput, output: okOutput, transport: { kind: "inproc" } },
    () => {
      const active = requireActive();
      const text = lastCompletion(active.mock, "reflect", active.round);
      const reflect = text === null ? { note: `round ${String(active.round)} reflected`, patch: "hold price" } : parseReflect(text);
      return sealRound(active, reflect.note, reflect.patch);
    },
  );
}

function bindRound(active: Active): void {
  active.mock.setContext({
    profile: active.profile,
    round: active.round,
    news: active.observation.news,
    cash: active.state.cash,
    unitCost: {
      primary: {
        tea: active.terms.listPrice.primary.tea,
        snack: active.terms.listPrice.primary.snack,
      },
      backup: {
        tea: active.terms.listPrice.backup.tea,
        snack: active.terms.listPrice.backup.snack,
      },
    },
    capacity: {
      primary: checkState(active).suppliers.primary.capacity,
      backup: checkState(active).suppliers.backup.capacity,
    },
    demand: {
      tea: active.model.nominalBaseDemand.tea,
      snack: active.model.nominalBaseDemand.snack,
    },
  });
}

async function playRound(active: Active, tools: ReturnType<typeof createToolRegistry>, callCap: number | null): Promise<RoundSummary> {
  const before = active.mock.calls.length;
  const supply = supplyCut(active.observation);
  const planned = plannedRoundCalls({ supplyCut: supply, stressed: active.profile === "stressed" });
  active.deals = [];
  active.seats = freshSeats();
  active.activated = [];
  active.decision = null;
  active.usedFallback = false;
  active.stopReason = null;
  if (callCap !== null && planned > callCap) {
    active.decision = fallbackFor(active);
    active.usedFallback = true;
    active.stopReason = "budget";
    sealRound(active, `round ${String(active.round)} used the fallback under the call cap`, "hold price");
    return { round: active.round, calls: 0, stopReason: "budget", usedFallback: true, supply };
  }
  bindRound(active);
  const workflow = await runWorkflow({
    document: document(),
    workflowId: WORK_ROUND,
    runId: active.runId,
    round: active.round,
    events: active.audit,
    agents: agentSource(active),
    tools,
    llm: active.mock,
    predicates: new Map([
      [PRED_PRICE, () => priceDropped(active)],
      [PRED_SUPPLY, () => active.activated.includes("supply-negotiation")],
      [PRED_DONE, () => supplySettled(active.seats)],
    ]),
    verifiers: new Map(),
    fallback: { kind: "workflow-fallback" },
    timeoutMs: 1000,
    maxAttempts: 1,
  });
  if (workflow.usedFallback && active.decision === null) {
    active.decision = fallbackFor(active);
    active.usedFallback = true;
    sealRound(active, `round ${String(active.round)} workflow fallback`, "hold price");
  }
  return {
    round: active.round,
    calls: active.mock.calls.length - before,
    stopReason: active.stopReason,
    usedFallback: active.usedFallback,
    supply,
  };
}

function minInventory(rows: readonly Outcome[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    min = Math.min(min, row.inventory.tea, row.inventory.snack);
  }
  return rows.length === 0 ? 0 : min;
}

export async function runShop(input: {
  readonly scenario: ScenarioName;
  readonly seed: number;
  readonly profile: ShopProfile;
  readonly callCap: number | null;
  readonly p50Threshold: number;
  readonly onlyRound?: number;
}): Promise<ShopSimulation> {
  const loaded = loadScenario(input.scenario);
  const runId = parseRunId(`${input.scenario}-${String(input.seed)}-${input.profile}`);
  const dir = mkdtempSync(path.join(tmpdir(), "u5-shop-"));
  const audit = openEventStore(path.join(dir, "audit.sqlite"));
  const ledger = openEventStore(path.join(dir, "ledger.sqlite"));
  const tools = createToolRegistry();
  const box: { current: Active | null } = { current: null };
  installTools(tools, box);
  const { registry, specs } = createShopRegistry(tools);
  const memory = createRoundMemory();
  memory.beginRun(runId);
  const mock = createShopMock();
  const active: Active = {
    audit,
    ledger,
    runId,
    round: 0,
    observation: project(loaded.initial, loaded.truth, loaded.initial.roundIndex),
    model: publicModel({
      nominalElasticity: loaded.nominalElasticity,
      nominalBaseDemand: loaded.nominalBaseDemand,
      lastCompetitorPrice: {
        tea: loaded.terms.listPrice.primary.tea,
        snack: loaded.terms.listPrice.primary.snack,
      },
    }),
    terms: loaded.terms,
    state: copyState(loaded.initial),
    loaded,
    previousPrices: openingPrices(loaded.terms),
    previousCompetitor: null,
    mock,
    memory,
    specs,
    registry,
    profile: input.profile,
    p50Threshold: input.p50Threshold,
    deals: [],
    seats: freshSeats(),
    activated: [],
    decision: null,
    usedFallback: false,
    stopReason: null,
    priceWars: [],
    ledgerRows: [],
    rng: deriveRng(seed(input.seed)),
  };
  box.current = active;
  const summaries: RoundSummary[] = [];
  try {
    const start = input.onlyRound ?? 0;
    const limit = input.onlyRound === undefined ? loaded.truth.rounds : input.onlyRound + 1;
    if (start !== 0) active.state = { ...active.state, roundIndex: roundIndex(start) };
    for (let step = start; step < limit; step += 1) {
      if (active.state.roundIndex !== step) {
        throw new Error(`round index ${String(active.state.roundIndex)} drifted at ${String(step)}`);
      }
      active.round = step;
      active.observation = project(active.state, active.loaded.truth, active.state.roundIndex);
      active.model = publicModel({
        nominalElasticity: loaded.nominalElasticity,
        nominalBaseDemand: loaded.nominalBaseDemand,
        lastCompetitorPrice: active.previousCompetitor ?? active.observation.competitorPrices,
      });
      summaries.push(await playRound(active, tools, input.callCap));
    }
    const folded = foldEvents(ledger.list(runId));
    const events = audit.list(runId).map((event) => ({ type: event.type, payloadJson: event.payloadJson }));
    const ledgerEvents = ledger.list(runId).map((event) => ({
      type: event.type,
      payloadJson: event.payloadJson,
    }));
    return {
      mode: "mock",
      hash: folded.finalHash,
      ledgerHash: ledgerDigest(active.ledgerRows),
      calls: mock.calls.length,
      callRoles: mock.calls.map((call) => readPrompt(call.prompt).role),
      rounds: summaries,
      events,
      ledgerEvents,
      priceWars: active.priceWars,
      minInventory: minInventory(active.ledgerRows),
    };
  } finally {
    box.current = null;
    audit.close();
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
