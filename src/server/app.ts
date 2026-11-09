import { Hono } from "hono";
import { z } from "zod";

import { isSeed } from "../templates/simshop/market/brand.js";
import { SCENARIO_NAMES, isScenarioName, loadScenario } from "../templates/simshop/market/scenario.js";
import { captureRun, type RunRecord } from "./capture.js";
import { sealLedger } from "./ledger-chain.js";
import { SSE_HEADERS, frameStream, parseLastEventId } from "./sse.js";
import type { RunStore } from "./store.js";

export const SERVER_HOST = "127.0.0.1";
export const SERVER_PORT = 47321;
export const WEB_HOST = "127.0.0.1";
export const WEB_PORT = 47322;

export type ModeInfo = {
  readonly llmMode: "mock";
  readonly keyPresent: boolean;
  readonly badge: string;
  readonly detail: string;
};

export function detectMode(env: NodeJS.ProcessEnv): ModeInfo {
  const key = env["OPENAI_API_KEY"] ?? env["DASHSCOPE_API_KEY"] ?? env["DEEPSEEK_API_KEY"] ?? "";
  if (key.trim().length > 0) {
    return {
      llmMode: "mock",
      keyPresent: true,
      badge: "检测到密钥 · 本单元运行源仍是 Mock LLM",
      detail:
        "环境里存在模型密钥，但 U5 的运行源只有 Mock 与回放两条确定性路径。本控制台不接真实模型，避免界面上的数字和事件对不上。",
    };
  }
  return {
    llmMode: "mock",
    keyPresent: false,
    badge: "无密钥模式 · Mock LLM 确定性运行",
    detail:
      "没有配置模型密钥。所有数字来自规则市场与 Mock LLM 的确定性运行，演示可以完整走完 8 回合，且每次重放哈希相同。",
  };
}

const createRunBody = z.strictObject({
  scenario: z.enum(SCENARIO_NAMES),
  seed: z.number().int(),
  profile: z.enum(["steady", "stressed"]),
});

function scenarioCatalog() {
  return SCENARIO_NAMES.map((name) => {
    const loaded = loadScenario(name);
    return {
      name,
      rounds: loaded.truth.rounds,
      primaryCapacity: loaded.truth.suppliers.primary.capacityByRound,
      backupCapacity: loaded.truth.suppliers.backup.capacityByRound,
      competitorPrice: {
        tea: loaded.truth.competitorPrice.tea,
        snack: loaded.truth.competitorPrice.snack,
      },
      initial: {
        cash: loaded.initial.cash,
        reputation: loaded.initial.reputation,
        inventory: loaded.initial.inventory,
      },
    };
  });
}

export type AppOptions = {
  readonly store: RunStore;
  readonly mode: ModeInfo;
  readonly capture?: (input: {
    readonly scenario: (typeof SCENARIO_NAMES)[number];
    readonly seed: number;
    readonly profile: "steady" | "stressed";
  }) => Promise<RunRecord>;
};

function loadOr404(store: RunStore, runId: string): RunRecord | Response {
  const record = store.load(runId);
  if (record === undefined) {
    return Response.json({ code: "run-not-found", runId }, { status: 404 });
  }
  return record;
}

export function createApp(options: AppOptions): Hono {
  const app = new Hono();
  const capture = options.capture ?? captureRun;

  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("access-control-allow-origin", "*");
    c.res.headers.set("access-control-allow-headers", "content-type, last-event-id");
    c.res.headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  });

  app.options("*", (c) => c.body(null, 204));

  app.get("/api/health", (c) =>
    c.json({ ok: true, service: "u7-console", server: `${SERVER_HOST}:${String(SERVER_PORT)}` }),
  );

  app.get("/api/mode", (c) => c.json({ ...options.mode, scenarios: scenarioCatalog() }));

  app.get("/api/runs", (c) => c.json({ runs: options.store.list() }));

  app.post("/api/runs", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = createRunBody.safeParse(body);
    if (!parsed.success) {
      return c.json({ code: "bad-request", detail: parsed.error.message }, 400);
    }
    if (!isSeed(parsed.data.seed)) {
      return c.json({ code: "bad-seed", detail: "seed is out of range" }, 400);
    }
    if (!isScenarioName(parsed.data.scenario)) {
      return c.json({ code: "bad-scenario" }, 400);
    }
    const record = await capture(parsed.data);
    options.store.save(record);
    return c.json({ runId: record.meta.runId, meta: record.meta }, 201);
  });

  app.get("/api/runs/:runId", (c) => {
    const record = loadOr404(options.store, c.req.param("runId"));
    if (record instanceof Response) {
      return record;
    }
    return c.json(record);
  });

  app.get("/api/runs/:runId/ledger", (c) => {
    const record = loadOr404(options.store, c.req.param("runId"));
    if (record instanceof Response) {
      return record;
    }
    const ledger = sealLedger(record.frames);
    return c.json({
      runId: record.meta.runId,
      finalHash: ledger.finalHash,
      matchesRunHash: ledger.finalHash === record.meta.finalHash,
      rounds: ledger.rounds.map((round) => ({
        round: round.round,
        locked: round.locked,
        source: round.source,
        hash: round.hash,
        prevHash: round.prevHash,
        decisionHash: round.decisionHash,
        outcome: round.outcome,
      })),
    });
  });

  app.get("/api/runs/:runId/events", (c) => {
    const record = loadOr404(options.store, c.req.param("runId"));
    if (record instanceof Response) {
      return record;
    }
    const since = parseLastEventId(c.req.query("since"));
    const frames = record.frames.filter((frame) => frame.seq > since);
    return c.json({ runId: record.meta.runId, since, lastSeq: record.frames.at(-1)?.seq ?? 0, frames });
  });

  app.get("/api/runs/:runId/stream", (c) => {
    const record = loadOr404(options.store, c.req.param("runId"));
    if (record instanceof Response) {
      return record;
    }
    const headerId = c.req.header("last-event-id") ?? c.req.query("lastEventId");
    const since = parseLastEventId(headerId);
    const paceRaw = c.req.query("pace");
    const paceParsed = paceRaw === undefined ? 90 : Number(paceRaw);
    const paceMs = Number.isFinite(paceParsed) ? Math.max(0, Math.min(2000, paceParsed)) : 90;
    const stream = frameStream({
      frames: record.frames,
      since,
      paceMs,
      signal: c.req.raw.signal,
    });
    return new Response(stream, { headers: SSE_HEADERS });
  });

  app.post("/api/runs/:runId/rounds/:round/commit", (c) => {
    const record = loadOr404(options.store, c.req.param("runId"));
    if (record instanceof Response) {
      return record;
    }
    const roundText = c.req.param("round");
    if (!/^\d+$/.test(roundText)) {
      return c.json({ code: "bad-round", detail: "round must be a non-negative integer" }, 400);
    }
    const round = Number(roundText);
    const ledger = sealLedger(record.frames);
    const sealed = ledger.rounds.find((row) => row.round === round);
    if (sealed === undefined) {
      return c.json({ code: "round-not-found", round }, 404);
    }
    return c.json(
      {
        code: "round-locked",
        round,
        storedDecisionHash: sealed.decisionHash,
        hash: sealed.hash,
        detail: `第 ${String(round + 1)} 回合已结算并锁定，提交接口拒绝任何重做`,
      },
      409,
    );
  });

  return app;
}
