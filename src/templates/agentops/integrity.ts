import { sha256Hex } from "../../engine/hash.js";
import { canonicalJson } from "../../engine/json.js";
import type { AgentRun } from "./types.js";

const ZERO_HASH = "0".repeat(64);

export type RunIntegrity = {
  /** Every event hash recomputes and links to the previous one, starting at the zero hash. */
  readonly chainOk: boolean;
  /** `fingerprint` equals sha256 of the run's own embedded { workflow, events, artifacts }. */
  readonly fingerprintOk: boolean;
  readonly firstBrokenSeq: number | null;
};

/**
 * Recomputes the proofs from the run's *embedded* workflow/events/artifacts, so legacy runs
 * are verified under the rules they were sealed with (never against today's workflow).
 */
export function verifyRunIntegrity(run: AgentRun): RunIntegrity {
  let previous = ZERO_HASH;
  let firstBrokenSeq: number | null = null;
  for (const event of run.events) {
    const expected = sha256Hex(canonicalJson({ version: 1, prevHash: previous, seq: event.seq, type: event.type, detail: event.detail }));
    if (event.prevHash !== previous || event.hash !== expected) {
      firstBrokenSeq = event.seq;
      break;
    }
    previous = event.hash;
  }
  const fingerprint = sha256Hex(canonicalJson({ workflow: run.workflow, events: run.events, artifacts: run.artifacts }));
  return { chainOk: firstBrokenSeq === null, fingerprintOk: fingerprint === run.fingerprint, firstBrokenSeq };
}
