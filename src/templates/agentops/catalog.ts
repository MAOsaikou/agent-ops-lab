import { sha256Hex } from "../../engine/hash.js";
import { canonicalJson } from "../../engine/json.js";
import { SAMPLES } from "../pricing/sample.js";
import type { AgentSpec, Capability, WorkflowDocument, WorkflowNode } from "./types.js";

export const AGENTS: readonly AgentSpec[] = [
  { id: "planner", name: "任务规划师", role: "将用户意图拆成有依赖关系的工作流；识别缺失字段、约束和验收条件。", version: "1.2.0", capabilities: { planning: 0.98 }, tools: ["workflow.plan"], maxCallsPerRun: 2 },
  { id: "link-researcher", name: "商品研究员", role: "解析商品链接和分享文案，抽取商品名、类目、参考价、销量与服务，并为每个字段给证据。", version: "1.1.0", capabilities: { intake: 0.95, market: 0.62 }, tools: ["product.parse", "knowledge.search"], maxCallsPerRun: 4 },
  { id: "cost-accountant", name: "成本会计", role: "只用用户提供的采购、包材、快递、费率和退货假设计算成本与保本价。", version: "1.3.0", capabilities: { cost: 0.99, risk: 0.55 }, tools: ["pricing.unit-cost", "pricing.break-even", "knowledge.search"], maxCallsPerRun: 3 },
  { id: "market-analyst", name: "市场分析师", role: "基于用户提供的竞品价、价格弹性和单量假设对比价位，不把单品销量误当全市场日单量。", version: "1.0.0", capabilities: { market: 0.92, planning: 0.45 }, tools: ["pricing.candidates", "pricing.simulate", "knowledge.search"], maxCallsPerRun: 3 },
  { id: "risk-auditor", name: "独立风控审计", role: "独立复核保本价、目标毛利、活动价、需求假设与证据边界；失败时给出可执行修正意见。", version: "1.4.0", capabilities: { risk: 0.99, cost: 0.62 }, tools: ["pricing.verify", "pricing.simulate", "knowledge.search"], maxCallsPerRun: 4 },
  { id: "copywriter", name: "上架文案师", role: "根据选定方案生成平台限制内的标题和真实可兑现的卖点，不生成未验证承诺。", version: "1.0.0", capabilities: { copy: 0.96 }, tools: ["copy.generate"], maxCallsPerRun: 2 },
  { id: "reporter", name: "研究报告师", role: "整理多 Agent 结论、验证记录、假设与未解决风险，提供可复现的决策报告。", version: "1.0.0", capabilities: { report: 0.94 }, tools: ["report.compile"], maxCallsPerRun: 2 },
  {
    id: "procurement-lead",
    name: "采购负责人",
    role: "关注进货成本上浮、积压滞销与账期承压，通过悲观情景重估兜底利润。",
    version: "1.0.0",
    capabilities: { procure: 0.98, cost: 0.5, risk: 0.4 },
    tools: ["pricing.simulate", "pricing.unit-cost", "knowledge.search"],
    maxCallsPerRun: 3,
  },
  {
    id: "pricing-lead",
    name: "定价参谋",
    role: "坚守目标毛利率与保本安全垫，防范价格倒挂与佣金侵蚀。",
    version: "1.0.0",
    capabilities: { price: 0.98, market: 0.4, cost: 0.4 },
    tools: ["pricing.candidates", "pricing.verify", "knowledge.search"],
    maxCallsPerRun: 3,
  },
  {
    id: "growth-operator",
    name: "推广运营",
    role: "测算付费投流杠杆与订单规模，防范高客单低转化或获客失血。",
    version: "1.0.0",
    capabilities: { promote: 0.98, market: 0.4, risk: 0.3 },
    tools: ["pricing.simulate", "copy.generate", "knowledge.search"],
    maxCallsPerRun: 3,
  },
];

export const AGENTS_V1: readonly AgentSpec[] = AGENTS.slice(0, 7);

export const TOOL_CATALOG = [
  { name: "product.parse", title: "商品链接与分享文案解析", kind: "parse" },
  { name: "knowledge.search", title: "行业规则知识库检索", kind: "kb" },
  { name: "pricing.unit-cost", title: "单件成本计算", kind: "compute" },
  { name: "pricing.break-even", title: "保本价计算", kind: "compute" },
  { name: "pricing.candidates", title: "三策略报价计算", kind: "compute" },
  { name: "pricing.simulate", title: "30 天现金流模拟", kind: "simulate" },
  { name: "pricing.verify", title: "定价约束验证", kind: "compute" },
  { name: "copy.generate", title: "上架文案生成", kind: "compute" },
  { name: "report.compile", title: "审计报告组装", kind: "compute" },
] as const;

const workflowNodes: readonly WorkflowNode[] = [
  { kind: "agent", id: "plan", capability: "planning", title: "拆任务与验收标准", dependsOn: [] },
  { kind: "agent", id: "research", capability: "intake", title: "商品信息与证据提取", dependsOn: ["plan"] },
  { kind: "parallel", id: "parallel-analysis", branches: ["account", "market"], title: "成本与市场并行分析", dependsOn: ["research"] },
  { kind: "agent", id: "account", capability: "cost", title: "成本会计核算", dependsOn: [] },
  { kind: "agent", id: "market", capability: "market", title: "市场分析与情景模拟", dependsOn: [] },
  { kind: "agent", id: "risk", capability: "risk", title: "独立风控与交叉验证", dependsOn: ["parallel-analysis"] },
  { kind: "condition", id: "risk-gate", predicate: "risk-pass", then: "copy", otherwise: "adjust-loop", title: "验证通过？", dependsOn: ["risk"] },
  { kind: "loop", id: "adjust-loop", body: ["market", "risk"], until: "risk-pass", maxIterations: 3, title: "修正假设并重新验证", dependsOn: [] },
  { kind: "agent", id: "copy", capability: "copy", title: "生成可兑现的上架文案", dependsOn: ["risk-gate"] },
  { kind: "humanGate", id: "approval", title: "掌柜确认风险与方案", dependsOn: ["copy"] },
  { kind: "agent", id: "report", capability: "report", title: "生成可复核决策报告", dependsOn: ["approval"] },
  { kind: "verify", id: "final-check", pipeline: ["evidence", "economics", "constraints", "report"], title: "最终一致性检查", dependsOn: ["report"] },
  { kind: "commit", id: "seal", title: "封存运行事件与结果指纹", dependsOn: ["final-check"] },
];

export const DEFAULT_WORKFLOW: WorkflowDocument = {
  id: "product-launch-review",
  title: "商品上架可行性评审",
  intent: "从商品链接或分享文案，到可审计的定价、风险和上架建议",
  nodes: workflowNodes,
};

const collabWorkflowNodes: readonly WorkflowNode[] = [
  { kind: "agent", id: "plan", capability: "planning", title: "拆任务与验收标准", dependsOn: [] },
  { kind: "agent", id: "research", capability: "intake", title: "商品信息与证据提取", dependsOn: ["plan"] },
  { kind: "parallel", id: "parallel-analysis", branches: ["account", "market"], title: "成本与市场并行分析", dependsOn: ["research"] },
  { kind: "agent", id: "account", capability: "cost", title: "成本会计核算", dependsOn: [] },
  { kind: "agent", id: "market", capability: "market", title: "市场分析与情景模拟", dependsOn: [] },
  { kind: "agent", id: "challenge", capability: "risk", title: "三方质询与会签交叉复核", dependsOn: ["parallel-analysis"] },
  { kind: "agent", id: "risk", capability: "risk", title: "独立风控与交叉验证", dependsOn: ["challenge"] },
  { kind: "condition", id: "risk-gate", predicate: "risk-pass", then: "copy", otherwise: "adjust-loop", title: "验证通过？", dependsOn: ["risk"] },
  { kind: "loop", id: "adjust-loop", body: ["market", "risk"], until: "risk-pass", maxIterations: 3, title: "修正假设并重新验证", dependsOn: [] },
  { kind: "agent", id: "copy", capability: "copy", title: "生成可兑现的上架文案", dependsOn: ["risk-gate"] },
  { kind: "humanGate", id: "approval", title: "掌柜确认风险与方案", dependsOn: ["copy"] },
  { kind: "agent", id: "report", capability: "report", title: "生成可复核决策报告", dependsOn: ["approval"] },
  { kind: "verify", id: "final-check", pipeline: ["evidence", "economics", "constraints", "report"], title: "最终一致性检查", dependsOn: ["report"] },
  { kind: "commit", id: "seal", title: "封存运行事件与结果指纹", dependsOn: ["final-check"] },
];

export const COLLAB_WORKFLOW: WorkflowDocument = {
  id: "product-launch-review.v2",
  title: "商品上架可行性评审（多方会签质询版）",
  intent: "在三套报价后引入采购、定价与增长三方质询复核，裁决最优候选方案并审计残留风险",
  nodes: collabWorkflowNodes,
};

export const WORKFLOW_TEMPLATES = [
  { ...COLLAB_WORKFLOW, featured: true },
  { ...DEFAULT_WORKFLOW, featured: false },
  {
    id: "sample-drape-review",
    title: "纯棉短袖上架审查",
    intent: "评估样例商品的成本空间、活动风险和上架准备度",
    featured: false,
  },
  {
    id: "sample-pillow-review",
    title: "护颈枕价格与现金流评估",
    intent: "比较稳价、跟价、冲量策略并验证账期风险",
    featured: false,
  },
] as const;

export function resolveAgent(
  need: Capability,
  loads: Readonly<Record<string, number>>,
  failures: Readonly<Record<string, number>>,
  calls: Readonly<Record<string, number>>,
  agents: readonly AgentSpec[] = AGENTS,
): { readonly agent: AgentSpec; readonly scores: readonly { readonly agent: AgentSpec; readonly score: number }[] } {
  const eligible = agents.filter((agent) => (agent.capabilities[need] ?? 0) > 0 && (calls[agent.id] ?? 0) < agent.maxCallsPerRun);
  if (eligible.length === 0) {
    throw new Error(`no eligible agent for ${need}`);
  }
  const scores = eligible.map((agent) => {
    const capability = agent.capabilities[need] ?? 0;
    const load = loads[agent.id] ?? 0;
    const failure = failures[agent.id] ?? 0;
    const score = Math.round((capability * 100 - load * 9 - failure * 15) * 100) / 100;
    return { agent, score };
  }).sort((left, right) => right.score - left.score || left.agent.id.localeCompare(right.agent.id));
  const winner = scores[0];
  if (winner === undefined) throw new Error(`no dispatch winner for ${need}`);
  return { agent: winner.agent, scores };
}

export function sampleInput(id: string) {
  const sample = SAMPLES.find((item) => item.id === id);
  return sample?.input ?? SAMPLES[0]?.input;
}

export function workflowFingerprint(workflow: WorkflowDocument): string {
  return sha256Hex(canonicalJson(workflow));
}
