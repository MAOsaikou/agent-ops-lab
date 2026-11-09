import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { RunProfile } from "./capture.js";
import { buildRecord } from "./capture.js";
import type { ScenarioName } from "../templates/simshop/market/scenario.js";
import { runShop } from "../templates/simshop/workflows/round.js";

const OUTPUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../web/src/state/__fixtures__/recorded-frames.json",
);

export async function writeFixture(input: {
  readonly scenario: ScenarioName;
  readonly seed: number;
  readonly profile: RunProfile;
}): Promise<{ file: string; frames: number }> {
  const sim = await runShop({
    scenario: input.scenario,
    seed: input.seed,
    profile: input.profile,
    callCap: null,
    p50Threshold: 1,
  });
  const record = buildRecord({
    sim,
    scenario: input.scenario,
    seed: input.seed,
    profile: input.profile,
    createdAt: "2026-11-08T16:00:00.000Z",
    replayVerified: true,
  });
  mkdirSync(path.dirname(OUTPUT), { recursive: true });
  writeFileSync(
    OUTPUT,
    `${JSON.stringify({ meta: record.meta, frames: record.frames }, null, 2)}\n`,
    "utf8",
  );
  return { file: OUTPUT, frames: record.frames.length };
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith("fixture.ts");
if (invokedDirectly) {
  const result = await writeFixture({ scenario: "supplycut", seed: 7, profile: "steady" });
  process.stdout.write(`wrote ${String(result.frames)} frames to ${result.file}\n`);
}
