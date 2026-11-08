import { foldEvents } from "./events/fold.js";
import type { EventStore } from "./events/store.js";
import type { RunId } from "./ids.js";
import type { Hash, RoundRecord } from "./types.js";

export type Snapshot = {
  readonly runId: RunId;
  readonly lastSeq: number;
  readonly finalHash: Hash;
  readonly rounds: readonly RoundRecord[];
};

export function snapshot(input: {
  store: EventStore;
  runId: RunId;
  throughSeq?: number;
}): Snapshot {
  const events = input.store.list(input.runId);
  const throughSeq = input.throughSeq;
  const prefix =
    throughSeq === undefined ? events : events.filter((event) => event.seq <= throughSeq);
  const folded = foldEvents(prefix);
  return {
    runId: input.runId,
    lastSeq: folded.lastSeq,
    finalHash: folded.finalHash,
    rounds: folded.rounds,
  };
}
