import { mkdtempSync, rmSync, statfsSync } from "node:fs";
import { availableParallelism, loadavg } from "node:os";
import path from "node:path";

import { openEventStore } from "../src/engine/events/store.js";
import { parseRunId } from "../src/engine/ids.js";
import { replay } from "../src/engine/replay.js";
import { seed } from "../src/templates/simshop/market/brand.js";
import { loadScenario } from "../src/templates/simshop/market/scenario.js";
import { POLICIES } from "../src/templates/simshop/policies/heuristic.js";
import { loggedRunId, runLogged } from "../src/templates/simshop/logged-run.js";

const EVENTS = 100_000;
const ROUNDS = 5;
const WARMUP = 1_000;
const REPLAYS = 5;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid] : undefined;
  if (value !== undefined) {
    return value;
  }
  const upper = sorted[mid];
  const lower = sorted[mid - 1];
  if (upper === undefined || lower === undefined) {
    throw new Error("empty sample");
  }
  return (upper + lower) / 2;
}

function appendRound(root: string, index: number): {
  rate: number;
  seconds: number;
  rows: number;
  wal: string;
  synchronous: number;
  cpuMicros: number;
  fsWrite: number;
} {
  const dir = mkdtempSync(path.join(root, "round-"));
  const dbPath = path.join(dir, "events.sqlite");
  const store = openEventStore(dbPath);
  const warmupId = parseRunId("warmup");
  const runId = parseRunId(`bench${index}`);
  try {
    for (let event = 0; event < WARMUP; event += 1) {
      store.append({
        runId: warmupId,
        type: "Warmup",
        payloadJson: String(event),
        causationId: null,
        idempotencyKey: null,
      });
    }
    const wal = store.journalMode();
    const synchronous = store.synchronous();
    const cpuStart = process.cpuUsage();
    const ioStart = process.resourceUsage().fsWrite;
    const started = process.hrtime.bigint();
    for (let event = 0; event < EVENTS; event += 1) {
      store.append({
        runId,
        type: "Bench",
        payloadJson: String(event),
        causationId: null,
        idempotencyKey: null,
      });
    }
    const elapsedNs = process.hrtime.bigint() - started;
    const cpu = process.cpuUsage(cpuStart);
    const fsWrite = process.resourceUsage().fsWrite - ioStart;
    const rows = store.count(runId);
    const seconds = Number(elapsedNs) / 1e9;
    return {
      rate: rows / seconds,
      seconds,
      rows,
      wal,
      synchronous,
      cpuMicros: cpu.user + cpu.system,
      fsWrite,
    };
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const root = mkdtempSync(path.join(process.cwd(), ".data", "bench-"));
const fsType = statfsSync(root).type;
console.log(`claim median append rate >= 5000/s and 8-round replay < 1s`);
console.log(
  `cores ${availableParallelism()} load ${loadavg()
    .map((value) => value.toFixed(2))
    .join(",")} fsType ${fsType}`,
);
console.log(`warmup ${WARMUP} excluded; timed appends ${EVENTS}; rounds ${ROUNDS}`);

const rates: number[] = [];
let errors = 0;
try {
  for (let index = 0; index < ROUNDS; index += 1) {
    const sample = appendRound(root, index);
    if (sample.rows !== EVENTS || sample.wal !== "wal") {
      errors += 1;
    }
    rates.push(sample.rate);
    console.log(
      `round ${index + 1} rate ${sample.rate.toFixed(1)} rows ${sample.rows} seconds ${sample.seconds.toFixed(3)} wal ${sample.wal} synchronous ${sample.synchronous} cpuMicros ${sample.cpuMicros} fsWrite ${sample.fsWrite}`,
    );
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

const rateMedian = median(rates);
const rateMin = Math.min(...rates);
const rateMax = Math.max(...rates);
console.log(
  `append median ${rateMedian.toFixed(1)} min ${rateMin.toFixed(1)} max ${rateMax.toFixed(1)} errors ${errors}`,
);

const replayDb = path.join(process.cwd(), ".data", "u2-replay-bench.sqlite");
rmSync(replayDb, { force: true });
rmSync(`${replayDb}-wal`, { force: true });
rmSync(`${replayDb}-shm`, { force: true });
const loaded = loadScenario("spring");
const drawn = seed(42);
const runId = loggedRunId("spring", drawn, "heuristic-good");
const logged = runLogged({
  dbPath: replayDb,
  runId,
  loaded,
  seed: drawn,
  policy: POLICIES["heuristic-good"],
});
const replaySeconds: number[] = [];
const store = openEventStore(replayDb);
try {
  for (let index = 0; index < REPLAYS; index += 1) {
    const started = process.hrtime.bigint();
    const folded = replay({ store, runId });
    const elapsedNs = process.hrtime.bigint() - started;
    if (folded.finalHash !== logged.finalHash || folded.rounds.length !== 8) {
      errors += 1;
    }
    const seconds = Number(elapsedNs) / 1e9;
    replaySeconds.push(seconds);
    console.log(`replay ${index + 1} seconds ${seconds.toFixed(6)} hash ${folded.finalHash}`);
  }
} finally {
  store.close();
}
const replayMedian = median(replaySeconds);
const replayMin = Math.min(...replaySeconds);
const replayMax = Math.max(...replaySeconds);
console.log(
  `replay median ${replayMedian.toFixed(6)} min ${replayMin.toFixed(6)} max ${replayMax.toFixed(6)} errors ${errors}`,
);
if (errors !== 0) {
  process.exit(1);
}
