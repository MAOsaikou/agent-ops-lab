import { z } from "zod";

import { analyzeProductInput } from "../intake/agent.js";
import type { IntakeResult } from "../intake/types.js";
import { buildCandidates, checksFor } from "../pricing/candidates.js";
import { breakEvenCents, evaluate, unitCost } from "../pricing/economics.js";
import type { ProductInput } from "../pricing/model.js";
import {
  PLATFORM_IDS,
  PLATFORM_PRESETS,
  RATE_DISCLAIMER,
  SERVICE_TAGS,
  type PlatformId,
  type PlatformPreset,
} from "../pricing/platform.js";
import { simulate } from "../pricing/simulate.js";

export const TOOL_NAMES = [
  "pricing.unit-cost",
  "pricing.break-even",
  "pricing.candidates",
  "pricing.simulate",
  "pricing.verify",
  "knowledge.search",
  "product.parse",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type ToolSpec = {
  readonly name: ToolName;
  readonly title: string;
  readonly kind: "compute" | "simulate" | "parse" | "kb";
};

export const TOOL_WHITELIST: readonly ToolSpec[] = [
  { name: "pricing.unit-cost", title: "单件成本核算", kind: "compute" },
  { name: "pricing.break-even", title: "保本价核算", kind: "compute" },
  { name: "pricing.candidates", title: "三策略报价计算", kind: "compute" },
  { name: "pricing.simulate", title: "30 天现金流模拟", kind: "simulate" },
  { name: "pricing.verify", title: "定价约束与风控检查", kind: "compute" },
  { name: "knowledge.search", title: "平台规则与费率检索", kind: "kb" },
  { name: "product.parse", title: "商品事实解析", kind: "parse" },
];

const productInputSchema: z.ZodType<ProductInput> = z.strictObject({
  platform: z.enum(PLATFORM_IDS),
  name: z.string().min(1).max(100),
  category: z.string().max(100),
  keywords: z.string().max(200),
  buyCents: z.number().int().nonnegative(),
  packagingCents: z.number().int().nonnegative(),
  shippingCents: z.number().int().nonnegative(),
  commissionRate: z.number().min(0).max(0.5),
  payFeeRate: z.number().min(0).max(0.05),
  returnRate: z.number().min(0).max(0.9),
  returnSalvage: z.number().min(0).max(1),
  adDailyBudgetCents: z.number().int().nonnegative(),
  adCpcCents: z.number().int().positive(),
  adCvr: z.number().min(0).max(1),
  competitorCents: z.number().int().positive(),
  marketOrders: z.number().int().nonnegative(),
  elasticity: z.number().min(0.5).max(10),
  targetMargin: z.number().min(0.01).max(0.9),
  cashCents: z.number().int().nonnegative(),
  settleDays: z.number().int().nonnegative(),
  services: z.array(z.enum(SERVICE_TAGS)),
  promoEnabled: z.boolean(),
  promoDiscount: z.number().min(0.1).max(1),
  seed: z.number().int(),
});

const unitCostParamsSchema = z.strictObject({
  input: productInputSchema,
  priceCents: z.number().int().positive(),
});

const breakEvenParamsSchema = z.strictObject({
  input: productInputSchema,
});

const candidatesParamsSchema = z.strictObject({
  input: productInputSchema,
  preset: z.custom<PlatformPreset>().optional(),
});

const simulateParamsSchema = z.strictObject({
  input: productInputSchema,
  priceCents: z.number().int().positive(),
  days: z.number().int().positive().optional(),
});

const verifyParamsSchema = z.strictObject({
  input: productInputSchema,
  priceCents: z.number().int().positive(),
  promoPriceCents: z.number().int().positive().optional(),
});

const knowledgeSearchParamsSchema = z.strictObject({
  query: z.string().min(1).max(500),
  platform: z.enum(PLATFORM_IDS).optional(),
});

const productParseParamsSchema = z.strictObject({
  text: z.string().min(1).max(20_000),
});

export type ToolCallRequest<T = unknown> = {
  readonly tool: ToolName;
  readonly params: T;
  readonly callerRole?: string | undefined;
  readonly runId?: string | undefined;
};

export type ToolCallResult<T = unknown> = {
  readonly tool: ToolName;
  readonly ok: boolean;
  readonly data?: T | undefined;
  readonly error?: string | undefined;
  readonly elapsedMs: number;
};

export type KbSearchHit = {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
};

/**
 * 白名单只读工具分发器。
 * 包装已有确定性函数，不改变原有函数语义，拒绝任何未授权的工具名称和非法参数。
 */
export async function dispatchToolCall<T = unknown>(
  req: ToolCallRequest,
): Promise<ToolCallResult<T>> {
  const started = Date.now();

  if (!TOOL_NAMES.includes(req.tool)) {
    return {
      tool: req.tool,
      ok: false,
      error: `Unauthorized tool: ${String(req.tool)}. Only whitelisted read-only tools allowed.`,
      elapsedMs: Date.now() - started,
    };
  }

  try {
    switch (req.tool) {
      case "pricing.unit-cost": {
        const { input, priceCents } = unitCostParamsSchema.parse(req.params);
        const result = unitCost(input, priceCents);
        return {
          tool: req.tool,
          ok: true,
          data: result as T,
          elapsedMs: Date.now() - started,
        };
      }

      case "pricing.break-even": {
        const { input } = breakEvenParamsSchema.parse(req.params);
        const result = breakEvenCents(input);
        return {
          tool: req.tool,
          ok: true,
          data: { breakEvenCents: result } as T,
          elapsedMs: Date.now() - started,
        };
      }

      case "pricing.candidates": {
        const { input, preset } = candidatesParamsSchema.parse(req.params);
        const activePreset = preset ?? PLATFORM_PRESETS[input.platform] ?? PLATFORM_PRESETS.taobao;
        const result = buildCandidates(input, activePreset);
        return {
          tool: req.tool,
          ok: true,
          data: result as T,
          elapsedMs: Date.now() - started,
        };
      }

      case "pricing.simulate": {
        const { input, priceCents, days } = simulateParamsSchema.parse(req.params);
        const result = simulate(input, priceCents, days);
        return {
          tool: req.tool,
          ok: true,
          data: result as T,
          elapsedMs: Date.now() - started,
        };
      }

      case "pricing.verify": {
        const { input, priceCents, promoPriceCents } = verifyParamsSchema.parse(req.params);
        const preset = PLATFORM_PRESETS[input.platform] ?? PLATFORM_PRESETS.taobao;
        const evaluation = evaluate(input, priceCents);
        const sim = simulate(input, priceCents);
        const promo = promoPriceCents ?? priceCents;
        const result = checksFor(input, preset, evaluation, sim, promo);
        return {
          tool: req.tool,
          ok: true,
          data: result as T,
          elapsedMs: Date.now() - started,
        };
      }

      case "knowledge.search": {
        const { platform } = knowledgeSearchParamsSchema.parse(req.params);
        const hits: KbSearchHit[] = [];
        const platformsToSearch: readonly PlatformId[] = platform ? [platform] : PLATFORM_IDS;

        for (const pid of platformsToSearch) {
          const p = PLATFORM_PRESETS[pid];
          hits.push({
            id: `kb-fee-${pid}`,
            title: `${p.label} 费率标准`,
            detail: `技术服务费率 ${(p.commissionRate * 100).toFixed(1)}%，支付手续费率 ${(p.payFeeRate * 100).toFixed(1)}%，默认参考退货率 ${(p.returnRate * 100).toFixed(1)}%。${RATE_DISCLAIMER}`,
          });
          hits.push({
            id: `kb-rules-${pid}`,
            title: `${p.label} 规则与结算周期`,
            detail: `常规结算周期 ${p.settleDays} 天，标题字数上限 ${p.titleMax} 字。${p.tips.join("；")}`,
          });
        }

        return {
          tool: req.tool,
          ok: true,
          data: hits as T,
          elapsedMs: Date.now() - started,
        };
      }

      case "product.parse": {
        const { text } = productParseParamsSchema.parse(req.params);
        const result: IntakeResult = analyzeProductInput({ text });
        return {
          tool: req.tool,
          ok: true,
          data: result as T,
          elapsedMs: Date.now() - started,
        };
      }

      default: {
        return {
          tool: req.tool,
          ok: false,
          error: `Unhandled tool: ${String(req.tool)}`,
          elapsedMs: Date.now() - started,
        };
      }
    }
  } catch (error) {
    return {
      tool: req.tool,
      ok: false,
      error: error instanceof Error ? error.message : "Tool invocation failed",
      elapsedMs: Date.now() - started,
    };
  }
}
