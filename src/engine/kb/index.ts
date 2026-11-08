import type { RunId } from "../ids.js";

export type KbDocument = {
  readonly id: string;
  readonly text: string;
};

export type KbHit = {
  readonly id: string;
  readonly text: string;
};

const BM25_K1 = 1.2;
const BM25_B = 0.75;

type IndexedDoc = {
  id: string;
  text: string;
  terms: Map<string, number>;
  length: number;
};

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 0);
}

function indexDocument(doc: KbDocument): IndexedDoc {
  const tokens = tokenize(doc.text);
  const terms = new Map<string, number>();
  for (const token of tokens) {
    terms.set(token, (terms.get(token) ?? 0) + 1);
  }
  return { id: doc.id, text: doc.text, terms, length: tokens.length };
}

function rank(docs: readonly KbDocument[], query: string): KbHit[] {
  const indexed = docs.map(indexDocument);
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0 || indexed.length === 0) return [];
  const totalLength = indexed.reduce((sum, doc) => sum + doc.length, 0);
  const avgdl = totalLength / indexed.length;
  const scores = new Map<string, number>();
  for (const term of queryTerms) {
    let documentFrequency = 0;
    for (const doc of indexed) {
      if ((doc.terms.get(term) ?? 0) > 0) documentFrequency += 1;
    }
    const idf = Math.log(
      (indexed.length - documentFrequency + 0.5) / (documentFrequency + 0.5) + 1,
    );
    for (const doc of indexed) {
      const frequency = doc.terms.get(term) ?? 0;
      if (frequency === 0) continue;
      const lengthRatio = avgdl === 0 ? 0 : doc.length / avgdl;
      const denominator = frequency + BM25_K1 * (1 - BM25_B + BM25_B * lengthRatio);
      const increment = idf * ((frequency * (BM25_K1 + 1)) / denominator);
      scores.set(doc.id, (scores.get(doc.id) ?? 0) + increment);
    }
  }
  return indexed
    .filter((doc) => (scores.get(doc.id) ?? 0) > 0)
    .sort((left, right) => {
      const delta = (scores.get(right.id) ?? 0) - (scores.get(left.id) ?? 0);
      if (delta !== 0) return delta;
      if (left.id < right.id) return -1;
      if (left.id > right.id) return 1;
      return 0;
    })
    .map((doc) => ({ id: doc.id, text: doc.text }));
}

function copyDoc(doc: KbDocument): KbDocument {
  if (doc.id.length === 0 || doc.id.trim() !== doc.id) {
    throw new Error("document id must be a non-empty string");
  }
  return { id: doc.id, text: doc.text };
}

export type KnowledgeBase = {
  beginRun(runId: RunId): void;
  put(runId: RunId, doc: KbDocument): void;
  search(runId: RunId, query: string): KbHit[];
};

export function createKnowledgeBase(base: readonly KbDocument[]): KnowledgeBase {
  const corpus: KbDocument[] = [];
  const seen = new Set<string>();
  for (const doc of base) {
    const copied = copyDoc(doc);
    if (seen.has(copied.id)) throw new Error(`duplicate base document: ${copied.id}`);
    seen.add(copied.id);
    corpus.push(copied);
  }
  const overlays = new Map<RunId, KbDocument[]>();

  function overlayFor(runId: RunId): KbDocument[] {
    const overlay = overlays.get(runId);
    if (overlay === undefined) throw new Error(`run has no overlay: ${runId}`);
    return overlay;
  }

  return {
    beginRun(runId) {
      if (!overlays.has(runId)) overlays.set(runId, []);
    },

    put(runId, doc) {
      const overlay = overlayFor(runId);
      const copied = copyDoc(doc);
      if (seen.has(copied.id) || overlay.some((item) => item.id === copied.id)) {
        throw new Error(`document already stored: ${copied.id}`);
      }
      overlay.push(copied);
    },

    search(runId, query) {
      const overlay = overlayFor(runId);
      return rank([...corpus, ...overlay], query);
    },
  };
}
