import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { parseRunId } from "../src/engine/ids.js";
import { CassetteMissError, createCassetteLlm } from "../src/engine/llm/cassette.js";
import type { LlmClient, LlmRequest } from "../src/engine/llm/client.js";
import { promptHash } from "../src/engine/llm/hash.js";
import { createMockLlm } from "../src/engine/llm/mock.js";

const fileSchema = z.object({
  entries: z.record(z.string(), z.string()),
});

const dirs: string[] = [];

function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "u3-cassette-"));
  dirs.push(dir);
  return join(dir, "tape.json");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function request(input: { nodeId: string; prompt: string; attempt?: number }): LlmRequest {
  return {
    runId: parseRunId("run-a"),
    round: 3,
    nodeId: input.nodeId,
    attempt: input.attempt ?? 0,
    prompt: input.prompt,
    maxTokens: 32,
  };
}

function storedBytes(path: string, key: string): string {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const parsed = fileSchema.parse(raw);
  const bytes = parsed.entries[key];
  if (bytes === undefined) throw new Error(`missing cassette key ${key}`);
  return bytes;
}

function completionBytes(text: string): string {
  return JSON.stringify({
    text,
    usage: { promptTokens: 10, completionTokens: 10 },
  });
}

test("record then replay is byte-identical, including a new instance", async () => {
  const path = tempPath();
  const prompt = "price the tea";
  const req = request({ nodeId: "pricer", prompt });
  const key = `${req.runId}|${req.round}|${req.nodeId}|${req.attempt}|${promptHash(prompt)}`;
  const recorder = createCassetteLlm({ path, mode: "record", inner: createMockLlm() });
  const recorded = await recorder.complete(req);
  expect(recorded.text).toBe(promptHash(prompt));
  expect(recorded.usage).toEqual({ promptTokens: 10, completionTokens: 10 });
  const bytes = storedBytes(path, key);
  expect(bytes).toBe(completionBytes(recorded.text));

  const replay = createCassetteLlm({ path, mode: "replay" });
  const first = await replay.complete(req);
  expect(completionBytes(first.text)).toBe(bytes);
  expect(first.usage).toEqual(recorded.usage);

  const restarted = createCassetteLlm({ path, mode: "replay" });
  const second = await restarted.complete(req);
  expect(completionBytes(second.text)).toBe(bytes);
});

test("a missing cassette key throws and does not call through", async () => {
  const path = tempPath();
  const recordedReq = request({ nodeId: "pricer", prompt: "recorded" });
  await createCassetteLlm({ path, mode: "record", inner: createMockLlm() }).complete(recordedReq);
  let calls = 0;
  const inner: LlmClient = {
    async complete() {
      calls += 1;
      return { text: "live", usage: { promptTokens: 1, completionTokens: 1 } };
    },
  };
  const missing = request({ nodeId: "pricer", prompt: "not recorded" });
  const player = createCassetteLlm({ path, mode: "replay", inner });
  const key = `${missing.runId}|${missing.round}|${missing.nodeId}|${missing.attempt}|${promptHash(missing.prompt)}`;
  await expect(player.complete(missing)).rejects.toBeInstanceOf(CassetteMissError);
  await expect(player.complete(missing)).rejects.toMatchObject({ key });
  expect(calls).toBe(0);
});

test("cassette keys do not depend on record order", async () => {
  const path = tempPath();
  const reqA = request({ nodeId: "node-a", prompt: "prompt a" });
  const reqB = request({ nodeId: "node-b", prompt: "prompt b" });
  const recorder = createCassetteLlm({ path, mode: "record", inner: createMockLlm() });
  const recordedB = await recorder.complete(reqB);
  const recordedA = await recorder.complete(reqA);
  const keyA = `${reqA.runId}|${reqA.round}|${reqA.nodeId}|${reqA.attempt}|${promptHash(reqA.prompt)}`;
  const keyB = `${reqB.runId}|${reqB.round}|${reqB.nodeId}|${reqB.attempt}|${promptHash(reqB.prompt)}`;
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const keys = Object.keys(fileSchema.parse(raw).entries);
  expect(keys).toContain(keyA);
  expect(keys).toContain(keyB);

  const player = createCassetteLlm({ path, mode: "replay" });
  const first = await player.complete(reqA);
  const second = await player.complete(reqB);
  expect(first.text).toBe(recordedA.text);
  expect(second.text).toBe(recordedB.text);
  expect(first.text).not.toBe(second.text);
  expect(completionBytes(first.text)).toBe(storedBytes(path, keyA));
  expect(completionBytes(second.text)).toBe(storedBytes(path, keyB));
});
