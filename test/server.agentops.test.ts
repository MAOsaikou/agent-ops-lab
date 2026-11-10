import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { openAgentRunStore } from "../src/server/agent-runs.js";
import { openLlmSettingsStore } from "../src/server/llm-settings.js";
import { openPlanStore } from "../src/server/plans.js";
import { createPricingApp } from "../src/server/pricing-app.js";
import type { AgentRun, RunEvent } from "../src/templates/agentops/types.js";

const TASK =
  "分析拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。纯棉短袖，券后价 ¥39.90，已拼 10 万+ 件。采购价 16 元，包材 1.5 元，快递 6.5 元，竞品主流价 39.90 元，日单量 50，目标毛利 25%，推广预算 30 元，可周转资金 300 元。";

const AD_CONFLICT_TASK =
  "分析拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。商品名：纯棉短袖，券后价 ¥39.90。采购价 16 元，包材 1.5 元，快递 6.5 元，竞品主流价 39.90 元，日单量 15，目标毛利 25%，推广预算 220 元，可周转资金 5000 元。";

function setup(runsDir?: string): {
  readonly app: ReturnType<typeof createPricingApp>;
  readonly runsDir: string;
} {
  const baseDir = mkdtempSync(path.join(tmpdir(), "agentops-api-"));
  const effectiveRunsDir = runsDir ?? path.join(baseDir, "agent-runs");
  const app = createPricingApp({
    store: openPlanStore(path.join(baseDir, "plans")),
    agentRuns: openAgentRunStore(effectiveRunsDir),
    llmSettings: openLlmSettingsStore(null, {}),
    now: () => new Date("2026-11-10T00:00:00.000Z"),
  });
  return { app, runsDir: effectiveRunsDir };
}

function parseSseStream(raw: string): {
  readonly events: readonly RunEvent[];
  readonly doneRun: AgentRun | null;
} {
  const events: RunEvent[] = [];
  let doneRun: AgentRun | null = null;
  const blocks = raw.split("\n\n").map((block) => block.trim()).filter((block) => block.length > 0);
  for (const block of blocks) {
    let eventName = "message";
    let dataLine = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) {
        eventName = line.slice("event: ".length).trim();
      } else if (line.startsWith("data: ")) {
        dataLine = line.slice("data: ".length).trim();
      }
    }
    if (dataLine === "") continue;
    const parsed: unknown = JSON.parse(dataLine);
    if (eventName === "done") {
      doneRun = parsed as AgentRun;
    } else if (eventName === "event") {
      events.push(parsed as RunEvent);
    }
  }
  return { events, doneRun };
}

function assertContinuousHashChain(events: readonly RunEvent[]): void {
  expect(events.length).toBeGreaterThan(0);
  expect(events[0]?.seq).toBe(1);
  expect(events[0]?.prevHash).toBe("0".repeat(64));
  expect(events[0]?.hash).toHaveLength(64);
  for (let index = 1; index < events.length; index += 1) {
    expect(events[index]?.seq).toBe(index + 1);
    expect(events[index]?.prevHash).toBe(events[index - 1]?.hash);
    expect(events[index]?.hash).toHaveLength(64);
  }
}

describe("AgentOps stream and human decision gate API", () => {
  test("autoApprove false pauses at gate.awaiting and approve resumes to completed with continuous hash chain and adopted candidate", async () => {
    const { app, runsDir } = setup();
    const createRes = await app.request("/api/agentops/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: AD_CONFLICT_TASK, autoApprove: false }),
    });
    expect(createRes.status).toBe(201);
    const paused = (await createRes.json()) as AgentRun;
    expect(paused.status).toBe("awaiting-approval");
    expect(paused.events.at(-1)?.type).toBe("gate.awaiting");
    expect(paused.artifacts.report).toHaveLength(0);
    expect(paused.failures["market-analyst"]).toBeGreaterThanOrEqual(1);
    assertContinuousHashChain(paused.events);

    // Re-open store on the same directory to verify persisted scheduler state is sufficient to resume
    const reopened = setup(runsDir).app;
    const loadedRes = await reopened.request(`/api/agentops/runs/${paused.id}`);
    expect(loadedRes.status).toBe(200);
    const loadedPaused = (await loadedRes.json()) as AgentRun;
    expect(loadedPaused.status).toBe("awaiting-approval");
    expect(loadedPaused.fingerprint).toBe(paused.fingerprint);

    const approveRes = await reopened.request(`/api/agentops/runs/${paused.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", candidateId: "volume" }),
    });
    expect(approveRes.status).toBe(200);
    const completed = (await approveRes.json()) as AgentRun;
    expect(completed.status).toBe("completed");
    expect(completed.gateDecision).toBe("approve");
    expect(completed.decidedCandidateId).toBe("volume");
    expect(completed.preferredCandidateId).toBe("volume");
    expect(completed.artifacts.chosenId).toBe("volume");
    expect(completed.artifacts.report.length).toBeGreaterThan(0);
    expect(completed.artifacts.report.some((line) => line.includes("冲量"))).toBe(true);
    expect(completed.events.length).toBeGreaterThan(paused.events.length);
    expect(completed.events[paused.events.length]?.type).toBe("gate.decided");
    expect(completed.events.at(-1)?.type).toBe("run.completed");
    expect(completed.fingerprint).toHaveLength(64);
    expect(completed.fingerprint).not.toBe(paused.fingerprint);
    assertContinuousHashChain(completed.events);
  });

  test("reject path records gate.decided, sets status to rejected, seals fingerprint, and does not invent a report", async () => {
    const { app } = setup();
    const createRes = await app.request("/api/agentops/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: TASK, autoApprove: false }),
    });
    expect(createRes.status).toBe(201);
    const paused = (await createRes.json()) as AgentRun;
    expect(paused.status).toBe("awaiting-approval");

    const rejectRes = await app.request(`/api/agentops/runs/${paused.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reject" }),
    });
    expect(rejectRes.status).toBe(200);
    const rejected = (await rejectRes.json()) as AgentRun;
    expect(rejected.status).toBe("rejected");
    expect(rejected.gateDecision).toBe("reject");
    expect(rejected.events).toHaveLength(paused.events.length + 1);
    expect(rejected.events.at(-1)?.type).toBe("gate.decided");
    expect(rejected.events.some((event) => event.type === "run.completed")).toBe(false);
    expect(rejected.events.some((event) => event.nodeId === "report")).toBe(false);
    expect(rejected.artifacts.report).toEqual([]);
    expect(rejected.fingerprint).toHaveLength(64);
    expect(rejected.fingerprint).not.toBe(paused.fingerprint);
    assertContinuousHashChain(rejected.events);
  });

  test("idempotent approve and reject return 200 and the same fingerprint without duplicating events", async () => {
    const { app } = setup();

    // Approve idempotency
    const createdApprove = (await (
      await app.request("/api/agentops/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: TASK, autoApprove: false }),
      })
    ).json()) as AgentRun;

    const firstApprove = await app.request(`/api/agentops/runs/${createdApprove.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", candidateId: "profit" }),
    });
    expect(firstApprove.status).toBe(200);
    const firstApprovedRun = (await firstApprove.json()) as AgentRun;

    const secondApprove = await app.request(`/api/agentops/runs/${createdApprove.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", candidateId: "profit" }),
    });
    expect(secondApprove.status).toBe(200);
    const secondApprovedRun = (await secondApprove.json()) as AgentRun;
    expect(secondApprovedRun.fingerprint).toBe(firstApprovedRun.fingerprint);
    expect(secondApprovedRun.events).toHaveLength(firstApprovedRun.events.length);

    // Reject idempotency
    const createdReject = (await (
      await app.request("/api/agentops/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: TASK, autoApprove: false }),
      })
    ).json()) as AgentRun;

    const firstReject = await app.request(`/api/agentops/runs/${createdReject.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reject" }),
    });
    expect(firstReject.status).toBe(200);
    const firstRejectedRun = (await firstReject.json()) as AgentRun;

    const secondReject = await app.request(`/api/agentops/runs/${createdReject.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reject" }),
    });
    expect(secondReject.status).toBe(200);
    const secondRejectedRun = (await secondReject.json()) as AgentRun;
    expect(secondRejectedRun.fingerprint).toBe(firstRejectedRun.fingerprint);
    expect(secondRejectedRun.events).toHaveLength(firstRejectedRun.events.length);
  });

  test("conflicting second decision, auto-approved run decision, and unknown run id return typed errors", async () => {
    const { app } = setup();

    const missing = await app.request("/api/agentops/runs/nonexistent/decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { code: string }).code).toBe("run-not-found");

    const autoApproved = (await (
      await app.request("/api/agentops/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: TASK, autoApprove: true }),
      })
    ).json()) as AgentRun;
    const onAutoApproved = await app.request(`/api/agentops/runs/${autoApproved.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(onAutoApproved.status).toBe(409);
    expect(((await onAutoApproved.json()) as { code: string }).code).toBe("run-not-awaiting-decision");

    const paused = (await (
      await app.request("/api/agentops/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: TASK, autoApprove: false }),
      })
    ).json()) as AgentRun;

    const approvedRes = await app.request(`/api/agentops/runs/${paused.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", candidateId: "profit" }),
    });
    expect(approvedRes.status).toBe(200);
    const approvedRun = (await approvedRes.json()) as AgentRun;

    const conflictAction = await app.request(`/api/agentops/runs/${paused.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reject" }),
    });
    expect(conflictAction.status).toBe(409);
    expect(((await conflictAction.json()) as { code: string }).code).toBe("decision-conflict");

    const conflictCandidate = await app.request(`/api/agentops/runs/${paused.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", candidateId: "volume" }),
    });
    expect(conflictCandidate.status).toBe(409);
    expect(((await conflictCandidate.json()) as { code: string }).code).toBe("decision-conflict");

    const storedAfterConflict = (await (await app.request(`/api/agentops/runs/${paused.id}`)).json()) as AgentRun;
    expect(storedAfterConflict.fingerprint).toBe(approvedRun.fingerprint);
    expect(storedAfterConflict.status).toBe("completed");
  });

  test("concurrent decision race on the same awaiting run allows only one winner", async () => {
    const { app } = setup();

    // Case 1: concurrent conflicting decisions (approve vs reject)
    const paused1 = (await (
      await app.request("/api/agentops/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: TASK, autoApprove: false }),
      })
    ).json()) as AgentRun;

    const [race1A, race1B] = await Promise.all([
      app.request(`/api/agentops/runs/${paused1.id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve", candidateId: "profit" }),
      }),
      app.request(`/api/agentops/runs/${paused1.id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      }),
    ]);

    const statuses1 = [race1A.status, race1B.status].sort((a, b) => a - b);
    expect(statuses1).toEqual([200, 409]);
    const loser1 = race1A.status === 409 ? race1A : race1B;
    const loser1Body = (await loser1.json()) as { code: string };
    expect(["decision-in-progress", "decision-conflict"]).toContain(loser1Body.code);

    // Case 2: concurrent identical decisions (approve vs approve) still only allows one in-flight winner
    const paused2 = (await (
      await app.request("/api/agentops/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: TASK, autoApprove: false }),
      })
    ).json()) as AgentRun;

    const [race2A, race2B] = await Promise.all([
      app.request(`/api/agentops/runs/${paused2.id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve", candidateId: "match" }),
      }),
      app.request(`/api/agentops/runs/${paused2.id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve", candidateId: "match" }),
      }),
    ]);

    const statuses2 = [race2A.status, race2B.status].sort((a, b) => a - b);
    expect(statuses2).toEqual([200, 409]);
    const loser2 = race2A.status === 409 ? race2A : race2B;
    const loser2Body = (await loser2.json()) as { code: string };
    expect(loser2Body.code).toBe("decision-in-progress");
  });

  test("stream emits real RunEvents with continuous hash chain and final fingerprint matches sync POST", async () => {
    const { app } = setup();

    const runnerSource = readFileSync(path.resolve(process.cwd(), "src/templates/agentops/runner.ts"), "utf8");
    const pricingAppSource = readFileSync(path.resolve(process.cwd(), "src/server/pricing-app.ts"), "utf8");
    expect(runnerSource).not.toMatch(/setTimeout|sleep/);
    expect(pricingAppSource).not.toMatch(/setTimeout|sleep/);

    const syncRes = await app.request("/api/agentops/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "sync-run-1",
        createdAt: "2026-11-10T00:00:00.000Z",
        task: TASK,
        autoApprove: true,
      }),
    });
    expect(syncRes.status).toBe(201);
    const syncRun = (await syncRes.json()) as AgentRun;

    const streamRes = await app.request("/api/agentops/runs/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "stream-run-1",
        createdAt: "2026-11-10T00:00:00.000Z",
        task: TASK,
        autoApprove: true,
      }),
    });
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get("content-type")).toContain("text/event-stream");
    const rawStream = await streamRes.text();
    const { events, doneRun } = parseSseStream(rawStream);

    assertContinuousHashChain(events);
    expect(doneRun).not.toBeNull();
    expect(doneRun!.status).toBe("completed");
    expect(events).toEqual(doneRun!.events);
    expect(events).toEqual(syncRun.events);
    expect(doneRun!.fingerprint).toBe(syncRun.fingerprint);

    // Also test streaming with autoApprove: false pauses at gate.awaiting and persists the awaiting run
    const pausedStreamRes = await app.request("/api/agentops/runs/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "stream-paused-1",
        createdAt: "2026-11-10T00:00:00.000Z",
        task: TASK,
        autoApprove: false,
      }),
    });
    expect(pausedStreamRes.status).toBe(200);
    const pausedParsed = parseSseStream(await pausedStreamRes.text());
    assertContinuousHashChain(pausedParsed.events);
    expect(pausedParsed.doneRun).not.toBeNull();
    expect(pausedParsed.doneRun!.status).toBe("awaiting-approval");
    expect(pausedParsed.events.at(-1)?.type).toBe("gate.awaiting");

    const loadedPausedRes = await app.request("/api/agentops/runs/stream-paused-1");
    expect(loadedPausedRes.status).toBe(200);
    expect(((await loadedPausedRes.json()) as AgentRun).fingerprint).toBe(pausedParsed.doneRun!.fingerprint);
  });
});
