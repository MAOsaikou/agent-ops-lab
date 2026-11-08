import { cents, qty, roundIndex } from "../src/templates/simshop/market/brand.js";
import {
  BACKUP_CANNOT_DELIVER,
  observationBytes,
  PRIMARY_CANNOT_DELIVER,
  project,
} from "../src/templates/simshop/market/project.js";
import { loadScenario } from "../src/templates/simshop/market/scenario.js";
import type { ScenarioTruth } from "../src/templates/simshop/market/types.js";
import { expect, test } from "vitest";

function text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

test("hidden parameters and future shocks do not change the current observation", () => {
  const loaded = loadScenario("spring");
  const round = loaded.initial.roundIndex;
  const before = observationBytes(project(loaded.initial, loaded.truth, round));
  const mutated: ScenarioTruth = {
    ...loaded.truth,
    elasticity: loaded.truth.elasticity + 4.5,
    noiseSigma: loaded.truth.noiseSigma + 1,
    stockoutPenalty: loaded.truth.stockoutPenalty + 9,
    holdingCost: cents(loaded.truth.holdingCost + 17),
    adHalfSat: cents(loaded.truth.adHalfSat + 99),
    seasonBps: loaded.truth.seasonBps.map((bps) => bps + 2500),
    skus: {
      tea: {
        baseDemand: qty(loaded.truth.skus.tea.baseDemand + 11),
        refPrice: cents(loaded.truth.skus.tea.refPrice + 111),
      },
      snack: {
        baseDemand: qty(loaded.truth.skus.snack.baseDemand + 11),
        refPrice: cents(loaded.truth.skus.snack.refPrice + 111),
      },
    },
    competitorPrice: {
      tea: loaded.truth.competitorPrice.tea.map((price, index) =>
        index > round ? cents(424242) : price,
      ),
      snack: loaded.truth.competitorPrice.snack.map((price, index) =>
        index > round ? cents(909090) : price,
      ),
    },
    suppliers: {
      primary: {
        ...loaded.truth.suppliers.primary,
        leadTime: loaded.truth.suppliers.primary.leadTime + 3,
        unitCost: {
          tea: cents(loaded.truth.suppliers.primary.unitCost.tea + 15),
          snack: cents(loaded.truth.suppliers.primary.unitCost.snack + 15),
        },
        capacityByRound: loaded.truth.suppliers.primary.capacityByRound.map((cap, index) =>
          index > round ? qty(515151) : cap,
        ),
      },
      backup: {
        ...loaded.truth.suppliers.backup,
        leadTime: loaded.truth.suppliers.backup.leadTime + 3,
        unitCost: {
          tea: cents(loaded.truth.suppliers.backup.unitCost.tea + 15),
          snack: cents(loaded.truth.suppliers.backup.unitCost.snack + 15),
        },
        capacityByRound: loaded.truth.suppliers.backup.capacityByRound.map((cap, index) =>
          index > round ? qty(616161) : cap,
        ),
      },
    },
  };
  const after = observationBytes(project(loaded.initial, mutated, round));
  expect(after).toEqual(before);
  const rendered = text(after);
  expect(rendered).not.toContain("424242");
  expect(rendered).not.toContain("909090");
  expect(rendered).not.toContain("515151");
  expect(rendered).not.toContain("616161");

  const stillOpen: ScenarioTruth = {
    ...loaded.truth,
    suppliers: {
      ...loaded.truth.suppliers,
      primary: {
        ...loaded.truth.suppliers.primary,
        capacityByRound: loaded.truth.suppliers.primary.capacityByRound.map((cap, index) =>
          index === round ? qty(50) : cap,
        ),
      },
    },
  };
  expect(observationBytes(project(loaded.initial, stillOpen, round))).toEqual(before);

  const closed: ScenarioTruth = {
    ...loaded.truth,
    suppliers: {
      ...loaded.truth.suppliers,
      primary: {
        ...loaded.truth.suppliers.primary,
        capacityByRound: loaded.truth.suppliers.primary.capacityByRound.map((cap, index) =>
          index === round ? qty(0) : cap,
        ),
      },
    },
  };
  const closedObservation = project(loaded.initial, closed, round);
  expect(closedObservation.news).toContain(PRIMARY_CANNOT_DELIVER);
  expect(closedObservation.news).not.toContain(BACKUP_CANNOT_DELIVER);
  expect(observationBytes(closedObservation)).not.toEqual(before);
  expect(text(observationBytes(closedObservation))).not.toContain("424242");
});

test("supply cut announces only the closed rounds", () => {
  const loaded = loadScenario("supplycut");
  const open = project(loaded.initial, loaded.truth, roundIndex(0));
  const closed = project(loaded.initial, loaded.truth, roundIndex(1));
  const later = project(loaded.initial, loaded.truth, roundIndex(3));
  expect(open.news).not.toContain(PRIMARY_CANNOT_DELIVER);
  expect(closed.news).toContain(PRIMARY_CANNOT_DELIVER);
  expect(closed.competitorPrices.tea).toBe(loaded.truth.competitorPrice.tea[1]);
  expect(later.news).not.toContain(PRIMARY_CANNOT_DELIVER);
  expect(open.cash).toBe(loaded.initial.cash);
  expect(open.inventory).toEqual(loaded.initial.inventory);
  expect(open.reputation).toBe(loaded.initial.reputation);
});
