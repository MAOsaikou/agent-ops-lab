import { seed } from "../src/templates/simshop/market/brand.js";
import { runMarket } from "../src/templates/simshop/market/run.js";
import { loadScenario, parseScenario } from "../src/templates/simshop/market/scenario.js";
import { POLICIES, type PolicyName } from "../src/templates/simshop/policies/heuristic.js";
import { expect, test } from "vitest";

const cases = [
  { scenario: "spring", drawn: 42, policy: "heuristic-good" },
  { scenario: "supplycut", drawn: 7, policy: "heuristic-good" },
  { scenario: "pricewar", drawn: 1, policy: "heuristic-bad" },
] as const;

for (const item of cases) {
  test(`${item.scenario} seed ${item.drawn} ${item.policy}`, () => {
    const loaded = loadScenario(item.scenario);
    const policyName: PolicyName = item.policy;
    const first = runMarket({
      loaded,
      seed: seed(item.drawn),
      policy: POLICIES[policyName],
    });
    const second = runMarket({
      loaded,
      seed: seed(item.drawn),
      policy: POLICIES[policyName],
    });
    expect(second.ledger).toEqual(first.ledger);
    expect(second.hash).toBe(first.hash);
    expect(second.state).toEqual(first.state);
    expect(first.ledger).toMatchSnapshot();
  });
}

test("rejects a scenario that is not the truth shape", () => {
  expect(() => parseScenario({ name: "spring" })).toThrow(/scenario rejected/);
});

test("supplycut seed 7 shows missed demand while reputation stays positive", () => {
  const loaded = loadScenario("supplycut");
  const primary = runMarket({
    loaded,
    seed: seed(7),
    policy: POLICIES["heuristic-primary-only"],
  });
  for (const row of primary.ledger) {
    expect(row.reputation).toBeGreaterThan(0);
  }
  const proof = primary.ledger.find((row) => {
    const capacity = loaded.truth.suppliers.primary.capacityByRound[row.round];
    return capacity === 0 && row.missed > 0;
  });
  expect(proof).toBeDefined();

  const good = runMarket({
    loaded,
    seed: seed(7),
    policy: POLICIES["heuristic-good"],
  });
  for (const row of good.ledger) {
    expect(row.reputation).toBeGreaterThan(0);
  }
});
