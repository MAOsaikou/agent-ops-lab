import { sha256Hex } from "../../../engine/hash.js";
import { canonicalJson } from "../../../engine/json.js";
import type { BenchmarkCase } from "./types.js";

export { BENCHMARK_ARCHETYPES, type BenchmarkCase } from "./types.js";

/**
 * 冻结 12 案评测基准数据集。
 * 覆盖 6 类核心场景（标准、缺事实、证据冲突、资金约束、故障恢复、应当拒绝），每类 2 案。
 * 注意：所有用例均为离线测试与评测专用的【构造样例】，非真实商户经营数据。
 */
export const BENCHMARK_CASES: readonly BenchmarkCase[] = [
  // 1. 标准正常案例（数据齐备，可正常核算并推荐）
  {
    id: "std-apparel-pdd",
    title: "标准纯棉T恤（拼多多）",
    archetype: "standard",
    taskText: "分析拼多多女装纯棉短袖上架可行性。采购价 16 元，包材 1.5 元，快递 6.5 元，竞品价 39.9 元，日单量 50，目标毛利 25%，预算 30 元，周转金 3000 元。",
    constructed: true,
    note: "构造样例：标准服饰品类，数据完整，各策略均可正常核算。",
    expectations: {
      expectedOutcome: "approve",
      targetCandidateId: "profit",
      knownRiskIds: [],
    },
  },
  {
    id: "std-pillow-jd",
    title: "标准护颈记忆枕（京东）",
    archetype: "standard",
    taskText: "评估护颈枕上架京东。采购 28 元，包材 3 元，快递 8 元，竞品 89 元，日销 40 单，目标毛利 30%，推广预算 60 元，周转金 8000 元。",
    constructed: true,
    note: "构造样例：家居标品，完整经营假设，利润与现金流均充裕。",
    expectations: {
      expectedOutcome: "approve",
      targetCandidateId: "profit",
      knownRiskIds: [],
    },
  },

  // 2. 缺失事实案例（必须触发主动追问，严禁模型凭空编造事实或猜测成本）
  {
    id: "missing-buy-shipping",
    title: "缺失采购价与运费",
    archetype: "missing_facts",
    taskText: "准备上架一款便携保温杯，竞品卖 49 元，日均 30 单，预算 20 元。请做可行性核算。",
    constructed: true,
    note: "构造样例：缺失关键采购进货与运费成本，必须触发主动追问，禁止模型自行猜测金额。",
    expectations: {
      expectedOutcome: "clarify",
      mustClarifyFields: ["buy", "shipping"],
      knownRiskIds: ["missing-cost-facts"],
      forbiddenClaims: ["采购成本估算", "默认运费已计入"],
    },
  },
  {
    id: "missing-competitor-price",
    title: "缺失竞品参考价",
    archetype: "missing_facts",
    taskText: "上架一款手工陶艺茶杯。采购 12 元，包材 2 元，快递 6 元，目标毛利 35%。",
    constructed: true,
    note: "构造样例：缺失市场竞品锚点与单量，必须触发追问，不能凭空生成市场价。",
    expectations: {
      expectedOutcome: "clarify",
      mustClarifyFields: ["competitor"],
      knownRiskIds: ["missing-market-anchor"],
      forbiddenClaims: ["根据同类均价设定"],
    },
  },

  // 3. 证据冲突案例（小众品类谎报单量、竞品价倒挂，需独立质询并暴露风险）
  {
    id: "conflict-demand-cap",
    title: "小众品类宣称超高单量",
    archetype: "conflict_evidence",
    taskText: "上架高端复古墨水瓶，采购 40 元，运费 8 元，竞品 120 元。声称日单量 2000 单，预算 50 元，周转金 2000 元。",
    constructed: true,
    note: "构造样例：小众冷门类目夸大日单量，需独立质询指出单量与周转金严重背离并发出风险提醒。",
    expectations: {
      expectedOutcome: "approve",
      targetCandidateId: "profit",
      knownRiskIds: ["cashflow", "market-demand-doubt"],
      forbiddenClaims: ["可轻松实现2000单"],
    },
  },
  {
    id: "conflict-price-inversion",
    title: "竞品价低于进货裸成本",
    archetype: "conflict_evidence",
    taskText: "智能手环上架。采购成本 85 元，包材 3 元，快递 7 元。竞品售价 49.9 元，日单量 100，预算 50 元。",
    constructed: true,
    note: "构造样例：竞品售价严重低于商品进货与履约裸成本，跟价必倒挂亏损，系统需阻断或驳回。",
    expectations: {
      expectedOutcome: "reject",
      knownRiskIds: ["break-even", "margin"],
      forbiddenClaims: ["跟价可盈利", "保本价39元"],
    },
  },

  // 4. 现金与周转约束案例（周转金短缺、超长账期导致断货或资金穿底）
  {
    id: "cash-tight-volume-stockout",
    title: "周转资金极度匮乏",
    archetype: "cash_constraint",
    taskText: "羽绒马甲上架。采购 65 元，包材 3 元，快递 8 元，竞品 159 元，日单量 60。可周转金仅 400 元，预算 30 元。",
    constructed: true,
    note: "构造样例：周转金严重不足（仅够几件库存），冲量会导致超长缺货天数，应自动收紧推荐或预警。",
    expectations: {
      expectedOutcome: "approve",
      targetCandidateId: "profit",
      knownRiskIds: ["cashflow"],
      forbiddenClaims: ["资金充足适合放量"],
    },
  },
  {
    id: "cash-long-settlement",
    title: "超长账期导致现金断流",
    archetype: "cash_constraint",
    taskText: "商用净水滤芯。采购 50 元，包材 4 元，快递 10 元，竞品 128 元，日单量 30。周转金 1500 元，平台账期 30 天。",
    constructed: true,
    note: "构造样例：超长结算周期导致回款滞后，30天现金流模拟显示最低现金击穿阈值。",
    expectations: {
      expectedOutcome: "approve",
      targetCandidateId: "profit",
      knownRiskIds: ["cashflow"],
    },
  },

  // 5. 故障恢复与模型容错案例（超时降级规则、非JSON格式纠错）
  {
    id: "fail-timeout-recovery",
    title: "模型调用超时降级",
    archetype: "failure_recovery",
    taskText: "评估拼多多帆布袋上架。采购 8 元，包材 1 元，快递 4 元，竞品 25 元，日单量 80，目标毛利 25%，预算 20 元，周转金 2000 元。",
    constructed: true,
    note: "构造样例：用于校验模型网关超时断连时，系统安全降级为规则分析，保留完整事件链且不崩溃。",
    expectations: {
      expectedOutcome: "approve",
      knownRiskIds: [],
    },
  },
  {
    id: "fail-malformed-schema",
    title: "模型非JSON响应纠错",
    archetype: "failure_recovery",
    taskText: "评估车载香薰上架。采购 15 元，包材 2 元，快递 6 元，竞品 45 元，日单量 40，目标毛利 30%，预算 25 元，周转金 3000 元。",
    constructed: true,
    note: "构造样例：用于校验模型返回 Markdown 杂质或格式错乱时触发携带具体错误的一次重试机制。",
    expectations: {
      expectedOutcome: "approve",
      knownRiskIds: [],
    },
  },

  // 6. 应当拒绝/劝退案例（严重倒挂、高退货率侵蚀导致无可行方案）
  {
    id: "reject-negative-margin",
    title: "严重倒挂亏损商品",
    archetype: "should_reject",
    taskText: "分析上架可行性：采购 35 元，包材 2 元，快递 7 元，竞品主流价 29.9 元，日单量 30，目标毛利 30%，周转金 1000 元。",
    constructed: true,
    note: "构造样例：成本44元而竞品不足30元，即使稳价也无法达到正毛利，风控必须阻断并给出拒绝上架建议。",
    expectations: {
      expectedOutcome: "reject",
      knownRiskIds: ["break-even", "margin"],
    },
  },
  {
    id: "reject-extreme-returns",
    title: "极高退货率侵蚀全部利润",
    archetype: "should_reject",
    taskText: "高损耗易碎花瓶上架。采购 25 元，高防震包材 8 元，保价快递 15 元，竞品 59 元，日单量 20。行业退货率 60%，残值仅 20%。",
    constructed: true,
    note: "构造样例：极端退货率与运费折损直接击穿利润安全垫，全套策略均无法盈利，属于必须劝退的商品。",
    expectations: {
      expectedOutcome: "reject",
      knownRiskIds: ["margin", "break-even"],
    },
  },
];

/**
 * 冻结的数据集指纹常量（字面量 64 位十六进制字符串）。
 * 任何用例、字段或字符的改动均会使 validateBenchmarkDataset 校验失败。
 */
export const BENCHMARK_DATASET_HASH =
  "2a2710aadef149fc2fa050c49088a5ec996a28223415b13e64498550d10ab892";

/**
 * 校验传入的用例集合是否与冻结的常量哈希完全一致。
 * 在用例被篡改或删减时返回 valid: false。
 */
export function validateBenchmarkDataset(
  cases: readonly BenchmarkCase[] = BENCHMARK_CASES,
): { valid: boolean; hash: string } {
  const hash = sha256Hex(canonicalJson(cases));
  const valid = hash === BENCHMARK_DATASET_HASH && cases.length === 12;
  return { valid, hash };
}
