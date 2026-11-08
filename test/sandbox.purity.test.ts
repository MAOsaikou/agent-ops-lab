import { expect, test } from "vitest";

import { sha256Hex } from "../src/engine/hash.js";
import { canonicalJson } from "../src/engine/json.js";
import { loadScenario } from "../src/templates/simshop/market/scenario.js";
import { project, publicModel } from "../src/templates/simshop/market/project.js";
import { forecastShop, publicSandboxView } from "../src/templates/simshop/sandbox.js";
import type { ShopDecision } from "../src/templates/simshop/constraints.js";

const decision: ShopDecision = {
  adSpend: 500,
  orders: {
    tea: { price: 900, qty: 4, supplier: "primary" },
    snack: { price: 450, qty: 3, supplier: "backup" },
  },
};

test("a sandbox call leaves the state hash unchanged and ignores hidden elasticity", () => {
  const loaded = loadScenario("spring");
  const round = loaded.initial.roundIndex;
  const observation = project(loaded.initial, loaded.truth, round);
  const model = publicModel({
    nominalElasticity: loaded.nominalElasticity,
    nominalBaseDemand: loaded.nominalBaseDemand,
    lastCompetitorPrice: observation.competitorPrices,
  });
  const view = publicSandboxView({ observation, model, terms: loaded.terms });
  const beforeState = sha256Hex(canonicalJson(loaded.initial));
  const beforeView = sha256Hex(canonicalJson(view));
  const first = forecastShop({ decision, state: loaded.initial, view });
  expect(sha256Hex(canonicalJson(loaded.initial))).toBe(beforeState);
  expect(sha256Hex(canonicalJson(view))).toBe(beforeView);

  const hidden = loaded.truth.elasticity + 6.5;
  const twistedTruth = { ...loaded.truth, elasticity: hidden };
  const twistedObservation = project(loaded.initial, twistedTruth, round);
  const twistedModel = publicModel({
    nominalElasticity: loaded.nominalElasticity,
    nominalBaseDemand: loaded.nominalBaseDemand,
    lastCompetitorPrice: twistedObservation.competitorPrices,
  });
  const twistedView = publicSandboxView({
    observation: twistedObservation,
    model: twistedModel,
    terms: loaded.terms,
  });
  const second = forecastShop({ decision, state: loaded.initial, view: twistedView });
  expect(second).toEqual(first);
  expect(twistedView.nominalElasticity).toBe(view.nominalElasticity);
  expect(canonicalJson(twistedView)).not.toContain(String(hidden));
});
