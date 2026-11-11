import { checksFor } from "../pricing/candidates.js";
import { evaluate, nicePrice } from "../pricing/economics.js";
import type { Candidate, CandidateId, ProductInput } from "../pricing/model.js";
import { PLATFORM_PRESETS } from "../pricing/platform.js";
import { simulate } from "../pricing/simulate.js";
import type {
  CollabObjection,
  CollabProposal,
  CollaborationArtifact,
  RiskRow,
} from "./types.js";

function money(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function num(val: number, decimals: number = 0): string {
  return val.toFixed(decimals);
}

function strategyLabel(id: CandidateId): string {
  if (id === "profit") return "稳价 · 保目标毛利";
  if (id === "match") return "跟价 · 对齐竞品";
  return "冲量 · 压价抢单";
}

export function runCollaboration(
  product: ProductInput,
  candidates: readonly Candidate[],
  originalRecommendedId: CandidateId,
): CollaborationArtifact {
  const preset = PLATFORM_PRESETS[product.platform];

  // 1. Procurement lead lens: buy +10%, demand -30%
  const procProduct: ProductInput = {
    ...product,
    buyCents: Math.round(product.buyCents * 1.1),
    marketOrders: Math.max(1, Math.round(product.marketOrders * 0.7)),
  };
  const procSims = candidates.map((cand) => {
    const sim = simulate(procProduct, cand.priceCents);
    return { cand, sim };
  });
  // Maximize pessimistic p10
  const bestProc = [...procSims].sort(
    (a, b) => b.sim.p10Cents - a.sim.p10Cents || a.cand.priceCents - b.cand.priceCents,
  )[0]?.cand ?? candidates[0]!;
  const bestProcSim = procSims.find((s) => s.cand.id === bestProc.id)?.sim;

  // 2. Pricing lead lens: baseline numbers, margin hard bar >= targetMargin
  const meetingTarget = candidates.filter((c) => c.evaluation.daily.margin >= product.targetMargin);
  const bestPrice =
    meetingTarget.length > 0
      ? [...meetingTarget].sort((a, b) => b.evaluation.daily.margin - a.evaluation.daily.margin)[0]!
      : [...candidates].sort((a, b) => b.evaluation.daily.margin - a.evaluation.daily.margin)[0]!;

  // 3. Growth operator lens: ad budget * 1.5
  const growthProduct: ProductInput = {
    ...product,
    adDailyBudgetCents: Math.round(product.adDailyBudgetCents * 1.5),
  };
  const growthEvals = candidates.map((cand) => {
    const evalResult = evaluate(growthProduct, cand.priceCents);
    return { cand, eval: evalResult };
  });
  // Maximize orders
  const bestGrowth = [...growthEvals].sort(
    (a, b) => b.eval.daily.orders - a.eval.daily.orders || a.cand.priceCents - b.cand.priceCents,
  )[0]?.cand ?? candidates[0]!;
  const bestGrowthEval = growthEvals.find((g) => g.cand.id === bestGrowth.id)?.eval;

  const proposals: CollabProposal[] = [
    {
      role: "procurement-lead",
      roleName: "采购负责人",
      candidateId: bestProc.id,
      candidateLabel: strategyLabel(bestProc.id),
      metricName: "悲观 p10 利润",
      metricValue: money(bestProcSim?.p10Cents ?? 0),
      rationale: `进货成本上浮 10% 且需求下滑 30% 时，该方案较差情况利润最优（${money(bestProcSim?.p10Cents ?? 0)}）`,
    },
    {
      role: "pricing-lead",
      roleName: "定价参谋",
      candidateId: bestPrice.id,
      candidateLabel: strategyLabel(bestPrice.id),
      metricName: "核算毛利率",
      metricValue: pct(bestPrice.evaluation.daily.margin),
      rationale: `坚守目标毛利 ${pct(product.targetMargin)}，该方案实现毛利 ${pct(bestPrice.evaluation.daily.margin)}，安全垫最足`,
    },
    {
      role: "growth-operator",
      roleName: "推广运营",
      candidateId: bestGrowth.id,
      candidateLabel: strategyLabel(bestGrowth.id),
      metricName: "放量日单量",
      metricValue: `${num(bestGrowthEval?.daily.orders ?? 0, 0)} 单`,
      rationale: `投流预算提升 1.5 倍至 ${money(growthProduct.adDailyBudgetCents)}/天时，该方案规模最大（${num(bestGrowthEval?.daily.orders ?? 0, 0)} 单/天）`,
    },
  ];

  // Cross-examination objections across all candidates
  const objections: CollabObjection[] = [];

  for (const cand of candidates) {
    // 1. Procurement objection: cares about cost overrun and unsold stock/cashflow under pessimistic lens
    const procEval = evaluate(procProduct, cand.priceCents);
    const procSim = simulate(procProduct, cand.priceCents);
    const procPromoPrice = nicePrice(Math.round(cand.priceCents * procProduct.promoDiscount));
    const procChecks = checksFor(procProduct, preset, procEval, procSim, procPromoPrice);
    for (const chk of procChecks) {
      if (chk.id === "break-even" || chk.id === "cashflow") {
        if (chk.status === "fail" || chk.status === "warn") {
          objections.push({
            challenger: "procurement-lead",
            challengerName: "采购负责人",
            targetCandidateId: cand.id,
            checkId: chk.id,
            title: chk.label,
            status: chk.status,
            detail: `悲观重算（进货成本+10%、单量-30%）：${chk.detail}`,
          });
        }
      }
    }

    // 2. Pricing objection: hard bar = 目标毛利
    if (cand.evaluation.daily.margin < product.targetMargin) {
      objections.push({
        challenger: "pricing-lead",
        challengerName: "定价参谋",
        targetCandidateId: cand.id,
        checkId: "margin",
        title: "毛利达标",
        status: "fail",
        detail: `毛利未达硬红线：当前毛利率 ${pct(cand.evaluation.daily.margin)} 低于目标毛利 ${pct(product.targetMargin)}`,
      });
    }

    // 3. Growth objection: cares about ad-share and cashflow under 1.5x ad budget
    const growthEval = evaluate(growthProduct, cand.priceCents);
    const growthSim = simulate(growthProduct, cand.priceCents);
    const growthPromoPrice = nicePrice(Math.round(cand.priceCents * growthProduct.promoDiscount));
    const growthChecks = checksFor(growthProduct, preset, growthEval, growthSim, growthPromoPrice);
    for (const chk of growthChecks) {
      if (chk.id === "ad-share" || chk.id === "cashflow") {
        if (chk.status === "fail") {
          objections.push({
            challenger: "growth-operator",
            challengerName: "推广运营",
            targetCandidateId: cand.id,
            checkId: chk.id,
            title: chk.label,
            status: "fail",
            detail: `投流 1.5 倍模拟：${chk.detail}`,
          });
        }
      }
    }
  }

  // Adjudication by risk auditor:
  // 1. Fewest upheld fail objections
  // 2. Tie -> higher baseline p10
  // 3. Tie -> keep incumbent (originalRecommendedId)
  const candidateScores = candidates.map((cand) => {
    const fails = objections.filter(
      (o) => o.targetCandidateId === cand.id && o.status === "fail",
    ).length;
    const warns = objections.filter(
      (o) => o.targetCandidateId === cand.id && o.status === "warn",
    ).length;
    const baselineP10 = cand.sim.p10Cents;
    const isIncumbent = cand.id === originalRecommendedId;
    return { cand, fails, warns, baselineP10, isIncumbent };
  });

  candidateScores.sort((a, b) => {
    if (a.fails !== b.fails) return a.fails - b.fails;
    if (a.baselineP10 !== b.baselineP10) return b.baselineP10 - a.baselineP10;
    if (a.isIncumbent !== b.isIncumbent) return a.isIncumbent ? -1 : 1;
    return a.cand.id.localeCompare(b.cand.id);
  });

  const winner = candidateScores[0]!.cand;
  const adjudicatedId = winner.id;
  const changed = adjudicatedId !== originalRecommendedId;

  const unanimous = proposals.every((p) => p.candidateId === proposals[0]!.candidateId);

  let summary: string;
  if (changed) {
    summary = `原推荐「${strategyLabel(originalRecommendedId)}」→ 改为「${strategyLabel(adjudicatedId)}」，因为在悲观情景与投流质询下「${strategyLabel(adjudicatedId)}」具有更好的抗风险能力（未通过质询项更少且利润更稳）`;
  } else if (unanimous) {
    summary = `三方一致推荐「${strategyLabel(adjudicatedId)}」，无分歧改动`;
  } else {
    summary = `三方虽有不同侧重，经交叉质询辩论后维持推荐「${strategyLabel(adjudicatedId)}」，综合抗风险与收益最佳`;
  }

  // Leftover risks: any upheld objection on the winning candidate (presented as warnings)
  const winnerObjections = objections.filter((o) => o.targetCandidateId === adjudicatedId);
  const leftoverRisks: RiskRow[] = winnerObjections.map((o) => ({
    id: `collab-${o.checkId}-${o.challenger}`,
    title: `会签质询 · ${o.title}`,
    status: "warn",
    detail: `${o.challengerName}：${o.detail}`,
    owner: o.challenger,
  }));

  return {
    mode: "rule",
    originalRecommendedId,
    adjudicatedId,
    changed,
    summary,
    proposals,
    objections,
    leftoverRisks,
  };
}
