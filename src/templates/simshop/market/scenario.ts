import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import {
  isCents,
  isQty,
  isReputation,
  isRoundIndex,
  qty,
  roundIndex,
  type Cents,
  type Qty,
} from "./brand.js";
import type { PublicTerms, ScenarioTruth, ShopState, Sku } from "./types.js";

export const SCENARIO_NAMES = ["spring", "supplycut", "pricewar"] as const;
export type ScenarioName = (typeof SCENARIO_NAMES)[number];

export function isScenarioName(value: string): value is ScenarioName {
  for (const name of SCENARIO_NAMES) {
    if (name === value) {
      return true;
    }
  }
  return false;
}

export type LoadedScenario = {
  name: ScenarioName;
  truth: ScenarioTruth;
  initial: ShopState;
  nominalElasticity: number;
  nominalBaseDemand: Record<Sku, Qty>;
  terms: PublicTerms;
};

const skuName = z.enum(["tea", "snack"]);
const positiveInt = z.int().positive();
const nonNegativeInt = z.int().nonnegative();

const scenarioSchema = z.strictObject({
  name: z.enum(SCENARIO_NAMES),
  rounds: z.int().min(1).max(64),
  elasticity: z.number().positive(),
  noiseSigma: z.number().positive(),
  stockoutPenalty: nonNegativeInt,
  holdingCost: nonNegativeInt,
  adHalfSat: positiveInt,
  seasonBps: z.array(nonNegativeInt).min(1),
  skus: z.strictObject({
    tea: z.strictObject({ baseDemand: positiveInt, refPrice: positiveInt }),
    snack: z.strictObject({ baseDemand: positiveInt, refPrice: positiveInt }),
  }),
  competitorPrice: z.strictObject({
    tea: z.array(positiveInt).min(1),
    snack: z.array(positiveInt).min(1),
  }),
  suppliers: z.strictObject({
    primary: z.strictObject({
      leadTime: nonNegativeInt,
      unitCost: z.strictObject({ tea: positiveInt, snack: positiveInt }),
      capacityByRound: z.array(nonNegativeInt).min(1),
    }),
    backup: z.strictObject({
      leadTime: nonNegativeInt,
      unitCost: z.strictObject({ tea: positiveInt, snack: positiveInt }),
      capacityByRound: z.array(nonNegativeInt).min(1),
    }),
  }),
  initial: z.strictObject({
    cash: nonNegativeInt,
    reputation: z.int().min(0).max(1000),
    roundIndex: z.literal(0),
    inventory: z.strictObject({ tea: nonNegativeInt, snack: nonNegativeInt }),
    pendingReceipts: z.array(
      z.strictObject({
        sku: skuName,
        qty: nonNegativeInt,
        arrivesAt: nonNegativeInt,
      }),
    ),
  }),
});

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

function requireLength(values: readonly unknown[], rounds: number, label: string): void {
  if (values.length !== rounds) {
    throw new Error(`${label} has length ${values.length}, expected ${rounds}`);
  }
}

function brandQtyList(values: readonly number[], label: string): readonly Qty[] {
  return values.map((value, index) => {
    if (!isQty(value)) {
      throw new Error(`${label}[${index}] is not a quantity`);
    }
    return value;
  });
}

function brandPositiveCents(value: number, label: string): Cents {
  if (!isCents(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer number of cents`);
  }
  return value;
}

function brandCents(value: number, label: string): Cents {
  if (!isCents(value)) {
    throw new Error(`${label} must be an integer number of cents`);
  }
  return value;
}

function brandSkuPositive(values: { tea: number; snack: number }, label: string): Record<Sku, Cents> {
  return {
    tea: brandPositiveCents(values.tea, `${label}.tea`),
    snack: brandPositiveCents(values.snack, `${label}.snack`),
  };
}

export function parseScenario(input: unknown): LoadedScenario {
  const parsed = scenarioSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`scenario rejected: ${parsed.error.message}`);
  }
  const raw = parsed.data;
  requireLength(raw.seasonBps, raw.rounds, "seasonBps");
  requireLength(raw.competitorPrice.tea, raw.rounds, "competitorPrice.tea");
  requireLength(raw.competitorPrice.snack, raw.rounds, "competitorPrice.snack");
  requireLength(raw.suppliers.primary.capacityByRound, raw.rounds, "primary capacity");
  requireLength(raw.suppliers.backup.capacityByRound, raw.rounds, "backup capacity");

  const truth: ScenarioTruth = {
    rounds: raw.rounds,
    elasticity: raw.elasticity,
    noiseSigma: raw.noiseSigma,
    stockoutPenalty: raw.stockoutPenalty,
    holdingCost: brandCents(raw.holdingCost, "holdingCost"),
    adHalfSat: brandPositiveCents(raw.adHalfSat, "adHalfSat"),
    seasonBps: raw.seasonBps,
    skus: {
      tea: {
        baseDemand: qty(raw.skus.tea.baseDemand),
        refPrice: brandPositiveCents(raw.skus.tea.refPrice, "tea refPrice"),
      },
      snack: {
        baseDemand: qty(raw.skus.snack.baseDemand),
        refPrice: brandPositiveCents(raw.skus.snack.refPrice, "snack refPrice"),
      },
    },
    competitorPrice: {
      tea: raw.competitorPrice.tea.map((value, index) =>
        brandPositiveCents(value, `tea competitor ${index}`),
      ),
      snack: raw.competitorPrice.snack.map((value, index) =>
        brandPositiveCents(value, `snack competitor ${index}`),
      ),
    },
    suppliers: {
      primary: {
        leadTime: raw.suppliers.primary.leadTime,
        unitCost: brandSkuPositive(raw.suppliers.primary.unitCost, "primary unitCost"),
        capacityByRound: brandQtyList(raw.suppliers.primary.capacityByRound, "primary capacity"),
      },
      backup: {
        leadTime: raw.suppliers.backup.leadTime,
        unitCost: brandSkuPositive(raw.suppliers.backup.unitCost, "backup unitCost"),
        capacityByRound: brandQtyList(raw.suppliers.backup.capacityByRound, "backup capacity"),
      },
    },
  };

  if (!isReputation(raw.initial.reputation) || !isRoundIndex(raw.initial.roundIndex)) {
    throw new Error("scenario initial shop state is out of range");
  }
  const initial: ShopState = {
    cash: brandCents(raw.initial.cash, "initial cash"),
    reputation: raw.initial.reputation,
    roundIndex: raw.initial.roundIndex,
    inventory: {
      tea: qty(raw.initial.inventory.tea),
      snack: qty(raw.initial.inventory.snack),
    },
    pendingReceipts: raw.initial.pendingReceipts.map((receipt) => ({
      sku: receipt.sku,
      qty: qty(receipt.qty),
      arrivesAt: roundIndex(receipt.arrivesAt),
    })),
  };
  const terms: PublicTerms = {
    listPrice: {
      primary: {
        tea: truth.suppliers.primary.unitCost.tea,
        snack: truth.suppliers.primary.unitCost.snack,
      },
      backup: {
        tea: truth.suppliers.backup.unitCost.tea,
        snack: truth.suppliers.backup.unitCost.snack,
      },
    },
  };
  return {
    name: raw.name,
    truth,
    initial,
    nominalElasticity: truth.elasticity,
    nominalBaseDemand: {
      tea: truth.skus.tea.baseDemand,
      snack: truth.skus.snack.baseDemand,
    },
    terms,
  };
}

const scenarioDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "scenarios");

export function loadScenario(name: ScenarioName): LoadedScenario {
  const text = readFileSync(path.join(scenarioDir, `${name}.json`), "utf8");
  const loaded = parseScenario(parseJson(text));
  if (loaded.name !== name) {
    throw new Error(`scenario file ${name} declared ${loaded.name}`);
  }
  return loaded;
}
