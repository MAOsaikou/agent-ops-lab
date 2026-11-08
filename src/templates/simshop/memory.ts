import type { RunId } from "../../engine/ids.js";
import { createKnowledgeBase, type KbHit, type KnowledgeBase } from "../../engine/kb/index.js";

const ROUND_PREFIX = "round-";

export type RoundNote = {
  readonly id: string;
  readonly text: string;
  readonly round: number;
};

function noteRound(id: string): number | null {
  if (!id.startsWith(ROUND_PREFIX)) return null;
  const rest = id.slice(ROUND_PREFIX.length);
  const dash = rest.indexOf("-");
  if (dash <= 0) return null;
  const round = Number(rest.slice(0, dash));
  if (!Number.isInteger(round) || round < 0) return null;
  return round;
}

export function roundNoteId(round: number, slug: string): string {
  return `${ROUND_PREFIX}${String(round)}-${slug}`;
}

export type RoundMemory = {
  beginRun(runId: RunId): void;
  write(runId: RunId, note: RoundNote): void;
  search(input: { readonly runId: RunId; readonly round: number; readonly query: string }): KbHit[];
  overlayIds(runId: RunId): readonly string[];
};

export function createRoundMemory(base: KnowledgeBase = createKnowledgeBase([])): RoundMemory {
  const rounds = new Map<string, number>();
  const ids = new Map<RunId, string[]>();

  return {
    beginRun(runId) {
      base.beginRun(runId);
      if (!ids.has(runId)) ids.set(runId, []);
    },

    write(runId, note) {
      const stamped = noteRound(note.id);
      if (stamped !== note.round) {
        throw new Error("note id must carry its round");
      }
      base.put(runId, { id: note.id, text: note.text });
      rounds.set(`${runId}:${note.id}`, note.round);
      const list = ids.get(runId);
      if (list === undefined) throw new Error(`run has no overlay: ${runId}`);
      list.push(note.id);
    },

    search(input) {
      return base.search(input.runId, input.query).filter((hit) => {
        const round = rounds.get(`${input.runId}:${hit.id}`) ?? noteRound(hit.id);
        if (round === null) return true;
        return round < input.round;
      });
    },

    overlayIds(runId) {
      return [...(ids.get(runId) ?? [])];
    },
  };
}
