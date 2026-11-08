import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseRunId } from "../src/engine/ids.js";
import { createCassetteLlm } from "../src/engine/llm/cassette.js";
import type { LlmCompletion, LlmRequest } from "../src/engine/llm/client.js";
import { promptHash } from "../src/engine/llm/hash.js";
import { createMockLlm } from "../src/engine/llm/mock.js";
import { createMcpClient, type Command } from "../src/engine/tools/mcp-client.js";
import { readMarketPrices } from "../src/templates/simshop/prices.js";

function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  const value = sorted[index];
  if (value === undefined) throw new Error("empty samples");
  return value;
}

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid] : undefined;
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  if (value !== undefined) return value;
  if (lower === undefined || upper === undefined) throw new Error("empty samples");
  return (lower + upper) / 2;
}

const request: LlmRequest = {
  runId: parseRunId("bench"),
  round: 1,
  nodeId: "bench",
  attempt: 0,
  prompt: "replay me",
  maxTokens: 16,
};

function sameCompletion(left: LlmCompletion, right: LlmCompletion): boolean {
  return (
    left.text === right.text &&
    left.usage.promptTokens === right.usage.promptTokens &&
    left.usage.completionTokens === right.usage.completionTokens
  );
}

const dir = mkdtempSync(path.join(tmpdir(), "u3-bench-"));
const tape = path.join(dir, "tape.json");
try {
  const recorded = await createCassetteLlm({
    path: tape,
    mode: "record",
    inner: createMockLlm(),
  }).complete(request);
  const player = createCassetteLlm({ path: tape, mode: "replay" });
  for (let warm = 0; warm < 50; warm += 1) {
    const completion = await player.complete(request);
    if (!sameCompletion(completion, recorded)) throw new Error("warmup mismatch");
  }

  const rounds = 5;
  const calls = 1000;
  const p95s: number[] = [];
  for (let round = 0; round < rounds; round += 1) {
    const samples: number[] = [];
    let errors = 0;
    for (let call = 0; call < calls; call += 1) {
      const start = performance.now();
      const completion = await player.complete(request);
      samples.push(performance.now() - start);
      if (!sameCompletion(completion, recorded)) errors += 1;
    }
    if (errors !== 0) throw new Error(`cassette replay mismatches: ${errors}`);
    p95s.push(percentile(samples, 95));
  }
  const hashSamples: number[] = [];
  for (let call = 0; call < calls; call += 1) {
    const start = performance.now();
    const hash = promptHash(request.prompt);
    hashSamples.push(performance.now() - start);
    if (hash.length !== 64) throw new Error("prompt hash length");
  }
  const low = Math.min(...p95s);
  const high = Math.max(...p95s);
  console.log(
    `prompt hash calls=${calls} p95_ms=${percentile(hashSamples, 95).toFixed(4)}`,
  );
  console.log(
    `cassette replay calls=${calls} rounds=${rounds} p95_ms=${p95s.map((value) => value.toFixed(4)).join(",")} median_p95_ms=${median(p95s).toFixed(4)} min_p95_ms=${low.toFixed(4)} max_p95_ms=${high.toFixed(4)} errors=0`,
  );

  const serverPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/templates/simshop/mcp-server.ts",
  );
  const command: Command = [process.execPath, "--import", "tsx", serverPath];
  const client = createMcpClient({ command: () => command });
  const inproc = readMarketPrices();
  try {
    const first = await client.call("market.read_prices");
    if (!("tea" in first) || first.tea !== inproc.tea || first.snack !== inproc.snack) {
      throw new Error("mcp bench warmup mismatch");
    }
    const mcpP95: number[] = [];
    const localP95: number[] = [];
    for (let round = 0; round < rounds; round += 1) {
      const mcpSamples: number[] = [];
      const localSamples: number[] = [];
      let errors = 0;
      for (let call = 0; call < calls; call += 1) {
        const localStart = performance.now();
        const local = readMarketPrices();
        localSamples.push(performance.now() - localStart);
        const mcpStart = performance.now();
        const remote = await client.call("market.read_prices");
        mcpSamples.push(performance.now() - mcpStart);
        if (!("tea" in remote) || remote.tea !== local.tea || remote.snack !== local.snack) errors += 1;
      }
      if (errors !== 0) throw new Error(`mcp bench mismatches: ${errors}`);
      mcpP95.push(percentile(mcpSamples, 95));
      localP95.push(percentile(localSamples, 95));
    }
    const mcpMedian = median(mcpP95);
    const localMedian = median(localP95);
    console.log(
      `mcp extra p95_ms=${(mcpMedian - localMedian).toFixed(4)} mcp_p95_ms=${mcpP95.map((value) => value.toFixed(4)).join(",")} inproc_p95_ms=${localP95.map((value) => value.toFixed(4)).join(",")} calls=${calls} rounds=${rounds} errors=0`,
    );
  } finally {
    await client.close();
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
