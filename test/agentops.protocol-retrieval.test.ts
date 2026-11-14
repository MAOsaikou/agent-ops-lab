import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import {
  BENCHMARK_CASES,
  BENCHMARK_DATASET_HASH,
  validateBenchmarkDataset,
} from "../src/templates/agentops/eval/dataset.js";
import {
  createProductOrchestrator,
  defaultProductOrchestrator,
} from "../src/templates/agentops/orchestrator.js";
import { runAgentWorkflow } from "../src/templates/agentops/runner.js";
import { readMarketPrices } from "../src/templates/simshop/prices.js";
import { memoryAgentRunStore } from "../src/server/agent-runs.js";

const V1_TASK =
  "分析拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。纯棉短袖，券后价 ¥39.90，已拼 10 万+ 件。采购价 16 元，包材 1.5 元，快递 6.5 元，竞品主流价 39.90 元，日单量 50，目标毛利 25%，推广预算 30 元，可周转资金 300 元。";

const V1_FINGERPRINTS = {
  "test-run-v1": "59346b6d7ac56447cd37a72d9b31d00c20318d76005c0b48b72688c00edceaa3",
  "v1-inversion": "e14f14ef6056b3bb90f30f3a7b4574e91081ff6ac05f3320e34d03df090d4b64",
} as const;

const simshopMcpServerPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/templates/simshop/mcp-server.ts",
);

describe("Stage 4: opt-in MCP protocol & retrieval-augmented reasoning on product main path", () => {
  test("default/offline path (protocols & retrieval off) preserves frozen v1 fingerprints and dataset hash", async () => {
    const datasetCheck = validateBenchmarkDataset();
    expect(datasetCheck.valid).toBe(true);
    expect(datasetCheck.hash).toBe(BENCHMARK_DATASET_HASH);

    const v1Run = await defaultProductOrchestrator.start(
      {
        id: "test-run-v1",
        taskText: V1_TASK,
        autoApprove: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      { options: { collaboration: false } },
    );
    expect(v1Run.fingerprint).toBe(V1_FINGERPRINTS["test-run-v1"]);
    expect(v1Run.protocolTraces).toBeUndefined();
    expect(v1Run.protocolErrors).toBeUndefined();
    expect(v1Run.artifacts.citations).toBeUndefined();

    const inversionCase = BENCHMARK_CASES.find((item) => item.id === "conflict-price-inversion");
    expect(inversionCase).toBeDefined();
    const inversionRun = await runAgentWorkflow(
      {
        id: "v1-inversion",
        taskText: inversionCase!.taskText,
        autoApprove: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      null,
      undefined,
      { collaboration: false },
    );
    expect(inversionRun.fingerprint).toBe(V1_FINGERPRINTS["v1-inversion"]);
  });

  test("executes opt-in MCP via createMcpClient on product main path and records real tool.called trace", async () => {
    const store = memoryAgentRunStore();
    const orchestrator = createProductOrchestrator({ store });

    const run = await orchestrator.start(
      {
        id: "stage4-mcp-ok",
        taskText: V1_TASK,
        autoApprove: true,
        createdAt: "2026-11-13T00:00:00.000Z",
      },
      {
        options: {
          protocols: {
            mcp: {
              enabled: true,
              serverName: "simshop-fixture-mcp",
              command: [process.execPath, "--import", "tsx", simshopMcpServerPath],
              timeoutMs: 10_000,
            },
          },
        },
      },
    );

    expect(run.status).toBe("completed");
    expect(run.protocolErrors ?? []).toEqual([]);
    expect(run.protocolTraces).toBeDefined();
    expect(run.protocolTraces).toHaveLength(1);
    expect(run.protocolTraces![0]).toMatchObject({
      protocol: "mcp",
      type: "tool.called",
      serverName: "simshop-fixture-mcp",
      tool: "market.read_prices",
      ok: true,
      result: readMarketPrices(),
    });
    expect(
      run.events.some(
        (ev) => ev.type === "tool.called" && ev.title.includes("mcp.market.read_prices"),
      ),
    ).toBe(true);
    expect(orchestrator.verify("stage4-mcp-ok").kind).toBe("ok");
  }, 20_000);

  test("surfaces MCP failure visibly without silent fake success fallback", async () => {
    const run = await defaultProductOrchestrator.start(
      {
        id: "stage4-mcp-fail",
        taskText: V1_TASK,
        autoApprove: true,
        createdAt: "2026-11-13T00:00:00.000Z",
      },
      {
        options: {
          protocols: {
            mcp: {
              enabled: true,
              serverName: "broken-exit-mcp",
              command: [process.execPath, "-e", "process.exit(1)"],
              timeoutMs: 5_000,
            },
          },
        },
      },
    );

    expect(run.protocolErrors).toBeDefined();
    expect(run.protocolErrors!.length).toBeGreaterThan(0);
    expect(run.protocolErrors![0]).toMatchObject({
      protocol: "mcp",
      source: "broken-exit-mcp",
    });
    expect(run.protocolTraces).toBeDefined();
    expect(
      run.protocolTraces!.some(
        (t) => t.protocol === "mcp" && t.type === "tool.called" && t.ok === false,
      ),
    ).toBe(true);
    expect(
      run.events.some(
        (ev) => ev.type === "tool.called" && ev.title.includes("mcp.market.read_prices") && ev.detail.includes("失败"),
      ),
    ).toBe(true);
  }, 15_000);

  test("surfaces MCP timeout visibly without hanging or fake fallback", async () => {
    const run = await defaultProductOrchestrator.start(
      {
        id: "stage4-mcp-timeout",
        taskText: V1_TASK,
        autoApprove: true,
        createdAt: "2026-11-13T00:00:00.000Z",
      },
      {
        options: {
          protocols: {
            mcp: {
              enabled: true,
              serverName: "hanging-mcp",
              command: [process.execPath, "-e", "setTimeout(() => {}, 10000)"],
              timeoutMs: 120,
            },
          },
        },
      },
    );

    expect(run.protocolErrors).toBeDefined();
    expect(run.protocolErrors!.some((e) => e.protocol === "mcp" && e.code === "timeout")).toBe(true);
    expect(
      run.protocolTraces?.some(
        (t) => t.protocol === "mcp" && t.ok === false && t.timedOut === true,
      ),
    ).toBe(true);
  }, 15_000);

  test("retrieval-augmented reasoning cites retrieved knowledge.search references and avoids inventing citations on empty hits", async () => {
    const withEvidence = await defaultProductOrchestrator.start(
      {
        id: "stage4-rag-hit",
        taskText: V1_TASK,
        autoApprove: true,
        createdAt: "2026-11-13T00:00:00.000Z",
      },
      {
        options: {
          retrieval: {
            enabled: true,
            query: "费率 结算",
            platform: "pdd",
          },
        },
      },
    );

    expect(withEvidence.artifacts.citations).toBeDefined();
    expect(withEvidence.artifacts.citations!.length).toBeGreaterThan(0);
    expect(withEvidence.artifacts.citations![0]).toMatchObject({
      refId: expect.stringMatching(/^kb-/),
      source: "knowledge.search",
    });
    expect(
      withEvidence.artifacts.report.some((line) => line.includes(withEvidence.artifacts.citations![0]!.refId)),
    ).toBe(true);

    const emptyRetrieval = await defaultProductOrchestrator.start(
      {
        id: "stage4-rag-empty",
        taskText: V1_TASK,
        autoApprove: true,
        createdAt: "2026-11-13T00:00:00.000Z",
      },
      {
        options: {
          retrieval: {
            enabled: true,
            query: "量子力学_不存在词条_99999",
            platform: "pdd",
          },
        },
      },
    );

    expect(emptyRetrieval.artifacts.citations).toEqual([]);
    expect(
      emptyRetrieval.artifacts.report.some((line) => line.includes("kb-")),
    ).toBe(false);
  });

  test("surfaces retrieval failure or timeout visibly without fabricating citations", async () => {
    const run = await defaultProductOrchestrator.start(
      {
        id: "stage4-rag-timeout",
        taskText: V1_TASK,
        autoApprove: true,
        createdAt: "2026-11-13T00:00:00.000Z",
      },
      {
        options: {
          retrieval: {
            enabled: true,
            query: "费率",
            timeoutMs: 50,
            retriever: () => new Promise((resolve) => setTimeout(() => resolve([]), 500)),
          },
        },
      },
    );

    expect(run.artifacts.citations).toEqual([]);
    expect(run.protocolErrors?.some((e) => e.protocol === "retrieval" && e.code === "timeout")).toBe(true);
  });
});
