import { checksFor } from "../pricing/candidates.js";
import { evaluate, nicePrice } from "../pricing/economics.js";
import type { Candidate, CandidateId, ProductInput } from "../pricing/model.js";
import { PLATFORM_PRESETS } from "../pricing/platform.js";
import { simulate } from "../pricing/simulate.js";
import type { CollabAnalysis, CollabObjection, CollabRole, CollabResponse, CollaborationArtifact } from "./types.js";

function money(cents: number): string { return `¥${(cents / 100).toFixed(2)}`; }
function pct(ratio: number): string { return `${(ratio * 100).toFixed(1)}%`; }
function strategyLabel(id: CandidateId): string {
  return id === "profit" ? "稳价 · 保目标毛利" : id === "match" ? "跟价 · 对齐竞品" : "冲量 · 压价抢单";
}

const ROLE_NAMES: Record<CollabRole, string> = {
  "procurement-lead": "采购负责人", "pricing-lead": "定价参谋", "growth-operator": "推广运营",
};

/** Each specialist consumes the same immutable market handoff and produces its own report.
 * Stress assumptions are explicit; simulations are reused for evidence and objections. */
export function analyzeCollaborationRole(
  role: CollabRole, product: ProductInput, candidates: readonly Candidate[],
): CollabAnalysis {
  if (candidates.length === 0) throw new Error("collaboration requires candidate evidence");
  const scenarioProduct: ProductInput = role === "procurement-lead"
    ? { ...product, buyCents: Math.round(product.buyCents * 1.1), marketOrders: Math.max(0, Math.round(product.marketOrders * 0.7)) }
    : role === "growth-operator" ? { ...product, adDailyBudgetCents: Math.round(product.adDailyBudgetCents * 1.5) } : product;
  const scenario = role === "procurement-lead" ? "压力假设：采购成本 +10%，需求 -30%"
    : role === "growth-operator" ? "压力假设：日推广预算 ×1.5" : "基准情景：用户输入与已标注假设";
  const rows = candidates.map((cand) => {
    const baseline = role === "pricing-lead";
    const evaluation = baseline ? cand.evaluation : evaluate(scenarioProduct, cand.priceCents);
    const sim = baseline ? cand.sim : simulate(scenarioProduct, cand.priceCents);
    const promo = scenarioProduct.promoEnabled ? nicePrice(Math.round(cand.priceCents * scenarioProduct.promoDiscount)) : cand.priceCents;
    return {
      candidateId: cand.id, priceCents: cand.priceCents, margin: evaluation.daily.margin,
      p10Cents: sim.p10Cents, orders: evaluation.daily.orders, stockoutDays: sim.stockoutDays,
      minCashCents: sim.minCashCents,
      checks: checksFor(scenarioProduct, PLATFORM_PRESETS[product.platform], evaluation, sim, promo),
    };
  });
  const sorted = [...rows].sort((a, b) => {
    const score = role === "procurement-lead" ? b.p10Cents - a.p10Cents
      : role === "pricing-lead" ? b.margin - a.margin : b.orders - a.orders;
    return score || a.priceCents - b.priceCents || a.candidateId.localeCompare(b.candidateId);
  });
  const best = sorted[0]!;
  const metricName = role === "procurement-lead" ? "悲观 p10 利润" : role === "pricing-lead" ? "核算毛利率" : "放量日单量";
  const metricValue = role === "procurement-lead" ? money(best.p10Cents) : role === "pricing-lead" ? pct(best.margin) : `${best.orders.toFixed(0)} 单`;
  const rationale = role === "procurement-lead" ? `${scenario}时，该方案较差情况利润最优（${money(best.p10Cents)}）`
    : role === "pricing-lead" ? `目标毛利 ${pct(product.targetMargin)}，该方案核算毛利 ${pct(best.margin)}，安全垫最足`
      : `${scenario}至 ${money(scenarioProduct.adDailyBudgetCents)}/天，该方案订单规模最大（${best.orders.toFixed(0)} 单/天）；仍需采购复核备货与风控复核现金`;
  const objections: CollabObjection[] = [];
  for (const row of rows) {
    const relevant = role === "procurement-lead" ? ["break-even", "cashflow"] : role === "growth-operator" ? ["ad-share", "cashflow"] : ["margin"];
    for (const check of row.checks) {
      if (!relevant.includes(check.id)) continue;
      const status = role === "pricing-lead" && row.margin < product.targetMargin ? "fail" : check.status;
      if (status === "pass" || (role === "growth-operator" && status !== "fail")) continue;
      objections.push({ challenger: role, challengerName: ROLE_NAMES[role], targetCandidateId: row.candidateId,
        checkId: check.id, title: check.label, status,
        detail: `${scenario}：${check.detail}${role === "pricing-lead" ? `；目标毛利红线 ${pct(product.targetMargin)}` : ""}` });
    }
  }
  return {
    role, roleName: ROLE_NAMES[role], scenario,
    inputSummary: `接收市场三套报价与会计成本；采购 ${money(scenarioProduct.buyCents)}，竞品日单量 ${String(scenarioProduct.marketOrders)}，推广 ${money(scenarioProduct.adDailyBudgetCents)}/天，周转金 ${money(scenarioProduct.cashCents)}`,
    rows,
    proposal: { role, roleName: ROLE_NAMES[role], candidateId: best.candidateId, candidateLabel: strategyLabel(best.candidateId), metricName, metricValue, rationale },
    objections,
  };
}

/** Receiving an objection records work still needed; it never marks the risk resolved. */
export function respondToObjections(candidates: readonly Candidate[], analyses: readonly CollabAnalysis[]): readonly CollabResponse[] {
  return analyses.flatMap((analysis) => analysis.objections.map((objection) => {
    const baseline = candidates.find((c) => c.id === objection.targetCandidateId);
    const stressed = analysis.rows.find((r) => r.candidateId === objection.targetCandidateId);
    if (!baseline || !stressed) throw new Error("objection has no candidate evidence");
    return {
      challenger: objection.challenger, targetCandidateId: objection.targetCandidateId, checkId: objection.checkId,
      owner: "market-analyst", ownerName: "市场分析师",
      disposition: objection.status === "fail" ? "accepted" as const : "retained" as const,
      evidence: `原报价 ${money(baseline.priceCents)}：基准毛利 ${pct(baseline.evaluation.daily.margin)}、p10 ${money(baseline.sim.p10Cents)}；复核情景毛利 ${pct(stressed.margin)}、p10 ${money(stressed.p10Cents)}、缺货 ${String(stressed.stockoutDays)} 天`,
      action: objection.status === "fail"
        ? `接受${objection.challengerName}质询，交风控比较替代策略；若最终仍选此方案，保留失败项并要求修正或掌柜明确承担风险`
        : `保留${objection.challengerName}提醒；维持原报价供风控与其他方案比较，发布前核实对应假设`,
    };
  }));
}

export function adjudicateCollaboration(
  _product: ProductInput, candidates: readonly Candidate[], originalRecommendedId: CandidateId,
  analyses: readonly CollabAnalysis[], responses = respondToObjections(candidates, analyses),
): CollaborationArtifact {
  const roles: readonly CollabRole[] = ["procurement-lead", "pricing-lead", "growth-operator"];
  if (analyses.length !== roles.length || roles.some((role) => analyses.filter((a) => a.role === role).length !== 1)) {
    throw new Error("adjudication requires one independent report from each specialist");
  }
  const proposals = analyses.map((a) => a.proposal);
  const objections = analyses.flatMap((a) => a.objections);
  const procurement = analyses.find((a) => a.role === "procurement-lead")!;
  const scores = candidates.map((cand) => ({
    cand, fails: objections.filter((o) => o.targetCandidateId === cand.id && o.status === "fail").length,
    warns: objections.filter((o) => o.targetCandidateId === cand.id && o.status === "warn").length,
  })).sort((a, b) => a.fails - b.fails || b.cand.sim.p10Cents - a.cand.sim.p10Cents
    || Number(b.cand.id === originalRecommendedId) - Number(a.cand.id === originalRecommendedId) || a.cand.id.localeCompare(b.cand.id));
  const winner = scores[0]?.cand;
  if (!winner) throw new Error("adjudication requires candidates");
  const adjudicatedId = winner.id;
  const changed = adjudicatedId !== originalRecommendedId;
  const consensus = proposals.every((p) => p.candidateId === proposals[0]!.candidateId);
  const comparison = candidates.map((cand) => ({
    candidateId: cand.id, baselineP10Cents: cand.sim.p10Cents,
    stressP10Cents: procurement.rows.find((r) => r.candidateId === cand.id)!.p10Cents,
    margin: cand.evaluation.daily.margin,
    failCount: scores.find((s) => s.cand.id === cand.id)!.fails,
    warnCount: scores.find((s) => s.cand.id === cand.id)!.warns,
    selected: cand.id === adjudicatedId,
  }));
  const before = comparison.find((r) => r.candidateId === originalRecommendedId);
  const after = comparison.find((r) => r.selected)!;
  const decision = `先比较失败质询数，再比较基准 p10；原推荐 ${String(before?.failCount ?? 0)} 项失败 / p10 ${money(before?.baselineP10Cents ?? 0)}，裁决 ${String(after.failCount)} 项失败 / p10 ${money(after.baselineP10Cents)}。`;
  const summary = (changed
    ? `原推荐「${strategyLabel(originalRecommendedId)}」→ 改为「${strategyLabel(adjudicatedId)}」。`
    : consensus ? `三方一致提议「${strategyLabel(proposals[0]!.candidateId)}」，裁决维持「${strategyLabel(adjudicatedId)}」。`
      : `三方存在分歧，经交叉质询后维持推荐「${strategyLabel(adjudicatedId)}」。`) + decision
      + (after.failCount > 0 ? "仍有失败项，不能视为会签通过。" : "");
  return {
    mode: "rule", originalRecommendedId, adjudicatedId, changed, summary, proposals, objections,
    analyses, responses, comparison, consensus,
    leftoverRisks: objections.filter((o) => o.targetCandidateId === adjudicatedId).map((o) => ({
      id: `collab-${o.checkId}-${o.challenger}`, title: `会签质询 · ${o.title}`,
      status: o.status, detail: `${o.challengerName}：${o.detail}；责任人回应仅代表已接收，尚未消除风险。`, owner: "market-analyst",
    })),
  };
}

/** Compatibility entry point for callers outside the orchestrator. */
export function runCollaboration(product: ProductInput, candidates: readonly Candidate[], originalRecommendedId: CandidateId): CollaborationArtifact {
  const analyses = (["procurement-lead", "pricing-lead", "growth-operator"] as const).map((role) => analyzeCollaborationRole(role, product, candidates));
  return adjudicateCollaboration(product, candidates, originalRecommendedId, analyses);
}
