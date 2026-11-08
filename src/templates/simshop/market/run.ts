import { roundIndex, type Cents, type Seed } from "./brand.js";
import { ledgerDigest } from "./ledger.js";
import { project, publicModel } from "./project.js";
import { settle } from "./rules.js";
import { deriveRng } from "./rng.js";
import type { LoadedScenario } from "./scenario.js";
import type { Outcome, Policy, ShopState, Sku } from "./types.js";

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

export function runMarket(input: {
  loaded: LoadedScenario;
  seed: Seed;
  policy: Policy;
}): { ledger: readonly Outcome[]; state: ShopState; hash: string } {
  const rng = deriveRng(input.seed);
  let state = copyState(input.loaded.initial);
  let previous: Record<Sku, Cents> | undefined;
  const ledger: Outcome[] = [];
  for (let step = 0; step < input.loaded.truth.rounds; step += 1) {
    if (state.roundIndex !== step) {
      throw new Error(`round index ${state.roundIndex} drifted at step ${step}`);
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
    const settled = settle(state, decision, input.loaded.truth, rng);
    ledger.push(settled.outcome);
    previous = {
      tea: observation.competitorPrices.tea,
      snack: observation.competitorPrices.snack,
    };
    state = settled.state;
  }
  if (state.roundIndex !== roundIndex(input.loaded.truth.rounds)) {
    throw new Error("market run stopped before the scenario rounds were settled");
  }
  return { ledger, state, hash: ledgerDigest(ledger) };
}
