import { seed } from "../src/templates/simshop/market/brand.js";
import { runMarket } from "../src/templates/simshop/market/run.js";
import { loadScenario, SCENARIO_NAMES } from "../src/templates/simshop/market/scenario.js";
import { POLICIES } from "../src/templates/simshop/policies/heuristic.js";

const SEEDS = 20;
const POLICIES_UNDER_TEST = ["heuristic-good", "heuristic-bad"] as const;

function medianOf(sorted: readonly number[]): number {
  const count = sorted.length;
  if (count === 0) {
    throw new Error("empty sample");
  }
  const mid = Math.floor(count / 2);
  if (count % 2 === 1) {
    const value = sorted[mid];
    if (value === undefined) {
      throw new Error("median index missing");
    }
    return value;
  }
  const left = sorted[mid - 1];
  const right = sorted[mid];
  if (left === undefined || right === undefined) {
    throw new Error("median index missing");
  }
  return (left + right) / 2;
}

function summarize(values: readonly number[]): {
  median: number;
  q1: number;
  q3: number;
  iqr: number;
} {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length % 2 !== 0) {
    throw new Error("median-of-halves expects an even sample");
  }
  const mid = sorted.length / 2;
  const q1 = medianOf(sorted.slice(0, mid));
  const q3 = medianOf(sorted.slice(mid));
  const median = medianOf(sorted);
  return { median, q1, q3, iqr: q3 - q1 };
}

console.log("metric=final_cash quartile=median_of_halves seeds=1..20");

let allPassed = true;
for (const scenarioName of SCENARIO_NAMES) {
  const loaded = loadScenario(scenarioName);
  const stats: Partial<Record<(typeof POLICIES_UNDER_TEST)[number], ReturnType<typeof summarize>>> =
    {};
  for (const policyName of POLICIES_UNDER_TEST) {
    const finals: number[] = [];
    for (let drawn = 1; drawn <= SEEDS; drawn += 1) {
      const result = runMarket({
        loaded,
        seed: seed(drawn),
        policy: POLICIES[policyName],
      });
      finals.push(result.state.cash);
    }
    const summary = summarize(finals);
    stats[policyName] = summary;
    console.log(
      `scenario=${scenarioName} policy=${policyName} n=${SEEDS} median=${summary.median} q1=${summary.q1} q3=${summary.q3} iqr=${summary.iqr}`,
    );
  }
  const good = stats["heuristic-good"];
  const bad = stats["heuristic-bad"];
  if (good === undefined || bad === undefined) {
    throw new Error(`missing sensitivity stats for ${scenarioName}`);
  }
  const gap = good.median - bad.median;
  const spread = good.iqr + bad.iqr;
  const pass = gap > spread;
  if (!pass) {
    allPassed = false;
  }
  console.log(
    `scenario=${scenarioName} median_gap=${gap} iqr_sum=${spread} pass=${pass ? "yes" : "no"}`,
  );
}

console.log(allPassed ? "gate=pass" : "gate=fail");
process.exit(allPassed ? 0 : 1);
