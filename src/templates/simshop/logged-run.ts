import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "../../engine/json.js";
import { sha256Bytes, sha256Hex } from "../../engine/hash.js";
import { isRunId, type RunId } from "../../engine/ids.js";
import { replay } from "../../engine/replay.js";
import { commitDecision, reflectRound, settleRound } from "../../engine/round/commit.js";
import { initialRound, step, type RoundState } from "../../engine/round/machine.js";
import { defaultEventDbPath, openEventStore, type EventStore } from "../../engine/events/store.js";
import type { Hash } from "../../engine/types.js";
import { isSeed, roundIndex, seed, type Cents, type Seed } from "./market/brand.js";
import { outcomeCanonical } from "./market/ledger.js";
import { observationBytes, project, publicModel } from "./market/project.js";
import { settle } from "./market/rules.js";
import { deriveRng } from "./market/rng.js";
import {
  isScenarioName,
  loadScenario,
  type LoadedScenario,
  type ScenarioName,
} from "./market/scenario.js";
import type { Decision, Policy, PublicModel, ShopState, Sku } from "./market/types.js";
import { isPolicyName, POLICIES, type PolicyName } from "./policies/heuristic.js";

const ITERATION_CAP = 3;

export class HaltedRun extends Error {
  readonly appendIndex: number;

  constructor(appendIndex: number) {
    super(`halted before append ${appendIndex}`);
    this.name = "HaltedRun";
    this.appendIndex = appendIndex;
  }
}

export type LoggedRunInput = {
  readonly dbPath: string;
  readonly runId: RunId;
  readonly loaded: LoadedScenario;
  readonly seed: Seed;
  readonly policy: Policy;
  readonly haltBeforeAppend?: number;
};

export type LoggedRunResult = {
  readonly runId: RunId;
  readonly finalHash: Hash;
  readonly appends: number;
  readonly rounds: number;
};

function copyState(state: ShopState): ShopState {
  const pending = [];
  for (const receipt of state.pendingReceipts) {
    pending.push({
      sku: receipt.sku,
      qty: receipt.qty,
      arrivesAt: receipt.arrivesAt,
    });
  }
  return {
    cash: state.cash,
    inventory: { tea: state.inventory.tea, snack: state.inventory.snack },
    reputation: state.reputation,
    roundIndex: state.roundIndex,
    pendingReceipts: pending,
  };
}

function decisionBody(decision: Decision): {
  adSpend: number;
  orders: {
    snack: { price: number; qty: number; supplier: string };
    tea: { price: number; qty: number; supplier: string };
  };
} {
  return {
    adSpend: decision.adSpend,
    orders: {
      snack: {
        price: decision.orders.snack.price,
        qty: decision.orders.snack.qty,
        supplier: decision.orders.snack.supplier,
      },
      tea: {
        price: decision.orders.tea.price,
        qty: decision.orders.tea.qty,
        supplier: decision.orders.tea.supplier,
      },
    },
  };
}

function beliefDigest(model: PublicModel, profit: number, cash: number, reputation: number): Hash {
  return sha256Hex(
    canonicalJson({
      baseDemand: {
        snack: model.nominalBaseDemand.snack,
        tea: model.nominalBaseDemand.tea,
      },
      cash,
      elasticity: model.nominalElasticity,
      lastCompetitorPrice: {
        snack: model.lastCompetitorPrice.snack,
        tea: model.lastCompetitorPrice.tea,
      },
      profit,
      reputation,
    }),
  );
}

function phaseToCommitted(): RoundState {
  let phase = initialRound();
  phase = step(phase, "ObservationPublished", ITERATION_CAP);
  phase = step(phase, "ScheduleChosen", ITERATION_CAP);
  phase = step(phase, "NoConflict", ITERATION_CAP);
  phase = step(phase, "VerificationPassed", ITERATION_CAP);
  phase = step(phase, "Timeout", ITERATION_CAP);
  if (phase.phase !== "Committed") {
    throw new Error(`round phase is ${phase.phase}`);
  }
  return phase;
}

function execute(store: EventStore, input: LoggedRunInput): LoggedRunResult {
  if (
    input.haltBeforeAppend !== undefined &&
    (!Number.isSafeInteger(input.haltBeforeAppend) || input.haltBeforeAppend < 0)
  ) {
    throw new RangeError("haltBeforeAppend must be a non-negative integer");
  }
  const rounds = input.loaded.truth.rounds;
  let state = copyState(input.loaded.initial);
  const rng = deriveRng(input.seed);
  let previous: Record<Sku, Cents> | undefined;
  let appendIndex = 0;
  const pass = (): void => {
    if (input.haltBeforeAppend !== undefined && appendIndex === input.haltBeforeAppend) {
      store.close();
      throw new HaltedRun(input.haltBeforeAppend);
    }
    appendIndex += 1;
  };

  for (let stepIndex = 0; stepIndex < rounds; stepIndex += 1) {
    if (state.roundIndex !== stepIndex) {
      throw new Error(`round index ${state.roundIndex} drifted at step ${stepIndex}`);
    }
    const observation = project(state, input.loaded.truth, state.roundIndex);
    const model = publicModel({
      nominalElasticity: input.loaded.nominalElasticity,
      nominalBaseDemand: input.loaded.nominalBaseDemand,
      lastCompetitorPrice: previous ?? observation.competitorPrices,
    });
    const decision = input.policy({
      state,
      observation,
      model,
      terms: input.loaded.terms,
    });
    const body = decisionBody(decision);
    const bodyJson = canonicalJson(body);
    const decisionHash = sha256Hex(bodyJson);
    const observationHash = sha256Bytes(observationBytes(observation));
    let phase = phaseToCommitted();
    pass();
    const committed = commitDecision({
      store,
      runId: input.runId,
      round: stepIndex,
      decisionHash,
      payload: { observationHash, body },
    });
    if (committed.bodyJson !== bodyJson || committed.decisionHash !== decisionHash) {
      throw new Error(`round ${stepIndex} commit does not match the decision`);
    }
    pass();
    let producedOutcome: ReturnType<typeof settle> | undefined;
    const recorded = settleRound({
      store,
      runId: input.runId,
      round: stepIndex,
      decisionHash,
      produce() {
        const settled = settle(state, decision, input.loaded.truth, rng);
        producedOutcome = settled;
        return outcomeCanonical(settled.outcome);
      },
    });
    const replayed = producedOutcome ?? settle(state, decision, input.loaded.truth, rng);
    const outcomeJson = canonicalJson(outcomeCanonical(replayed.outcome));
    if (outcomeJson !== recorded.outcomeJson) {
      throw new Error(`round ${stepIndex} outcome does not match the stored settlement`);
    }
    state = replayed.state;
    phase = step(phase, "Settle", ITERATION_CAP);
    if (phase.phase !== "Settled") {
      throw new Error(`round phase is ${phase.phase}`);
    }
    const beliefHash = beliefDigest(
      model,
      replayed.outcome.profit,
      replayed.outcome.cash,
      replayed.outcome.reputation,
    );
    const overlayHash = sha256Hex(canonicalJson({ entries: stepIndex + 1 }));
    pass();
    reflectRound({
      store,
      runId: input.runId,
      round: stepIndex,
      write: () => ({ beliefHash, overlayHash }),
    });
    phase = step(phase, "Reflect", ITERATION_CAP);
    if (phase.phase !== "Reflected") {
      throw new Error(`round phase is ${phase.phase}`);
    }
    previous = {
      tea: observation.competitorPrices.tea,
      snack: observation.competitorPrices.snack,
    };
  }
  if (state.roundIndex !== roundIndex(rounds)) {
    throw new Error("logged run stopped before the last round");
  }
  if (appendIndex !== rounds * 3) {
    throw new Error(`logged run appended ${appendIndex} times`);
  }
  return {
    runId: input.runId,
    finalHash: replay({ store, runId: input.runId }).finalHash,
    appends: appendIndex,
    rounds,
  };
}

export function runLogged(input: LoggedRunInput): LoggedRunResult {
  const store = openEventStore(input.dbPath);
  try {
    return execute(store, input);
  } finally {
    store.close();
  }
}

export function loggedRunId(scenario: ScenarioName, drawn: Seed, policyName: PolicyName): RunId {
  const text = `${scenario}-s${drawn}-${policyName}`;
  if (!isRunId(text)) {
    throw new Error(`run id rejected: ${text}`);
  }
  return text;
}

const USAGE =
  "usage: tsx src/templates/simshop/logged-run.ts --scenario spring|supplycut|pricewar --seed <int> --policy heuristic-good|heuristic-bad|heuristic-primary-only [--db <path>]";

function parseSeed(text: string): Seed | undefined {
  if (!/^-?\d+$/.test(text)) {
    return undefined;
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value) || !isSeed(value)) {
    return undefined;
  }
  return seed(value);
}

function parseArgs(argv: readonly string[]):
  | {
      ok: true;
      scenario: ScenarioName;
      drawn: Seed;
      policyName: PolicyName;
      dbPath: string;
    }
  | { ok: false } {
  const flags = new Map<string, string>();
  let index = 0;
  while (index < argv.length) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === undefined || value === undefined || !key.startsWith("--") || value.startsWith("--")) {
      return { ok: false };
    }
    if (key !== "--scenario" && key !== "--seed" && key !== "--policy" && key !== "--db") {
      return { ok: false };
    }
    flags.set(key, value);
    index += 2;
  }
  const scenarioText = flags.get("--scenario");
  const seedText = flags.get("--seed");
  const policyText = flags.get("--policy");
  if (scenarioText === undefined || seedText === undefined || policyText === undefined) {
    return { ok: false };
  }
  if (!isScenarioName(scenarioText) || !isPolicyName(policyText)) {
    return { ok: false };
  }
  const drawn = parseSeed(seedText);
  if (drawn === undefined) {
    return { ok: false };
  }
  const dbText = flags.get("--db");
  return {
    ok: true,
    scenario: scenarioText,
    drawn,
    policyName: policyText,
    dbPath: dbText ?? defaultEventDbPath(),
  };
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (invokedDirectly()) {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(USAGE);
    process.exit(1);
  }
  const result = runLogged({
    dbPath: parsed.dbPath,
    runId: loggedRunId(parsed.scenario, parsed.drawn, parsed.policyName),
    loaded: loadScenario(parsed.scenario),
    seed: parsed.drawn,
    policy: POLICIES[parsed.policyName],
  });
  console.log(`runId ${result.runId}`);
  console.log(`final hash ${result.finalHash}`);
}
