import { foldEvents, type FoldedRun } from "./events/fold.js";
import type { EventStore } from "./events/store.js";
import type { RunId } from "./ids.js";

export function replay(input: { store: EventStore; runId: RunId }): FoldedRun {
  return foldEvents(input.store.list(input.runId));
}
