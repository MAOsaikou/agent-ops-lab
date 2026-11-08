import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { LlmClient, LlmCompletion, LlmRequest } from "./client.js";
import { promptHash } from "./hash.js";

const completionSchema = z.object({
  text: z.string(),
  usage: z.object({
    promptTokens: z.number(),
    completionTokens: z.number(),
  }),
});

const cassetteFileSchema = z.object({
  entries: z.record(z.string(), z.string()),
});

export class CassetteMissError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`cassette miss: ${key}`);
    this.name = "CassetteMissError";
    this.key = key;
  }
}

export type CassetteMode = "record" | "replay";

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

function encodeCompletion(completion: LlmCompletion): string {
  return JSON.stringify({
    text: completion.text,
    usage: {
      promptTokens: completion.usage.promptTokens,
      completionTokens: completion.usage.completionTokens,
    },
  });
}

function decodeCompletion(bytes: string): LlmCompletion {
  return completionSchema.parse(parseJson(bytes));
}

function loadEntries(path: string): Map<string, string> {
  if (!existsSync(path)) return new Map();
  const parsed = cassetteFileSchema.parse(parseJson(readFileSync(path, "utf8")));
  return new Map(Object.entries(parsed.entries));
}

function saveEntries(path: string, entries: Map<string, string>): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ entries: Object.fromEntries(entries) }));
  renameSync(tmp, path);
}

export function cassetteKey(request: LlmRequest): string {
  if (request.nodeId.includes("|")) {
    throw new Error("nodeId cannot contain |");
  }
  if (!Number.isInteger(request.round) || !Number.isInteger(request.attempt)) {
    throw new Error("round and attempt must be integers");
  }
  return `${request.runId}|${request.round}|${request.nodeId}|${request.attempt}|${promptHash(request.prompt)}`;
}

export function createCassetteLlm(options: {
  path: string;
  mode: CassetteMode;
  inner?: LlmClient;
}): LlmClient {
  const entries = loadEntries(options.path);
  return {
    async complete(request) {
      const key = cassetteKey(request);
      switch (options.mode) {
        case "replay": {
          const hit = entries.get(key);
          if (hit === undefined) throw new CassetteMissError(key);
          return decodeCompletion(hit);
        }
        case "record": {
          const inner = options.inner;
          if (inner === undefined) {
            throw new Error("cassette record mode needs an inner client");
          }
          const completion = await inner.complete(request);
          const bytes = encodeCompletion(completion);
          entries.set(key, bytes);
          saveEntries(options.path, entries);
          return decodeCompletion(bytes);
        }
        default: {
          const _exhaustive: never = options.mode;
          return _exhaustive;
        }
      }
    },
  };
}
