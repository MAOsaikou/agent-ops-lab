import { seed } from "../src/templates/simshop/market/brand.js";
import { project, publicModel } from "../src/templates/simshop/market/project.js";
import { settle } from "../src/templates/simshop/market/rules.js";
import { deriveRng } from "../src/templates/simshop/market/rng.js";
import { loadScenario } from "../src/templates/simshop/market/scenario.js";
import { heuristicGood } from "../src/templates/simshop/policies/heuristic.js";

const WARMUP = 10000;
const CALLS = 10000;
const ROUNDS = 5;

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    throw new Error("empty sample");
  }
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  const left = sorted[low];
  const right = sorted[high];
  if (left === undefined || right === undefined) {
    throw new Error("percentile index missing");
  }
  if (low === high) {
    return left;
  }
  const weight = index - low;
  return left * (1 - weight) + right * weight;
}

function formatMs(value: number): string {
  return value.toFixed(6);
}

const loaded = loadScenario("spring");
const state = loaded.initial;
const observation = project(state, loaded.truth, state.roundIndex);
const decision = heuristicGood({
  state,
  observation,
  model: publicModel({
    nominalElasticity: loaded.nominalElasticity,
    nominalBaseDemand: loaded.nominalBaseDemand,
    lastCompetitorPrice: observation.competitorPrices,
  }),
  terms: loaded.terms,
});
const rng = deriveRng(seed(1));
const probe = settle(state, decision, loaded.truth, rng);
const unit = probe.outcome.profit + probe.outcome.sales + probe.state.cash;
if (unit === 0 || probe.state.cash < 0 || probe.state.inventory.tea < 0 || probe.state.inventory.snack < 0) {
  console.error("bench probe failed");
  process.exit(1);
}

let warm = 0;
for (let call = 0; call < WARMUP; call += 1) {
  const settled = settle(state, decision, loaded.truth, rng);
  warm += settled.outcome.profit;
}
if (warm !== probe.outcome.profit * WARMUP) {
  console.error(`warmup checksum mismatch ${warm}`);
  process.exit(1);
}

let checksum = 0;

const samples: number[] = [];
for (let round = 1; round <= ROUNDS; round += 1) {
  const roundSamples: number[] = [];
  for (let call = 0; call < CALLS; call += 1) {
    const started = process.hrtime.bigint();
    const settled = settle(state, decision, loaded.truth, rng);
    const elapsed = process.hrtime.bigint() - started;
    roundSamples.push(Number(elapsed) / 1e6);
    checksum += settled.outcome.profit + settled.outcome.sales + settled.state.cash;
  }
  const sorted = [...roundSamples].sort((left, right) => left - right);
  const median = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  for (const sample of roundSamples) {
    samples.push(sample);
  }
  console.log(`round=${round} calls=${CALLS} median_ms=${formatMs(median)} p95_ms=${formatMs(p95)}`);
}

const expected = unit * CALLS * ROUNDS;
if (checksum !== expected) {
  console.error(`checksum mismatch ${checksum} vs ${expected}`);
  process.exit(1);
}

const pooled = samples.sort((left, right) => left - right);
console.log(
  `summary calls=${CALLS * ROUNDS} warmup_calls=${WARMUP} median_ms=${formatMs(percentile(pooled, 0.5))} p95_ms=${formatMs(percentile(pooled, 0.95))} errors=0 checksum=${checksum} probe_cash=${probe.state.cash} probe_profit=${probe.outcome.profit} probe_sales=${probe.outcome.sales}`,
);
