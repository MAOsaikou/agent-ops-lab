import {
  breakEvenCents,
  dailyCapacity,
  evaluate,
  nicePrice,
  priceForMargin,
} from "./economics.js";
import type {
  Bullet,
  Candidate,
  CandidateId,
  CheckRow,
  PriceEvaluation,
  ProductInput,
  SimResult,
} from "./model.js";
import type { PlatformPreset, ServiceTag } from "./platform.js";
import { simulate } from "./simulate.js";

export type Draft = {
  readonly id: CandidateId;
  readonly label: string;
  readonly tagline: string;
  readonly priceCents: number;
};

function money(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export function draftCandidates(input: ProductInput): readonly Draft[] {
  const breakEven = breakEvenCents(input);
  const floor = Number.isFinite(breakEven) ? Math.max(99, breakEven + 10) : 99;
  const rate = 1 - input.commissionRate - input.payFeeRate;
  let marginPrice = priceForMargin(input, input.targetMargin);
  if (Number.isFinite(marginPrice)) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const probe = evaluate(input, nicePrice(marginPrice));
      if (probe.daily.margin >= input.targetMargin || rate <= 0) {
        break;
      }
      marginPrice += Math.max(1, Math.round(probe.daily.adPerOrderCents / rate));
    }
  }
  const raw: Draft[] = [
    {
      id: "profit",
      label: "稳价 · 保目标毛利",
      tagline: "毛利优先",
      priceCents: Number.isFinite(marginPrice) ? nicePrice(marginPrice) : nicePrice(floor),
    },
    {
      id: "match",
      label: "跟价 · 对齐竞品",
      tagline: "不冒头",
      priceCents: nicePrice(Math.max(input.competitorCents, floor)),
    },
    {
      id: "volume",
      label: "冲量 · 压价抢单",
      tagline: "单量优先",
      priceCents: nicePrice(Math.max(Math.round(input.competitorCents * 0.88), floor)),
    },
  ];
  const seen = new Set<number>();
  const out: Draft[] = [];
  for (const draft of raw) {
    let price = Math.max(draft.priceCents, floor);
    while (seen.has(price)) {
      price += 100;
    }
    seen.add(price);
    out.push({ ...draft, priceCents: price });
  }
  return out;
}

function check(
  id: string,
  label: string,
  status: CheckRow["status"],
  detail: string,
): CheckRow {
  return { id, label, status, detail };
}

export function checksFor(
  input: ProductInput,
  preset: PlatformPreset,
  evaluation: PriceEvaluation,
  sim: SimResult,
  promoPriceCents: number,
): readonly CheckRow[] {
  const rows: CheckRow[] = [];
  const price = evaluation.priceCents;
  const breakEven = evaluation.breakEvenCents;

  if (price > breakEven * 1.05) {
    rows.push(check("break-even", "高于保本价", "pass", `${money(price)} > 保本 ${money(breakEven)}`));
  } else if (price > breakEven) {
    rows.push(check("break-even", "高于保本价", "warn", `${money(price)} 只比保本价高一点`));
  } else {
    rows.push(check("break-even", "高于保本价", "fail", `${money(price)} 低于保本 ${money(breakEven)}，卖一单亏一单`));
  }

  const margin = evaluation.daily.margin;
  if (margin >= input.targetMargin) {
    rows.push(check("margin", "毛利达标", "pass", `毛利率 ${pct(margin)}，达到目标 ${pct(input.targetMargin)}`));
  } else if (margin >= 0.1) {
    rows.push(check("margin", "毛利达标", "warn", `毛利率 ${pct(margin)}，低于目标 ${pct(input.targetMargin)}`));
  } else {
    rows.push(check("margin", "毛利达标", "fail", `毛利率 ${pct(margin)}，撑不住退货和推广`));
  }

  const adShare = price > 0 ? evaluation.daily.adPerOrderCents / price : 0;
  if (input.adDailyBudgetCents <= 0) {
    rows.push(check("ad-share", "推广占比", "pass", "没开付费推广，省下的都是净利"));
  } else if (adShare <= 0.12) {
    rows.push(check("ad-share", "推广占比", "pass", `推广分摊占售价 ${pct(adShare)}`));
  } else if (adShare <= 0.2) {
    rows.push(check("ad-share", "推广占比", "warn", `推广分摊占售价 ${pct(adShare)}，偏高`));
  } else {
    rows.push(check("ad-share", "推广占比", "fail", `推广分摊占售价 ${pct(adShare)}，投得越多亏得越多`));
  }

  const baseline = preset.returnRate;
  if (input.returnRate <= baseline * 1.2) {
    rows.push(check("returns", "退货率合理", "pass", `${pct(input.returnRate)}，在 ${preset.short}常见水平内`));
  } else if (input.returnRate <= baseline * 1.6) {
    rows.push(check("returns", "退货率合理", "warn", `${pct(input.returnRate)} 高于 ${preset.short}常见值 ${pct(baseline)}`));
  } else {
    rows.push(check("returns", "退货率合理", "fail", `${pct(input.returnRate)} 过高，来回运费会吃掉毛利`));
  }

  const gap = input.competitorCents > 0 ? (price - input.competitorCents) / input.competitorCents : 0;
  if (Math.abs(gap) <= 0.25) {
    rows.push(check("competitor", "价格在竞品带内", "pass", `比竞品${gap >= 0 ? "高" : "低"} ${pct(Math.abs(gap))}`));
  } else if (Math.abs(gap) <= 0.4) {
    rows.push(check("competitor", "价格在竞品带内", "warn", `比竞品${gap >= 0 ? "高" : "低"} ${pct(Math.abs(gap))}，转化会受影响`));
  } else {
    rows.push(check("competitor", "价格在竞品带内", "fail", `比竞品${gap >= 0 ? "高" : "低"} ${pct(Math.abs(gap))}，买家大概率直接跳过`));
  }

  if (sim.stockoutDays === 0) {
    rows.push(check("cashflow", "30 天不缺货", "pass", `周转金够用，30 天最低现金 ${money(sim.minCashCents)}`));
  } else if (sim.stockoutDays <= 5) {
    rows.push(check("cashflow", "30 天不缺货", "warn", `有 ${String(sim.stockoutDays)} 天备货资金不够`));
  } else {
    rows.push(check("cashflow", "30 天不缺货", "fail", `有 ${String(sim.stockoutDays)} 天备货资金不够，白白漏单`));
  }

  if (input.promoEnabled) {
    if (promoPriceCents >= breakEven) {
      rows.push(check("promo", "活动价不亏", "pass", `活动价 ${money(promoPriceCents)} 仍高于保本价`));
    } else {
      rows.push(check("promo", "活动价不亏", "fail", `活动价 ${money(promoPriceCents)} 低于保本价 ${money(breakEven)}`));
    }
  }
  return rows;
}

const SERVICE_SENTENCE: Record<ServiceTag, string> = {
  包邮: "全国包邮，页面价就是到手价",
  "48 小时发货": "48 小时内发货，急单也来得及",
  七天无理由: "支持七天无理由退换，不喜欢直接退",
  退货运费险: "送退货运费险，退换不花运费",
  支持开票: "支持开发票，可开专票",
  现货直发: "现货直发，不用等预售",
  一件代发: "支持一件代发，不压库存",
};

export function bulletsFor(
  input: ProductInput,
  evaluation: PriceEvaluation,
): readonly Bullet[] {
  const rows: Bullet[] = [];
  const price = evaluation.priceCents;
  const competitor = input.competitorCents;
  if (competitor > 0 && price <= competitor) {
    rows.push({
      text: `到手价 ${money(price)}，比同类常见价 ${money(competitor)} 低 ${pct((competitor - price) / competitor)}`,
      basis: "按你填的竞品价算出来的真实差价",
      needsReview: false,
    });
  } else {
    rows.push({
      text: `到手价 ${money(price)}，价格实在，钱都花在货上`,
      basis: "没有价格优势时不要硬写「全网最低」，会被平台判违规",
      needsReview: false,
    });
  }
  for (const tag of input.services) {
    rows.push({ text: SERVICE_SENTENCE[tag], basis: `你勾选了「${tag}」，要真能做到`, needsReview: false });
  }
  const capacity = dailyCapacity(input);
  if (input.keywords.trim().length > 0) {
    rows.push({
      text: `适合${input.keywords.split(/[,，、\s]+/).filter((word) => word.length > 0).slice(0, 3).join("、")}`,
      basis: "用你填的关键词拼的，发布前确认场景对不对",
      needsReview: true,
    });
  }
  rows.push({
    text:
      capacity >= 50
        ? "现货充足，下单当天就能出库"
        : capacity >= 1
          ? "小批量现货，下单后 3 天内发出"
          : "支持预售，付款后 7 天内发出",
    basis: `按你的周转金和采购价，每天最多备 ${String(Math.max(0, capacity))} 单`,
    needsReview: capacity < 50,
  });
  if (rows.length < 5) {
    rows.push({
      text: "包装加固，运输破损少",
      basis: "模板句，做得到再发",
      needsReview: true,
    });
  }
  return rows.slice(0, 5);
}

function verdictFor(
  draft: Draft,
  evaluation: PriceEvaluation,
  sim: SimResult,
): string {
  const perOrder = evaluation.daily.netPerOrderCents;
  const month = sim.p50Cents;
  if (draft.id === "profit") {
    return `一单净赚 ${money(perOrder)}，30 天中位利润 ${money(month)}`;
  }
  if (draft.id === "match") {
    return `一单净赚 ${money(perOrder)}，日均 ${String(Math.round(evaluation.daily.orders))} 单`;
  }
  return `一单只赚 ${money(perOrder)}，靠日均 ${String(Math.round(evaluation.daily.orders))} 单摊薄推广费`;
}

export function buildCandidates(
  input: ProductInput,
  preset: PlatformPreset,
): readonly Candidate[] {
  const drafts = draftCandidates(input);
  const out: Candidate[] = [];
  for (const draft of drafts) {
    const evaluation = evaluate(input, draft.priceCents);
    const sim = simulate(input, draft.priceCents);
    const promoPriceCents = input.promoEnabled
      ? nicePrice(Math.round(draft.priceCents * input.promoDiscount))
      : draft.priceCents;
    const checks = checksFor(input, preset, evaluation, sim, promoPriceCents);
    const risks = checks
      .filter((row) => row.status !== "pass")
      .map((row) => `${row.label}：${row.detail}`);
    out.push({
      id: draft.id,
      label: draft.label,
      tagline: draft.tagline,
      priceCents: draft.priceCents,
      promoPriceCents,
      evaluation,
      sim,
      checks,
      bullets: bulletsFor(input, evaluation),
      verdict: verdictFor(draft, evaluation, sim),
      risks,
    });
  }
  return out;
}