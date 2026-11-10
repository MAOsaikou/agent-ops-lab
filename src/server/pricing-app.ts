import { Hono } from "hono";
import { z } from "zod";

import { CANDIDATE_IDS } from "../templates/pricing/model.js";
import type { CandidateId } from "../templates/pricing/model.js";
import { buildPlan, lockPlan } from "../templates/pricing/plan.js";
import {
  PLATFORM_IDS,
  PLATFORM_PRESETS,
  RATE_DISCLAIMER,
  SERVICE_TAGS,
} from "../templates/pricing/platform.js";
import { planCsv } from "./plan-csv.js";
import type { PlanStore } from "./plans.js";
import { analyzeProductInput } from "../templates/intake/agent.js";
import { AGENTS, DEFAULT_WORKFLOW, TOOL_CATALOG, WORKFLOW_TEMPLATES } from "../templates/agentops/catalog.js";
import { runAgentWorkflow } from "../templates/agentops/runner.js";
import { memoryAgentRunStore, type AgentRunStore } from "./agent-runs.js";
import { openLlmSettingsStore, type LlmSettingsStore } from "./llm-settings.js";

const inputSchema = z.strictObject({
  platform: z.enum(PLATFORM_IDS),
  name: z.string().min(1).max(40),
  category: z.string().max(20),
  keywords: z.string().max(80),
  buyCents: z.int().min(1).max(100_000_000),
  packagingCents: z.int().min(0).max(10_000_000),
  shippingCents: z.int().min(0).max(10_000_000),
  commissionRate: z.number().min(0).max(0.5),
  payFeeRate: z.number().min(0).max(0.05),
  returnRate: z.number().min(0).max(0.9),
  returnSalvage: z.number().min(0).max(1),
  adDailyBudgetCents: z.int().min(0).max(100_000_000),
  adCpcCents: z.int().min(1).max(100_000),
  adCvr: z.number().min(0).max(0.6),
  competitorCents: z.int().min(100).max(100_000_000),
  marketOrders: z.int().min(0).max(1_000_000),
  elasticity: z.number().min(1).max(4),
  targetMargin: z.number().min(0.02).max(0.6),
  cashCents: z.int().min(0).max(1_000_000_000),
  settleDays: z.int().min(0).max(30),
  services: z.array(z.enum(SERVICE_TAGS)).max(7),
  promoEnabled: z.boolean(),
  promoDiscount: z.number().min(0.4).max(1),
  seed: z.int().min(0).max(1_000_000),
});

const lockSchema = z.strictObject({ candidateId: z.enum(CANDIDATE_IDS) });

const intakeSchema = z.strictObject({
  text: z.string().min(1).max(20_000),
  links: z.array(z.string().max(2_048)).max(10).optional(),
});

let counter = 0;

function newPlanId(): string {
  counter = (counter + 1) % 1296;
  return `p${Date.now().toString(36)}${counter.toString(36).padStart(2, "0")}`;
}

export type PricingAppOptions = {
  readonly store: PlanStore;
  readonly agentRuns?: AgentRunStore;
  readonly llmSettings?: LlmSettingsStore;
  readonly now?: () => Date;
};

export function createPricingApp(options: PricingAppOptions): Hono {
  const app = new Hono();
  const now = options.now ?? (() => new Date());
  const agentRuns = options.agentRuns ?? memoryAgentRunStore();
  const llmSettings = options.llmSettings ?? openLlmSettingsStore(null, process.env);

  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("access-control-allow-origin", "*");
    c.res.headers.set("access-control-allow-headers", "content-type");
    c.res.headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  });

  app.options("*", (c) => c.body(null, 204));

  app.get("/api/health", (c) =>
    c.json({ ok: true, service: "shopkeeper-pricing", plans: options.store.list().length }),
  );

  app.get("/api/platforms", (c) =>
    c.json({
      platforms: PLATFORM_IDS.map((id) => PLATFORM_PRESETS[id]),
      serviceTags: SERVICE_TAGS,
      rateDisclaimer: RATE_DISCLAIMER,
    }),
  );

  app.post("/api/intake", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = intakeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ code: "bad-request", detail: parsed.error.message }, 400);
    }
    return c.json(analyzeProductInput(parsed.data));
  });

  app.get("/api/agentops/catalog", (c) =>
    c.json({ agents: AGENTS, tools: TOOL_CATALOG, workflow: DEFAULT_WORKFLOW, templates: WORKFLOW_TEMPLATES }),
  );

  app.get("/api/agentops/runs", (c) => c.json({ runs: agentRuns.list() }));

  app.get("/api/agentops/llm", (c) => c.json(llmSettings.view()));

  app.post("/api/agentops/llm", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    try {
      return c.json(llmSettings.save(body));
    } catch (error) {
      return c.json({ code: "bad-llm-settings", detail: error instanceof Error ? error.message : "配置不合法" }, 400);
    }
  });

  app.post("/api/agentops/llm/test", async (c) => c.json(await llmSettings.test()));

  app.post("/api/agentops/runs", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = z.strictObject({ task: z.string().min(8).max(20_000), autoApprove: z.boolean().optional() }).safeParse(body);
    if (!parsed.success) return c.json({ code: "bad-request", detail: parsed.error.message }, 400);
    const id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    try {
      const run = await runAgentWorkflow(
        { id, taskText: parsed.data.task, autoApprove: parsed.data.autoApprove ?? true, createdAt: now().toISOString() },
        llmSettings.resolve(),
      );
      agentRuns.save(run);
      return c.json(run, 201);
    } catch (error) {
      return c.json({ code: "run-failed", detail: error instanceof Error ? error.message : "Agent run failed" }, 422);
    }
  });

  app.get("/api/agentops/runs/:id", (c) => {
    const run = agentRuns.load(c.req.param("id"));
    return run === undefined ? c.json({ code: "run-not-found" }, 404) : c.json(run);
  });

  app.get("/api/agentops/runs/:id/events", (c) => {
    const run = agentRuns.load(c.req.param("id"));
    return run === undefined ? c.json({ code: "run-not-found" }, 404) : c.json({ events: run.events, fingerprint: run.fingerprint });
  });

  app.get("/api/plans", (c) => c.json({ plans: options.store.list() }));

  app.post("/api/plans", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ code: "bad-request", detail: parsed.error.message }, 400);
    }
    const plan = buildPlan(parsed.data, { id: newPlanId(), createdAt: now().toISOString() });
    options.store.save(plan);
    return c.json(plan, 201);
  });

  app.get("/api/plans/:id", (c) => {
    const plan = options.store.load(c.req.param("id"));
    if (plan === undefined) {
      return c.json({ code: "plan-not-found", id: c.req.param("id") }, 404);
    }
    return c.json(plan);
  });

  app.post("/api/plans/:id/lock", async (c) => {
    const plan = options.store.load(c.req.param("id"));
    if (plan === undefined) {
      return c.json({ code: "plan-not-found", id: c.req.param("id") }, 404);
    }
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = lockSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ code: "bad-request", detail: parsed.error.message }, 400);
    }
    if (plan.locked !== null) {
      return c.json(
        {
          code: "plan-locked",
          locked: plan.locked,
          detail: "这版方案已经锁定，要改价请重新核算一份新的",
        },
        409,
      );
    }
    const candidateId: CandidateId = parsed.data.candidateId;
    const locked = lockPlan(plan, candidateId, now().toISOString());
    options.store.save(locked);
    return c.json(locked);
  });

  app.get("/api/plans/:id/export.csv", (c) => {
    const plan = options.store.load(c.req.param("id"));
    if (plan === undefined) {
      return c.json({ code: "plan-not-found", id: c.req.param("id") }, 404);
    }
    return new Response(planCsv(plan), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${plan.id}-pricing.csv"`,
      },
    });
  });

  return app;
}