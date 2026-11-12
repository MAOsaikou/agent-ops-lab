import { analyzeCollaborationRole } from "./collaboration.js";
import type { Candidate, CandidateId, ProductInput } from "../pricing/model.js";

export type ProvenanceTag = "merchant_explicit" | "link_extracted" | "rule_assumption";

export type EvidenceEntry = {
  readonly id: string;
  readonly role: string;
  readonly candidateId?: CandidateId | undefined;
  readonly scenario: string;
  readonly priceCents?: number | undefined;
  readonly margin?: number | undefined;
  readonly p10Cents?: number | undefined;
  readonly orders?: number | undefined;
  readonly stockoutDays?: number | undefined;
  readonly minCashCents?: number | undefined;
  readonly failCount?: number | undefined;
  readonly provenance: ProvenanceTag;
  readonly rawValue?: unknown;
};

export type EvidenceLedger = {
  readonly entries: readonly EvidenceEntry[];
  getEntry(id: string): EvidenceEntry | undefined;
  getByRole(role: string): readonly EvidenceEntry[];
  getByProvenance(provenance: ProvenanceTag): readonly EvidenceEntry[];
};

export type CreateEvidenceLedgerInput = {
  readonly product: ProductInput;
  readonly candidates: readonly Candidate[];
  readonly explicitFields?: readonly string[] | undefined;
};

const FACT_KEYS: readonly (keyof ProductInput)[] = [
  "name",
  "category",
  "buyCents",
  "packagingCents",
  "shippingCents",
  "competitorCents",
  "adDailyBudgetCents",
  "cashCents",
  "targetMargin",
  "marketOrders",
];

/**
 * 创建事实溯源账本。
 * 所有数字均直接抽取自已有的候选集与情景分析对象，不重新编写任何定价计算公式。
 */
export function createEvidenceLedger(input: CreateEvidenceLedgerInput): EvidenceLedger {
  const entries: EvidenceEntry[] = [];
  const explicitSet = new Set(input.explicitFields ?? []);

  // 1. 录入输入事实条目
  for (const key of FACT_KEYS) {
    const rawValue = input.product[key];
    const isExplicit = explicitSet.has(key);
    entries.push({
      id: `fact/${key}`,
      role: "merchant",
      scenario: "商户事实输入",
      rawValue,
      provenance: isExplicit ? "merchant_explicit" : "rule_assumption",
    });
  }

  // 2. 定价参谋基准核算条目
  for (const cand of input.candidates) {
    const failCount = cand.checks.filter((c) => c.status === "fail").length;
    entries.push({
      id: `pricing-lead/${cand.id}`,
      role: "pricing-lead",
      candidateId: cand.id,
      scenario: "基准情景：用户输入与已标注假设",
      priceCents: cand.priceCents,
      margin: cand.evaluation.daily.margin,
      p10Cents: cand.sim.p10Cents,
      orders: cand.evaluation.daily.orders,
      stockoutDays: cand.sim.stockoutDays,
      minCashCents: cand.sim.minCashCents,
      failCount,
      provenance: "rule_assumption",
    });
  }

  // 3. 采购负责人与推广运营情景分析条目（直接复用 analyzeCollaborationRole 结果）
  const roles = ["procurement-lead", "growth-operator"] as const;
  for (const role of roles) {
    const analysis = analyzeCollaborationRole(role, input.product, input.candidates);
    for (const row of analysis.rows) {
      const failCount = row.checks.filter((c) => c.status === "fail").length;
      entries.push({
        id: `${role}/${row.candidateId}`,
        role,
        candidateId: row.candidateId,
        scenario: analysis.scenario,
        priceCents: row.priceCents,
        margin: row.margin,
        p10Cents: row.p10Cents,
        orders: row.orders,
        stockoutDays: row.stockoutDays,
        minCashCents: row.minCashCents,
        failCount,
        provenance: "rule_assumption",
      });
    }
  }

  return {
    entries,
    getEntry(id: string) {
      return entries.find((e) => e.id === id);
    },
    getByRole(role: string) {
      return entries.filter((e) => e.role === role);
    },
    getByProvenance(provenance: ProvenanceTag) {
      return entries.filter((e) => e.provenance === provenance);
    },
  };
}

/**
 * 校验文本中不得包含大模型自行臆造的数值、金额或百分比。
 * 允许定性表述，以及 p10/p50/p90 这一类指标代号。
 */
export function assertNoInventedNumbers(text: string): void {
  // 先剥离 p10 / p50 / p90 等合法统计分位数指标名称
  const sanitized = text.replace(/\bp(?:10|50|90)\b/gi, "");

  // 检查是否残留阿拉伯数字、全角数字、货币符号或百分号
  if (/[\d０-９%％¥￥$€]/u.test(sanitized)) {
    throw new Error("文字不得包含数值、金额或百分比；请通过 evidenceRefs 引用真实计算结果。");
  }
}

/**
 * 校验传入的证据引用必须存在于给定的溯源账本中。
 * 若引用了未知 ID 或引用为空，则抛出错误。
 */
export function verifyEvidenceReferences(
  refs: readonly string[],
  ledger: EvidenceLedger,
): void {
  if (refs.length === 0) {
    throw new Error("至少需要引用 1 项有效数值证据。");
  }

  for (const ref of refs) {
    const entry = ledger.getEntry(ref);
    if (!entry) {
      throw new Error(`未知 evidenceRef: ${ref}；只能引用已验证的账本条目。`);
    }
  }
}
