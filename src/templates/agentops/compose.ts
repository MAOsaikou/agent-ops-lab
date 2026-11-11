/**
 * Structured entry for merchants without a listing link.
 *
 * The product contract stays "one task string": this module only *writes* that string in the
 * wording the existing parsers (`intake/text.ts`, runner `parseTaskFacts`) already read. It never
 * fills a blank with a guess: a field left empty is left out of the sentence.
 */

export type ComposeForm = {
  readonly name: string;
  /** 同类商品现在卖多少（元） */
  readonly competitorYuan: string;
  readonly buyYuan: string;
  readonly shippingYuan: string;
  readonly packagingYuan?: string;
  readonly targetMarginPct?: string;
  readonly dailyOrders?: string;
  readonly cashYuan?: string;
  readonly adBudgetYuan?: string;
};

export type ComposeFieldId = keyof ComposeForm;

export type ComposeResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly errors: Readonly<Partial<Record<ComposeFieldId, string>>> };

export const REQUIRED_FIELDS: readonly ComposeFieldId[] = ["name", "competitorYuan", "buyYuan", "shippingYuan"];

const NAME_SEPARATORS = /[，,。；;！!？?\n\r]+/g;

function amount(raw: string | undefined, max: number, decimals: number): number | "empty" | "bad" {
  const text = (raw ?? "").trim().replace(/^[¥￥]/, "").replace(/\s*元$/, "").trim();
  if (text.length === 0) return "empty";
  const pattern =
    decimals === 0 ? /^\d{1,7}$/ : new RegExp(`^\\d{1,7}(?:\\.\\d{1,${String(decimals)}})?$`);
  if (!pattern.test(text)) return "bad";
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || value > max) return "bad";
  return value;
}

function plain(value: number): string {
  return String(value);
}

export function cleanProductName(raw: string): string {
  return raw.replace(NAME_SEPARATORS, " ").replace(/\s+/g, " ").trim().slice(0, 40);
}

export function composeTaskText(form: ComposeForm): ComposeResult {
  const errors: Partial<Record<ComposeFieldId, string>> = {};
  const name = cleanProductName(form.name);
  if ([...name].length < 2) errors.name = "写个能认出来的商品名，至少 2 个字";

  const competitor = amount(form.competitorYuan, 100_000, 2);
  const buy = amount(form.buyYuan, 100_000, 2);
  const shipping = amount(form.shippingYuan, 10_000, 2);
  if (competitor === "empty") errors.competitorYuan = "填同类商品现在卖多少钱";
  else if (competitor === "bad") errors.competitorYuan = "金额要是大于 0 的数字";
  if (buy === "empty") errors.buyYuan = "填你的进货价，我不会替你猜";
  else if (buy === "bad") errors.buyYuan = "金额要是大于 0 的数字";
  if (shipping === "empty") errors.shippingYuan = "填一单的快递费，我不会替你猜";
  else if (shipping === "bad") errors.shippingYuan = "金额要是大于 0 的数字";

  const packaging = amount(form.packagingYuan, 10_000, 2);
  const margin = amount(form.targetMarginPct, 60, 1);
  const orders = amount(form.dailyOrders, 1_000_000, 0);
  const cash = amount(form.cashYuan, 10_000_000, 2);
  const ad = amount(form.adBudgetYuan, 1_000_000, 2);
  if (packaging === "bad") errors.packagingYuan = "金额要是大于 0 的数字";
  if (margin === "bad" || (typeof margin === "number" && margin < 2)) errors.targetMarginPct = "目标毛利填 2 到 60 之间的百分数";
  if (orders === "bad") errors.dailyOrders = "单量要是正整数";
  if (cash === "bad") errors.cashYuan = "金额要是大于 0 的数字";
  if (ad === "bad") errors.adBudgetYuan = "金额要是大于 0 的数字";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (typeof competitor !== "number" || typeof buy !== "number" || typeof shipping !== "number") {
    return { ok: false, errors };
  }

  const clauses = [
    `商品名：${name}`,
    `竞品价 ¥${plain(competitor)}`,
    `采购价 ${plain(buy)} 元`,
    `快递 ${plain(shipping)} 元`,
  ];
  if (typeof packaging === "number") clauses.push(`包材 ${plain(packaging)} 元`);
  if (typeof margin === "number") clauses.push(`目标毛利 ${plain(margin)}%`);
  if (typeof orders === "number") clauses.push(`日单量 ${plain(orders)}`);
  if (typeof cash === "number") clauses.push(`可周转资金 ${plain(cash)} 元`);
  if (typeof ad === "number") clauses.push(`推广预算 ${plain(ad)} 元`);
  return { ok: true, text: `评估这个商品是否值得上架。${clauses.join("，")}。` };
}

/** One clause to append to the existing task text when the merchant answers a follow-up question. */
export type AnswerKind = "name" | "competitor" | "buy" | "shipping" | "orders";

export function clauseForAnswer(kind: AnswerKind, raw: string): { readonly ok: true; readonly clause: string } | { readonly ok: false; readonly error: string } {
  if (kind === "name") {
    const name = cleanProductName(raw);
    return [...name].length >= 2 ? { ok: true, clause: `商品名：${name}` } : { ok: false, error: "写个能认出来的商品名，至少 2 个字" };
  }
  if (kind === "orders") {
    const value = amount(raw, 1_000_000, 0);
    return typeof value === "number" ? { ok: true, clause: `日单量 ${plain(value)}` } : { ok: false, error: "单量要是正整数" };
  }
  const max = kind === "shipping" ? 10_000 : 100_000;
  const value = amount(raw, max, 2);
  if (typeof value !== "number") return { ok: false, error: "金额要是大于 0 的数字" };
  if (kind === "competitor") return { ok: true, clause: `竞品价 ¥${plain(value)}` };
  if (kind === "buy") return { ok: true, clause: `采购价 ${plain(value)} 元` };
  return { ok: true, clause: `快递 ${plain(value)} 元` };
}

export function appendClause(task: string, clause: string): string {
  const trimmed = task.trim().replace(/[。；;，,\s]+$/, "");
  return `${trimmed}，${clause}。`;
}
