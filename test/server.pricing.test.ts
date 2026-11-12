import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { openPlanStore } from "../src/server/plans.js";
import { createPricingApp } from "../src/server/pricing-app.js";
import { openLlmSettingsStore } from "../src/server/llm-settings.js";
import { SAMPLES } from "../src/templates/pricing/index.js";

function setup(): ReturnType<typeof createPricingApp> {
  const dir = mkdtempSync(path.join(tmpdir(), "plan-api-"));
  const store = openPlanStore(dir);
  return createPricingApp({
    store,
    llmSettings: openLlmSettingsStore(null, {}),
    now: () => new Date("2026-11-10T00:00:00.000Z"),
  });
}

function sampleInput(): unknown {
  const sample = SAMPLES[0];
  if (sample === undefined) {
    throw new Error("sample missing");
  }
  return sample.input;
}

async function createPlan(app: ReturnType<typeof createPricingApp>): Promise<{ id: string; hash: string }> {
  const response = await app.request("/api/plans", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sampleInput()),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { id: string; hash: string };
  return body;
}

describe("pricing api", () => {
  test("persists model settings without returning the secret", async () => {
    const app = setup();
    const response = await app.request("/api/agentops/llm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, baseUrl: "https://api.deepseek.com", model: "deepseek-flash", apiKey: "sk-example-secret" }),
    });
    expect(response.status).toBe(200);
    const view = (await response.json()) as { active: boolean; model: string; hasKey: boolean; keyHint: string };
    expect(view.active).toBe(true);
    expect(view.model).toBe("deepseek-flash");
    expect(view.hasKey).toBe(true);
    expect(view.keyHint).not.toContain("sk-example-secret");
    const read = await app.request("/api/agentops/llm");
    expect((await read.json()).keyHint).toBe(view.keyHint);
  });

  test("rejects enabling a model without a model name", async () => {
    const app = setup();
    const response = await app.request("/api/agentops/llm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, model: "" }),
    });
    expect(response.status).toBe(400);
  });

  test("runs the multi-agent harness and exposes its event chain", async () => {
    const app = setup();
    const created = await app.request("/api/agentops/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "分析拼多多女装纯棉短袖上架可行性。采购价 16 元，包材 1.5 元，快递 6.5 元，竞品价 39.9 元，日单量 50，目标毛利 25%，预算 30 元，周转金 3000 元。", autoApprove: true }),
    });
    expect(created.status).toBe(201);
    const run = (await created.json()) as { id: string; status: string; dispatches: readonly unknown[]; events: readonly unknown[]; fingerprint: string };
    expect(run.status).toBe("completed");
    expect(run.dispatches.length).toBeGreaterThan(5);
    expect(run.events.length).toBeGreaterThan(20);
    expect(run.fingerprint).toHaveLength(64);
    const events = await app.request(`/api/agentops/runs/${run.id}/events`);
    expect(events.status).toBe(200);
  });

  test("recognizes product links without API key", async () => {
    const app = setup();
    const response = await app.request("/api/intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "【拼多多】纯棉短袖 https://mobile.yangkeduo.com/goods.html?goods_id=412345678901 ¥39.90 券后" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      patch: { platform?: string; competitorCents?: number };
      links: readonly { kind: string; itemId: string | null }[];
      trace: readonly unknown[];
    };
    expect(body.patch.platform).toBe("pdd");
    expect(body.patch.competitorCents).toBe(3990);
    expect(body.links[0]?.kind).toBe("item");
    expect(body.links[0]?.itemId).toBe("412345678901");
    expect(body.trace).toHaveLength(4);
  });

  test("rejects oversized or missing intake text", async () => {
    const app = setup();
    const response = await app.request("/api/intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "" }),
    });
    expect(response.status).toBe(400);
  });
  test("creates a plan with three candidates and a trace", async () => {
    const app = setup();
    const response = await app.request("/api/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sampleInput()),
    });
    expect(response.status).toBe(201);
    const plan = (await response.json()) as {
      id: string;
      candidates: readonly { id: string; priceCents: number }[];
      trace: readonly unknown[];
      copy: { titles: readonly unknown[] };
      recommendedId: string;
    };
    expect(plan.candidates).toHaveLength(3);
    expect(plan.trace.length).toBeGreaterThan(6);
    expect(plan.copy.titles.length).toBeGreaterThan(0);
    expect(plan.candidates.map((candidate) => candidate.id)).toContain(plan.recommendedId);
  });

  test("lists, loads, and locks a plan once", async () => {
    const app = setup();
    const created = await createPlan(app);

    const list = (await (await app.request("/api/plans")).json()) as {
      plans: readonly { id: string; locked: boolean }[];
    };
    expect(list.plans).toHaveLength(1);
    expect(list.plans[0]?.id).toBe(created.id);
    expect(list.plans[0]?.locked).toBe(false);

    const loaded = await app.request(`/api/plans/${created.id}`);
    expect(loaded.status).toBe(200);

    const locked = await app.request(`/api/plans/${created.id}/lock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidateId: "volume" }),
    });
    expect(locked.status).toBe(200);
    const body = (await locked.json()) as { locked: { candidateId: string; hash: string } };
    expect(body.locked.candidateId).toBe("volume");
    expect(body.locked.hash).toHaveLength(64);

    const again = await app.request(`/api/plans/${created.id}/lock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidateId: "profit" }),
    });
    expect(again.status).toBe(409);
  });

  test("exports a csv with a BOM and the plan rows", async () => {
    const app = setup();
    const created = await createPlan(app);
    const response = await app.request(`/api/plans/${created.id}/export.csv`);
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("方案,售价(元)");
    expect(text.split("\r\n").filter((line) => line.length > 0)).toHaveLength(4);
  });

  test("rejects bad input and unknown ids", async () => {
    const app = setup();
    const bad = await app.request("/api/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "taobao" }),
    });
    expect(bad.status).toBe(400);

    const missing = await app.request("/api/plans/nope");
    expect(missing.status).toBe(404);
  });

  test("serves platform presets the form can start from", async () => {
    const app = setup();
    const response = await app.request("/api/platforms");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      platforms: readonly { id: string; titleMax: number }[];
      serviceTags: readonly string[];
    };
    expect(body.platforms.length).toBe(6);
    expect(body.serviceTags.length).toBeGreaterThan(3);
  });
});