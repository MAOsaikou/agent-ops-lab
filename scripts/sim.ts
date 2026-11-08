import { isSeed, type Seed } from "../src/templates/simshop/market/brand.js";
import { ledgerLine } from "../src/templates/simshop/market/ledger.js";
import { runMarket } from "../src/templates/simshop/market/run.js";
import {
  isScenarioName,
  loadScenario,
  type ScenarioName,
} from "../src/templates/simshop/market/scenario.js";
import {
  isPolicyName,
  POLICIES,
  type PolicyName,
} from "../src/templates/simshop/policies/heuristic.js";

const USAGE =
  "usage: pnpm sim --scenario spring|supplycut|pricewar --seed <int> --policy heuristic-good|heuristic-bad|heuristic-primary-only";

function parseSeed(text: string): Seed | undefined {
  if (!/^-?\d+$/.test(text)) {
    return undefined;
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    return undefined;
  }
  if (!isSeed(value)) {
    return undefined;
  }
  return value;
}

function parseArgs(argv: readonly string[]):
  | { ok: true; scenario: ScenarioName; seed: Seed; policy: PolicyName }
  | { ok: false } {
  const flags = new Map<string, string>();
  let index = 0;
  while (index < argv.length) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      key === undefined ||
      value === undefined ||
      !key.startsWith("--") ||
      value.startsWith("--")
    ) {
      return { ok: false };
    }
    if (key !== "--scenario" && key !== "--seed" && key !== "--policy") {
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
  const parsedSeed = parseSeed(seedText);
  if (parsedSeed === undefined) {
    return { ok: false };
  }
  return { ok: true, scenario: scenarioText, seed: parsedSeed, policy: policyText };
}

const parsed = parseArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(USAGE);
  process.exit(1);
}

const result = runMarket({
  loaded: loadScenario(parsed.scenario),
  seed: parsed.seed,
  policy: POLICIES[parsed.policy],
});
for (const outcome of result.ledger) {
  console.log(ledgerLine(outcome));
}
console.log(`final hash ${result.hash}`);
