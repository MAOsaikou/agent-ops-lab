import { z } from "zod";

import { sha256Hex } from "../../engine/hash.js";
import { parseRunId } from "../../engine/ids.js";
import { canonicalJson } from "../../engine/json.js";
import type { LlmRequest, LlmUsage } from "../../engine/llm/client.js";
import type { Candidate, CandidateId, CheckRow, ProductInput } from "../pricing/model.js";
import { DELIBERATION_GOALS, DELIBERATION_ROLES } from "./deliberation.js";
import { assertNoInventedNumbers } from "./evidence-ledger.js";
import type { LiveLlm } from "./llm.js";
import { isUnprofitableAtMarket } from "./review-policy.js";
import { dispatchToolCall, type ToolName } from "./tools.js";
import type { CollabComparison, CollabRole, CollaborationArtifact } from "./types.js";

export const CLARIFY_FIELDS = [
  "buy",
  "shipping",
  "competitor",
  "moq",
  "cash",
  "promo-stack",
  "return-evidence",
  "channel-floor",
  "supplier-lot",
] as const;

export type ClarifyField = (typeof CLARIFY_FIELDS)[number];

export type DecisionReviewMode = "off" | "single-self-review" | "multi-deliberation" | "multi-consensus";

export type EvidenceSource = {
  readonly id: string;
  readonly title: string;
  readonly kind?: string | undefined;
  readonly body: string;
};

export type EvidenceSourceCatalogItem = {
  readonly id: string;
  readonly title: string;
  readonly kind?: string | undefined;
};

export type ConsultAct = {
  readonly action: "consult";
  readonly sourceIds: readonly string[];
  readonly summary: string;
  readonly evidenceRefs: readonly string[];
};

export type DecisionAct = {
  readonly action: "approve" | "reject" | "clarify";
  readonly candidateId?: CandidateId | undefined;
  readonly fields?: readonly ClarifyField[] | undefined;
  readonly summary: string;
  readonly evidenceRefs: readonly string[];
};

export type DecisionOrConsultAct = DecisionAct | ConsultAct;

export type DecisionSource = "model" | "fallback-numeric" | "rejected-by-safety";

export type DecisionPackProduct = {
  readonly platform: ProductInput["platform"];
  readonly name: string;
  readonly category: string;
  readonly buyCents: number;
  readonly packagingCents: number;
  readonly shippingCents: number;
  readonly competitorCents: number;
  readonly marketOrders: number;
  readonly targetMargin: number;
  readonly cashCents: number;
  readonly settleDays: number;
  readonly adDailyBudgetCents: number;
  readonly returnRate: number;
};

export type DecisionPackCandidate = {
  readonly id: CandidateId;
  readonly label: string;
  readonly priceCents: number;
  readonly promoPriceCents: number;
  readonly margin: number;
  readonly p50Cents: number;
  readonly p10Cents: number;
  readonly orders: number;
  readonly stockoutDays: number;
  readonly minCashCents: number;
  readonly failCheckIds: readonly string[];
  readonly warnCheckIds: readonly string[];
};

export type DecisionPackRoleRow = {
  readonly id: string;
  readonly role: CollabRole;
  readonly candidateId: CandidateId;
  readonly scenario: string;
  readonly priceCents: number;
  readonly margin: number;
  readonly p10Cents: number;
  readonly orders: number;
  readonly stockoutDays: number;
  readonly minCashCents: number;
  readonly failCheckIds: readonly string[];
  readonly warnCheckIds: readonly string[];
};

export type DecisionPack = {
  readonly taskText: string;
  readonly product: DecisionPackProduct;
  readonly breakEvenCents: number;
  readonly candidates: readonly DecisionPackCandidate[];
  readonly comparison: readonly CollabComparison[];
  readonly minFailCandidateIds: readonly CandidateId[];
  readonly roleRows: readonly DecisionPackRoleRow[];
  readonly sourceCatalog?: readonly EvidenceSourceCatalogItem[] | undefined;
  readonly allowedEvidenceRefs: readonly string[];
  readonly fingerprint: string;
};

export type DecisionToolReceipt = {
  readonly tool: ToolName;
  readonly callerRole: string;
  readonly candidateId?: CandidateId | undefined;
  readonly ok: boolean;
  readonly summary: string;
  readonly elapsedMs: number;
};

export type SingleSelfReviewNode = {
  readonly id: string;
  readonly phase: "draft" | "consult" | "review";
  readonly status: "completed" | "failed";
  readonly attempts: number;
  readonly elapsedMs: number;
  readonly usage: LlmUsage;
  readonly act?: DecisionOrConsultAct | undefined;
  readonly error?: string | undefined;
};

export type SingleSelfReviewResult = {
  readonly act: DecisionAct | null;
  readonly nodes: readonly SingleSelfReviewNode[];
  readonly toolCalls: readonly DecisionToolReceipt[];
  readonly completionsUsed: number;
  readonly exhausted: boolean;
  readonly consultedSourceIds: readonly string[];
};

export type DecisionBudgetHooks = {
  readonly maxTokens: number;
  readonly maxToolCalls: number;
  readonly runStartedAt: number;
  readonly timeoutMs: number;
  readonly usedTokens: () => number;
  readonly usedToolCalls: () => number;
  readonly hasUnknownUsage?: () => boolean;
  readonly recordPredictedTokens?: (tokens: number) => void;
  readonly recordUsage: (usage: LlmUsage | undefined) => void;
  readonly onStop: (reason: "budget.tool_calls" | "budget.tokens" | "budget.timeout", detail: string) => void;
};

const DECISION_MAX_TOKENS = 960;
const DECISION_MIN_COMPLETION_TOKENS = 128;

const SCENARIO_TAG: Record<CollabRole, string> = {
  "procurement-lead": "采购+10%/需求-30%",
  "pricing-lead": "基准",
  "growth-operator": "推广×1.5",
};

function noInventedNumbers(text: string): boolean {
  try {
    assertNoInventedNumbers(text);
    return true;
  } catch {
    return false;
  }
}

const candidateSchema = z.enum(["profit", "match", "volume"]);
const clarifyFieldSchema = z.enum(CLARIFY_FIELDS);

export const summarySchema = z
  .string()
  .trim()
  .min(8)
  .max(400)
  .refine(noInventedNumbers, "summary 只能写定性权衡，不能新增或复述数值");

export const evidenceRefsSchema = z
  .array(z.string().min(1).max(100))
  .min(1)
  .max(6)
  .refine((refs) => new Set(refs).size === refs.length, "evidenceRefs 不得重复");

const approveActSchema = z
  .object({
    action: z.literal("approve"),
    candidateId: candidateSchema,
    summary: summarySchema,
    evidenceRefs: evidenceRefsSchema,
  })
  .strict();

const rejectActSchema = z
  .object({
    action: z.literal("reject"),
    summary: summarySchema,
    evidenceRefs: evidenceRefsSchema,
  })
  .strict();

const clarifyActSchema = z
  .object({
    action: z.literal("clarify"),
    fields: z
      .array(clarifyFieldSchema)
      .min(1)
      .max(CLARIFY_FIELDS.length)
      .refine((fields) => new Set(fields).size === fields.length, "fields 不得重复"),
    summary: summarySchema,
    evidenceRefs: evidenceRefsSchema,
  })
  .strict();

const consultActObjectSchema = z
  .object({
    action: z.literal("consult"),
    sourceIds: z
      .array(z.string().trim().min(1).max(100))
      .min(1)
      .max(2)
      .refine((ids) => new Set(ids).size === ids.length, "sourceIds 不得重复"),
    summary: summarySchema,
    evidenceRefs: evidenceRefsSchema,
  })
  .strict();

export const consultActSchema: z.ZodType<ConsultAct> = consultActObjectSchema;

export const decisionActSchema: z.ZodType<DecisionAct> = z.discriminatedUnion("action", [
  approveActSchema,
  rejectActSchema,
  clarifyActSchema,
]);

export const decisionOrConsultActSchema: z.ZodType<DecisionOrConsultAct> = z.discriminatedUnion("action", [
  approveActSchema,
  rejectActSchema,
  clarifyActSchema,
  consultActObjectSchema,
]);

export type CrosscheckQuote = {
  readonly sourceId: string;
  readonly excerpt: string;
};

export type CrosscheckAct =
  | {
      readonly action: "uphold";
      readonly summary?: string | undefined;
    }
  | {
      readonly action: "rebut";
      readonly decision: DecisionAct;
      readonly quotes: readonly CrosscheckQuote[];
    };

export type MultiConsensusResult = {
  readonly act: DecisionAct | null;
  readonly nodes: readonly SingleSelfReviewNode[];
  readonly toolCalls: readonly DecisionToolReceipt[];
  readonly completionsUsed: number;
  readonly exhausted: boolean;
  readonly consultedSourceIds: readonly string[];
  readonly challengeTriggered: boolean;
  readonly challengeOutcome: "skipped-no-tension" | "upheld" | "rebutted" | "rebuttal-ungrounded";
};

const crosscheckQuoteSchema = z
  .object({
    sourceId: z.string().trim().min(1).max(100),
    excerpt: z.string().trim().min(1).max(1000),
  })
  .strict();

const crosscheckUpholdSchema = z
  .object({
    action: z.literal("uphold"),
    summary: summarySchema.optional(),
  })
  .strict();

const crosscheckRebutSchema = z
  .object({
    action: z.literal("rebut"),
    decision: decisionActSchema,
    quotes: z.array(crosscheckQuoteSchema).min(1).max(6),
  })
  .strict();

export const crosscheckActSchema: z.ZodType<CrosscheckAct> = z.discriminatedUnion("action", [
  crosscheckUpholdSchema,
  crosscheckRebutSchema,
]);

function normalizeWhitespaceForQuote(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function isVerbatimQuoteInSource(
  excerpt: string,
  sourceBody: string,
): boolean {
  const trimmedExcerpt = excerpt.trim();
  if (trimmedExcerpt.length === 0 || sourceBody.length === 0) return false;
  if (sourceBody.includes(trimmedExcerpt)) return true;
  const normalizedExcerpt = normalizeWhitespaceForQuote(trimmedExcerpt);
  const normalizedBody = normalizeWhitespaceForQuote(sourceBody);
  return normalizedExcerpt.length > 0 && normalizedBody.includes(normalizedExcerpt);
}

export function verifyCrosscheckQuotes(
  quotes: readonly CrosscheckQuote[],
  sourcesById: ReadonlyMap<string, EvidenceSource>,
): { readonly grounded: boolean; readonly reason?: string } {
  if (quotes.length === 0) {
    return { grounded: false, reason: "rebut 必须提供至少一条 quotes 原文摘录" };
  }
  for (const quote of quotes) {
    const source = sourcesById.get(quote.sourceId);
    if (!source) {
      return { grounded: false, reason: `未查阅或不存在 sourceId: ${quote.sourceId}` };
    }
    if (!isVerbatimQuoteInSource(quote.excerpt, source.body)) {
      return { grounded: false, reason: `摘录不是 ${quote.sourceId} 正文的逐字连续子串` };
    }
  }
  return { grounded: true };
}

export function parseAndValidateCrosscheckAct(
  rawText: string,
  allowedRefs: ReadonlySet<string>,
  validCandidateIds: ReadonlySet<string>,
): CrosscheckAct {
  const trimmed = rawText.trim().replace(/^```json\s*\n?([\s\S]*?)\n?```$/i, "$1");
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    throw new Error("Crosscheck 输出必须是一个完整 JSON 对象");
  }
  const act = crosscheckActSchema.parse(raw);
  if (act.action === "rebut") {
    for (const ref of act.decision.evidenceRefs) {
      if (!allowedRefs.has(ref)) {
        throw new Error(`未知 evidenceRef: ${ref}；只能引用给定报告ID或 "task"`);
      }
    }
    if (
      act.decision.action === "approve" &&
      (act.decision.candidateId === undefined || !validCandidateIds.has(act.decision.candidateId))
    ) {
      throw new Error(`candidateId ${String(act.decision.candidateId)} 不在当前候选报价中`);
    }
  }
  return act;
}

export function estimateDecisionPromptTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 1.5));
}

export function withCompatMessages(
  request: LlmRequest,
): LlmRequest {
  const withMessages: Record<string, unknown> = {
    ...request,
    messages: [{ role: "user", content: request.prompt }],
  };
  return withMessages as LlmRequest;
}

function checkIdsByStatus(checks: readonly CheckRow[], status: CheckRow["status"]): readonly string[] {
  return checks.filter((c) => c.status === status).map((c) => c.id);
}

export function computeMinFailCandidateIds(
  candidates: readonly Candidate[],
  comparison?: readonly CollabComparison[] | undefined,
): readonly CandidateId[] {
  if (candidates.length === 0) return [];
  const counts = candidates.map((cand) => {
    const row = comparison?.find((item) => item.candidateId === cand.id);
    const failCount =
      row !== undefined ? row.failCount : cand.checks.filter((check) => check.status === "fail").length;
    return { id: cand.id, failCount };
  });
  const minFail = Math.min(...counts.map((item) => item.failCount));
  return counts.filter((item) => item.failCount === minFail).map((item) => item.id);
}

export function buildDecisionPack(input: {
  readonly taskText: string;
  readonly product: ProductInput;
  readonly breakEvenCents: number;
  readonly candidates: readonly Candidate[];
  readonly collaboration?: CollaborationArtifact | undefined;
  readonly evidenceSources?: readonly EvidenceSource[] | undefined;
}): DecisionPack {
  const product: DecisionPackProduct = {
    platform: input.product.platform,
    name: input.product.name,
    category: input.product.category,
    buyCents: input.product.buyCents,
    packagingCents: input.product.packagingCents,
    shippingCents: input.product.shippingCents,
    competitorCents: input.product.competitorCents,
    marketOrders: input.product.marketOrders,
    targetMargin: input.product.targetMargin,
    cashCents: input.product.cashCents,
    settleDays: input.product.settleDays,
    adDailyBudgetCents: input.product.adDailyBudgetCents,
    returnRate: input.product.returnRate,
  };

  const candidates: DecisionPackCandidate[] = input.candidates.map((cand) => ({
    id: cand.id,
    label: cand.label,
    priceCents: cand.priceCents,
    promoPriceCents: cand.promoPriceCents,
    margin: Number(cand.evaluation.daily.margin.toFixed(4)),
    p50Cents: cand.sim.p50Cents,
    p10Cents: cand.sim.p10Cents,
    orders: Number(cand.evaluation.daily.orders.toFixed(2)),
    stockoutDays: cand.sim.stockoutDays,
    minCashCents: cand.sim.minCashCents,
    failCheckIds: checkIdsByStatus(cand.checks, "fail"),
    warnCheckIds: checkIdsByStatus(cand.checks, "warn"),
  }));

  const comparison: CollabComparison[] =
    input.collaboration?.comparison?.map((row) => ({
      candidateId: row.candidateId,
      baselineP10Cents: row.baselineP10Cents,
      stressP10Cents: row.stressP10Cents,
      margin: Number(row.margin.toFixed(4)),
      failCount: row.failCount,
      warnCount: row.warnCount,
      selected: row.selected,
    })) ??
    input.candidates.map((cand, idx) => ({
      candidateId: cand.id,
      baselineP10Cents: cand.sim.p10Cents,
      stressP10Cents: cand.sim.p10Cents,
      margin: Number(cand.evaluation.daily.margin.toFixed(4)),
      failCount: cand.checks.filter((c) => c.status === "fail").length,
      warnCount: cand.checks.filter((c) => c.status === "warn").length,
      selected: idx === 0,
    }));

  const roleRows: DecisionPackRoleRow[] = (input.collaboration?.analyses ?? []).flatMap((analysis) =>
    analysis.rows.map((row) => ({
      id: `${analysis.role}/${row.candidateId}`,
      role: analysis.role,
      candidateId: row.candidateId,
      scenario: SCENARIO_TAG[analysis.role],
      priceCents: row.priceCents,
      margin: Number(row.margin.toFixed(4)),
      p10Cents: row.p10Cents,
      orders: Number(row.orders.toFixed(2)),
      stockoutDays: row.stockoutDays,
      minCashCents: row.minCashCents,
      failCheckIds: checkIdsByStatus(row.checks, "fail"),
      warnCheckIds: checkIdsByStatus(row.checks, "warn"),
    })),
  );

  const sourceCatalog: EvidenceSourceCatalogItem[] = (input.evidenceSources ?? []).map((source) => ({
    id: source.id,
    title: source.title,
    ...(source.kind !== undefined ? { kind: source.kind } : {}),
  }));

  const minFailCandidateIds = computeMinFailCandidateIds(input.candidates, comparison);
  const allowedEvidenceRefs = Array.from(
    new Set([
      "task",
      ...roleRows.map((row) => row.id),
      ...(roleRows.length === 0 ? input.candidates.map((cand) => `pricing-lead/${cand.id}`) : []),
      ...sourceCatalog.map((source) => `source/${source.id}`),
    ]),
  );

  const canonicalPayload = {
    taskText: input.taskText,
    product,
    breakEvenCents: input.breakEvenCents,
    candidates,
    comparison,
    minFailCandidateIds,
    roleRows,
    ...(sourceCatalog.length > 0 ? { sourceCatalog } : {}),
    allowedEvidenceRefs,
  };
  const fingerprint = sha256Hex(canonicalJson(canonicalPayload));

  return {
    ...canonicalPayload,
    fingerprint,
  };
}

function compactDecisionPackProduct(product: DecisionPackProduct) {
  return {
    platform: product.platform,
    buyCents: product.buyCents,
    packagingCents: product.packagingCents,
    shippingCents: product.shippingCents,
    competitorCents: product.competitorCents,
    marketOrders: product.marketOrders,
    targetMargin: product.targetMargin,
    cashCents: product.cashCents,
    settleDays: product.settleDays,
    adDailyBudgetCents: product.adDailyBudgetCents,
    returnRate: product.returnRate,
  };
}

function compactDecisionPackCandidate(cand: DecisionPackCandidate) {
  return {
    id: cand.id,
    priceCents: cand.priceCents,
    promoPriceCents: cand.promoPriceCents,
    margin: cand.margin,
    p50Cents: cand.p50Cents,
    p10Cents: cand.p10Cents,
    orders: cand.orders,
    stockoutDays: cand.stockoutDays,
    minCashCents: cand.minCashCents,
    ...(cand.failCheckIds.length > 0 ? { failCheckIds: cand.failCheckIds } : {}),
  };
}

export function formatDecisionPackPromptBlock(pack: DecisionPack): string {
  const compactCandidates = pack.candidates.map(compactDecisionPackCandidate);
  const compactComparison = pack.comparison.map((r) => ({
    id: r.candidateId,
    p10: r.stressP10Cents,
    fail: r.failCount,
  }));
  const hasSources = (pack.sourceCatalog?.length ?? 0) > 0;
  return [
    "【原始任务文本】",
    pack.taskText,
    "【/原始任务文本】",
    `商品:${JSON.stringify(compactDecisionPackProduct(pack.product))}`,
    `保本价:${String(pack.breakEvenCents)}`,
    `候选:${JSON.stringify(compactCandidates)}`,
    `对照:${JSON.stringify(compactComparison)}`,
    `最少失败:${JSON.stringify(pack.minFailCandidateIds)}`,
    ...(hasSources
      ? [`资料目录:${JSON.stringify(pack.sourceCatalog)}`, `可用refs:${JSON.stringify(pack.allowedEvidenceRefs)}`]
      : [`可用refs:${JSON.stringify(pack.allowedEvidenceRefs)}`]),
  ].join("\n");
}

export function formatConsultedSourcesPromptBlock(
  consultedSources: readonly EvidenceSource[],
): string {
  if (consultedSources.length === 0) return "";
  return [
    "【已查阅资料正文（终局需引 source/<id>）】",
    ...consultedSources.map((source) =>
      JSON.stringify({
        ref: `source/${source.id}`,
        title: source.title,
        body: source.body,
      }),
    ),
    "【/已查阅资料正文】",
  ].join("\n");
}

export function formatToolReceiptsPromptBlock(receipts: readonly DecisionToolReceipt[]): string {
  if (receipts.length === 0) return "";
  return [
    "【工具回执】",
    ...receipts.map((receipt) =>
      JSON.stringify({
        tool: receipt.tool,
        role: receipt.callerRole,
        ...(receipt.candidateId ? { candidateId: receipt.candidateId } : {}),
        ok: receipt.ok,
        summary: receipt.summary,
      }),
    ),
    "【/工具回执】",
  ].join("\n");
}

export function decisionPolicyRulesBlock(): string {
  return [
    "【通用裁决规则（开放前提 vs 闭合约束）】",
    "1. 闭合约束不可行->reject：若任务或资料已有足够事实表明上架或全部候选违反闭合约束（资金不覆起订/门槛、叠加亏损、跌破限价、声明缺据或违规），须直接 reject，不得 clarify。",
    "2. 强制条款约束：若资料规定强制条款（口径、叠加、限价、质保），而另一资料表明其不可满足或违规，须 reject（仅缺前提或内部矛盾时 clarify），不得以先批准再删改条款为由 approve。",
    "3. 开放前提缺失/矛盾->clarify：必要输入缺失或同一输入口径冲突无法核算，须 clarify 并列 fields。",
    "4. 其余->approve：在符合政策、强制条款与红线的可行候选中批准合适方案。",
    "【/通用裁决规则】",
  ].join("\n");
}

export function decisionActFormatInstruction(hasSources = false): string {
  return [
    decisionPolicyRulesBlock(),
    ...(hasSources
      ? [
          "只输出单个合法 JSON 对象（禁额外文字/字段），四选一（consult 非终局，批准前需交叉核对并引 source/<id>）：",
          '1) {"action":"approve","candidateId":"profit|match|volume","summary":"定性权衡(>=8字，禁数字)","evidenceRefs":["task","role/candidateId","source/id"]}',
          '2) {"action":"reject","summary":"定性理由(>=8字，禁数字)","evidenceRefs":["task","source/id"]}',
          `3) {"action":"clarify","fields":["${CLARIFY_FIELDS.join("|")}"],"summary":"定性原因(>=8字，禁数字)","evidenceRefs":["task"]}`,
          '4) {"action":"consult","sourceIds":["id1","id2"],"summary":"定性说明查阅原因(>=8字，禁数字)","evidenceRefs":["task"]}',
        ]
      : [
          "只输出单个合法 JSON 对象（禁额外文字/字段），三选一：",
          '1) {"action":"approve","candidateId":"profit|match|volume","summary":"定性权衡(>=8字，禁数字)","evidenceRefs":["task","role/candidateId"]}',
          '2) {"action":"reject","summary":"定性理由(>=8字，禁数字)","evidenceRefs":["task"]}',
          `3) {"action":"clarify","fields":["${CLARIFY_FIELDS.join("|")}"],"summary":"定性原因(>=8字，禁数字)","evidenceRefs":["task"]}`,
        ]),
  ].join("\n");
}

export function parseAndValidateDecisionAct(
  rawText: string,
  allowedRefs: ReadonlySet<string>,
  validCandidateIds: ReadonlySet<string>,
): DecisionAct {
  const trimmed = rawText.trim().replace(/^```json\s*\n?([\s\S]*?)\n?```$/i, "$1");
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    throw new Error("DecisionAct 输出必须是一个完整 JSON 对象");
  }
  const act = decisionActSchema.parse(raw);
  for (const ref of act.evidenceRefs) {
    if (!allowedRefs.has(ref)) {
      throw new Error(`未知 evidenceRef: ${ref}；只能引用给定报告ID或 "task"`);
    }
  }
  if (act.action === "approve" && (act.candidateId === undefined || !validCandidateIds.has(act.candidateId))) {
    throw new Error(`candidateId ${String(act.candidateId)} 不在当前候选报价中`);
  }
  return act;
}

export function parseAndValidateDecisionOrConsultAct(
  rawText: string,
  allowedRefs: ReadonlySet<string>,
  validCandidateIds: ReadonlySet<string>,
  validSourceIds: ReadonlySet<string>,
): DecisionOrConsultAct {
  const trimmed = rawText.trim().replace(/^```json\s*\n?([\s\S]*?)\n?```$/i, "$1");
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    throw new Error("DecisionAct 输出必须是一个完整 JSON 对象");
  }
  const act = decisionOrConsultActSchema.parse(raw);
  for (const ref of act.evidenceRefs) {
    if (!allowedRefs.has(ref)) {
      throw new Error(`未知 evidenceRef: ${ref}；只能引用给定报告ID或 "task"`);
    }
  }
  if (act.action === "consult") {
    for (const sourceId of act.sourceIds) {
      if (!validSourceIds.has(sourceId)) {
        throw new Error(`未知 sourceId: ${sourceId}；只能查阅资料目录中的 id`);
      }
    }
    return act;
  }
  if (act.action === "approve" && (act.candidateId === undefined || !validCandidateIds.has(act.candidateId))) {
    throw new Error(`candidateId ${String(act.candidateId)} 不在当前候选报价中`);
  }
  return act;
}

export function summarizeToolData(tool: ToolName, ok: boolean, data: unknown, error?: string): string {
  if (!ok) {
    return error ?? "工具调用失败";
  }
  if (tool === "pricing.verify" && Array.isArray(data)) {
    const rows = data as ReadonlyArray<{ id?: string; status?: string }>;
    const fails = rows.filter((r) => r.status === "fail").map((r) => r.id ?? "fail");
    const warns = rows.filter((r) => r.status === "warn").map((r) => r.id ?? "warn");
    return `核验完成 fail=${JSON.stringify(fails)} warn=${JSON.stringify(warns)}`;
  }
  if (tool === "pricing.simulate" && typeof data === "object" && data !== null) {
    const sim = data as { p10Cents?: number; p50Cents?: number; stockoutDays?: number; minCashCents?: number };
    return `模拟 p10=${String(sim.p10Cents ?? 0)} p50=${String(sim.p50Cents ?? 0)} 缺货天数=${String(sim.stockoutDays ?? 0)} 最低现金=${String(sim.minCashCents ?? 0)}`;
  }
  if (tool === "pricing.unit-cost" && typeof data === "object" && data !== null) {
    const unit = data as { totalCents?: number; margin?: number };
    return `单件成本=${String(unit.totalCents ?? 0)}`;
  }
  if (tool === "pricing.break-even" && typeof data === "object" && data !== null) {
    const be = data as { breakEvenCents?: number };
    return `保本价=${String(be.breakEvenCents ?? 0)}`;
  }
  if (tool === "knowledge.search" && Array.isArray(data)) {
    const hits = data as ReadonlyArray<{ id?: string; title?: string }>;
    return `命中规则=${JSON.stringify(hits.map((h) => h.id ?? h.title ?? ""))}`;
  }
  if (tool === "sources.list" && Array.isArray(data)) {
    const entries = data as ReadonlyArray<{ id?: string }>;
    return `资料目录=${JSON.stringify(entries.map((entry) => entry.id ?? ""))}`;
  }
  if (tool === "sources.read" && Array.isArray(data)) {
    const entries = data as ReadonlyArray<{ id?: string; title?: string }>;
    return `已查阅资料=${JSON.stringify(entries.map((entry) => entry.id ?? entry.title ?? ""))}`;
  }
  return "工具执行完成";
}

export type ApplyDecisionActResult = {
  readonly decisionAct: DecisionAct;
  readonly decisionSource: DecisionSource;
  readonly appliedAction: "approve" | "reject" | "clarify" | "fallback";
  readonly chosenId: string | null;
  readonly gateDecision: "approve" | "reject" | null;
  readonly clarifiedFields: readonly string[];
  readonly rejectedBySafety: boolean;
  readonly chosenChanged: boolean;
};

export function applyDecisionAct(input: {
  readonly act: DecisionAct | ConsultAct | null;
  readonly product: ProductInput;
  readonly candidates: readonly Candidate[];
  readonly fallbackChosenId: string | null;
  readonly minFailCandidateIds: readonly CandidateId[];
  readonly preflightClarifiedFields: readonly string[];
}): ApplyDecisionActResult {
  const { act, product, candidates, fallbackChosenId, minFailCandidateIds, preflightClarifiedFields } = input;
  if (act === null) {
    return {
      decisionAct: {
        action: "approve",
        candidateId: (fallbackChosenId as CandidateId | null) ?? "match",
        summary: "模型未能产出合法结构化决策，回退采用数值规则裁决方案",
        evidenceRefs: ["task"],
      },
      decisionSource: "fallback-numeric",
      appliedAction: "fallback",
      chosenId: fallbackChosenId,
      gateDecision: null,
      clarifiedFields: [...preflightClarifiedFields],
      rejectedBySafety: false,
      chosenChanged: false,
    };
  }

  if (act.action === "consult") {
    return {
      decisionAct: {
        action: "approve",
        candidateId: (fallbackChosenId as CandidateId | null) ?? "match",
        summary: "模型停留在非终局查阅动作 consult，未产出终局裁决",
        evidenceRefs: ["task"],
      },
      decisionSource: "rejected-by-safety",
      appliedAction: "fallback",
      chosenId: fallbackChosenId,
      gateDecision: null,
      clarifiedFields: [...preflightClarifiedFields],
      rejectedBySafety: true,
      chosenChanged: false,
    };
  }

  if (act.action === "reject") {
    return {
      decisionAct: act,
      decisionSource: "model",
      appliedAction: "reject",
      chosenId: fallbackChosenId,
      gateDecision: "reject",
      clarifiedFields: [...preflightClarifiedFields],
      rejectedBySafety: false,
      chosenChanged: false,
    };
  }

  if (act.action === "clarify") {
    const unionFields = Array.from(new Set([...preflightClarifiedFields, ...(act.fields ?? [])]));
    return {
      decisionAct: act,
      decisionSource: "model",
      appliedAction: "clarify",
      chosenId: fallbackChosenId,
      gateDecision: null,
      clarifiedFields: unionFields,
      rejectedBySafety: false,
      chosenChanged: false,
    };
  }

  if (act.action === "approve") {
    const unprofitable = isUnprofitableAtMarket(product);
    const candId = act.candidateId;
    const candidateExists = candId !== undefined && candidates.some((c) => c.id === candId);
    const inMinFailSet = candId !== undefined && minFailCandidateIds.includes(candId);

    if (unprofitable || !candidateExists || !inMinFailSet) {
      return {
        decisionAct: act,
        decisionSource: "rejected-by-safety",
        appliedAction: "fallback",
        chosenId: fallbackChosenId,
        gateDecision: null,
        clarifiedFields: [...preflightClarifiedFields],
        rejectedBySafety: true,
        chosenChanged: false,
      };
    }

    return {
      decisionAct: act,
      decisionSource: "model",
      appliedAction: "approve",
      chosenId: candId,
      gateDecision: null,
      clarifiedFields: [...preflightClarifiedFields],
      rejectedBySafety: false,
      chosenChanged: candId !== fallbackChosenId,
    };
  }

  return {
    decisionAct: act,
    decisionSource: "rejected-by-safety",
    appliedAction: "fallback",
    chosenId: fallbackChosenId,
    gateDecision: null,
    clarifiedFields: [...preflightClarifiedFields],
    rejectedBySafety: true,
    chosenChanged: false,
  };
}

export async function runSingleSelfReview(input: {
  readonly runId: string;
  readonly round: number;
  readonly product: ProductInput;
  readonly candidates: readonly Candidate[];
  readonly pack: DecisionPack;
  readonly live: LiveLlm;
  readonly evidenceSources?: readonly EvidenceSource[] | undefined;
  readonly maxDecisionCompletions?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly budget?: DecisionBudgetHooks | undefined;
  readonly onNodeEvent?: (type: "review.started" | "review.retrying" | "review.completed" | "review.failed", nodeId: string, detail: string) => void;
}): Promise<SingleSelfReviewResult> {
  const maxCompletions = Math.max(1, Math.floor(input.maxDecisionCompletions ?? 8));
  const timeoutMs = input.timeoutMs ?? 60_000;
  const runId = parseRunId(input.runId);
  const evidenceSources = input.evidenceSources ?? [];
  const hasSources = evidenceSources.length > 0;
  const validSourceIds = new Set(evidenceSources.map((source) => source.id));
  const allowedRefs = new Set(input.pack.allowedEvidenceRefs);
  const validCandidates = new Set(input.candidates.map((c) => c.id));
  const packBlock = formatDecisionPackPromptBlock(input.pack);
  const formatInstruction = decisionActFormatInstruction(hasSources);

  const nodes: SingleSelfReviewNode[] = [];
  const toolCalls: DecisionToolReceipt[] = [];
  const consultedSourcesById = new Map<string, EvidenceSource>();
  let completionsUsed = 0;
  let budgetStopped = false;
  let lastValidAct: DecisionAct | null = null;

  const stopForBudget = (
    reason: "budget.tool_calls" | "budget.tokens" | "budget.timeout",
    detail: string,
  ): void => {
    budgetStopped = true;
    input.budget?.onStop(reason, detail);
  };

  const reserveCall = (promptText: string): number | null => {
    if (!input.budget) return DECISION_MAX_TOKENS;
    if (budgetStopped) return null;
    const elapsed = Date.now() - input.budget.runStartedAt;
    if (elapsed >= input.budget.timeoutMs) {
      stopForBudget(
        "budget.timeout",
        `运行耗时 ${String(elapsed)}ms 已达 timeoutMs=${String(input.budget.timeoutMs)}ms 上限`,
      );
      return null;
    }
    if (input.budget.hasUnknownUsage?.()) {
      stopForBudget("budget.tokens", "前置模型调用未返回有效 Token 用量，按保守策略停止后续模型调用");
      return null;
    }
    const remaining = Math.floor(input.budget.maxTokens - input.budget.usedTokens());
    if (input.budget.maxTokens === 0 || remaining <= 0) {
      stopForBudget(
        "budget.tokens",
        `Token 用量 ${String(input.budget.usedTokens())} 已达 maxTokens=${String(input.budget.maxTokens)} 上限`,
      );
      return null;
    }
    const estPrompt = estimateDecisionPromptTokens(promptText);
    const available = remaining - estPrompt;
    if (available < DECISION_MIN_COMPLETION_TOKENS) {
      stopForBudget(
        "budget.tokens",
        `估计输入 ${String(estPrompt)} + 最小完成额度 ${String(DECISION_MIN_COMPLETION_TOKENS)} 超过剩余预算 ${String(remaining)}，停止模型调用`,
      );
      return null;
    }
    return Math.min(DECISION_MAX_TOKENS, available);
  };

  const canCallTool = (): boolean => {
    if (!input.budget) return true;
    if (budgetStopped) return false;
    const elapsed = Date.now() - input.budget.runStartedAt;
    if (elapsed >= input.budget.timeoutMs) {
      stopForBudget(
        "budget.timeout",
        `运行耗时 ${String(elapsed)}ms 已达 timeoutMs=${String(input.budget.timeoutMs)}ms 上限`,
      );
      return false;
    }
    const totalCalls = input.budget.usedToolCalls() + toolCalls.length;
    if (totalCalls >= input.budget.maxToolCalls) {
      stopForBudget(
        "budget.tool_calls",
        `工具调用次数 ${String(totalCalls)} 已达 maxToolCalls=${String(input.budget.maxToolCalls)} 上限`,
      );
      return false;
    }
    return true;
  };

  async function invokeTool(
    tool: ToolName,
    params: unknown,
    candidateId?: CandidateId,
  ): Promise<Awaited<ReturnType<typeof dispatchToolCall>> | null> {
    if (!canCallTool()) return null;
    const res = await dispatchToolCall({
      tool,
      params,
      callerRole: "generalist",
      runId: input.runId,
    });
    const summary = summarizeToolData(tool, res.ok, res.data, res.error);
    toolCalls.push({
      tool,
      callerRole: "generalist",
      ...(candidateId ? { candidateId } : {}),
      ok: res.ok,
      summary,
      elapsedMs: res.elapsedMs,
    });
    return res;
  }

  async function runConsultSources(sourceIds: readonly string[]): Promise<number> {
    if (!hasSources || sourceIds.length === 0 || budgetStopped) return 0;
    const beforeSize = consultedSourcesById.size;
    const res = await invokeTool("sources.read", {
      sources: evidenceSources,
      sourceIds: [...sourceIds],
    });
    if (res?.ok && Array.isArray(res.data)) {
      for (const entry of res.data as ReadonlyArray<{ id?: string; title?: string; kind?: string; body?: string }>) {
        if (typeof entry.id === "string") {
          consultedSourcesById.set(entry.id, {
            id: entry.id,
            title: entry.title ?? entry.id,
            ...(entry.kind !== undefined ? { kind: entry.kind } : {}),
            body: entry.body ?? "",
          });
        }
      }
    }
    return consultedSourcesById.size - beforeSize;
  }

  const unreadSourceIds = (): readonly string[] =>
    hasSources
      ? evidenceSources
          .map((source) => source.id)
          .filter((id) => !consultedSourcesById.has(id))
      : [];

  const remainingToolBudget = (): number => {
    if (!input.budget) return Number.POSITIVE_INFINITY;
    return Math.max(0, input.budget.maxToolCalls - (input.budget.usedToolCalls() + toolCalls.length));
  };

  const estimateCoverageExtraChars = (unread: readonly string[]): number => {
    const headerChars = consultedSourcesById.size === 0 ? 60 : 0;
    const receiptHeaderChars = toolCalls.length === 0 ? 50 : 0;
    const sourceChars = unread.reduce((sum, id) => {
      const src = evidenceSources.find((s) => s.id === id);
      return sum + (src ? src.title.length + src.body.length + 120 : 120);
    }, 0);
    const receiptChars = Math.ceil(unread.length / 2) * 80;
    return headerChars + receiptHeaderChars + sourceChars + receiptChars;
  };

  const canAffordCoverageAndFollowUp = (
    unread: readonly string[],
    nextPromptPreview: string,
    requiredFollowUpCompletions = 1,
  ): boolean => {
    if (unread.length <= 0 || budgetStopped) return false;
    if (completionsUsed + requiredFollowUpCompletions > maxCompletions) return false;
    const batchesNeeded = Math.ceil(unread.length / 2);
    if (remainingToolBudget() < batchesNeeded) return false;
    if (input.budget) {
      const elapsed = Date.now() - input.budget.runStartedAt;
      if (elapsed >= input.budget.timeoutMs || input.budget.hasUnknownUsage?.()) return false;
      const remainingTokens = Math.floor(input.budget.maxTokens - input.budget.usedTokens());
      const estNextPrompt =
        estimateDecisionPromptTokens(nextPromptPreview) +
        Math.ceil(estimateCoverageExtraChars(unread) / 1.5);
      if (input.budget.maxTokens === 0 || remainingTokens - estNextPrompt < DECISION_MIN_COMPLETION_TOKENS) {
        return false;
      }
    }
    return true;
  };

  async function runCoverageReadsForUnread(nextPromptPreview: string): Promise<number> {
    const unread = unreadSourceIds();
    if (!canAffordCoverageAndFollowUp(unread, nextPromptPreview, 1)) return 0;
    let totalNewlyRead = 0;
    for (let i = 0; i < unread.length; i += 2) {
      if (budgetStopped) break;
      const batch = unread.slice(i, i + 2);
      const newlyRead = await runConsultSources(batch);
      totalNewlyRead += newlyRead;
      if (newlyRead <= 0) break;
    }
    return totalNewlyRead;
  }

  async function runModelNode(
    nodeId: string,
    phase: "draft" | "consult" | "review",
    basePrompt: string,
  ): Promise<SingleSelfReviewNode | null> {
    if (completionsUsed >= maxCompletions || budgetStopped) return null;
    const started = Date.now();
    let correction = "";
    let attempts = 0;
    const totalUsage = { promptTokens: 0, completionTokens: 0 };
    let lastError = "未完成";
    input.onNodeEvent?.("review.started", nodeId, `正在请求单模型决策：${phase}`);

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (completionsUsed >= maxCompletions || budgetStopped) break;
      const attemptPrompt = basePrompt + correction;
      const maxTokens = reserveCall(attemptPrompt);
      if (maxTokens === null) {
        const failed: SingleSelfReviewNode = {
          id: nodeId,
          phase,
          status: "failed",
          attempts,
          elapsedMs: Date.now() - started,
          usage: totalUsage,
          error: "预算上限已触发",
        };
        nodes.push(failed);
        return failed;
      }

      const nodeRemaining = timeoutMs - (Date.now() - started);
      const runRemaining = input.budget
        ? input.budget.timeoutMs - (Date.now() - input.budget.runStartedAt)
        : nodeRemaining;
      const remaining = Math.min(nodeRemaining, runRemaining);
      if (remaining <= 0) {
        if (input.budget && runRemaining <= 0) {
          stopForBudget(
            "budget.timeout",
            `运行耗时已达 timeoutMs=${String(input.budget.timeoutMs)}ms 上限`,
          );
        }
        const failed: SingleSelfReviewNode = {
          id: nodeId,
          phase,
          status: "failed",
          attempts,
          elapsedMs: Date.now() - started,
          usage: totalUsage,
          error: "模型节点超时",
        };
        nodes.push(failed);
        return failed;
      }

      attempts += 1;
      completionsUsed += 1;
      input.budget?.recordPredictedTokens?.(maxTokens);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const completion = await Promise.race([
          input.live.client.complete(
            withCompatMessages({
              runId,
              round: input.round,
              nodeId,
              attempt,
              prompt: attemptPrompt,
              maxTokens,
              responseFormat: "json_object",
              reasoningEffort: "low",
              timeoutMs: remaining,
            }),
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("模型节点超时")), remaining);
          }),
        ]);
        input.budget?.recordUsage(completion?.usage);
        if (
          completion?.usage &&
          typeof completion.usage.promptTokens === "number" &&
          Number.isFinite(completion.usage.promptTokens) &&
          typeof completion.usage.completionTokens === "number" &&
          Number.isFinite(completion.usage.completionTokens)
        ) {
          totalUsage.promptTokens += Math.max(0, completion.usage.promptTokens);
          totalUsage.completionTokens += Math.max(0, completion.usage.completionTokens);
        } else if (input.budget) {
          stopForBudget("budget.tokens", "模型未返回有效 Token 用量，按保守策略停止后续模型调用");
        }
        if (input.budget && input.budget.usedTokens() > input.budget.maxTokens) {
          stopForBudget(
            "budget.tokens",
            `Token 用量 ${String(input.budget.usedTokens())} 超过 maxTokens=${String(input.budget.maxTokens)} 上限`,
          );
        }
        if (input.budget && Date.now() - input.budget.runStartedAt >= input.budget.timeoutMs) {
          stopForBudget("budget.timeout", `运行耗时已达 timeoutMs=${String(input.budget.timeoutMs)}ms 上限`);
        }

        const act = hasSources
          ? parseAndValidateDecisionOrConsultAct(completion.text, allowedRefs, validCandidates, validSourceIds)
          : parseAndValidateDecisionAct(completion.text, allowedRefs, validCandidates);
        if (act.action !== "consult") {
          lastValidAct = act;
        }
        const completed: SingleSelfReviewNode = {
          id: nodeId,
          phase,
          status: "completed",
          attempts,
          elapsedMs: Date.now() - started,
          usage: totalUsage,
          act,
        };
        nodes.push(completed);
        input.onNodeEvent?.("review.completed", nodeId, "单模型决策输出通过结构、候选与证据引用校验");
        return completed;
      } catch (error: unknown) {
        if (input.budget && Date.now() - input.budget.runStartedAt >= input.budget.timeoutMs && !budgetStopped) {
          stopForBudget("budget.timeout", `运行耗时已达 timeoutMs=${String(input.budget.timeoutMs)}ms 上限`);
        }
        lastError = (error instanceof Error ? error.message : String(error)).slice(0, 1200);
        if (attempt === 2 || budgetStopped || completionsUsed >= maxCompletions) {
          const failed: SingleSelfReviewNode = {
            id: nodeId,
            phase,
            status: "failed",
            attempts,
            elapsedMs: Date.now() - started,
            usage: totalUsage,
            error: lastError,
          };
          nodes.push(failed);
          input.onNodeEvent?.("review.failed", nodeId, lastError);
          return failed;
        }
        input.onNodeEvent?.("review.retrying", nodeId, lastError);
        correction = `\n上次输出校验或调用失败：${lastError}\n请修正以上错误，严格按协议只输出 JSON。`;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }

    const failed: SingleSelfReviewNode = {
      id: nodeId,
      phase,
      status: "failed",
      attempts,
      elapsedMs: Date.now() - started,
      usage: totalUsage,
      error: lastError,
    };
    nodes.push(failed);
    return failed;
  }

  const rolePerspectivesBlock = [
    "【分角色核对清单（在同一上下文中依次从以下三方视角独立审视并交叉质询，不切分隐藏记忆）】",
    ...DELIBERATION_ROLES.map((role) => `- ${role}：${DELIBERATION_GOALS[role]}`),
    "共识与反证规则：若各视角并行审视后意见一致则直接收口定案；若存在分歧或质疑，仅当能够给出已查阅资料中的逐字原文摘录作为可验证反证时方可改判或驳回，禁止臆造摘录。",
    "【/分角色核对清单】",
  ].join("\n");

  // Step 1: Initial draft DecisionAct (or serial consult rounds if evidenceSources are provided)
  const buildDraftPrompt = (): string => {
    const consultedBlock = formatConsultedSourcesPromptBlock([...consultedSourcesById.values()]);
    const receiptsBlock = formatToolReceiptsPromptBlock(toolCalls);
    return [
      "你是综合决策 Agent，请对照原始任务文本与数值证据给出初版结构化决策。",
      "注意逐项核对任务中的闭合约束与开放前提：区分“已给足数字且明确不可行（应 reject）”与“缺关键输入或口径冲突（应 clarify）”，以及任务是否有明确经营红线限制候选选择。",
      rolePerspectivesBlock,
      packBlock,
      ...(consultedBlock ? [consultedBlock] : []),
      ...(receiptsBlock ? [receiptsBlock] : []),
      formatInstruction,
    ].join("\n");
  };

  let draftNode = await runModelNode("decision-single-draft", "draft", buildDraftPrompt());
  let consultStep = 0;
  while (
    draftNode?.status === "completed" &&
    draftNode.act?.action === "consult" &&
    !budgetStopped &&
    completionsUsed < maxCompletions
  ) {
    const newlyRead = await runConsultSources(draftNode.act.sourceIds);
    if (newlyRead <= 0 || budgetStopped || completionsUsed >= maxCompletions) break;
    consultStep += 1;
    draftNode = await runModelNode(
      `decision-single-consult-${String(consultStep)}`,
      "consult",
      buildDraftPrompt(),
    );
  }

  // Coverage gate if self-review cannot run after draft, or when a terminal draft act would become final.
  const canAttemptReviewAfterDraft = (): boolean => {
    if (budgetStopped || completionsUsed >= maxCompletions) return false;
    if (!input.budget) return true;
    const elapsed = Date.now() - input.budget.runStartedAt;
    if (elapsed >= input.budget.timeoutMs || input.budget.hasUnknownUsage?.()) return false;
    const remainingTokens = Math.floor(input.budget.maxTokens - input.budget.usedTokens());
    return remainingTokens > DECISION_MIN_COMPLETION_TOKENS;
  };

  // Step 2: Code-routed tool verification based on draft act & pack
  if (!budgetStopped) {
    const focusCandId: CandidateId =
      draftNode?.act?.action === "approve" && draftNode.act.candidateId !== undefined
        ? draftNode.act.candidateId
        : (input.pack.minFailCandidateIds[0] ?? input.candidates[0]?.id ?? "profit");
    const focusCand =
      input.candidates.find((c) => c.id === focusCandId) ?? input.candidates[0];
    if (focusCand !== undefined) {
      await invokeTool(
        "pricing.verify",
        {
          input: input.product,
          priceCents: focusCand.priceCents,
          promoPriceCents: focusCand.promoPriceCents,
        },
        focusCand.id,
      );
      await invokeTool(
        "pricing.simulate",
        { input: input.product, priceCents: focusCand.priceCents },
        focusCand.id,
      );
      await invokeTool(
        "pricing.unit-cost",
        { input: input.product, priceCents: focusCand.priceCents },
        focusCand.id,
      );
    }
    if (!budgetStopped) {
      await invokeTool("knowledge.search", {
        query: "平台费率、结算周期与标题规则",
        platform: input.product.platform,
      });
    }
    const inverted = input.product.competitorCents <= input.product.buyCents + input.product.shippingCents;
    if (!budgetStopped && (inverted || focusCandId === "volume")) {
      await invokeTool("pricing.break-even", { input: input.product });
    }
  }

  // Step 3: Self-review seeing tool receipts & consulted sources (if budget & completion envelope allow)
  if (canAttemptReviewAfterDraft()) {
    const buildReviewPrompt = (prevAct: DecisionOrConsultAct | undefined): string => {
      const consultedBlock = formatConsultedSourcesPromptBlock([...consultedSourcesById.values()]);
      const receiptsBlock = formatToolReceiptsPromptBlock(toolCalls);
      return [
        "你是综合决策 Agent，现在进行自检终审。",
        "请严格按通用裁决规则重新核对：1) 原始任务文本与已查阅资料是否已陈述足够的闭合约束冲突（若是则 reject，不得把已给出数字再拿去 clarify，也不得以先批准再删改强制条款替代 reject）；2) 是否存在必要输入缺失或同一输入互相矛盾（若是则 clarify）；3) 数值与工具回执是否支持在红线内 approve；4) 上一轮初稿是否误把闭合冲突当 clarify，或忽略了红线、证据矛盾、违规候选。",
        rolePerspectivesBlock,
        packBlock,
        ...(consultedBlock ? [consultedBlock] : []),
        ...(receiptsBlock ? [receiptsBlock] : []),
        ...(prevAct ? [`上一轮初稿 DecisionAct: ${JSON.stringify(prevAct)}`] : []),
        "请输出最终确认或修正后的结构化 DecisionAct：",
        formatInstruction,
      ].join("\n");
    };

    const reviewBasePrompt = buildReviewPrompt(draftNode?.act);
    const reviewCanReserve =
      !input.budget ||
      Math.floor(input.budget.maxTokens - input.budget.usedTokens()) -
        estimateDecisionPromptTokens(reviewBasePrompt) >=
        DECISION_MIN_COMPLETION_TOKENS;

    let reviewNode: SingleSelfReviewNode | null = null;
    if (reviewCanReserve) {
      reviewNode = await runModelNode(
        "decision-single-review",
        "review",
        reviewBasePrompt,
      );
      while (
        reviewNode?.status === "completed" &&
        reviewNode.act?.action === "consult" &&
        !budgetStopped &&
        completionsUsed < maxCompletions
      ) {
        const newlyRead = await runConsultSources(reviewNode.act.sourceIds);
        if (newlyRead <= 0 || budgetStopped || completionsUsed >= maxCompletions) break;
        consultStep += 1;
        reviewNode = await runModelNode(
          `decision-single-review-consult-${String(consultStep)}`,
          "review",
          buildReviewPrompt(reviewNode.act),
        );
      }

      while (
        hasSources &&
        reviewNode?.status === "completed" &&
        reviewNode.act !== undefined &&
        reviewNode.act.action !== "consult" &&
        unreadSourceIds().length > 0 &&
        !budgetStopped
      ) {
        const nextPromptPreview = buildReviewPrompt(reviewNode.act);
        if (!canAffordCoverageAndFollowUp(unreadSourceIds(), nextPromptPreview, 1)) {
          break;
        }
        const newlyRead = await runCoverageReadsForUnread(nextPromptPreview);
        if (newlyRead <= 0 || budgetStopped || completionsUsed >= maxCompletions) break;
        consultStep += 1;
        const postCoverageNode = await runModelNode(
          `decision-single-review-coverage-${String(consultStep)}`,
          "review",
          buildReviewPrompt(reviewNode.act),
        );
        if (postCoverageNode === null || postCoverageNode.status !== "completed") {
          break;
        }
        reviewNode = postCoverageNode;
      }
    }
  } else if (
    hasSources &&
    draftNode?.status === "completed" &&
    draftNode.act !== undefined &&
    draftNode.act.action !== "consult" &&
    unreadSourceIds().length > 0 &&
    !budgetStopped
  ) {
    const nextPromptPreview = buildDraftPrompt();
    if (canAffordCoverageAndFollowUp(unreadSourceIds(), nextPromptPreview, 1)) {
      const newlyRead = await runCoverageReadsForUnread(nextPromptPreview);
      if (newlyRead > 0 && !budgetStopped && completionsUsed < maxCompletions) {
        consultStep += 1;
        await runModelNode(
          `decision-single-draft-coverage-${String(consultStep)}`,
          "draft",
          buildDraftPrompt(),
        );
      }
    }
  }

  return {
    act: lastValidAct,
    nodes,
    toolCalls,
    completionsUsed,
    exhausted: completionsUsed >= maxCompletions && lastValidAct === null,
    consultedSourceIds: [...consultedSourcesById.keys()],
  };
}

export type MultiConsensusNodeEvent = {
  readonly type: "started" | "retrying" | "completed" | "failed";
  readonly nodeId: string;
  readonly role: CollabRole | "crosscheck";
  readonly detail: string;
};

export async function runMultiConsensus(input: {
  readonly runId: string;
  readonly round: number;
  readonly product: ProductInput;
  readonly candidates: readonly Candidate[];
  readonly pack: DecisionPack;
  readonly live: LiveLlm;
  readonly evidenceSources?: readonly EvidenceSource[] | undefined;
  readonly maxDecisionCompletions?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly budget?: DecisionBudgetHooks | undefined;
  readonly onNodeEvent?: (event: MultiConsensusNodeEvent) => void;
}): Promise<MultiConsensusResult> {
  const maxCompletions = Math.max(1, Math.floor(input.maxDecisionCompletions ?? 8));
  const timeoutMs = input.timeoutMs ?? 60_000;
  const runId = parseRunId(input.runId);
  const evidenceSources = input.evidenceSources ?? [];
  const hasSources = evidenceSources.length > 0;
  const validSourceIds = new Set(evidenceSources.map((source) => source.id));
  const allowedRefs = new Set(input.pack.allowedEvidenceRefs);
  const validCandidates = new Set(input.candidates.map((c) => c.id));
  const packBlock = formatDecisionPackPromptBlock(input.pack);
  const formatInstruction = decisionActFormatInstruction(hasSources);

  const nodes: SingleSelfReviewNode[] = [];
  const toolCalls: DecisionToolReceipt[] = [];
  const consultedSourcesByRole: Record<CollabRole, Map<string, EvidenceSource>> = {
    "procurement-lead": new Map<string, EvidenceSource>(),
    "pricing-lead": new Map<string, EvidenceSource>(),
    "growth-operator": new Map<string, EvidenceSource>(),
  };
  const crosscheckSourcesById = new Map<string, EvidenceSource>();
  let completionsUsed = 0;
  let budgetStopped = false;
  let reservedInFlightTokens = 0;

  const collectConsultedSourceIds = (): string[] => {
    const union = new Set<string>();
    for (const roleMap of Object.values(consultedSourcesByRole)) {
      for (const id of roleMap.keys()) union.add(id);
    }
    for (const id of crosscheckSourcesById.keys()) union.add(id);
    return [...union];
  };

  const stopForBudget = (
    reason: "budget.tool_calls" | "budget.tokens" | "budget.timeout",
    detail: string,
  ): void => {
    budgetStopped = true;
    input.budget?.onStop(reason, detail);
  };

  const remainingTokensNow = (): number => {
    if (!input.budget) return Number.POSITIVE_INFINITY;
    return Math.floor(input.budget.maxTokens - input.budget.usedTokens() - reservedInFlightTokens);
  };

  const reserveWaveCaps = (
    prompts: readonly string[],
    intendedPerCall = DECISION_MAX_TOKENS,
    reserveTrailingTokens = 0,
  ): readonly number[] => {
    const count = prompts.length;
    if (count <= 0) return [];
    if (!input.budget) {
      return Array.from({ length: count }, () => intendedPerCall);
    }
    if (budgetStopped) return Array.from({ length: count }, () => 0);
    const elapsed = Date.now() - input.budget.runStartedAt;
    if (elapsed >= input.budget.timeoutMs) {
      stopForBudget(
        "budget.timeout",
        `运行耗时 ${String(elapsed)}ms 已达 timeoutMs=${String(input.budget.timeoutMs)}ms 上限`,
      );
      return Array.from({ length: count }, () => 0);
    }
    if (input.budget.hasUnknownUsage?.()) {
      stopForBudget("budget.tokens", "前置模型调用未返回有效 Token 用量，按保守策略停止后续模型调用");
      return Array.from({ length: count }, () => 0);
    }
    const remaining = remainingTokensNow();
    if (input.budget.maxTokens === 0 || remaining <= 0) {
      stopForBudget(
        "budget.tokens",
        `Token 用量 ${String(input.budget.usedTokens())} 已达 maxTokens=${String(input.budget.maxTokens)} 上限`,
      );
      return Array.from({ length: count }, () => 0);
    }
    const estPrompts = prompts.map((p) => estimateDecisionPromptTokens(p));
    const estPromptSum = estPrompts.reduce((sum, tokens) => sum + tokens, 0);
    const minTotal = estPromptSum + count * DECISION_MIN_COMPLETION_TOKENS;
    if (minTotal > remaining) {
      stopForBudget(
        "budget.tokens",
        `并发波次估计输入+最小完成额度 ${String(minTotal)} 超过剩余预算 ${String(remaining)}，拒绝启动波次`,
      );
      return Array.from({ length: count }, () => 0);
    }
    const headroom = remaining - estPromptSum;
    const waveHeadroom = Math.max(count * DECISION_MIN_COMPLETION_TOKENS, headroom - reserveTrailingTokens);
    const baseShare = Math.min(intendedPerCall, Math.floor(waveHeadroom / count));
    const caps: number[] = [];
    let allocated = 0;
    for (let index = 0; index < count; index += 1) {
      let cap = baseShare;
      if (index === count - 1) {
        cap = Math.min(intendedPerCall, Math.max(0, waveHeadroom - allocated));
      }
      caps.push(cap);
      allocated += cap;
    }
    return caps;
  };

  const reserveModelCall = (
    promptText: string,
    preferredCap?: number,
  ): { cap: number; reservation: number } | null => {
    const intended =
      preferredCap === undefined
        ? DECISION_MAX_TOKENS
        : Math.min(DECISION_MAX_TOKENS, Math.floor(preferredCap));
    if (!input.budget) return { cap: intended, reservation: 0 };
    if (budgetStopped) return null;
    const elapsed = Date.now() - input.budget.runStartedAt;
    if (elapsed >= input.budget.timeoutMs) {
      stopForBudget(
        "budget.timeout",
        `运行耗时 ${String(elapsed)}ms 已达 timeoutMs=${String(input.budget.timeoutMs)}ms 上限`,
      );
      return null;
    }
    if (input.budget.hasUnknownUsage?.()) {
      stopForBudget("budget.tokens", "前置模型调用未返回有效 Token 用量，按保守策略停止后续模型调用");
      return null;
    }
    const remaining = remainingTokensNow();
    if (input.budget.maxTokens === 0 || remaining <= 0) {
      stopForBudget(
        "budget.tokens",
        `Token 用量 ${String(input.budget.usedTokens())} 已达 maxTokens=${String(input.budget.maxTokens)} 上限`,
      );
      return null;
    }
    if (intended <= 0) return null;
    const estPrompt = estimateDecisionPromptTokens(promptText);
    const availableForCompletion = remaining - estPrompt;
    if (availableForCompletion < DECISION_MIN_COMPLETION_TOKENS) {
      stopForBudget(
        "budget.tokens",
        `估计输入 ${String(estPrompt)} + 最小完成额度 ${String(DECISION_MIN_COMPLETION_TOKENS)} 超过剩余预算 ${String(remaining)}，停止模型调用`,
      );
      return null;
    }
    const cap = Math.min(intended, availableForCompletion);
    if (cap <= 0) return null;
    const reservation = estPrompt + cap;
    reservedInFlightTokens += reservation;
    return { cap, reservation };
  };

  const releaseModelReservation = (reservedTokens: number): void => {
    reservedInFlightTokens = Math.max(0, reservedInFlightTokens - reservedTokens);
  };

  const canCallTool = (): boolean => {
    if (!input.budget) return true;
    if (budgetStopped) return false;
    const elapsed = Date.now() - input.budget.runStartedAt;
    if (elapsed >= input.budget.timeoutMs) {
      stopForBudget(
        "budget.timeout",
        `运行耗时 ${String(elapsed)}ms 已达 timeoutMs=${String(input.budget.timeoutMs)}ms 上限`,
      );
      return false;
    }
    const totalCalls = input.budget.usedToolCalls() + toolCalls.length;
    if (totalCalls >= input.budget.maxToolCalls) {
      stopForBudget(
        "budget.tool_calls",
        `工具调用次数 ${String(totalCalls)} 已达 maxToolCalls=${String(input.budget.maxToolCalls)} 上限`,
      );
      return false;
    }
    return true;
  };

  async function invokeTool(
    tool: ToolName,
    params: unknown,
    callerRole: string,
    candidateId?: CandidateId,
  ): Promise<Awaited<ReturnType<typeof dispatchToolCall>> | null> {
    if (!canCallTool()) return null;
    const res = await dispatchToolCall({
      tool,
      params,
      callerRole,
      runId: input.runId,
    });
    const summary = summarizeToolData(tool, res.ok, res.data, res.error);
    toolCalls.push({
      tool,
      callerRole,
      ...(candidateId ? { candidateId } : {}),
      ok: res.ok,
      summary,
      elapsedMs: res.elapsedMs,
    });
    return res;
  }

  async function runRoleConsultWave(
    requests: ReadonlyArray<{ readonly role: CollabRole; readonly sourceIds: readonly string[] }>,
  ): Promise<number> {
    if (!hasSources || requests.length === 0 || budgetStopped) return 0;
    let totalNewlyRead = 0;
    await Promise.all(
      requests.map(async ({ role, sourceIds }) => {
        const roleMap = consultedSourcesByRole[role];
        const beforeSize = roleMap.size;
        const res = await invokeTool(
          "sources.read",
          { sources: evidenceSources, sourceIds: [...sourceIds] },
          role,
        );
        if (res?.ok && Array.isArray(res.data)) {
          for (const entry of res.data as ReadonlyArray<{ id?: string; title?: string; kind?: string; body?: string }>) {
            if (typeof entry.id === "string") {
              roleMap.set(entry.id, {
                id: entry.id,
                title: entry.title ?? entry.id,
                ...(entry.kind !== undefined ? { kind: entry.kind } : {}),
                body: entry.body ?? "",
              });
            }
          }
        }
        totalNewlyRead += roleMap.size - beforeSize;
      }),
    );
    return totalNewlyRead;
  }

  async function runCrosscheckConsult(sourceIds: readonly string[]): Promise<number> {
    if (!hasSources || sourceIds.length === 0 || budgetStopped) return 0;
    const beforeSize = crosscheckSourcesById.size;
    const res = await invokeTool(
      "sources.read",
      { sources: evidenceSources, sourceIds: [...sourceIds] },
      "crosscheck",
    );
    if (res?.ok && Array.isArray(res.data)) {
      for (const entry of res.data as ReadonlyArray<{ id?: string; title?: string; kind?: string; body?: string }>) {
        if (typeof entry.id === "string") {
          crosscheckSourcesById.set(entry.id, {
            id: entry.id,
            title: entry.title ?? entry.id,
            ...(entry.kind !== undefined ? { kind: entry.kind } : {}),
            body: entry.body ?? "",
          });
        }
      }
    }
    return crosscheckSourcesById.size - beforeSize;
  }

  async function runRoleNode(
    role: CollabRole,
    nodeId: string,
    phase: "draft" | "consult",
    basePrompt: string,
    preferredCap?: number,
  ): Promise<SingleSelfReviewNode> {
    const started = Date.now();
    let correction = "";
    let attempts = 0;
    const totalUsage = { promptTokens: 0, completionTokens: 0 };
    let lastError = "未完成";
    input.onNodeEvent?.({
      type: "started",
      nodeId,
      role,
      detail: `正在请求并行角色裁决：${role}`,
    });

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (completionsUsed >= maxCompletions || budgetStopped) {
        const failed: SingleSelfReviewNode = {
          id: nodeId,
          phase,
          status: "failed",
          attempts,
          elapsedMs: Date.now() - started,
          usage: totalUsage,
          error: budgetStopped ? "预算上限已触发" : "决策调用次数已达 maxDecisionCompletions 上限",
        };
        nodes.push(failed);
        return failed;
      }
      if (attempt === 1 && preferredCap !== undefined && preferredCap <= 0) {
        const failed: SingleSelfReviewNode = {
          id: nodeId,
          phase,
          status: "failed",
          attempts,
          elapsedMs: Date.now() - started,
          usage: totalUsage,
          error: "预算上限已触发",
        };
        nodes.push(failed);
        return failed;
      }

      const attemptPrompt = basePrompt + correction;
      const reserved = reserveModelCall(attemptPrompt, attempt === 1 ? preferredCap : undefined);
      if (reserved === null) {
        const failed: SingleSelfReviewNode = {
          id: nodeId,
          phase,
          status: "failed",
          attempts,
          elapsedMs: Date.now() - started,
          usage: totalUsage,
          error: "预算上限已触发",
        };
        nodes.push(failed);
        return failed;
      }

      let reservationActive = Boolean(input.budget);
      const releaseOnce = (): void => {
        if (!reservationActive) return;
        reservationActive = false;
        releaseModelReservation(reserved.reservation);
      };

      const nodeRemaining = timeoutMs - (Date.now() - started);
      const runRemaining = input.budget
        ? input.budget.timeoutMs - (Date.now() - input.budget.runStartedAt)
        : nodeRemaining;
      const remaining = Math.min(nodeRemaining, runRemaining);
      if (remaining <= 0) {
        releaseOnce();
        if (input.budget && runRemaining <= 0) {
          stopForBudget(
            "budget.timeout",
            `运行耗时已达 timeoutMs=${String(input.budget.timeoutMs)}ms 上限`,
          );
        }
        const failed: SingleSelfReviewNode = {
          id: nodeId,
          phase,
          status: "failed",
          attempts,
          elapsedMs: Date.now() - started,
          usage: totalUsage,
          error: "模型节点超时",
        };
        nodes.push(failed);
        return failed;
      }

      attempts += 1;
      completionsUsed += 1;
      input.budget?.recordPredictedTokens?.(reserved.cap);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const completion = await Promise.race([
          input.live.client.complete(
            withCompatMessages({
              runId,
              round: input.round,
              nodeId,
              attempt,
              prompt: attemptPrompt,
              maxTokens: reserved.cap,
              responseFormat: "json_object",
              reasoningEffort: "low",
              timeoutMs: remaining,
            }),
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("模型节点超时")), remaining);
          }),
        ]);
        releaseOnce();
        input.budget?.recordUsage(completion?.usage);
        if (
          completion?.usage &&
          typeof completion.usage.promptTokens === "number" &&
          Number.isFinite(completion.usage.promptTokens) &&
          typeof completion.usage.completionTokens === "number" &&
          Number.isFinite(completion.usage.completionTokens)
        ) {
          totalUsage.promptTokens += Math.max(0, completion.usage.promptTokens);
          totalUsage.completionTokens += Math.max(0, completion.usage.completionTokens);
        } else if (input.budget) {
          stopForBudget("budget.tokens", "模型未返回有效 Token 用量，按保守策略停止后续模型调用");
        }
        if (input.budget && input.budget.usedTokens() > input.budget.maxTokens) {
          stopForBudget(
            "budget.tokens",
            `Token 用量 ${String(input.budget.usedTokens())} 超过 maxTokens=${String(input.budget.maxTokens)} 上限`,
          );
        }
        if (input.budget && Date.now() - input.budget.runStartedAt >= input.budget.timeoutMs) {
          stopForBudget("budget.timeout", `运行耗时已达 timeoutMs=${String(input.budget.timeoutMs)}ms 上限`);
        }

        const act = hasSources
          ? parseAndValidateDecisionOrConsultAct(completion.text, allowedRefs, validCandidates, validSourceIds)
          : parseAndValidateDecisionAct(completion.text, allowedRefs, validCandidates);
        const completed: SingleSelfReviewNode = {
          id: nodeId,
          phase,
          status: "completed",
          attempts,
          elapsedMs: Date.now() - started,
          usage: totalUsage,
          act,
        };
        nodes.push(completed);
        input.onNodeEvent?.({
          type: "completed",
          nodeId,
          role,
          detail: `角色 ${role} 输出通过结构、候选与证据引用校验`,
        });
        return completed;
      } catch (error: unknown) {
        releaseOnce();
        if (input.budget && Date.now() - input.budget.runStartedAt >= input.budget.timeoutMs && !budgetStopped) {
          stopForBudget("budget.timeout", `运行耗时已达 timeoutMs=${String(input.budget.timeoutMs)}ms 上限`);
        }
        lastError = (error instanceof Error ? error.message : String(error)).slice(0, 1200);
        if (attempt === 2 || budgetStopped || completionsUsed >= maxCompletions) {
          const failed: SingleSelfReviewNode = {
            id: nodeId,
            phase,
            status: "failed",
            attempts,
            elapsedMs: Date.now() - started,
            usage: totalUsage,
            error: lastError,
          };
          nodes.push(failed);
          input.onNodeEvent?.({
            type: "failed",
            nodeId,
            role,
            detail: lastError,
          });
          return failed;
        }
        input.onNodeEvent?.({
          type: "retrying",
          nodeId,
          role,
          detail: lastError,
        });
        correction = `\n上次输出校验或调用失败：${lastError}\n请修正以上错误，严格按协议只输出 JSON。`;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }

    const failed: SingleSelfReviewNode = {
      id: nodeId,
      phase,
      status: "failed",
      attempts,
      elapsedMs: Date.now() - started,
      usage: totalUsage,
      error: lastError,
    };
    nodes.push(failed);
    return failed;
  }

  const buildRolePrompt = (role: CollabRole): string => {
    const roleRows = input.pack.roleRows
      .filter((row) => row.role === role)
      .map((row) => ({
        id: row.id,
        margin: row.margin,
        p10Cents: row.p10Cents,
        orders: row.orders,
        stockoutDays: row.stockoutDays,
        minCashCents: row.minCashCents,
        failCheckIds: row.failCheckIds,
        ...(row.warnCheckIds.length > 0 ? { warnCheckIds: row.warnCheckIds } : {}),
      }));
    const consultedBlock = formatConsultedSourcesPromptBlock([...consultedSourcesByRole[role].values()]);
    const receiptsBlock = formatToolReceiptsPromptBlock(
      toolCalls.filter((receipt) => receipt.callerRole === role),
    );
    return [
      "你是多角色独立评审中的一位专家，仅基于任务、本角色数据与自己查阅的材料独立给出结构化裁决。",
      DELIBERATION_GOALS[role],
      "注意区分闭合约束不可行（应 reject）、开放前提缺失或矛盾（应 clarify）与红线内可行方案（应 approve）。",
      packBlock,
      ...(roleRows.length > 0 ? [`本角色场景数值:${JSON.stringify(roleRows)}`] : []),
      ...(consultedBlock ? [consultedBlock] : []),
      ...(receiptsBlock ? [receiptsBlock] : []),
      formatInstruction,
    ].join("\n");
  };

  // Phase 1: Isolated parallel roles from the start, with per-role consult memory.
  // Reserve headroom for at least 1 crosscheck node if roles disagree.
  const crosscheckReserveTokens = hasSources ? 3200 : 2200;
  const latestNodeByRole = new Map<CollabRole, SingleSelfReviewNode>();
  const initialPrompts = DELIBERATION_ROLES.map((role) => buildRolePrompt(role));
  const initialCaps = reserveWaveCaps(initialPrompts, DECISION_MAX_TOKENS, crosscheckReserveTokens);
  const initialNodes = await Promise.all(
    DELIBERATION_ROLES.map((role, index) =>
      runRoleNode(role, `decision-consensus-${role}`, "draft", initialPrompts[index]!, initialCaps[index]),
    ),
  );
  for (let i = 0; i < DELIBERATION_ROLES.length; i += 1) {
    latestNodeByRole.set(DELIBERATION_ROLES[i]!, initialNodes[i]!);
  }

  let consultWave = 0;
  while (!budgetStopped && completionsUsed < maxCompletions) {
    const consultRequests: Array<{ readonly role: CollabRole; readonly sourceIds: readonly string[] }> = [];
    for (const role of DELIBERATION_ROLES) {
      const node = latestNodeByRole.get(role);
      if (node?.status === "completed" && node.act?.action === "consult") {
        consultRequests.push({ role, sourceIds: node.act.sourceIds });
      }
    }
    if (consultRequests.length === 0) break;
    const newlyRead = await runRoleConsultWave(consultRequests);
    if (newlyRead <= 0 || budgetStopped || completionsUsed >= maxCompletions) break;
    consultWave += 1;
    const rolesToRePrompt = consultRequests.map((req) => req.role);
    const followUpPrompts = rolesToRePrompt.map((role) => buildRolePrompt(role));
    const followUpCaps = reserveWaveCaps(followUpPrompts, DECISION_MAX_TOKENS, crosscheckReserveTokens);
    const followUpNodes = await Promise.all(
      rolesToRePrompt.map((role, index) =>
        runRoleNode(
          role,
          `decision-consensus-${role}-consult-${String(consultWave)}`,
          "consult",
          followUpPrompts[index]!,
          followUpCaps[index],
        ),
      ),
    );
    for (let i = 0; i < rolesToRePrompt.length; i += 1) {
      latestNodeByRole.set(rolesToRePrompt[i]!, followUpNodes[i]!);
    }
  }

  // Collect terminal role decisions (no single-host draft before roles).
  const roleDecisions = DELIBERATION_ROLES.flatMap((role) => {
    const node = latestNodeByRole.get(role);
    if (node?.status === "completed" && node.act && node.act.action !== "consult") {
      return [{ role, act: node.act }];
    }
    return [];
  });

  if (roleDecisions.length === 0) {
    return {
      act: null,
      nodes,
      toolCalls,
      completionsUsed,
      exhausted: completionsUsed >= maxCompletions,
      consultedSourceIds: collectConsultedSourceIds(),
      challengeTriggered: false,
      challengeOutcome: "skipped-no-tension",
    };
  }

  const decisionKey = (act: DecisionAct): string => {
    if (act.action === "approve") return `approve:${act.candidateId ?? ""}`;
    if (act.action === "clarify") return `clarify:${[...(act.fields ?? [])].sort().join(",")}`;
    return "reject";
  };

  const distinctKeys = new Set(roleDecisions.map((item) => decisionKey(item.act)));
  const hasDisagreement = distinctKeys.size > 1;

  // Immediate close on agreement: no cross-check node is invoked.
  if (!hasDisagreement) {
    return {
      act: roleDecisions[0]!.act,
      nodes,
      toolCalls,
      completionsUsed,
      exhausted: false,
      consultedSourceIds: collectConsultedSourceIds(),
      challengeTriggered: false,
      challengeOutcome: "skipped-no-tension",
    };
  }

  // Disagreement detected -> seed cross-check consulted sources with bodies already read by roles
  // (never pre-load unread bodies), and allow cross-check to issue sources.read via consult if needed.
  for (const roleMap of Object.values(consultedSourcesByRole)) {
    for (const [id, src] of roleMap.entries()) {
      crosscheckSourcesById.set(id, src);
    }
  }

  // Pick a non-reject majority/fallback baseline in case cross-check upholds or produces an ungrounded rebuttal.
  const countByKey = new Map<string, { count: number; act: DecisionAct }>();
  for (const item of roleDecisions) {
    const key = decisionKey(item.act);
    const existing = countByKey.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      countByKey.set(key, { count: 1, act: item.act });
    }
  }
  const rankedActs = [...countByKey.values()].sort((a, b) => b.count - a.count);
  const nonRejectMajority = rankedActs.find((entry) => entry.act.action !== "reject")?.act;
  const baselineAct = nonRejectMajority ?? rankedActs[0]!.act;

  const buildCrosscheckPrompt = (): string => {
    const consultedBlock = formatConsultedSourcesPromptBlock([...crosscheckSourcesById.values()]);
    const receiptsBlock = formatToolReceiptsPromptBlock(toolCalls);
    const draftsSummary = roleDecisions.map(({ role, act }) => ({ role, decision: act }));
    return [
      "你是多角色分歧交叉核验员（crosscheck）。当前并行角色对裁决存在分歧，请核对各角色初稿、任务文本与已查阅资料正文。",
      "规则：1) 若需补充查阅资料目录中未读的条目，可先输出 consult（每次最多 2 个 sourceIds）；2) 若维持多数/稳健基线且无有效反证，输出 uphold；3) 若要推翻/改判（例如依据某条资料驳回或改选），必须输出 rebut 并附带至少一条逐字原文摘录 quotes（excerpt 必须是对应 sourceId 正文的逐字连续子串，禁止臆造）。",
      packBlock,
      `各角色独立裁决:${JSON.stringify(draftsSummary)}`,
      ...(consultedBlock ? [consultedBlock] : []),
      ...(receiptsBlock ? [receiptsBlock] : []),
      "只输出单个合法 JSON 对象（禁额外文字/字段），格式三选一：",
      '1) {"action":"uphold","summary":"定性说明维持基线原因(>=8字，禁数字)"}',
      '2) {"action":"rebut","decision":{"action":"approve|reject|clarify",...},"quotes":[{"sourceId":"id","excerpt":"逐字原文摘录"}]}',
      ...(hasSources
        ? ['3) {"action":"consult","sourceIds":["id1","id2"],"summary":"定性说明查阅原因(>=8字，禁数字)","evidenceRefs":["task"]}']
        : []),
    ].join("\n");
  };

  let crosscheckStep = 0;
  let crosscheckAct: CrosscheckAct | null = null;
  let crosscheckConsultedMore = true;

  while (!budgetStopped && completionsUsed < maxCompletions && crosscheckAct === null && crosscheckConsultedMore) {
    crosscheckConsultedMore = false;
    const nodeId =
      crosscheckStep === 0
        ? "decision-crosscheck"
        : `decision-crosscheck-consult-${String(crosscheckStep)}`;
    const started = Date.now();
    let correction = "";
    let attempts = 0;
    const totalUsage = { promptTokens: 0, completionTokens: 0 };
    let lastError = "未完成";
    const basePrompt = buildCrosscheckPrompt();

    input.onNodeEvent?.({
      type: "started",
      nodeId,
      role: "crosscheck",
      detail: "并行角色存在分歧，启动交叉核验节点",
    });

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (completionsUsed >= maxCompletions || budgetStopped) break;
      const attemptPrompt = basePrompt + correction;
      const reserved = reserveModelCall(attemptPrompt);
      if (reserved === null) {
        nodes.push({
          id: nodeId,
          phase: "review",
          status: "failed",
          attempts,
          elapsedMs: Date.now() - started,
          usage: totalUsage,
          error: "预算上限已触发",
        });
        break;
      }

      let reservationActive = Boolean(input.budget);
      const releaseOnce = (): void => {
        if (!reservationActive) return;
        reservationActive = false;
        releaseModelReservation(reserved.reservation);
      };

      const nodeRemaining = timeoutMs - (Date.now() - started);
      const runRemaining = input.budget
        ? input.budget.timeoutMs - (Date.now() - input.budget.runStartedAt)
        : nodeRemaining;
      const remaining = Math.min(nodeRemaining, runRemaining);
      if (remaining <= 0) {
        releaseOnce();
        if (input.budget && runRemaining <= 0) {
          stopForBudget(
            "budget.timeout",
            `运行耗时已达 timeoutMs=${String(input.budget.timeoutMs)}ms 上限`,
          );
        }
        nodes.push({
          id: nodeId,
          phase: "review",
          status: "failed",
          attempts,
          elapsedMs: Date.now() - started,
          usage: totalUsage,
          error: "模型节点超时",
        });
        break;
      }

      attempts += 1;
      completionsUsed += 1;
      input.budget?.recordPredictedTokens?.(reserved.cap);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const completion = await Promise.race([
          input.live.client.complete(
            withCompatMessages({
              runId,
              round: input.round,
              nodeId,
              attempt,
              prompt: attemptPrompt,
              maxTokens: reserved.cap,
              responseFormat: "json_object",
              reasoningEffort: "low",
              timeoutMs: remaining,
            }),
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("模型节点超时")), remaining);
          }),
        ]);
        releaseOnce();
        input.budget?.recordUsage(completion?.usage);
        if (
          completion?.usage &&
          typeof completion.usage.promptTokens === "number" &&
          Number.isFinite(completion.usage.promptTokens) &&
          typeof completion.usage.completionTokens === "number" &&
          Number.isFinite(completion.usage.completionTokens)
        ) {
          totalUsage.promptTokens += Math.max(0, completion.usage.promptTokens);
          totalUsage.completionTokens += Math.max(0, completion.usage.completionTokens);
        } else if (input.budget) {
          stopForBudget("budget.tokens", "模型未返回有效 Token 用量，按保守策略停止后续模型调用");
        }
        if (input.budget && input.budget.usedTokens() > input.budget.maxTokens) {
          stopForBudget(
            "budget.tokens",
            `Token 用量 ${String(input.budget.usedTokens())} 超过 maxTokens=${String(input.budget.maxTokens)} 上限`,
          );
        }
        if (input.budget && Date.now() - input.budget.runStartedAt >= input.budget.timeoutMs) {
          stopForBudget("budget.timeout", `运行耗时已达 timeoutMs=${String(input.budget.timeoutMs)}ms 上限`);
        }

        const trimmed = completion.text.trim().replace(/^```json\s*\n?([\s\S]*?)\n?```$/i, "$1");
        let parsedRaw: unknown;
        try {
          parsedRaw = JSON.parse(trimmed);
        } catch {
          throw new Error("Crosscheck 输出必须是一个完整 JSON 对象");
        }
        if (
          hasSources &&
          typeof parsedRaw === "object" &&
          parsedRaw !== null &&
          (parsedRaw as { action?: unknown }).action === "consult"
        ) {
          const consultAct = parseAndValidateDecisionOrConsultAct(
            completion.text,
            allowedRefs,
            validCandidates,
            validSourceIds,
          );
          if (consultAct.action === "consult") {
            nodes.push({
              id: nodeId,
              phase: "consult",
              status: "completed",
              attempts,
              elapsedMs: Date.now() - started,
              usage: totalUsage,
              act: consultAct,
            });
            input.onNodeEvent?.({
              type: "completed",
              nodeId,
              role: "crosscheck",
              detail: `交叉核验请求查阅资料：${consultAct.sourceIds.join("、")}`,
            });
            const newlyRead = await runCrosscheckConsult(consultAct.sourceIds);
            if (newlyRead > 0 && !budgetStopped && completionsUsed < maxCompletions) {
              crosscheckStep += 1;
              crosscheckConsultedMore = true;
            }
            break;
          }
        }

        const parsedCrosscheck = parseAndValidateCrosscheckAct(
          completion.text,
          allowedRefs,
          validCandidates,
        );
        crosscheckAct = parsedCrosscheck;
        nodes.push({
          id: nodeId,
          phase: "review",
          status: "completed",
          attempts,
          elapsedMs: Date.now() - started,
          usage: totalUsage,
          ...(parsedCrosscheck.action === "rebut" ? { act: parsedCrosscheck.decision } : {}),
        });
        input.onNodeEvent?.({
          type: "completed",
          nodeId,
          role: "crosscheck",
          detail: `交叉核验输出：${parsedCrosscheck.action}`,
        });
        break;
      } catch (error: unknown) {
        releaseOnce();
        if (input.budget && Date.now() - input.budget.runStartedAt >= input.budget.timeoutMs && !budgetStopped) {
          stopForBudget("budget.timeout", `运行耗时已达 timeoutMs=${String(input.budget.timeoutMs)}ms 上限`);
        }
        lastError = (error instanceof Error ? error.message : String(error)).slice(0, 1200);
        if (attempt === 2 || budgetStopped || completionsUsed >= maxCompletions) {
          nodes.push({
            id: nodeId,
            phase: "review",
            status: "failed",
            attempts,
            elapsedMs: Date.now() - started,
            usage: totalUsage,
            error: lastError,
          });
          input.onNodeEvent?.({
            type: "failed",
            nodeId,
            role: "crosscheck",
            detail: lastError,
          });
          break;
        }
        input.onNodeEvent?.({
          type: "retrying",
          nodeId,
          role: "crosscheck",
          detail: lastError,
        });
        correction = `\n上次输出校验或调用失败：${lastError}\n请修正以上错误，严格按协议只输出 JSON。`;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
  }

  if (crosscheckAct === null) {
    return {
      act: null,
      nodes,
      toolCalls,
      completionsUsed,
      exhausted: completionsUsed >= maxCompletions,
      consultedSourceIds: collectConsultedSourceIds(),
      challengeTriggered: true,
      challengeOutcome: "upheld",
    };
  }

  if (crosscheckAct.action === "uphold") {
    return {
      act: baselineAct,
      nodes,
      toolCalls,
      completionsUsed,
      exhausted: false,
      consultedSourceIds: collectConsultedSourceIds(),
      challengeTriggered: true,
      challengeOutcome: "upheld",
    };
  }

  const verifyQuotesForDecision = hasSources
    ? crosscheckSourcesById
    : new Map<string, EvidenceSource>();
  const quoteCheck = verifyCrosscheckQuotes(crosscheckAct.quotes, verifyQuotesForDecision);
  if (!quoteCheck.grounded) {
    return {
      act: baselineAct.action === "reject"
        ? {
            action: "clarify",
            fields: ["return-evidence"],
            summary: "交叉核验反驳引文未在资料原文中找到逐字依据，暂不采信驳回",
            evidenceRefs: ["task"],
          }
        : baselineAct,
      nodes,
      toolCalls,
      completionsUsed,
      exhausted: false,
      consultedSourceIds: collectConsultedSourceIds(),
      challengeTriggered: true,
      challengeOutcome: "rebuttal-ungrounded",
    };
  }

  return {
    act: crosscheckAct.decision,
    nodes,
    toolCalls,
    completionsUsed,
    exhausted: false,
    consultedSourceIds: collectConsultedSourceIds(),
    challengeTriggered: true,
    challengeOutcome: "rebutted",
  };
}
