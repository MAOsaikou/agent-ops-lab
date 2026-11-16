import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { memoryAgentRunStore } from "../src/server/agent-runs.js";
import { openLlmSettingsStore } from "../src/server/llm-settings.js";
import { openPlanStore } from "../src/server/plans.js";
import { createPricingApp } from "../src/server/pricing-app.js";
import type {
  SimShopCompareResponse,
  SimShopRunView,
  SimShopScenarioDetail,
} from "../src/server/simshop-routes.js";
import { openRunStore } from "../src/server/store.js";
import { ALL_TOPOLOGIES } from "../src/templates/agentops/eval/harness.js";

function setupApp(options?: { readonly simshopDir?: string }) {
  const dir = mkdtempSync(path.join(tmpdir(), "simshop-arena-"));
  const simshopStore =
    options?.simshopDir === undefined ? undefined : openRunStore(options.simshopDir);
  return createPricingApp({
    store: openPlanStore(path.join(dir, "plans")),
    agentRuns: memoryAgentRunStore(),
    llmSettings: openLlmSettingsStore(null, {}),
    ...(simshopStore === undefined ? {} : { simshopStore }),
    now: () => new Date("2026-11-16T00:00:00.000Z"),
  });
}

describe("SimShop arena API routes", () => {
  test("GET /api/simshop/scenarios returns all three scenarios with Chinese metadata and 8-round schedules", async () => {
    const app = setupApp();
    const res = await app.request("/api/simshop/scenarios");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { scenarios: readonly SimShopScenarioDetail[] };

    expect(body.scenarios.map((s) => s.name)).toEqual(["spring", "supplycut", "pricewar"]);
    for (const s of body.scenarios) {
      expect(s.title.length).toBeGreaterThan(4);
      expect(s.description.length).toBeGreaterThan(10);
      expect(s.rounds).toBe(8);
      expect(s.primaryCapacity).toHaveLength(8);
      expect(s.backupCapacity).toHaveLength(8);
      expect(s.competitorPrice.tea).toHaveLength(8);
      expect(s.competitorPrice.snack).toHaveLength(8);
      expect(s.initial.cash).toBe(500000);
      expect(s.initial.reputation).toBe(500);
    }

    const supplycut = body.scenarios.find((s) => s.name === "supplycut")!;
    expect(supplycut.primaryCapacity.slice(0, 4)).toEqual([80, 0, 0, 80]);

    const pricewar = body.scenarios.find((s) => s.name === "pricewar")!;
    expect(pricewar.competitorPrice.tea[2]).toBe(312);
    expect(pricewar.competitorPrice.snack[2]).toBe(156);
  });

  test("POST /api/simshop/runs executes supplycut steady 8-round run, folds quotes/upgrades/ledger, and preserves sourceProduct", async () => {
    const app = setupApp();
    const createRes = await app.request("/api/simshop/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scenario: "supplycut",
        sourceProduct: {
          name: "纯棉短袖女装",
          priceCents: 3990,
          buyCents: 1600,
          competitorCents: 3990,
        },
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as SimShopRunView;

    expect(created.meta.runId).toBe("u7-supplycut-s7-steady");
    expect(created.meta.scenario).toBe("supplycut");
    expect(created.meta.seed).toBe(7);
    expect(created.meta.profile).toBe("steady");
    expect(created.meta.rounds).toBe(8);
    expect(created.meta.replayVerified).toBe(true);
    expect(created.frames.length).toBeGreaterThan(50);

    // sourceProduct context echoed cleanly
    expect(created.sourceProduct).toEqual({
      name: "纯棉短袖女装",
      priceCents: 3990,
      buyCents: 1600,
      competitorCents: 3990,
    });
    expect(created.sourceContextNote).toContain("纯棉短袖女装");

    // 8-round folded views
    expect(created.rounds).toHaveLength(8);
    expect(created.rounds[0]?.roundLabel).toBe("第 1 回合");
    expect(created.rounds[1]?.supplyTriggered).toBe(true);
    expect(created.rounds[1]?.activatedSubflows).toContain("supply-negotiation");
    expect(created.rounds[2]?.supplyTriggered).toBe(true);

    // 3-round supplier negotiation quotes
    expect(created.quotes.length).toBe(16);
    expect(created.quotes.some((q) => q.supplier === "primary" && q.ruling === "walk")).toBe(true);
    expect(created.quotes.some((q) => q.supplier === "backup" && q.ruling === "counter")).toBe(true);
    expect(created.quotes.some((q) => q.supplier === "backup" && q.ruling === "accept")).toBe(true);

    // Agent hot-upgrade trail: pricer@1.0.0 -> pricer@1.0.1
    expect(created.versionUpgrades).toHaveLength(1);
    expect(created.versionUpgrades[0]?.agentId).toBe("pricer");
    expect(created.versionUpgrades[0]?.fromVersion).toBe("1.0.0");
    expect(created.versionUpgrades[0]?.toVersion).toBe("1.0.1");
    expect(created.versionUpgrades[0]?.fromPromptHash).not.toBe(
      created.versionUpgrades[0]?.toPromptHash,
    );

    // Verified SHA-256 ledger chain
    expect(created.ledger.matchesRunHash).toBe(true);
    expect(created.ledger.finalHash).toBe(created.meta.finalHash);
    expect(created.ledger.rounds).toHaveLength(8);
    expect(created.ledger.rounds.every((r) => r.locked)).toBe(true);
    for (let i = 1; i < created.ledger.rounds.length; i += 1) {
      expect(created.ledger.rounds[i]?.prevHash).toBe(created.ledger.rounds[i - 1]?.hash);
    }

    // Totals match round outcome sums
    const summedProfit = created.rounds.reduce((acc, r) => acc + (r.outcome?.profit ?? 0), 0);
    expect(created.totals.totalProfit).toBe(summedProfit);
    expect(created.totals.versionUpgradeCount).toBe(1);
    expect(created.totals.acceptedQuotes).toBe(4);

    // List, get run, get ledger
    const listRes = await app.request("/api/simshop/runs");
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { runs: readonly { runId: string }[] };
    expect(listBody.runs.map((r) => r.runId)).toEqual(["u7-supplycut-s7-steady"]);

    const getRes = await app.request("/api/simshop/runs/u7-supplycut-s7-steady");
    expect(getRes.status).toBe(200);
    const fetched = (await getRes.json()) as SimShopRunView;
    expect(fetched.meta.finalHash).toBe(created.meta.finalHash);
    expect(fetched.sourceProduct).toEqual(created.sourceProduct);

    const ledgerRes = await app.request("/api/simshop/runs/u7-supplycut-s7-steady/ledger");
    expect(ledgerRes.status).toBe(200);
    const ledgerBody = (await ledgerRes.json()) as {
      runId: string;
      finalHash: string;
      matchesRunHash: boolean;
      rounds: readonly { round: number; locked: boolean }[];
    };
    expect(ledgerBody.runId).toBe("u7-supplycut-s7-steady");
    expect(ledgerBody.matchesRunHash).toBe(true);
    expect(ledgerBody.rounds).toHaveLength(8);
  });

  test("POST /api/simshop/runs pricewar & stressed profiles expose budget arbitration and critic revision loops", async () => {
    const app = setupApp();

    const pricewarRes = await app.request("/api/simshop/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: "pricewar", seed: 7, profile: "steady" }),
    });
    expect(pricewarRes.status).toBe(201);
    const pricewar = (await pricewarRes.json()) as SimShopRunView;
    expect(pricewar.priceWars.length).toBeGreaterThan(0);
    expect(pricewar.priceWars[0]?.allocation).toEqual({ ads: 0, priceCut: 0 });
    expect(pricewar.priceWars[0]?.amounts.ads).toBeLessThanOrEqual(0);
    expect(pricewar.priceWars[0]?.amounts.priceCut).toBeLessThanOrEqual(0);
    expect(pricewar.priceWars[0]?.rationale).toContain("0 元");

    const stressedRes = await app.request("/api/simshop/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: "supplycut", seed: 7, profile: "stressed" }),
    });
    expect(stressedRes.status).toBe(201);
    const stressed = (await stressedRes.json()) as SimShopRunView;
    expect(stressed.loops.some((l) => l.verdict === "revise")).toBe(true);
    expect(stressed.loops.some((l) => l.stopReason === "maxIterations")).toBe(true);
    expect(stressed.rounds.every((r) => r.usedFallback)).toBe(true);
    expect(stressed.totals.fallbackRounds).toBe(8);
  });

  test("POST /api/simshop/runs/:runId/rounds/:round/commit enforces 409 round-locked immutability and validates inputs", async () => {
    const simshopDir = mkdtempSync(path.join(tmpdir(), "simshop-disk-"));
    const app = setupApp({ simshopDir });

    const createRes = await app.request("/api/simshop/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: "spring", seed: 7, profile: "steady" }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as SimShopRunView;
    const runId = created.meta.runId;
    expect(existsSync(path.join(simshopDir, `${runId}.json`))).toBe(true);

    // Attempt to tamper with round 0
    const commitRes = await app.request(`/api/simshop/runs/${runId}/rounds/0/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ price: 9999 }),
    });
    expect(commitRes.status).toBe(409);
    const conflict = (await commitRes.json()) as {
      code: string;
      round: number;
      storedDecisionHash: string;
      hash: string;
      detail: string;
    };
    expect(conflict.code).toBe("round-locked");
    expect(conflict.round).toBe(0);
    expect(conflict.storedDecisionHash).toBe(created.ledger.rounds[0]?.decisionHash);
    expect(conflict.hash).toBe(created.ledger.rounds[0]?.hash);
    expect(conflict.detail).toContain("锁定");

    // Invalid round index -> 400
    const badRound = await app.request(`/api/simshop/runs/${runId}/rounds/-1/commit`, {
      method: "POST",
    });
    expect(badRound.status).toBe(400);
    expect(((await badRound.json()) as { code: string }).code).toBe("bad-round");

    // Out-of-range round index -> 404
    const missingRound = await app.request(`/api/simshop/runs/${runId}/rounds/99/commit`, {
      method: "POST",
    });
    expect(missingRound.status).toBe(404);
    expect(((await missingRound.json()) as { code: string }).code).toBe("round-not-found");

    // Unknown runId and path traversal attempts -> 404 (not 500)
    for (const badId of ["nonexistent-run", "..%2Fsecret", "bad$run!id"]) {
      const missingRun = await app.request(`/api/simshop/runs/${badId}`);
      expect(missingRun.status).toBe(404);
      expect(((await missingRun.json()) as { code: string }).code).toBe("run-not-found");

      const missingLedger = await app.request(`/api/simshop/runs/${badId}/ledger`);
      expect(missingLedger.status).toBe(404);

      const missingCommit = await app.request(`/api/simshop/runs/${badId}/rounds/0/commit`, {
        method: "POST",
      });
      expect(missingCommit.status).toBe(404);
    }
  });

  test("POST /api/simshop/runs rejects invalid fields and extra strictObject properties with 400 bad-request", async () => {
    const app = setupApp();
    const invalidBodies: unknown[] = [
      null,
      {},
      { scenario: "unknown-scenario" },
      { scenario: "spring", seed: 1.5 },
      { scenario: "spring", profile: "turbo" },
      { scenario: "spring", extraField: "injected" },
      { scenario: "spring", sourceProduct: { name: "ok", apiKey: "leaked" } },
      { scenario: "spring", sourceProduct: { priceCents: 0 } },
    ];
    for (const body of invalidBodies) {
      const res = await app.request("/api/simshop/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe("bad-request");
    }
  });

  test("POST /api/simshop/compare evaluates all 4 topologies across 8 rounds with roundSeries and scenarioWinners", async () => {
    const app = setupApp();

    // Single scenario compare
    const singleRes = await app.request("/api/simshop/compare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: "supplycut", seed: 7 }),
    });
    expect(singleRes.status).toBe(200);
    const single = (await singleRes.json()) as SimShopCompareResponse;
    expect(single.scenarios).toEqual(["supplycut"]);
    expect(single.seed).toBe(7);
    expect(single.roundsPerRun).toBe(8);
    expect(single.topologies).toEqual(["rule", "single-agent", "collab-no-review", "collab-with-review"]);
    expect(single.runs).toHaveLength(4);
    expect(single.roundSeries).toHaveLength(1);
    expect(single.roundSeries[0]?.rounds).toHaveLength(8);
    expect(single.roundSeries[0]?.rounds[7]?.byTopology["collab-with-review"]?.cumulativeProfitCents).toBe(
      single.summary["collab-with-review"]?.totalProfitCents,
    );
    expect(single.scenarioWinners.supplycut?.topology).toBe("collab-with-review");
    expect(single.summary["collab-with-review"]?.negotiatedDealsCount).toBe(4);
    expect(single.summary["collab-with-review"]?.upgradedVersions).toContain("pricer@1.0.1");
    expect(single.summary["collab-no-review"]?.stressedAuditReviewPassRate).toBe(0);

    // Default {} evaluates all 3 scenarios at seed=7
    const allRes = await app.request("/api/simshop/compare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(allRes.status).toBe(200);
    const all = (await allRes.json()) as SimShopCompareResponse;
    expect(all.scenarios).toEqual(["spring", "supplycut", "pricewar"]);
    expect(all.runs).toHaveLength(12);
    expect(all.roundSeries).toHaveLength(3);
    expect(all.scenarioWinners.spring?.topology).toBe("rule");
    expect(all.scenarioWinners.supplycut?.topology).toBe("collab-with-review");
    expect(all.scenarioWinners.pricewar?.topology).toBe("collab-with-review");
    expect(all.summary["collab-with-review"]!.totalProfitCents).toBeGreaterThan(
      all.summary["collab-no-review"]!.totalProfitCents,
    );
    expect(all.summary["collab-no-review"]!.totalProfitCents).toBeGreaterThan(
      all.summary["single-agent"]!.totalProfitCents,
    );
    expect(all.summary["single-agent"]!.totalProfitCents).toBeGreaterThan(
      all.summary.rule!.totalProfitCents,
    );
    expect(all.summary["collab-with-review"]?.allLedgerConsistent).toBe(true);
    expect(all.summary["collab-with-review"]?.priceWarZeroInterceptions).toBe(1);
    expect(all.summary["collab-with-review"]?.versionUpgradeCount).toBe(3);

    // Reject invalid payloads
    for (const badBody of [
      { scenario: "nope" },
      { seed: 3.14 },
      { scenario: "spring", unknownKey: true },
    ]) {
      const badRes = await app.request("/api/simshop/compare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(badBody),
      });
      expect(badRes.status).toBe(400);
      expect(((await badRes.json()) as { code: string }).code).toBe("bad-request");
    }

    const malformed = await app.request("/api/simshop/compare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });
    expect(malformed.status).toBe(400);
  });

  test("POST /api/agentops/eval returns topologyStats, per-case attributions, and optional campaignEvaluation", async () => {
    const app = setupApp();
    const res = await app.request("/api/agentops/eval", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        topologies: ALL_TOPOLOGIES,
        includeCampaign: true,
        campaignScenario: "pricewar",
        campaignSeed: 7,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: Record<string, Record<string, unknown>>;
      topologyStats: Record<string, { totalCases: number; passedCases: number; passRate: number }>;
      caseComparisons: readonly {
        caseId: string;
        attribution: string;
        results: Record<string, { pass: boolean }>;
      }[];
      campaignEvaluation?: SimShopCompareResponse;
    };

    expect(body).not.toHaveProperty("winner");
    expect(body).not.toHaveProperty("collabAdvantage");
    expect(body.summary.rule).not.toHaveProperty("betterThan");

    expect(body.topologyStats.rule?.passedCases).toBe(7);
    expect(body.topologyStats["single-agent"]?.passedCases).toBe(7);
    expect(body.topologyStats["collab-no-review"]?.passedCases).toBe(10);
    expect(body.topologyStats["collab-with-review"]?.passedCases).toBe(12);
    expect(body.topologyStats["collab-with-review"]?.passRate).toBe(1);

    expect(body.caseComparisons).toHaveLength(12);
    const tightCash = body.caseComparisons.find((item) => item.caseId === "cash-tight-volume-stockout");
    expect(tightCash?.results["collab-with-review"]?.pass).toBe(true);
    expect(tightCash?.results["collab-no-review"]?.pass).toBe(false);
    expect(tightCash?.attribution).toContain("Self-Loop");

    expect(body.campaignEvaluation).toBeDefined();
    expect(body.campaignEvaluation?.scenarios).toEqual(["pricewar"]);
    expect(body.campaignEvaluation?.scenarioWinners.pricewar?.topology).toBe("collab-with-review");
  });
});
