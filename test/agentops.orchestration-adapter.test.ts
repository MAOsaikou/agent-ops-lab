import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { openEventStore } from "../src/engine/events/store.js";
import { parseRunId } from "../src/engine/ids.js";
import { replay } from "../src/engine/replay.js";
import { memoryAgentRunStore } from "../src/server/agent-runs.js";
import { BENCHMARK_CASES } from "../src/templates/agentops/eval/dataset.js";
import {
  createProductOrchestrator,
  defaultProductOrchestrator,
  verifyProductRun,
} from "../src/templates/agentops/orchestrator.js";
import { runAgentWorkflow } from "../src/templates/agentops/runner.js";
import { runMeeting } from "../src/templates/meeting/workflow.js";

const V1_TASK =
  "分析拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。纯棉短袖，券后价 ¥39.90，已拼 10 万+ 件。采购价 16 元，包材 1.5 元，快递 6.5 元，竞品主流价 39.90 元，日单量 50，目标毛利 25%，推广预算 30 元，可周转资金 300 元。";

const V1_FINGERPRINTS = {
  "test-run-v1": "59346b6d7ac56447cd37a72d9b31d00c20318d76005c0b48b72688c00edceaa3",
  "v1-inversion": "e14f14ef6056b3bb90f30f3a7b4574e91081ff6ac05f3320e34d03df090d4b64",
} as const;

describe("AgentOps orchestration adapter and legacy coexistence", () => {
  test("product orchestrator preserves frozen collaboration:false v1 fingerprints", async () => {
    const v1Run = await defaultProductOrchestrator.start(
      { id: "test-run-v1", taskText: V1_TASK, autoApprove: true, createdAt: "2026-01-01T00:00:00.000Z" },
      { options: { collaboration: false } },
    );
    expect(v1Run.fingerprint).toBe(V1_FINGERPRINTS["test-run-v1"]);

    const directV1 = await runAgentWorkflow(
      { id: "test-run-v1", taskText: V1_TASK, autoApprove: true, createdAt: "2026-01-01T00:00:00.000Z" },
      null,
      undefined,
      { collaboration: false },
    );
    expect(v1Run).toEqual(directV1);

    const inversionCase = BENCHMARK_CASES.find((item) => item.id === "conflict-price-inversion");
    expect(inversionCase).toBeDefined();
    const inversionRun = await defaultProductOrchestrator.start(
      {
        id: "v1-inversion",
        taskText: inversionCase!.taskText,
        autoApprove: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      { options: { collaboration: false } },
    );
    expect(inversionRun.fingerprint).toBe(V1_FINGERPRINTS["v1-inversion"]);
  });

  test("orchestrator manages start -> pause -> persist -> resume -> verify lifecycle and idempotency", async () => {
    const store = memoryAgentRunStore();
    const orchestrator = createProductOrchestrator({ store });

    const paused = await orchestrator.start(
      { id: "orch-pause-1", taskText: V1_TASK, autoApprove: false, createdAt: "2026-11-12T00:00:00.000Z" },
      { options: { strictEvidence: true } },
    );
    expect(paused.status).toBe("awaiting-approval");
    expect(orchestrator.inspect("orch-pause-1")).toMatchObject({ kind: "ok" });

    const verifiedPaused = orchestrator.verify("orch-pause-1");
    expect(verifiedPaused).toMatchObject({
      kind: "ok",
      integrity: { chainOk: true, fingerprintOk: true, firstBrokenSeq: null },
    });

    const resumed = await orchestrator.resume("orch-pause-1", { action: "approve", candidateId: "profit" });
    expect(resumed.status).toBe("completed");
    expect(resumed.decidedCandidateId).toBe("profit");

    const idempotent = await orchestrator.resume("orch-pause-1", { action: "approve", candidateId: "profit" });
    expect(idempotent.fingerprint).toBe(resumed.fingerprint);
    expect(idempotent.events).toHaveLength(resumed.events.length);

    const verifiedCompleted = orchestrator.verify("orch-pause-1");
    expect(verifiedCompleted).toMatchObject({
      kind: "ok",
      integrity: { chainOk: true, fingerprintOk: true, firstBrokenSeq: null },
    });
  });

  test("verify detects tampered run events or fingerprint without modifying stored bytes", async () => {
    const store = memoryAgentRunStore();
    const orchestrator = createProductOrchestrator({ store });
    const run = await orchestrator.start({
      id: "tamper-target",
      taskText: V1_TASK,
      autoApprove: true,
      createdAt: "2026-11-12T00:00:00.000Z",
    });

    const tampered = {
      ...run,
      events: run.events.map((event, idx) => (idx === 0 ? { ...event, detail: "tampered" } : event)),
    };
    const directVerify = verifyProductRun(tampered);
    expect(directVerify.chainOk).toBe(false);
    expect(directVerify.firstBrokenSeq).toBe(1);
    expect(directVerify.fingerprintOk).toBe(false);

    store.save(tampered);
    const verified = orchestrator.verify("tamper-target");
    expect(verified).toEqual({
      kind: "ok",
      run: tampered,
      integrity: { chainOk: false, fingerprintOk: false, firstBrokenSeq: 1 },
    });
  });

  test("server pricing-app and eval harness route through the product orchestrator without sleeping or touching legacy engine", () => {
    const pricingAppSource = readFileSync(path.resolve(process.cwd(), "src/server/pricing-app.ts"), "utf8");
    const harnessSource = readFileSync(path.resolve(process.cwd(), "src/templates/agentops/eval/harness.ts"), "utf8");
    const orchestratorSource = readFileSync(path.resolve(process.cwd(), "src/templates/agentops/orchestrator.ts"), "utf8");

    expect(pricingAppSource).toContain("orchestrator");
    expect(harnessSource).toContain("orchestrator");
    expect(pricingAppSource).not.toMatch(/setTimeout|sleep/);
    expect(orchestratorSource).not.toMatch(/setTimeout|sleep/);
    expect(orchestratorSource).not.toMatch(/from\s+["'][^"']*workflow\/executor/);
  });

  test("legacy src/engine workflow executor and SQLite replay remain independent and functional", async () => {
    const meeting = await runMeeting();
    expect(meeting.terminalHash).toHaveLength(64);
    expect(meeting.usedFallback).toBe(false);
    expect(meeting.finished.length).toBeGreaterThanOrEqual(4);

    const dbDir = mkdtempSync(path.join(tmpdir(), "engine-coexist-"));
    const store = openEventStore(path.join(dbDir, "events.sqlite"));
    try {
      const folded = replay({ store, runId: parseRunId("empty-coexist") });
      expect(folded.lastSeq).toBe(0);
      expect(folded.rounds).toEqual([]);
    } finally {
      store.close();
    }
  });
});
