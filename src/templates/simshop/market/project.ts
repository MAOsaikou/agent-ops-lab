import { type Cents, type Qty, type RoundIndex } from "./brand.js";
import { canonicalJson, type Canonical } from "./canonical.js";
import { readAt } from "./schedule.js";
import type {
  Observation,
  PublicModel,
  ScenarioTruth,
  ShopState,
  Sku,
} from "./types.js";

export const PRIMARY_CANNOT_DELIVER = "primary cannot deliver";
export const BACKUP_CANNOT_DELIVER = "backup cannot deliver";

function newsFor(
  round: RoundIndex,
  prices: Record<Sku, Cents>,
  primaryCapacity: Qty,
  backupCapacity: Qty,
): string {
  const parts = [
    `round ${round + 1}`,
    `tea competitor ${prices.tea}`,
    `snack competitor ${prices.snack}`,
  ];
  if (primaryCapacity === 0) {
    parts.push(PRIMARY_CANNOT_DELIVER);
  }
  if (backupCapacity === 0) {
    parts.push(BACKUP_CANNOT_DELIVER);
  }
  return parts.join(". ");
}

export function project(state: ShopState, truth: ScenarioTruth, round: RoundIndex): Observation {
  const competitorPrices = {
    tea: readAt(truth.competitorPrice.tea, round, "tea competitor price"),
    snack: readAt(truth.competitorPrice.snack, round, "snack competitor price"),
  };
  const primaryCapacity = readAt(
    truth.suppliers.primary.capacityByRound,
    round,
    "primary capacity",
  );
  const backupCapacity = readAt(
    truth.suppliers.backup.capacityByRound,
    round,
    "backup capacity",
  );
  return {
    cash: state.cash,
    inventory: { tea: state.inventory.tea, snack: state.inventory.snack },
    reputation: state.reputation,
    round,
    competitorPrices,
    news: newsFor(round, competitorPrices, primaryCapacity, backupCapacity),
  };
}

export function publicModel(input: {
  nominalElasticity: number;
  nominalBaseDemand: PublicModel["nominalBaseDemand"];
  lastCompetitorPrice: PublicModel["lastCompetitorPrice"];
}): PublicModel {
  return {
    nominalElasticity: input.nominalElasticity,
    nominalBaseDemand: {
      tea: input.nominalBaseDemand.tea,
      snack: input.nominalBaseDemand.snack,
    },
    lastCompetitorPrice: {
      tea: input.lastCompetitorPrice.tea,
      snack: input.lastCompetitorPrice.snack,
    },
  };
}

function observationCanonical(observation: Observation): Canonical {
  return {
    cash: observation.cash,
    competitorPrices: {
      snack: observation.competitorPrices.snack,
      tea: observation.competitorPrices.tea,
    },
    inventory: {
      snack: observation.inventory.snack,
      tea: observation.inventory.tea,
    },
    news: observation.news,
    reputation: observation.reputation,
    round: observation.round,
  };
}

export function observationBytes(observation: Observation): Uint8Array {
  return new TextEncoder().encode(canonicalJson(observationCanonical(observation)));
}
