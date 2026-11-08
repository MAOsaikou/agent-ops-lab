import { expect, test } from "vitest";
import { parseRunId } from "../src/engine/ids.js";
import type { LlmFetch } from "../src/engine/llm/openai-compatible.js";
import { createOpenAiCompatibleLlm } from "../src/engine/llm/openai-compatible.js";
import { promptHash } from "../src/engine/llm/hash.js";
import { createMockLlm } from "../src/engine/llm/mock.js";
import { resolveMode } from "../src/engine/llm/mode.js";

test("mock completions are a function of the prompt hash and record calls", async () => {
  const llm = createMockLlm();
  const request = {
    runId: parseRunId("run-a"),
    round: 1,
    nodeId: "pricer",
    attempt: 0,
    prompt: "same",
    maxTokens: 8,
  };
  const first = await llm.complete(request);
  const second = await llm.complete({ ...request, prompt: "same" });
  const third = await llm.complete({ ...request, prompt: "other" });
  expect(first.text).toBe(promptHash("same"));
  expect(second.text).toBe(first.text);
  expect(third.text).not.toBe(first.text);
  expect(first.usage).toEqual({ promptTokens: 10, completionTokens: 10 });
  expect(llm.calls).toHaveLength(3);
  expect(llm.calls[2]?.prompt).toBe("other");
});

test("resolveMode picks mock, cassette, or live without reading a key", () => {
  expect(resolveMode({ hasApiKey: false })).toBe("mock");
  expect(resolveMode({ hasApiKey: false, cassettePath: "tape.json" })).toBe("cassette");
  expect(resolveMode({ hasApiKey: true, cassettePath: "tape.json" })).toBe("cassette");
  expect(resolveMode({ hasApiKey: true })).toBe("live");
  expect(resolveMode({ hasApiKey: true, cassettePath: "" })).toBe("live");
});

test("the openai-compatible adapter uses the injected fetch", async () => {
  const seen: { url: string; authorization: string; body: string }[] = [];
  const fetchImpl: LlmFetch = async (url, init) => {
    seen.push({ url, authorization: init.headers.authorization, body: init.body });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "priced" } }],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      }),
    };
  };
  const llm = createOpenAiCompatibleLlm({
    fetch: fetchImpl,
    baseUrl: "http://127.0.0.1:9/v1/",
    apiKey: "test-key",
    model: "fixture",
  });
  const completion = await llm.complete({
    runId: parseRunId("run-a"),
    round: 2,
    nodeId: "pricer",
    attempt: 1,
    prompt: "price tea",
    maxTokens: 16,
  });
  expect(completion).toEqual({
    text: "priced",
    usage: { promptTokens: 3, completionTokens: 4 },
  });
  expect(seen).toHaveLength(1);
  expect(seen[0]?.url).toBe("http://127.0.0.1:9/v1/chat/completions");
  expect(seen[0]?.authorization).toBe("Bearer test-key");
  expect(seen[0]?.body).toContain("price tea");
});

test("a non-ok openai-compatible response throws before parsing a completion", async () => {
  const fetchImpl: LlmFetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ choices: [] }),
  });
  const llm = createOpenAiCompatibleLlm({
    fetch: fetchImpl,
    baseUrl: "http://127.0.0.1:9/v1",
    apiKey: "test-key",
    model: "fixture",
  });
  await expect(
    llm.complete({
      runId: parseRunId("run-a"),
      round: 1,
      nodeId: "pricer",
      attempt: 0,
      prompt: "price tea",
      maxTokens: 16,
    }),
  ).rejects.toThrow(/401/);
});
