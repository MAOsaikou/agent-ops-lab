import { rmSync } from "node:fs";

import { sha256Hex } from "../src/engine/hash.js";
import { openEventStore } from "../src/engine/events/store.js";
import { parseRunId } from "../src/engine/ids.js";
import {
  RoundAlreadyCommitted,
  commitDecision,
  settleRound,
} from "../src/engine/round/commit.js";

const dbPath = ".data/u2-reject.sqlite";
rmSync(dbPath, { force: true });
rmSync(`${dbPath}-wal`, { force: true });
rmSync(`${dbPath}-shm`, { force: true });

const store = openEventStore(dbPath);
const runId = parseRunId("reject-round-2");
const round = 1;
const decisionHash = sha256Hex("first-decision");
const otherHash = sha256Hex("other-decision");
const observationHash = sha256Hex("observation");

try {
  commitDecision({
    store,
    runId,
    round,
    decisionHash,
    payload: { observationHash, body: { choice: 1 } },
  });
  settleRound({
    store,
    runId,
    round,
    decisionHash,
    produce: () => ({ settled: true }),
  });
  const before = store.count(runId);
  try {
    commitDecision({
      store,
      runId,
      round,
      decisionHash: otherHash,
      payload: { observationHash, body: { choice: 2 } },
    });
    console.error("expected RoundAlreadyCommitted");
    process.exit(1);
  } catch (error) {
    if (!(error instanceof RoundAlreadyCommitted)) {
      throw error;
    }
    const after = store.count(runId);
    console.log(error.name);
    console.log(`rows before ${before}`);
    console.log(`rows after ${after}`);
    if (after !== before) {
      console.error("row count changed");
      process.exit(1);
    }
  }
} finally {
  store.close();
}
