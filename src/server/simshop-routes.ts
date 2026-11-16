import { Hono, type Context } from "hono";
import path from "node:path";
import { z } from "zod";

import { defaultEventDbPath } from "../engine/events/store.js";
import { isRunId } from "../engine/ids.js";
import {
  runCampaignEvaluation,
  type CampaignEvalOptions,
  type CampaignEvalResult,
  type CampaignScenarioWinner,
  type CampaignTopology,
} from "../templates/agentops/eval/harness.js";
import { isSeed } from "../templates/simshop/market/brand.js";
import {
  SCENARIO_NAMES,
  isScenarioName,
  loadScenario,
  type ScenarioName,
} from "../templates/simshop/market/scenario.js";
import { plannedRoundCalls } from "../templates/simshop/workflows/round.js";
import { captureRun, type RunMeta, type RunProfile, type RunRecord } from "./capture.js";
import type {
  BudgetFrame,
  CommitFrame,
  LoopFrame,
  NodeFrame,
  OutcomeRow,
  QuoteFrame,
  ReflectFrame,
  SettleFrame,
} from "./frames.js";
import { sealLedger } from "./ledger-chain.js";
import type { RunStore } from "./store.js";

const sourceProductSchema = z.strictObject({
  name: z.string().min(1).max(80).optional(),
  priceCents: z.number().int().min(1).max(100_000_000).optional(),
  buyCents: z.number().int().min(0).max(100_000_000).optional(),
  competitorCents: z.number().int().min(1).max(100_000_000).optional(),
});

const createRunRequestSchema = z.strictObject({
  scenario: z.enum(SCENARIO_NAMES),
  seed: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  profile: z.enum(["steady", "stressed"]).optional(),
  sourceProduct: sourceProductSchema.optional(),
});

const compareRequestSchema = z.strictObject({
  scenario: z.enum(SCENARIO_NAMES).optional(),
  scenarios: z.array(z.enum(SCENARIO_NAMES)).min(1).max(SCENARIO_NAMES.length).optional(),
  seed: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  includeStressedAudit: z.boolean().optional(),
});

export type SimShopSourceProduct = z.infer<typeof sourceProductSchema>;

export type CaptureSimShopRun = (input: {
  readonly scenario: ScenarioName;
  readonly seed: number;
  readonly profile: RunProfile;
  readonly now?: () => Date;
}) => Promise<RunRecord>;

export type CompareSimShopCampaign = (options?: CampaignEvalOptions) => Promise<CampaignEvalResult>;

export type SimShopRoutesOptions = {
  readonly store?: RunStore | undefined;
  readonly capture?: CaptureSimShopRun | undefined;
  readonly compareCampaign?: CompareSimShopCampaign | undefined;
  readonly now?: (() => Date) | undefined;
};

type ScenarioTextMeta = {
  readonly title: string;
  readonly highlight: string;
  readonly description: string;
};

const SCENARIO_META: Readonly<Record<ScenarioName, ScenarioTextMeta>> = {
  spring: {
    title: "春季开学大促（稳态基准对照）",
    highlight: "主备产能充足 · 检验日常补货与跨回合热升级",
    description:
      "8 回合需求平稳且主/备供应商产能均保持 80 件/回合。用于验证多 Agent 并行提案、Critic 核验与第 1 回合结束后的策略热升级基线表现。",
  },
  supplycut: {
    title: "主供应商突发断供（供应链应急博弈）",
    highlight: "第 2-3 回合主供断供 · 触发三轮议价子工作流",
    description:
      "主供应商在第 2、3 回合（roundIndex 1、2）产能突然归零。规划器按需激活 supply-negotiation 子工作流，对主/备供应商开展最多 3 轮让步报价与规则脱敏校验，切换高价备供守住库存与声誉。",
  },
  pricewar: {
    title: "竞品恶性价格战（边际收益预算仲裁）",
    highlight: "第 3 回合起竞品腰斩 60% · 触发零分配防亏损仲裁",
    description:
      "第 3 回合（roundIndex 2）起茶叶与零食竞品价格骤降 60%（低至成本一半）。沙盘边际收益仲裁台测算降价与投流边际收益均为负值，果断分配 0 元避免无底洞亏损。",
  },
};

const AGENT_LABELS: Readonly<Record<string, string>> = {
  buyer: "采购 Agent",
  pricer: "定价 Agent",
  marketer: "投放 Agent",
  critic: "风控 Critic",
  reflect: "复盘 Reflect",
  plan: "动态规划器",
  proposals: "并行提案组",
  "price-war": "价格战检测",
  arbitrate: "边际预算仲裁",
  "hold-budget": "维持预算",
  supply: "断供条件分支",
  negotiate: "议价子工作流",
  "supply-negotiation": "三轮议价子工作流",
  "skip-supply": "跳过议价",
  revise: "Critic 修正循环",
  seal: "不可逆账本封存",
};

const STOP_REASON_LABELS: Readonly<Record<string, string>> = {
  passed: "一次性通过核验",
  maxIterations: "达到最大修正轮次上限（启用规则兜底）",
  budget: "触发调用预算上限（启用规则兜底）",
  rejected: "被风控驳回（启用规则兜底）",
};

const RULING_LABELS: Readonly<Record<QuoteFrame["ruling"], string>> = {
  accept: "成交 (accept)",
  counter: "还价 (counter)",
  walk: "退出 (walk)",
};

const VERDICT_LABELS: Readonly<Record<LoopFrame["verdict"], string>> = {
  pass: "通过 (pass)",
  revise: "修正中 (revise)",
  reject: "驳回 (reject)",
};

function formatYuanFromCents(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

function buildSourceContextNote(sourceProduct: SimShopSourceProduct | null): string | null {
  if (sourceProduct === null) return null;
  const parts: string[] = [];
  if (sourceProduct.name !== undefined) parts.push(`商品「${sourceProduct.name}」`);
  if (sourceProduct.priceCents !== undefined) parts.push(`建议售价 ${formatYuanFromCents(sourceProduct.priceCents)}`);
  if (sourceProduct.buyCents !== undefined) parts.push(`采购成本 ${formatYuanFromCents(sourceProduct.buyCents)}`);
  if (sourceProduct.competitorCents !== undefined) {
    parts.push(`竞品价 ${formatYuanFromCents(sourceProduct.competitorCents)}`);
  }
  const summary = parts.length > 0 ? parts.join("，") : "来自单品会签台的商品上下文";
  return `已从单品多维会签台带入上下文（${summary}）；8 回合仿真严格遵循所选剧本的确定性双 SKU 市场规则与 SHA-256 账本链。`;
}

export type SimShopScenarioDetail = {
  readonly name: ScenarioName;
  readonly title: string;
  readonly highlight: string;
  readonly description: string;
  readonly rounds: number;
  readonly primaryCapacity: readonly number[];
  readonly backupCapacity: readonly number[];
  readonly competitorPrice: {
    readonly tea: readonly number[];
    readonly snack: readonly number[];
  };
  readonly suppliers: {
    readonly primary: {
      readonly label: string;
      readonly leadTime: number;
      readonly unitCost: { readonly tea: number; readonly snack: number };
      readonly capacityByRound: readonly number[];
    };
    readonly backup: {
      readonly label: string;
      readonly leadTime: number;
      readonly unitCost: { readonly tea: number; readonly snack: number };
      readonly capacityByRound: readonly number[];
    };
  };
  readonly skus: {
    readonly tea: { readonly label: string; readonly baseDemand: number; readonly refPrice: number };
    readonly snack: { readonly label: string; readonly baseDemand: number; readonly refPrice: number };
  };
  readonly initial: {
    readonly cash: number;
    readonly reputation: number;
    readonly inventory: { readonly tea: number; readonly snack: number };
  };
};

export function scenarioCatalog(): readonly SimShopScenarioDetail[] {
  return SCENARIO_NAMES.map((name) => {
    const loaded = loadScenario(name);
    const copy = SCENARIO_META[name];
    return {
      name,
      title: copy.title,
      highlight: copy.highlight,
      description: copy.description,
      rounds: loaded.truth.rounds,
      primaryCapacity: [...loaded.truth.suppliers.primary.capacityByRound],
      backupCapacity: [...loaded.truth.suppliers.backup.capacityByRound],
      competitorPrice: {
        tea: [...loaded.truth.competitorPrice.tea],
        snack: [...loaded.truth.competitorPrice.snack],
      },
      suppliers: {
        primary: {
          label: "主供应商（低价主力）",
          leadTime: loaded.truth.suppliers.primary.leadTime,
          unitCost: { ...loaded.truth.suppliers.primary.unitCost },
          capacityByRound: [...loaded.truth.suppliers.primary.capacityByRound],
        },
        backup: {
          label: "备用供应商（应急备选）",
          leadTime: loaded.truth.suppliers.backup.leadTime,
          unitCost: { ...loaded.truth.suppliers.backup.unitCost },
          capacityByRound: [...loaded.truth.suppliers.backup.capacityByRound],
        },
      },
      skus: {
        tea: { label: "茶叶礼盒 (tea)", ...loaded.truth.skus.tea },
        snack: { label: "坚果零食 (snack)", ...loaded.truth.skus.snack },
      },
      initial: {
        cash: loaded.initial.cash,
        reputation: loaded.initial.reputation,
        inventory: { ...loaded.initial.inventory },
      },
    };
  });
}

export type SimShopQuoteView = QuoteFrame & {
  readonly roundLabel: string;
  readonly supplierLabel: string;
  readonly skuLabel: string;
  readonly rulingLabel: string;
  readonly talkLabel: string;
};

export type SimShopPriceWarView = BudgetFrame & {
  readonly roundLabel: string;
  readonly rationale: string;
};

export type SimShopLoopView = LoopFrame & {
  readonly roundLabel: string;
  readonly verdictLabel: string;
  readonly stopReasonLabel: string;
};

export type SimShopVersionUpgradeView = {
  readonly seq: number;
  readonly round: number;
  readonly roundLabel: string;
  readonly agentId: string;
  readonly agentLabel: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly fromPromptHash: string;
  readonly toPromptHash: string;
  readonly reason: string;
};

export type SimShopAgentVersionSnapshot = {
  readonly agentId: string;
  readonly agentLabel: string;
  readonly version: string;
  readonly promptHash: string;
};

export type SimShopNodeTraceItem = {
  readonly seq: number;
  readonly nodeId: string;
  readonly nodeLabel: string;
  readonly event: NodeFrame["event"];
  readonly reason: string;
  readonly agent?: string;
  readonly version?: string;
  readonly promptHash?: string;
  readonly score?: number;
};

export type SimShopSealedRoundView = {
  readonly round: number;
  readonly roundLabel: string;
  readonly locked: boolean;
  readonly source: string;
  readonly sourceLabel: string;
  readonly hash: string;
  readonly prevHash: string;
  readonly decisionHash: string;
  readonly observationHash: string;
  readonly beliefHash: string;
  readonly overlayHash: string;
  readonly outcome: OutcomeRow;
};

export type SimShopRoundView = {
  readonly round: number;
  readonly roundLabel: string;
  readonly calls: number;
  readonly plannedCalls: number;
  readonly stopReason: string | null;
  readonly stopReasonLabel: string;
  readonly usedFallback: boolean;
  readonly supplyTriggered: boolean;
  readonly priceWarTriggered: boolean;
  readonly activatedSubflows: readonly string[];
  readonly activatedNodes: readonly SimShopNodeTraceItem[];
  readonly agentVersions: readonly SimShopAgentVersionSnapshot[];
  readonly competitorPrice: { readonly tea: number; readonly snack: number };
  readonly supplierCapacity: { readonly primary: number; readonly backup: number };
  readonly commit: {
    readonly decisionHash: string;
    readonly observationHash: string;
    readonly source: string;
    readonly sourceLabel: string;
    readonly adSpend: number;
    readonly orders: CommitFrame["orders"];
  } | null;
  readonly outcome: OutcomeRow | null;
  readonly reflect: {
    readonly beliefHash: string;
    readonly overlayHash: string;
  } | null;
  readonly ledger: {
    readonly locked: boolean;
    readonly hash: string;
    readonly prevHash: string;
    readonly decisionHash: string;
  } | null;
  readonly loops: readonly SimShopLoopView[];
  readonly quotes: readonly SimShopQuoteView[];
  readonly priceWars: readonly SimShopPriceWarView[];
};

export type SimShopRunTotals = {
  readonly totalProfit: number;
  readonly totalRevenue: number;
  readonly totalOrderCost: number;
  readonly totalHolding: number;
  readonly totalAdSpend: number;
  readonly totalSales: number;
  readonly totalMissed: number;
  readonly finalCash: number;
  readonly finalReputation: number;
  readonly minInventory: number;
  readonly totalCalls: number;
  readonly totalQuotes: number;
  readonly acceptedQuotes: number;
  readonly priceWarCount: number;
  readonly versionUpgradeCount: number;
  readonly fallbackRounds: number;
};

export type SimShopRunView = RunRecord & {
  readonly sourceProduct: SimShopSourceProduct | null;
  readonly sourceContextNote: string | null;
  readonly scenarioInfo: SimShopScenarioDetail;
  readonly ledger: {
    readonly finalHash: string;
    readonly matchesRunHash: boolean;
    readonly ledgerHash: string;
    readonly rounds: readonly SimShopSealedRoundView[];
  };
  readonly rounds: readonly SimShopRoundView[];
  readonly quotes: readonly SimShopQuoteView[];
  readonly priceWars: readonly SimShopPriceWarView[];
  readonly loops: readonly SimShopLoopView[];
  readonly versionUpgrades: readonly SimShopVersionUpgradeView[];
  readonly totals: SimShopRunTotals;
};

type StoredSimShopRecord = RunRecord & {
  readonly sourceProduct?: SimShopSourceProduct | undefined;
};

function readSourceProduct(record: RunRecord, fallback?: SimShopSourceProduct): SimShopSourceProduct | null {
  const embedded = (record as StoredSimShopRecord).sourceProduct;
  if (embedded !== undefined) return embedded;
  return fallback ?? null;
}

export function simshopRunsDirectory(from: string = process.cwd()): string {
  return path.join(path.dirname(defaultEventDbPath(from)), "simshop-runs");
}

export function memorySimShopRunStore(): RunStore {
  const records = new Map<string, RunRecord>();
  return {
    save(record) {
      records.set(record.meta.runId, record);
    },
    load(runId) {
      return records.get(runId);
    },
    list() {
      const metas: RunMeta[] = [];
      for (const record of records.values()) {
        metas.push(record.meta);
      }
      metas.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      return metas;
    },
  };
}

export const memoryRunStore = memorySimShopRunStore;

function toQuoteView(frame: QuoteFrame): SimShopQuoteView {
  return {
    ...frame,
    roundLabel: `第 ${String(frame.round + 1)} 回合`,
    supplierLabel: frame.supplier === "primary" ? "主供应商" : "备用供应商",
    skuLabel: frame.sku === "tea" ? "茶叶礼盒 (tea)" : "坚果零食 (snack)",
    rulingLabel: RULING_LABELS[frame.ruling],
    talkLabel: frame.talkAccepted ? "合规话术（未泄露底价）" : "触发底价脱敏拦截",
  };
}

function toPriceWarView(frame: BudgetFrame): SimShopPriceWarView {
  const noAllocation = frame.allocation.ads === 0 && frame.allocation.priceCut === 0;
  return {
    ...frame,
    roundLabel: `第 ${String(frame.round + 1)} 回合`,
    rationale: noAllocation
      ? `竞品大幅降价导致降价边际收益 (${String(frame.amounts.priceCut)} 分) 与投流边际收益 (${String(frame.amounts.ads)} 分) 均 ≤ 0，仲裁台分配 0 元以避免越卖越亏`
      : `按正边际收益加权分配：投流 ${String(frame.allocation.ads)} 分，降价 ${String(frame.allocation.priceCut)} 分`,
  };
}

function toLoopView(frame: LoopFrame): SimShopLoopView {
  return {
    ...frame,
    roundLabel: `第 ${String(frame.round + 1)} 回合`,
    verdictLabel: VERDICT_LABELS[frame.verdict],
    stopReasonLabel:
      frame.stopReason === null
        ? "继续迭代修正"
        : (STOP_REASON_LABELS[frame.stopReason] ?? frame.stopReason),
  };
}

function toNodeTraceItem(frame: NodeFrame): SimShopNodeTraceItem {
  return {
    seq: frame.seq,
    nodeId: frame.nodeId,
    nodeLabel: AGENT_LABELS[frame.nodeId] ?? frame.nodeId,
    event: frame.event,
    reason: frame.reason,
    ...(frame.agent === undefined ? {} : { agent: frame.agent }),
    ...(frame.version === undefined ? {} : { version: frame.version }),
    ...(frame.promptHash === undefined ? {} : { promptHash: frame.promptHash }),
    ...(frame.score === undefined ? {} : { score: frame.score }),
  };
}

export function buildSimShopRunView(
  record: RunRecord,
  fallbackSourceProduct?: SimShopSourceProduct,
): SimShopRunView {
  const sourceProduct = readSourceProduct(record, fallbackSourceProduct);
  const scenarioInfo = scenarioCatalog().find((item) => item.name === record.meta.scenario)
    ?? scenarioCatalog()[0]!;
  const sealedLedger = sealLedger(record.frames);

  const quotes: SimShopQuoteView[] = [];
  const priceWars: SimShopPriceWarView[] = [];
  const loops: SimShopLoopView[] = [];
  const versionUpgrades: SimShopVersionUpgradeView[] = [];

  const quotesByRound = new Map<number, SimShopQuoteView[]>();
  const priceWarsByRound = new Map<number, SimShopPriceWarView[]>();
  const loopsByRound = new Map<number, SimShopLoopView[]>();
  const nodesByRound = new Map<number, SimShopNodeTraceItem[]>();
  const subflowsByRound = new Map<number, Set<string>>();
  const versionsByRound = new Map<number, Map<string, SimShopAgentVersionSnapshot>>();
  const commitByRound = new Map<number, CommitFrame>();
  const settleByRound = new Map<number, SettleFrame>();
  const reflectByRound = new Map<number, ReflectFrame>();

  const seenAgentVersions = new Map<string, { readonly version: string; readonly promptHash: string }>();
  const seenUpgrades = new Set<string>();
  let activeRound = -1;

  for (const frame of record.frames) {
    if (frame.kind === "node") {
      if (frame.nodeId === "buyer" && frame.reason.startsWith("accepted")) {
        activeRound += 1;
      }
      const roundIdx = Math.max(0, activeRound);
      const bucket = nodesByRound.get(roundIdx) ?? [];
      bucket.push(toNodeTraceItem(frame));
      nodesByRound.set(roundIdx, bucket);

      if (frame.nodeId === "supply-negotiation" && frame.reason.includes("supply-negotiation")) {
        const subflows = subflowsByRound.get(roundIdx) ?? new Set<string>();
        subflows.add("supply-negotiation");
        subflowsByRound.set(roundIdx, subflows);
      }

      if (frame.version !== undefined && frame.promptHash !== undefined) {
        const snapshotMap = versionsByRound.get(roundIdx) ?? new Map<string, SimShopAgentVersionSnapshot>();
        snapshotMap.set(frame.nodeId, {
          agentId: frame.nodeId,
          agentLabel: AGENT_LABELS[frame.nodeId] ?? frame.nodeId,
          version: frame.version,
          promptHash: frame.promptHash,
        });
        versionsByRound.set(roundIdx, snapshotMap);

        const prev = seenAgentVersions.get(frame.nodeId);
        if (prev !== undefined && (prev.version !== frame.version || prev.promptHash !== frame.promptHash)) {
          const upgradeKey = `${frame.nodeId}|${prev.version}|${frame.version}|${frame.promptHash}`;
          if (!seenUpgrades.has(upgradeKey)) {
            seenUpgrades.add(upgradeKey);
            versionUpgrades.push({
              seq: frame.seq,
              round: roundIdx,
              roundLabel: `第 ${String(roundIdx + 1)} 回合`,
              agentId: frame.nodeId,
              agentLabel: AGENT_LABELS[frame.nodeId] ?? frame.nodeId,
              fromVersion: prev.version,
              toVersion: frame.version,
              fromPromptHash: prev.promptHash,
              toPromptHash: frame.promptHash,
              reason: "跨回合复盘（Reflect）写入新策略补丁，调度器热升级生效",
            });
          }
        }
        seenAgentVersions.set(frame.nodeId, { version: frame.version, promptHash: frame.promptHash });
      }
      continue;
    }

    if (frame.kind === "quote") {
      activeRound = Math.max(activeRound, frame.round);
      const q = toQuoteView(frame);
      quotes.push(q);
      const bucket = quotesByRound.get(frame.round) ?? [];
      bucket.push(q);
      quotesByRound.set(frame.round, bucket);
      continue;
    }

    if (frame.kind === "budget") {
      activeRound = Math.max(activeRound, frame.round);
      const pw = toPriceWarView(frame);
      priceWars.push(pw);
      const bucket = priceWarsByRound.get(frame.round) ?? [];
      bucket.push(pw);
      priceWarsByRound.set(frame.round, bucket);
      continue;
    }

    if (frame.kind === "loop") {
      activeRound = Math.max(activeRound, frame.round);
      const lv = toLoopView(frame);
      loops.push(lv);
      const bucket = loopsByRound.get(frame.round) ?? [];
      bucket.push(lv);
      loopsByRound.set(frame.round, bucket);
      continue;
    }

    if (frame.kind === "commit") {
      commitByRound.set(frame.round, frame);
      continue;
    }
    if (frame.kind === "settle") {
      settleByRound.set(frame.round, frame);
      continue;
    }
    if (frame.kind === "reflect") {
      reflectByRound.set(frame.round, frame);
    }
  }

  const sealedByRound = new Map(sealedLedger.rounds.map((row) => [row.round, row]));
  const runningVersions = new Map<string, SimShopAgentVersionSnapshot>();
  const rounds: SimShopRoundView[] = [];
  const totalRounds = Math.max(record.meta.rounds, record.meta.summary.length);

  for (let r = 0; r < totalRounds; r += 1) {
    const summaryRow = record.meta.summary.find((item) => item.round === r);
    const commit = commitByRound.get(r) ?? null;
    const settle = settleByRound.get(r) ?? null;
    const reflect = reflectByRound.get(r) ?? null;
    const sealed = sealedByRound.get(r) ?? null;
    const roundVersions = versionsByRound.get(r);
    if (roundVersions !== undefined) {
      for (const [id, snap] of roundVersions) {
        runningVersions.set(id, snap);
      }
    }
    const roundQuotes = quotesByRound.get(r) ?? [];
    const roundPriceWars = priceWarsByRound.get(r) ?? [];
    const roundLoops = loopsByRound.get(r) ?? [];
    const subflows = subflowsByRound.get(r);
    const supplyTriggered = summaryRow?.supply ?? roundQuotes.length > 0;
    const activatedSubflows = subflows !== undefined
      ? [...subflows]
      : supplyTriggered
        ? ["supply-negotiation"]
        : [];
    const stopReason = summaryRow?.stopReason ?? roundLoops.at(-1)?.stopReason ?? null;

    rounds.push({
      round: r,
      roundLabel: `第 ${String(r + 1)} 回合`,
      calls: summaryRow?.calls ?? 0,
      plannedCalls: plannedRoundCalls({
        supplyCut: supplyTriggered,
        stressed: record.meta.profile === "stressed",
      }),
      stopReason,
      stopReasonLabel: stopReason === null ? "正常结算" : (STOP_REASON_LABELS[stopReason] ?? stopReason),
      usedFallback: summaryRow?.usedFallback ?? false,
      supplyTriggered,
      priceWarTriggered: roundPriceWars.length > 0,
      activatedSubflows,
      activatedNodes: nodesByRound.get(r) ?? [],
      agentVersions: [...runningVersions.values()],
      competitorPrice: {
        tea: scenarioInfo.competitorPrice.tea[r] ?? scenarioInfo.competitorPrice.tea.at(-1) ?? 0,
        snack: scenarioInfo.competitorPrice.snack[r] ?? scenarioInfo.competitorPrice.snack.at(-1) ?? 0,
      },
      supplierCapacity: {
        primary: scenarioInfo.primaryCapacity[r] ?? 0,
        backup: scenarioInfo.backupCapacity[r] ?? 0,
      },
      commit: commit === null
        ? null
        : {
            decisionHash: commit.decisionHash,
            observationHash: commit.observationHash,
            source: commit.source,
            sourceLabel: commit.source === "verified" ? "多Agent核验通过" : "规则兜底回退",
            adSpend: commit.adSpend,
            orders: commit.orders,
          },
      outcome: settle?.outcome ?? sealed?.outcome ?? null,
      reflect: reflect === null
        ? null
        : { beliefHash: reflect.beliefHash, overlayHash: reflect.overlayHash },
      ledger: sealed === null
        ? null
        : {
            locked: sealed.locked,
            hash: sealed.hash,
            prevHash: sealed.prevHash,
            decisionHash: sealed.decisionHash,
          },
      loops: roundLoops,
      quotes: roundQuotes,
      priceWars: roundPriceWars,
    });
  }

  let totalProfit = 0;
  let totalRevenue = 0;
  let totalOrderCost = 0;
  let totalHolding = 0;
  let totalAdSpend = 0;
  let totalSales = 0;
  let totalMissed = 0;
  for (const row of rounds) {
    if (row.outcome === null) continue;
    totalProfit += row.outcome.profit;
    totalRevenue += row.outcome.revenue;
    totalOrderCost += row.outcome.orderCost;
    totalHolding += row.outcome.holding;
    totalAdSpend += row.outcome.adSpend;
    totalSales += row.outcome.sales;
    totalMissed += row.outcome.missed;
  }
  const lastOutcome = rounds.at(-1)?.outcome ?? null;

  return {
    meta: record.meta,
    frames: record.frames,
    sourceProduct,
    sourceContextNote: buildSourceContextNote(sourceProduct),
    scenarioInfo,
    ledger: {
      finalHash: sealedLedger.finalHash,
      matchesRunHash: sealedLedger.finalHash === record.meta.finalHash,
      ledgerHash: record.meta.ledgerHash,
      rounds: sealedLedger.rounds.map((row) => ({
        round: row.round,
        roundLabel: `第 ${String(row.round + 1)} 回合`,
        locked: row.locked,
        source: row.source,
        sourceLabel: row.source === "verified" ? "多Agent核验通过" : "规则兜底回退",
        hash: row.hash,
        prevHash: row.prevHash,
        decisionHash: row.decisionHash,
        observationHash: row.observationHash,
        beliefHash: row.beliefHash,
        overlayHash: row.overlayHash,
        outcome: row.outcome,
      })),
    },
    rounds,
    quotes,
    priceWars,
    loops,
    versionUpgrades,
    totals: {
      totalProfit,
      totalRevenue,
      totalOrderCost,
      totalHolding,
      totalAdSpend,
      totalSales,
      totalMissed,
      finalCash: lastOutcome?.cash ?? scenarioInfo.initial.cash,
      finalReputation: lastOutcome?.reputation ?? scenarioInfo.initial.reputation,
      minInventory: record.meta.minInventory,
      totalCalls: record.meta.calls,
      totalQuotes: quotes.length,
      acceptedQuotes: quotes.filter((item) => item.ruling === "accept").length,
      priceWarCount: priceWars.length,
      versionUpgradeCount: versionUpgrades.length,
      fallbackRounds: rounds.filter((item) => item.usedFallback).length,
    },
  };
}

export const CAMPAIGN_TOPOLOGY_LABELS: Readonly<Record<CampaignTopology, string>> = {
  rule: "静态规则 (rule)",
  "single-agent": "单 Agent (single-agent)",
  "collab-no-review": "无审多 Agent (collab-no-review)",
  "collab-with-review": "完整多 Agent 会签 (collab-with-review)",
};

export type SimShopCompareRoundMetric = {
  readonly profitCents: number;
  readonly cumulativeProfitCents: number;
  readonly cashCents: number;
  readonly reputation: number;
  readonly sales: number;
  readonly missed: number;
};

export type SimShopCompareScenarioSeries = {
  readonly scenario: ScenarioName;
  readonly title: string;
  readonly winner: CampaignScenarioWinner | null;
  readonly rounds: readonly {
    readonly round: number;
    readonly roundLabel: string;
    readonly byTopology: Readonly<Partial<Record<CampaignTopology, SimShopCompareRoundMetric>>>;
  }[];
};

export type SimShopCompareResponse = CampaignEvalResult & {
  readonly topologyLabels: Readonly<Record<CampaignTopology, string>>;
  readonly roundSeries: readonly SimShopCompareScenarioSeries[];
};

export function buildCampaignCompareResponse(result: CampaignEvalResult): SimShopCompareResponse {
  const roundSeries: SimShopCompareScenarioSeries[] = result.scenarios.map((scenarioName) => {
    const scenarioRuns = result.runs.filter(
      (item) => item.scenario === scenarioName && item.seed === result.seed,
    );
    const rounds = Array.from({ length: result.roundsPerRun }, (_, index) => {
      const roundNumber = index + 1;
      const byTopology: Partial<Record<CampaignTopology, SimShopCompareRoundMetric>> = {};
      for (const run of scenarioRuns) {
        const point = run.rounds.find((item) => item.round === roundNumber);
        if (point === undefined) continue;
        byTopology[run.topology] = {
          profitCents: point.profitCents,
          cumulativeProfitCents: point.cumulativeProfitCents,
          cashCents: point.cashCents,
          reputation: point.reputation,
          sales: point.sales,
          missed: point.missed,
        };
      }
      return {
        round: roundNumber,
        roundLabel: `第 ${String(roundNumber)} 回合`,
        byTopology,
      };
    });
    return {
      scenario: scenarioName,
      title: SCENARIO_META[scenarioName].title,
      winner: result.scenarioWinners[scenarioName] ?? null,
      rounds,
    };
  });

  return {
    ...result,
    topologyLabels: CAMPAIGN_TOPOLOGY_LABELS,
    roundSeries,
  };
}

export async function readOptionalJsonBody(c: Context): Promise<unknown> {
  const raw = await c.req.text();
  if (raw.trim() === "") return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function loadRunOrNull(store: RunStore, runId: string): RunRecord | null {
  if (!isRunId(runId)) return null;
  return store.load(runId) ?? null;
}

export function registerSimShopRoutes(app: Hono, options: SimShopRoutesOptions = {}): void {
  const store = options.store ?? memorySimShopRunStore();
  const capture = options.capture ?? captureRun;
  const compareCampaign = options.compareCampaign ?? runCampaignEvaluation;
  const now = options.now ?? (() => new Date());
  const sourceProducts = new Map<string, SimShopSourceProduct>();

  app.get("/api/simshop/scenarios", (c) => c.json({ scenarios: scenarioCatalog() }));

  app.get("/api/simshop/runs", (c) =>
    c.json({
      runs: store.list().map((meta) => {
        const sourceProduct = sourceProducts.get(meta.runId) ?? null;
        return sourceProduct === null ? meta : { ...meta, sourceProduct };
      }),
    }),
  );

  app.post("/api/simshop/runs", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = createRunRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ code: "bad-request", detail: parsed.error.message }, 400);
    }
    const scenario = parsed.data.scenario;
    const seed = parsed.data.seed ?? 7;
    const profile: RunProfile = parsed.data.profile ?? "steady";

    if (!isScenarioName(scenario)) {
      return c.json({ code: "bad-scenario", detail: `未知场景: ${String(scenario)}` }, 400);
    }
    if (!isSeed(seed)) {
      return c.json({ code: "bad-seed", detail: "seed 必须是整数" }, 400);
    }

    const record = await capture({ scenario, seed, profile, now });
    const sourceProduct = parsed.data.sourceProduct;
    if (sourceProduct !== undefined) {
      sourceProducts.set(record.meta.runId, sourceProduct);
    } else {
      sourceProducts.delete(record.meta.runId);
    }
    const stored: RunRecord = sourceProduct === undefined
      ? record
      : ({ ...record, sourceProduct } as StoredSimShopRecord);
    store.save(stored);
    return c.json(buildSimShopRunView(stored, sourceProduct), 201);
  });

  app.get("/api/simshop/runs/:runId", (c) => {
    const runId = c.req.param("runId");
    const record = loadRunOrNull(store, runId);
    if (record === null) {
      return c.json({ code: "run-not-found", runId, detail: "找不到该沙盘运行记录" }, 404);
    }
    return c.json(buildSimShopRunView(record, sourceProducts.get(runId)));
  });

  app.get("/api/simshop/runs/:runId/ledger", (c) => {
    const runId = c.req.param("runId");
    const record = loadRunOrNull(store, runId);
    if (record === null) {
      return c.json({ code: "run-not-found", runId, detail: "找不到该沙盘运行记录" }, 404);
    }
    const view = buildSimShopRunView(record, sourceProducts.get(runId));
    return c.json({
      runId: view.meta.runId,
      finalHash: view.ledger.finalHash,
      matchesRunHash: view.ledger.matchesRunHash,
      ledgerHash: view.ledger.ledgerHash,
      rounds: view.ledger.rounds,
    });
  });

  app.post("/api/simshop/runs/:runId/rounds/:round/commit", (c) => {
    const runId = c.req.param("runId");
    const record = loadRunOrNull(store, runId);
    if (record === null) {
      return c.json({ code: "run-not-found", runId, detail: "找不到该沙盘运行记录" }, 404);
    }
    const roundText = c.req.param("round");
    if (!/^\d+$/.test(roundText)) {
      return c.json({ code: "bad-round", detail: "round must be a non-negative integer" }, 400);
    }
    const round = Number(roundText);
    const ledger = sealLedger(record.frames);
    const sealed = ledger.rounds.find((row) => row.round === round);
    if (sealed === undefined) {
      return c.json({ code: "round-not-found", round, detail: "未找到该回合账本记录" }, 404);
    }
    return c.json(
      {
        code: "round-locked",
        round,
        roundLabel: `第 ${String(round + 1)} 回合`,
        storedDecisionHash: sealed.decisionHash,
        hash: sealed.hash,
        prevHash: sealed.prevHash,
        detail: `第 ${String(round + 1)} 回合已结算并锁定，不可逆账本拒绝任何重做或篡改`,
      },
      409,
    );
  });

  app.post("/api/simshop/compare", async (c) => {
    const body = await readOptionalJsonBody(c);
    const parsed = compareRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ code: "bad-request", detail: parsed.error.message }, 400);
    }
    const seed = parsed.data.seed ?? 7;
    if (!isSeed(seed)) {
      return c.json({ code: "bad-seed", detail: "seed 必须是整数" }, 400);
    }
    const scenarios =
      parsed.data.scenarios ??
      (parsed.data.scenario !== undefined ? [parsed.data.scenario] : undefined);
    const result = await compareCampaign({
      ...(scenarios === undefined ? {} : { scenarios }),
      seed,
      includeStressedAudit: parsed.data.includeStressedAudit ?? true,
    });
    return c.json(buildCampaignCompareResponse(result));
  });
}
