import { z } from "zod";

import { parseRunId } from "../../engine/ids.js";
import { analyzeProductInput } from "../intake/agent.js";
import type { AnswerKind } from "./compose.js";
import type { LiveLlm } from "./llm.js";
import { parseTaskFacts } from "./task-facts.js";

export type PreflightQuestion = { readonly id: AnswerKind; readonly ask: string; readonly why: string };
export type Preflight = {
  readonly task: string;
  readonly ready: boolean;
  readonly mode: "rule" | "live" | "fallback";
  readonly model: string | null;
  readonly note: string;
  readonly questions: readonly PreflightQuestion[];
  readonly known: readonly { readonly label: string; readonly value: string }[];
  readonly assumptions: readonly string[];
};

/** Read-only intake: never starts a pricing run or fills missing merchant facts. */
export function inspectTask(task: string): Preflight {
  const intake = analyzeProductInput({ text: task });
  const facts = parseTaskFacts(task);
  const questions: PreflightQuestion[] = [];
  const known: { label: string; value: string }[] = [];
  const money = (value: number): string => `${(value / 100).toFixed(2)} 元`;
  const required = (id: AnswerKind, label: string, value: string | null, ask: string, why: string): void => {
    if (value === null) questions.push({ id, ask, why });
    else known.push({ label, value });
  };
  const rawCompetitor = facts.competitorCents ?? intake.patch.competitorCents ?? null;
  const competitor = rawCompetitor !== null && rawCompetitor >= 100 && rawCompetitor <= 10_000_000 ? rawCompetitor : null;
  required("name", "商品", intake.patch.name ?? null, "准备卖什么商品？", "没有上架链接也可以，写商品名称和规格即可。");
  required("buy", "采购价", facts.buyCents === null ? null : money(facts.buyCents), "每件进货成本是多少元？", "用于算保本价，不替你猜进货成本。");
  required("shipping", "快递费", facts.shippingCents === null ? null : money(facts.shippingCents), "每单快递费是多少元？", "供应商承担运费可填 0；包邮不代表商家没有运费。");
  required("competitor", "同类售价", competitor === null ? null : money(competitor), "同类商品通常卖多少元？", "未上架也能用同类参考价；不知道时可先去找参考，不会编一个价。");
  const assumptions: string[] = [];
  const optional = (label: string, value: number | null, fallback: string, format: (value: number) => string = money): void => {
    if (value === null) assumptions.push(`${label}未提供，试算按${fallback}`);
    else known.push({ label, value: format(value) });
  };
  optional("包材", facts.packagingCents, "1.50 元/件");
  optional("目标毛利", facts.targetMargin, "25%", (value) => `${String(value * 100)}%`);
  optional("同类日单量", facts.marketOrders ?? intake.patch.marketOrders ?? null, "50 单/天", (value) => `${String(value)} 单/天`);
  optional("周转资金", facts.cashCents, "300.00 元");
  optional("日推广预算", facts.adDailyBudgetCents, "30.00 元/天");
  optional("活动折扣", facts.promoDiscount, "9 折", (value) => `${String(value * 10)} 折`);
  assumptions.push(intake.patch.platform === undefined ? "平台未提供，试算按淘宝预设费率和账期" : "费率与账期采用所选平台预设，需按店铺实际核对");
  assumptions.push("退货率 15%、退货商品残值 60%、投放点击成本 0.80 元、转化率 4%、价格弹性 2.2，均为演示假设");
  return { task, ready: questions.length === 0, mode: "rule", model: null, note: "本地规则检查资料，不会联网读取商品页。", questions, known, assumptions };
}

const wordingSchema = z.strictObject({ questions: z.array(z.strictObject({ id: z.enum(["name", "buy", "shipping", "competitor"]), ask: z.string().min(4).max(120).regex(/^[^0-9¥￥]+$/) })).max(4) });

/** A model may phrase existing questions, never change readiness or supply values. */
export async function prepareIntake(task: string, live: LiveLlm | null): Promise<Preflight> {
  const base = inspectTask(task);
  if (live === null || base.ready) return base;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply = await Promise.race([live.client.complete({
      runId: parseRunId("merchant-intake"), round: 1, nodeId: "intake-questions", attempt: 1, maxTokens: 500,
      prompt: `你是商家资料助手。只把下面缺失字段的问题改写得自然、简短，不能增删字段或给示例数字，不能填答案或价格。每个 ask 必须是问句，不含数字。严格返回 JSON {"questions":[{"id":"...","ask":"...？"}]}。待改写的问题：${JSON.stringify(base.questions)}`,
    }), new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("模型提问超时")), 12_000); })]);
    const parsed = wordingSchema.parse(JSON.parse(reply.text));
    const ids = parsed.questions.map((q) => q.id);
    if (new Set(ids).size !== base.questions.length || ids.length !== base.questions.length || base.questions.some((q) => !ids.includes(q.id as typeof ids[number])) || parsed.questions.some((q) => !/[？?]$/.test(q.ask))) throw new Error("问题字段不一致");
    return { ...base, mode: "live", model: live.model, note: "模型仅组织追问；缺项判断和数据校验由本地规则执行。", questions: base.questions.map((q) => ({ ...q, ask: parsed.questions.find((item) => item.id === q.id)!.ask })) };
  } catch {
    return { ...base, mode: "fallback", model: live.model, note: "模型提问不可用或校验未通过，已回退本地规则追问。" };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
