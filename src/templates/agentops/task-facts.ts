/**
 * Cost / market facts the merchant typed into the task text (never guessed).
 * Extracted from the runner so the structured-entry composer and the follow-up questions
 * share exactly one reading of the same sentence.
 */

export type TaskFacts = {
  readonly buyCents: number | null;
  readonly packagingCents: number | null;
  readonly shippingCents: number | null;
  readonly adDailyBudgetCents: number | null;
  readonly cashCents: number | null;
  readonly competitorCents: number | null;
  readonly marketOrders: number | null;
  readonly targetMargin: number | null;
  readonly promoDiscount: number | null;
};

function yuanOf(text: string, pattern: RegExp, allowZero = false): number | null {
  const match = pattern.exec(text);
  const raw = match?.[1];
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) return null;
  return Math.round(value * 100);
}

function parsePromoDiscount(text: string): number | null {
  const zhe = /(?:活动|秒杀|促销|大促)\s*折扣?\s*[:：]?\s*(\d(?:\.\d)?)\s*折/.exec(text);
  if (zhe?.[1] !== undefined) {
    const value = Number(zhe[1]) / 10;
    return value >= 0.4 && value <= 0.99 ? Number(value.toFixed(2)) : null;
  }
  const pctMatch = /(?:活动|秒杀|促销|大促)\s*折扣\s*[:：]?\s*(\d{2})\s*%/.exec(text);
  if (pctMatch?.[1] !== undefined) {
    const value = Number(pctMatch[1]) / 100;
    return value >= 0.4 && value <= 0.99 ? Number(value.toFixed(2)) : null;
  }
  return null;
}

export function parseTaskFacts(text: string): TaskFacts {
  const marginMatch = /(?:目标\s*毛利|毛利(?:率)?|利润率)\s*[:：]?\s*(\d{1,2}(?:\.\d)?)\s*%/i.exec(text);
  const orderMatch = /(?:竞品\s*)?(?:日单量|日销|日均|每天)\s*[:：]?\s*约?\s*(\d{1,7})(?![\d.])/.exec(text);
  const marginValue = marginMatch?.[1] === undefined ? null : Number(marginMatch[1]) / 100;
  const orderValue = orderMatch?.[1] === undefined ? null : Number(orderMatch[1]);
  return {
    buyCents: yuanOf(text, /(?:采购价?|进货价?|拿货价?)\s*[:：]?\s*(\d{1,6}(?:\.\d{1,2})?)\s*元/),
    packagingCents: yuanOf(text, /(?:包材|包装)\s*[:：]?\s*(\d{1,6}(?:\.\d{1,2})?)\s*元/, true),
    shippingCents: yuanOf(text, /(?:快递|运费|物流)\s*[:：]?\s*(\d{1,6}(?:\.\d{1,2})?)\s*元/, true),
    adDailyBudgetCents: yuanOf(text, /(?:推广预算|日预算|投放预算|预算)\s*[:：]?\s*(\d{1,7}(?:\.\d{1,2})?)\s*元/, true),
    cashCents: yuanOf(text, /(?:可周转资金|周转金|备货资金)\s*[:：]?\s*(\d{1,8}(?:\.\d{1,2})?)\s*元/, true),
    competitorCents: yuanOf(text, /(?:竞品(?:主流)?价|京东价|售价)\s*[:：]?\s*[¥￥]?\s*(\d{1,6}(?:\.\d{1,2})?)/),
    marketOrders: orderValue !== null && Number.isFinite(orderValue) && orderValue <= 1_000_000 ? orderValue : null,
    targetMargin: marginValue !== null && marginValue >= 0.02 && marginValue <= 0.6 ? marginValue : null,
    promoDiscount: parsePromoDiscount(text),
  };
}
