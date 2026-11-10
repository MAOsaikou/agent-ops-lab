import { sha256Hex } from "../../engine/hash.js";
import { canonicalJson } from "../../engine/json.js";
import { buildCandidates } from "./candidates.js";
import { buildCopy } from "./copy.js";
import { breakEvenCents, nicePrice } from "./economics.js";
import type {
  Candidate,
  CandidateId,
  PlanLock,
  PlanResult,
  ProductInput,
  RevisionRow,
  TraceStep,
} from "./model.js";
import { PLATFORM_PRESETS, RATE_DISCLAIMER, type PlatformPreset } from "./platform.js";

const TRACE_AGENT_LABEL: Record<TraceStep["agent"], string> = {
  accountant: "成本会计",
  pricer: "定价参谋",
  risk: "风控审核",
  copywriter: "文案手",
  owner: "掌柜",
  ledger: "账本",
};

export function agentLabel(agent: TraceStep["agent"]): string {
  return TRACE_AGENT_LABEL[agent];
}

function money(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) {
    return low;
  }
  return Math.min(high, Math.max(low, value));
}

function intAtLeast(value: number, min: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.round(value));
}

export function normalizeInput(raw: ProductInput): ProductInput {
  return {
    platform: raw.platform,
    name: raw.name.trim().slice(0, 40),
    category: raw.category.trim().slice(0, 20),
    keywords: raw.keywords.trim().slice(0, 80),
    buyCents: intAtLeast(raw.buyCents, 1),
    packagingCents: intAtLeast(raw.packagingCents, 0),
    shippingCents: intAtLeast(raw.shippingCents, 0),
    commissionRate: clamp(raw.commissionRate, 0, 0.5),
    payFeeRate: clamp(raw.payFeeRate, 0, 0.05),
    returnRate: clamp(raw.returnRate, 0, 0.9),
    returnSalvage: clamp(raw.returnSalvage, 0, 1),
    adDailyBudgetCents: intAtLeast(raw.adDailyBudgetCents, 0),
    adCpcCents: intAtLeast(raw.adCpcCents, 1),
    adCvr: clamp(raw.adCvr, 0, 0.6),
    competitorCents: intAtLeast(raw.competitorCents, 100),
    marketOrders: intAtLeast(raw.marketOrders, 0),
    elasticity: clamp(raw.elasticity, 1, 4),
    targetMargin: clamp(raw.targetMargin, 0.02, 0.6),
    cashCents: intAtLeast(raw.cashCents, 0),
    settleDays: Math.round(clamp(raw.settleDays, 0, 30)),
    services: raw.services,
    promoEnabled: raw.promoEnabled,
    promoDiscount: clamp(raw.promoDiscount, 0.4, 1),
    seed: intAtLeast(raw.seed, 0),
  };
}

export function recommendId(candidates: readonly Candidate[]): CandidateId {
  const first = candidates[0];
  if (first === undefined) {
    throw new Error("no candidate to recommend");
  }
  const viable = candidates.filter(
    (candidate) => candidate.evaluation.daily.margin >= 0.05 && candidate.sim.p10Cents > 0,
  );
  const pool = viable.length > 0 ? viable : candidates;
  let best = pool[0] ?? first;
  for (const candidate of pool) {
    if (candidate.sim.p10Cents > best.sim.p10Cents) {
      best = candidate;
    }
  }
  return best.id;
}

type Attempt = {
  readonly input: ProductInput;
  readonly candidates: readonly Candidate[];
  readonly revisions: readonly RevisionRow[];
};

function attemptPlan(start: ProductInput): Attempt {
  let input = start;
  const revisions: RevisionRow[] = [];
  let candidates = buildCandidates(input, PLATFORM_PRESETS[input.platform]);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const recommended = candidates.find((candidate) => candidate.id === recommendId(candidates));
    if (recommended === undefined) {
      break;
    }
    const price = recommended.priceCents;
    const adShare = price > 0 ? recommended.evaluation.daily.adPerOrderCents / price : 0;
    if (input.adDailyBudgetCents > 0 && adShare > 0.2) {
      const next = Math.max(100, Math.round(input.adDailyBudgetCents * 0.6));
      revisions.push({
        attempt,
        reason: `推广分摊吃掉售价 ${pct(adShare)}，再投就是给平台打工`,
        change: `日推广预算 ${money(input.adDailyBudgetCents)} → ${money(next)}`,
        beforeCents: input.adDailyBudgetCents,
        afterCents: next,
        profitDeltaCents: 0,
      });
      input = { ...input, adDailyBudgetCents: next };
      candidates = buildCandidates(input, PLATFORM_PRESETS[input.platform]);
      continue;
    }
    const breakEven = breakEvenCents(input);
    if (input.promoEnabled && recommended.promoPriceCents < breakEven) {
      const discount = clamp(Math.ceil((breakEven / price) * 100) / 100 + 0.01, 0.4, 0.99);
      const nextPromo = nicePrice(Math.round(price * discount));
      revisions.push({
        attempt,
        reason: "活动价低于保本价，报上去等于赔本冲量",
        change: `活动折扣 ${pct(input.promoDiscount)} → ${pct(discount)}（活动价 ${money(nextPromo)}）`,
        beforeCents: recommended.promoPriceCents,
        afterCents: nextPromo,
        profitDeltaCents: 0,
      });
      input = { ...input, promoDiscount: discount };
      candidates = buildCandidates(input, PLATFORM_PRESETS[input.platform]);
      continue;
    }
    break;
  }
  return { input, candidates, revisions };
}

function traceHash(previous: string, step: { agent: string; title: string; detail: string }): string {
  return sha256Hex(`${previous}|${canonicalJson(step)}`);
}

function buildTrace(
  input: ProductInput,
  preset: PlatformPreset,
  candidates: readonly Candidate[],
  recommended: Candidate,
  revisions: readonly RevisionRow[],
  copy: ReturnType<typeof buildCopy>,
): readonly TraceStep[] {
  const match = candidates.find((candidate) => candidate.id === "match") ?? recommended;
  const volume = candidates.find((candidate) => candidate.id === "volume") ?? recommended;
  const unit = recommended.evaluation.unit;
  const breakEven = breakEvenCents(input);
  const passed = recommended.checks.filter((row) => row.status === "pass").length;
  const warned = recommended.checks.filter((row) => row.status === "warn").length;
  const failed = recommended.checks.filter((row) => row.status === "fail").length;

  const steps: { agent: TraceStep["agent"]; title: string; detail: string }[] = [
    {
      agent: "accountant",
      title: "拆解一件的真实成本",
      detail: `采购 ${money(unit.buyCents)} + 包材 ${money(unit.packagingCents)} + 快递 ${money(
        unit.shippingCents,
      )} + 平台佣金 ${money(unit.commissionCents)} + 支付费 ${money(unit.payFeeCents)} + 退货摊销 ${money(
        unit.returnLossCents,
      )} = ${money(unit.totalCents)}`,
    },
    {
      agent: "accountant",
      title: "算出保本价",
      detail: `低于 ${money(breakEven)} 就是卖一单亏一单，这个价先记死`,
    },
    {
      agent: "pricer",
      title: "按目标毛利倒推价格",
      detail: `目标毛利 ${pct(input.targetMargin)} → ${money(
        candidates.find((candidate) => candidate.id === "profit")?.priceCents ?? recommended.priceCents,
      )}`,
    },
    {
      agent: "pricer",
      title: "对齐竞品价格带",
      detail: `竞品主流价 ${money(input.competitorCents)} → ${money(match.priceCents)}`,
    },
    {
      agent: "pricer",
      title: "试一套压价冲量的价",
      detail: `竞品价 88 折 → ${money(volume.priceCents)}，已卡在保本线之上`,
    },
    {
      agent: "risk",
      title: "跑 30 天现金流推演",
      detail: `每套价跑 200 次：中位利润 ${money(recommended.sim.p50Cents)}，最差 10% 是 ${money(
        recommended.sim.p10Cents,
      )}，账期 ${String(input.settleDays)} 天`,
    },
  ];

  for (const revision of revisions) {
    steps.push({
      agent: "risk",
      title: "退回修正一次",
      detail: `${revision.reason}，${revision.change}`,
    });
  }

  steps.push(
    {
      agent: "risk",
      title: "逐项过风控检查",
      detail: `推荐价 ${money(recommended.priceCents)}：${String(passed)} 项通过、${String(
        warned,
      )} 项提醒、${String(failed)} 项不通过`,
    },
    {
      agent: "copywriter",
      title: "写上架文案",
      detail: `${String(copy.titles.length)} 个标题 + 5 条卖点，最长 ${String(
        copy.titles[0]?.length ?? 0,
      )} 字（${preset.short}上限 ${String(preset.titleMax)} 字）`,
    },
    {
      agent: "owner",
      title: "拍板推荐方案",
      detail: `不赌最好的那天：推荐「${recommended.label}」${money(
        recommended.priceCents,
      )}，30 天最差 10% 也有 ${money(recommended.sim.p10Cents)}，日均 ${String(
        Math.round(recommended.evaluation.daily.orders),
      )} 单`,
    },
  );

  let previous = "plan";
  const out: TraceStep[] = [];
  steps.forEach((step, index) => {
    const hash = traceHash(previous, step);
    previous = hash;
    out.push({ index: index + 1, agent: step.agent, title: step.title, detail: step.detail, hash });
  });
  return out;
}

export function buildPlan(input: ProductInput, meta: { id: string; createdAt: string }): PlanResult {
  const normalized = normalizeInput(input);
  const preset = PLATFORM_PRESETS[normalized.platform];
  const attempt = attemptPlan(normalized);
  const candidates = attempt.candidates;
  const recommendedId = recommendId(candidates);
  const recommended = candidates.find((candidate) => candidate.id === recommendedId);
  if (recommended === undefined) {
    throw new Error("recommended candidate is missing");
  }
  const copy = buildCopy(normalized, preset, recommended.priceCents, breakEvenCents(normalized));
  const trace = buildTrace(attempt.input, preset, candidates, recommended, attempt.revisions, copy);
  const hash = sha256Hex(
    canonicalJson({
      version: 1,
      input: attempt.input,
      recommendedId,
      prices: candidates.map((candidate) => candidate.priceCents),
      median: candidates.map((candidate) => candidate.sim.p50Cents),
    }),
  );
  const notes = [
    RATE_DISCLAIMER,
    `所有数字来自你填的采购价、费率、竞品价，不联网抓平台数据，也不上传你的成本。`,
    `30 天推演假设：需求按价格弹性 ${attempt.input.elasticity.toFixed(1)} 随价格变化，日波动 ±28%，平台账期 ${String(
      attempt.input.settleDays,
    )} 天回款。`,
    `保本价 ${money(breakEvenCents(attempt.input))}：任何低于它的价格都在这套成本下亏钱。`,
  ];
  return {
    id: meta.id,
    createdAt: meta.createdAt,
    input: attempt.input,
    candidates,
    recommendedId,
    copy,
    checks: recommended.checks,
    trace,
    revisions: attempt.revisions,
    notes,
    hash,
    locked: null,
  };
}

export function lockPlan(plan: PlanResult, candidateId: CandidateId, at: string): PlanResult {
  if (plan.locked !== null) {
    return plan;
  }
  const chosen = plan.candidates.find((candidate) => candidate.id === candidateId);
  if (chosen === undefined) {
    throw new Error(`candidate not found: ${candidateId}`);
  }
  const hash = sha256Hex(`${plan.hash}|${candidateId}|${at}`);
  const lock: PlanLock = { candidateId, at, hash };
  return { ...plan, locked: lock };
}

export function summarize(plan: PlanResult): {
  priceCents: number;
  monthProfitCents: number;
  margin: number;
} {
  const chosen =
    plan.candidates.find((candidate) => candidate.id === plan.locked?.candidateId) ??
    plan.candidates.find((candidate) => candidate.id === plan.recommendedId);
  const fallback = plan.candidates[0];
  const candidate = chosen ?? fallback;
  if (candidate === undefined) {
    return { priceCents: 0, monthProfitCents: 0, margin: 0 };
  }
  return {
    priceCents: candidate.priceCents,
    monthProfitCents: candidate.sim.p50Cents,
    margin: candidate.evaluation.daily.margin,
  };
}