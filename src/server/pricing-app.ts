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
import { prepareIntake } from "../templates/agentops/preflight.js";
import { AGENTS, DEFAULT_WORKFLOW, TOOL_CATALOG, WORKFLOW_TEMPLATES } from "../templates/agentops/catalog.js";
import {
  createProductOrchestrator,
  DecisionConflictError,
  ProductRunCorruptError,
  ProductRunNotFoundError,
} from "../templates/agentops/orchestrator.js";
import { BENCHMARK_CASES } from "../templates/agentops/eval/dataset.js";
import {
  ALL_TOPOLOGIES,
  runCampaignEvaluation,
  runEvaluationSuite,
  topologyConfig,
  type CaseDetail,
  type TopologyName,
} from "../templates/agentops/eval/harness.js";
import type { BenchmarkCase } from "../templates/agentops/eval/types.js";
import { SCENARIO_NAMES } from "../templates/simshop/market/scenario.js";
import type { AgentRun, RunEvent } from "../templates/agentops/types.js";
import { memoryAgentRunStore, type AgentRunStore } from "./agent-runs.js";
import { openLlmSettingsStore, type LlmSettingsStore } from "./llm-settings.js";
import {
  buildCampaignCompareResponse,
  readOptionalJsonBody,
  registerSimShopRoutes,
  type CaptureSimShopRun,
} from "./simshop-routes.js";
import { SSE_HEADERS } from "./sse.js";
import type { RunStore } from "./store.js";

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

// Security note: mcp protocol hooks remain server-trusted configuration only
// and are never exposed via HTTP schema to prevent arbitrary process execution.
const budgetCeilingSchema = z.strictObject({
  maxTokens: z.number().finite().min(0).max(1_000_000),
  maxToolCalls: z.number().finite().min(0).max(10_000),
  timeoutMs: z.number().finite().min(0).max(300_000),
});

const retrievalSchema = z.strictObject({
  enabled: z.boolean(),
  query: z.string().min(1).max(20_000),
  platform: z.enum(PLATFORM_IDS).optional(),
  timeoutMs: z.number().finite().min(0).max(60_000).optional(),
});

const runRequestSchema = z.strictObject({
  task: z.string().min(8).max(20_000),
  autoApprove: z.boolean().optional(),
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/).optional(),
  createdAt: z.string().min(1).max(64).optional(),
  collaboration: z.boolean().optional(),
  budgetCeiling: budgetCeilingSchema.optional(),
  modelReview: z.boolean().optional(),
  retrieval: retrievalSchema.optional(),
});

const decisionSchema = z.strictObject({
  action: z.enum(["approve", "reject"]),
  candidateId: z.enum(CANDIDATE_IDS).optional(),
});

const evalRequestSchema = z.strictObject({
  topologies: z.array(z.enum(ALL_TOPOLOGIES)).min(1).max(ALL_TOPOLOGIES.length).optional(),
  limit: z.int().min(1).max(12).optional(),
  includeCampaign: z.boolean().optional(),
  campaignScenario: z.enum(SCENARIO_NAMES).optional(),
  campaignSeed: z.number().int().min(-1_000_000).max(1_000_000).optional(),
});

type TopologyPassStat = {
  readonly totalCases: number;
  readonly passedCases: number;
  readonly passRate: number;
};

type CaseComparisonEntry = {
  readonly caseId: string;
  readonly title: string;
  readonly archetype: BenchmarkCase["archetype"];
  readonly expectedOutcome: BenchmarkCase["expectations"]["expectedOutcome"];
  readonly targetCandidateId: string | null;
  readonly results: Readonly<Partial<Record<TopologyName, Omit<CaseDetail, "caseId" | "topology">>>>;
  readonly attribution: string;
};

function buildEvalTopologyStats(
  topologies: readonly TopologyName[],
  caseDetails: readonly CaseDetail[],
): Readonly<Partial<Record<TopologyName, TopologyPassStat>>> {
  const stats: Partial<Record<TopologyName, TopologyPassStat>> = {};
  for (const topology of topologies) {
    const items = caseDetails.filter((item) => item.topology === topology);
    const passedCases = items.filter((item) => item.pass).length;
    stats[topology] = {
      totalCases: items.length,
      passedCases,
      passRate: items.length === 0 ? 0 : passedCases / items.length,
    };
  }
  return stats;
}

function summarizeCaseAttribution(
  benchmarkCase: BenchmarkCase,
  results: Readonly<Partial<Record<TopologyName, Omit<CaseDetail, "caseId" | "topology">>>>,
): string {
  const evaluated = ALL_TOPOLOGIES.filter((topology) => results[topology] !== undefined);
  const allPassed = evaluated.length > 0 && evaluated.every((topology) => results[topology]?.pass === true);
  const rule = results.rule;
  const single = results["single-agent"];
  const noReview = results["collab-no-review"];
  const withReview = results["collab-with-review"];
  const targetLabel = benchmarkCase.expectations.targetCandidateId ?? benchmarkCase.expectations.expectedOutcome;

  if (allPassed) {
    if (benchmarkCase.expectations.expectedOutcome === "clarify") {
      const fields = benchmarkCase.expectations.mustClarifyFields?.join("、") ?? "缺失字段";
      return `缺事实主动追问：已评测拓扑（${evaluated.join(" / ")}）均识别缺失字段（${fields}），拒绝凭空编造。`;
    }
    if (benchmarkCase.expectations.expectedOutcome === "reject") {
      const risks = benchmarkCase.expectations.knownRiskIds.join("、");
      return `亏损倒挂阻断：已评测拓扑（${evaluated.join(" / ")}）均检出风控项（${risks}）并系统驳回上架。`;
    }
    if (benchmarkCase.archetype === "failure_recovery") {
      return `容错降级安全：已评测拓扑（${evaluated.join(" / ")}）均安全降级为规则核算并保留完整事件链。`;
    }
    return `已评测拓扑（${evaluated.join(" / ")}）均通过预期校验（判定：${targetLabel}）。`;
  }

  if (withReview?.pass === true && noReview?.pass === false) {
    return `经济修正环收敛：无修正环拓扑在首轮受推广预算或资金红线约束未能翻转；完整编排（collab-with-review）通过 Self-Loop 迭代下调推广预算/折扣消除 fail 后选出目标方案「${targetLabel}」。`;
  }
  if (
    withReview?.pass === true &&
    noReview?.pass === true &&
    (rule?.pass === false || single?.pass === false)
  ) {
    return `多方会签质询翻转：静态规则或单 Agent 被表面高销量与竞品跟价锚吸引误选，三方专家会签通过毛利红线与现金流压力质询后翻转为目标方案「${targetLabel}」。`;
  }
  if (withReview?.pass === true && (rule?.pass === false || single?.pass === false)) {
    const reasons = [
      ...(rule?.pass === false ? [`rule: ${rule.unmatched.join("；")}`] : []),
      ...(single?.pass === false ? [`single-agent: ${single.unmatched.join("；")}`] : []),
    ];
    return `collab-with-review 通过预期「${targetLabel}」，对照拓扑未通过（${reasons.join(" | ")}）。`;
  }

  const failures = evaluated
    .filter((topology) => results[topology]?.pass === false)
    .map((topology) => `${topology}: ${(results[topology]?.unmatched ?? []).join("；")}`);
  return failures.length > 0 ? `未匹配项：${failures.join(" | ")}` : "尚无足够对照数据";
}

function buildEvalCaseComparisons(
  cases: readonly BenchmarkCase[],
  caseDetails: readonly CaseDetail[],
): readonly CaseComparisonEntry[] {
  return cases.map((benchmarkCase) => {
    const results: Partial<Record<TopologyName, Omit<CaseDetail, "caseId" | "topology">>> = {};
    for (const detail of caseDetails) {
      if (detail.caseId !== benchmarkCase.id) continue;
      results[detail.topology] = {
        pass: detail.pass,
        outcome: detail.outcome,
        elapsedMs: detail.elapsedMs,
        tokens: detail.tokens,
        unmatched: detail.unmatched,
        collaborationPresent: detail.collaborationPresent,
        modelReviewPresent: detail.modelReviewPresent,
      };
    }
    return {
      caseId: benchmarkCase.id,
      title: benchmarkCase.title,
      archetype: benchmarkCase.archetype,
      expectedOutcome: benchmarkCase.expectations.expectedOutcome,
      targetCandidateId: benchmarkCase.expectations.targetCandidateId ?? null,
      results,
      attribution: summarizeCaseAttribution(benchmarkCase, results),
    };
  });
}

function formatAgentOpsEvent(event: RunEvent): string {
  return `id: ${String(event.seq)}\nevent: event\ndata: ${JSON.stringify(event)}\n\n`;
}

function formatAgentOpsSnapshot(run: AgentRun): string {
  return `event: snapshot\ndata: ${JSON.stringify(run)}\n\n`;
}

function formatAgentOpsDone(run: AgentRun): string {
  return `event: done\ndata: ${JSON.stringify(run)}\n\n`;
}

let counter = 0;

function newPlanId(): string {
  counter = (counter + 1) % 1296;
  return `p${Date.now().toString(36)}${counter.toString(36).padStart(2, "0")}`;
}

function newRunId(): string {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export type PricingAppOptions = {
  readonly store: PlanStore;
  readonly agentRuns?: AgentRunStore;
  readonly llmSettings?: LlmSettingsStore;
  readonly simshopStore?: RunStore;
  readonly simshopCapture?: CaptureSimShopRun;
  readonly now?: () => Date;
};

export function createPricingApp(options: PricingAppOptions): Hono {
  const app = new Hono();
  const now = options.now ?? (() => new Date());
  const agentRuns = options.agentRuns ?? memoryAgentRunStore();
  const orchestrator = createProductOrchestrator({ store: agentRuns });
  const llmSettings = options.llmSettings ?? openLlmSettingsStore(null, process.env);
  const inFlightDecisions = new Set<string>();

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

  app.post("/api/agentops/intake", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = z.strictObject({ task: z.string().min(1).max(20_000) }).safeParse(body);
    if (!parsed.success) return c.json({ code: "bad-request", detail: parsed.error.message }, 400);
    return c.json(await prepareIntake(parsed.data.task, llmSettings.resolve()));
  });

  app.get("/api/agentops/catalog", (c) =>
    c.json({ agents: AGENTS, tools: TOOL_CATALOG, workflow: DEFAULT_WORKFLOW, templates: WORKFLOW_TEMPLATES }),
  );

  app.get("/api/agentops/runs", (c) => c.json({ runs: orchestrator.list() }));

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

  const streamAgentRun = (
    input: {
      readonly id: string;
      readonly taskText: string;
      readonly autoApprove: boolean;
      readonly createdAt: string;
    },
    runOptions: {
      readonly collaboration?: boolean | undefined;
      readonly budgetCeiling?: z.infer<typeof budgetCeilingSchema> | undefined;
      readonly modelReview?: boolean | undefined;
      readonly retrieval?: z.infer<typeof retrievalSchema> | undefined;
    },
  ): Response => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          // One pre-model snapshot: numeric reports are final before the first model call
          // (model review when configured, otherwise copy), so the UI can show them while a
          // slow provider is still in flight. The gate stays locked until the run is saved.
          let snapshotSent = false;
          const run = await orchestrator.start(input, {
            live: llmSettings.resolve(),
            onEvent: (event, snapshot) => {
              controller.enqueue(encoder.encode(formatAgentOpsEvent(event)));
              const beforeModel = event.type === "review.started"
                || (event.nodeId === "copy" && event.type === "node.output");
              if (beforeModel && !snapshotSent) {
                snapshotSent = true;
                controller.enqueue(encoder.encode(formatAgentOpsSnapshot(snapshot)));
              }
            },
            options: {
              collaboration: runOptions.collaboration,
              strictEvidence: true,
              budgetCeiling: runOptions.budgetCeiling,
              modelReview: runOptions.modelReview,
              retrieval: runOptions.retrieval,
            },
          });
          controller.enqueue(encoder.encode(formatAgentOpsDone(run)));
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Agent run failed";
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ code: "run-failed", detail })}\n\n`),
          );
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { status: 200, headers: SSE_HEADERS });
  };

  app.post("/api/agentops/runs/stream", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = runRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ code: "bad-request", detail: parsed.error.message }, 400);
    const id = parsed.data.id ?? newRunId();
    const createdAt = parsed.data.createdAt ?? now().toISOString();
    return streamAgentRun(
      {
        id,
        taskText: parsed.data.task,
        autoApprove: parsed.data.autoApprove ?? true,
        createdAt,
      },
      {
        collaboration: parsed.data.collaboration,
        budgetCeiling: parsed.data.budgetCeiling,
        modelReview: parsed.data.modelReview,
        retrieval: parsed.data.retrieval,
      },
    );
  });

  app.post("/api/agentops/runs", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = runRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ code: "bad-request", detail: parsed.error.message }, 400);
    const id = parsed.data.id ?? newRunId();
    const createdAt = parsed.data.createdAt ?? now().toISOString();
    const input = {
      id,
      taskText: parsed.data.task,
      autoApprove: parsed.data.autoApprove ?? true,
      createdAt,
    };
    const runOptions = {
      collaboration: parsed.data.collaboration,
      budgetCeiling: parsed.data.budgetCeiling,
      modelReview: parsed.data.modelReview,
      retrieval: parsed.data.retrieval,
    };
    if (c.req.header("accept")?.includes("text/event-stream") === true) {
      return streamAgentRun(input, runOptions);
    }
    try {
      const run = await orchestrator.start(input, {
        live: llmSettings.resolve(),
        options: {
          collaboration: parsed.data.collaboration,
          strictEvidence: true,
          budgetCeiling: parsed.data.budgetCeiling,
          modelReview: parsed.data.modelReview,
          retrieval: parsed.data.retrieval,
        },
      });
      return c.json(run, 201);
    } catch (error) {
      return c.json({ code: "run-failed", detail: error instanceof Error ? error.message : "Agent run failed" }, 422);
    }
  });

  app.post("/api/agentops/runs/:id/decision", async (c) => {
    const id = c.req.param("id");
    if (inFlightDecisions.has(id)) {
      return c.json(
        {
          code: "decision-in-progress",
          id,
          detail: "该运行正在处理另一项审批请求，请勿并发提交",
        },
        409,
      );
    }
    const existing = orchestrator.inspect(id);
    if (existing.kind === "missing") {
      return c.json({ code: "run-not-found", id }, 404);
    }
    if (existing.kind === "corrupt") {
      return c.json({ code: "run-corrupt", id, detail: existing.reason }, 422);
    }
    inFlightDecisions.add(id);
    try {
      const body: unknown = await c.req.json().catch(() => null);
      const parsed = decisionSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ code: "bad-request", detail: parsed.error.message }, 400);
      }
      const updated = await orchestrator.resume(id, parsed.data);
      return c.json(updated, 200);
    } catch (error) {
      if (error instanceof ProductRunNotFoundError) {
        return c.json({ code: "run-not-found", id }, 404);
      }
      if (error instanceof ProductRunCorruptError) {
        return c.json({ code: "run-corrupt", id, detail: error.message }, 422);
      }
      if (error instanceof DecisionConflictError) {
        return c.json({ code: error.code, id, status: error.status, detail: error.message }, 409);
      }
      return c.json({ code: "decision-failed", detail: error instanceof Error ? error.message : "Decision failed" }, 422);
    } finally {
      inFlightDecisions.delete(id);
    }
  });

  app.get("/api/agentops/runs/:id", (c) => {
    const inspected = orchestrator.inspect(c.req.param("id"));
    if (inspected.kind === "missing") return c.json({ code: "run-not-found", detail: "找不到这份评审卷宗" }, 404);
    if (inspected.kind === "corrupt") return c.json({ code: "run-corrupt", detail: inspected.reason }, 422);
    return c.json(inspected.run);
  });

  app.get("/api/agentops/runs/:id/events", (c) => {
    const inspected = orchestrator.inspect(c.req.param("id"));
    return inspected.kind !== "ok"
      ? c.json({ code: "run-not-found" }, 404)
      : c.json({ events: inspected.run.events, fingerprint: inspected.run.fingerprint });
  });


  app.post("/api/agentops/eval", async (c) => {
    const body = await readOptionalJsonBody(c);
    const parsed = evalRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ code: "bad-request", detail: parsed.error.message }, 400);
    const topologies = parsed.data.topologies ?? ["rule"];
    const cases = parsed.data.limit === undefined ? BENCHMARK_CASES : BENCHMARK_CASES.slice(0, parsed.data.limit);
    const needsLive = topologies.some((topology) => topologyConfig(topology).useLive);
    try {
      const result = await runEvaluationSuite({
        topologies,
        cases,
        live: needsLive ? llmSettings.resolve() : null,
      });
      const topologyStats = buildEvalTopologyStats(topologies, result.caseDetails);
      const caseComparisons = buildEvalCaseComparisons(cases, result.caseDetails);
      const campaignEvaluation =
        parsed.data.includeCampaign === true
          ? buildCampaignCompareResponse(
              await runCampaignEvaluation({
                ...(parsed.data.campaignScenario === undefined
                  ? {}
                  : { scenarios: [parsed.data.campaignScenario] }),
                seed: parsed.data.campaignSeed ?? 7,
              }),
            )
          : undefined;
      return c.json({
        ...result,
        topologyStats,
        caseComparisons,
        ...(campaignEvaluation === undefined ? {} : { campaignEvaluation }),
      });
    } catch (error) {
      return c.json(
        { code: "eval-failed", detail: error instanceof Error ? error.message : "Evaluation failed" },
        422,
      );
    }
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

  registerSimShopRoutes(app, {
    store: options.simshopStore,
    capture: options.simshopCapture,
    now,
  });

  return app;
}
