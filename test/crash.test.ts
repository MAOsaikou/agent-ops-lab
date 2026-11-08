import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { sha256Hex } from "../src/engine/hash.js";
import { canonicalJson } from "../src/engine/json.js";
import { openEventStore } from "../src/engine/events/store.js";
import { replay } from "../src/engine/replay.js";
import { snapshot } from "../src/engine/snapshot.js";
import { parseRunId } from "../src/engine/ids.js";
import {
  commitDecision,
  reflectRound,
  settleRound,
} from "../src/engine/round/commit.js";
import { outcomeCanonical } from "../src/templates/simshop/market/ledger.js";
import { runMarket } from "../src/templates/simshop/market/run.js";
import { loadScenario } from "../src/templates/simshop/market/scenario.js";
import { seed } from "../src/templates/simshop/market/brand.js";
import { POLICIES } from "../src/templates/simshop/policies/heuristic.js";
import { HaltedRun, runLogged } from "../src/templates/simshop/logged-run.js";
import { expect, test } from "vitest";

function tempDb(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "u2-crash-")), "events.sqlite");
}

const loaded = loadScenario("spring");
const drawn = seed(42);
const policy = POLICIES["heuristic-good"];
const runId = parseRunId("spring-s42-heuristic-good");

function checkpoint(round: number, kind: "commit" | "settle" | "reflect"): number {
  switch (kind) {
    case "commit":
      return round * 3;
    case "settle":
      return round * 3 + 1;
    case "reflect":
      return round * 3 + 2;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

test("reopen after a commit calls produce once", () => {
  const dbPath = tempDb();
  const id = parseRunId("reopen-settle");
  const decisionHash = sha256Hex("decision");
  const observationHash = sha256Hex("observation");
  const first = openEventStore(dbPath);
  commitDecision({
    store: first,
    runId: id,
    round: 3,
    decisionHash,
    payload: { observationHash, body: { n: 1 } },
  });
  first.close();
  const second = openEventStore(dbPath);
  let calls = 0;
  const settled = settleRound({
    store: second,
    runId: id,
    round: 3,
    decisionHash,
    produce() {
      calls += 1;
      return { profit: 4 };
    },
  });
  settleRound({
    store: second,
    runId: id,
    round: 3,
    decisionHash,
    produce() {
      calls += 1;
      return { profit: 9 };
    },
  });
  expect(calls).toBe(1);
  expect(settled.outcomeJson).toBe(canonicalJson({ profit: 4 }));
  expect(second.list(id).filter((event) => event.type === "RoundSettled")).toHaveLength(1);
  second.close();
});

test("reopen after a settlement calls the writer once", () => {
  const dbPath = tempDb();
  const id = parseRunId("reopen-reflect");
  const decisionHash = sha256Hex("decision");
  const first = openEventStore(dbPath);
  commitDecision({
    store: first,
    runId: id,
    round: 3,
    decisionHash,
    payload: { observationHash: sha256Hex("observation"), body: { n: 1 } },
  });
  settleRound({
    store: first,
    runId: id,
    round: 3,
    decisionHash,
    produce: () => ({ profit: 4 }),
  });
  first.close();
  const second = openEventStore(dbPath);
  let writes = 0;
  const beliefHash = sha256Hex("belief");
  const overlayHash = sha256Hex("overlay");
  reflectRound({
    store: second,
    runId: id,
    round: 3,
    write() {
      writes += 1;
      return { beliefHash, overlayHash };
    },
  });
  reflectRound({
    store: second,
    runId: id,
    round: 3,
    write() {
      writes += 1;
      return { beliefHash, overlayHash };
    },
  });
  expect(writes).toBe(1);
  expect(second.list(id).filter((event) => event.type === "RoundReflected")).toHaveLength(1);
  const folded = replay({ store: second, runId: id });
  expect(folded.rounds).toHaveLength(1);
  expect(folded.finalHash).toBe(folded.rounds[0]?.hash);
  second.close();
});

test("a logged spring run matches the market and replays to the same hash", () => {
  const dbPath = tempDb();
  const logged = runLogged({ dbPath, runId, loaded, seed: drawn, policy });
  const direct = runMarket({ loaded, seed: drawn, policy });
  expect(logged.rounds).toBe(8);
  expect(logged.appends).toBe(24);
  const again = runLogged({
    dbPath: tempDb(),
    runId,
    loaded,
    seed: drawn,
    policy,
  });
  expect(again.finalHash).toBe(logged.finalHash);
  const store = openEventStore(dbPath);
  const folded = replay({ store, runId });
  expect(folded.finalHash).toBe(logged.finalHash);
  expect(folded.rounds).toHaveLength(direct.ledger.length);
  for (let index = 0; index < direct.ledger.length; index += 1) {
    const round = folded.rounds[index];
    const outcome = direct.ledger[index];
    if (round === undefined || outcome === undefined) {
      throw new Error(`missing round ${index}`);
    }
    expect(round.outcomeJson).toBe(canonicalJson(outcomeCanonical(outcome)));
    expect(round.round).toBe(index);
  }
  const full = snapshot({ store, runId });
  expect(full.lastSeq).toBe(24);
  expect(full.finalHash).toBe(logged.finalHash);
  const prefix = snapshot({ store, runId, throughSeq: 23 });
  expect(prefix.lastSeq).toBe(23);
  expect(prefix.rounds).toHaveLength(7);
  expect(prefix.finalHash).not.toBe(full.finalHash);
  store.close();
});

test("every append checkpoint, including commit without settle and settle without reflect, resumes", () => {
  const clean = runLogged({
    dbPath: tempDb(),
    runId,
    loaded,
    seed: drawn,
    policy,
  });
  const settleCut = checkpoint(3, "settle");
  const reflectCut = checkpoint(3, "reflect");
  for (let index = 0; index < clean.appends; index += 1) {
    const dbPath = tempDb();
    expect(() =>
      runLogged({
        dbPath,
        runId,
        loaded,
        seed: drawn,
        policy,
        haltBeforeAppend: index,
      }),
    ).toThrow(HaltedRun);
    const store = openEventStore(dbPath);
    const events = store.list(runId);
    expect(events, `checkpoint ${index}`).toHaveLength(index);
    if (index === settleCut) {
      expect(events.at(-1)?.type).toBe("DecisionCommitted");
      expect(events.filter((event) => event.type === "RoundSettled")).toHaveLength(3);
    }
    if (index === reflectCut) {
      expect(events.at(-1)?.type).toBe("RoundSettled");
      expect(events.filter((event) => event.type === "RoundSettled")).toHaveLength(4);
      expect(events.filter((event) => event.type === "RoundReflected")).toHaveLength(3);
    }
    store.close();
    const resumed = runLogged({ dbPath, runId, loaded, seed: drawn, policy });
    expect(resumed.finalHash, `checkpoint ${index}`).toBe(clean.finalHash);
  }
});
