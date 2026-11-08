import { rmSync } from "node:fs";

import { openEventStore } from "../src/engine/events/store.js";
import { seed } from "../src/templates/simshop/market/brand.js";
import { loadScenario } from "../src/templates/simshop/market/scenario.js";
import { POLICIES } from "../src/templates/simshop/policies/heuristic.js";
import { HaltedRun, loggedRunId, runLogged } from "../src/templates/simshop/logged-run.js";

const ROUND_INDEX = 3;
const SETTLE_CHECKPOINT = ROUND_INDEX * 3 + 1;
const dbPath = ".data/u2-crash.sqlite";
const cleanPath = ".data/u2-crash-clean.sqlite";

function removeDb(file: string): void {
  rmSync(file, { force: true });
  rmSync(`${file}-wal`, { force: true });
  rmSync(`${file}-shm`, { force: true });
}

const loaded = loadScenario("spring");
const drawn = seed(42);
const policy = POLICIES["heuristic-good"];
const runId = loggedRunId("spring", drawn, "heuristic-good");

removeDb(dbPath);
removeDb(cleanPath);

const clean = runLogged({ dbPath: cleanPath, runId, loaded, seed: drawn, policy });

try {
  runLogged({
    dbPath,
    runId,
    loaded,
    seed: drawn,
    policy,
    haltBeforeAppend: SETTLE_CHECKPOINT,
  });
  console.error("expected a stop before settle");
  process.exit(1);
} catch (error) {
  if (!(error instanceof HaltedRun)) {
    throw error;
  }
}

const store = openEventStore(dbPath);
const events = store.list(runId);
const last = events.at(-1);
console.log(`stopped before settle of round index ${ROUND_INDEX}`);
console.log(`events ${events.length}`);
console.log(`last ${last === undefined ? "none" : last.type}`);
console.log(
  `settled rows ${events.filter((event) => event.type === "RoundSettled").length}`,
);
store.close();

const resumed = runLogged({ dbPath, runId, loaded, seed: drawn, policy });
console.log(`clean hash ${clean.finalHash}`);
console.log(`resumed hash ${resumed.finalHash}`);
if (resumed.finalHash !== clean.finalHash) {
  console.error("hashes differ");
  process.exit(1);
}
console.log("hashes equal");
