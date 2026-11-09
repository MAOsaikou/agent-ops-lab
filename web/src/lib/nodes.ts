export const NODE_LABELS: Record<string, string> = {
  plan: "调度规划",
  proposals: "并行提案",
  buyer: "采购 Agent",
  pricer: "定价 Agent",
  marketer: "营销 Agent",
  "price-war": "价格战判定",
  arbitrate: "预算仲裁",
  "hold-budget": "维持预算",
  supply: "断供判定",
  negotiate: "供应协商",
  "supply-negotiation": "供应协商子流程",
  quotes: "报价循环",
  quote: "供应商报价",
  "skip-supply": "跳过协商",
  revise: "验证与修正",
  reflect: "复盘",
  seal: "提交锁定",
  critic: "Critic 质询",
  revision: "修正迭代",
};

export const NODE_KINDS: Record<string, string> = {
  plan: "工具",
  proposals: "并行",
  buyer: "Agent",
  pricer: "Agent",
  marketer: "Agent",
  "price-war": "条件",
  arbitrate: "工具",
  "hold-budget": "工具",
  supply: "条件",
  negotiate: "子工作流",
  "supply-negotiation": "子工作流",
  quotes: "循环",
  quote: "工具",
  "skip-supply": "工具",
  revise: "工具",
  reflect: "Agent",
  seal: "提交",
  critic: "Agent",
  revision: "工具",
};

export const AGENT_LABELS: Record<string, string> = {
  buyer: "采购",
  pricer: "定价",
  marketer: "营销",
  critic: "Critic",
  reflect: "复盘",
};

export function nodeLabel(nodeId: string): string {
  return NODE_LABELS[nodeId] ?? nodeId;
}

export function nodeKind(nodeId: string): string {
  return NODE_KINDS[nodeId] ?? "节点";
}

export const NODE_EVENT_TEXT: Record<string, string> = {
  scheduled: "排队",
  started: "运行",
  finished: "完成",
  "dead-letter": "死信",
};

export const RULING_TEXT: Record<string, string> = {
  accept: "接受",
  counter: "还价",
  walk: "破裂",
};

export const SUPPLIER_TEXT: Record<string, string> = {
  primary: "主供应商",
  backup: "备选供应商",
};

export const SKU_TEXT: Record<string, string> = {
  tea: "茶饮",
  snack: "零食",
};

export const STOP_TEXT: Record<string, string> = {
  passed: "验证通过",
  maxIterations: "到达迭代上限",
  budget: "调用预算耗尽",
  p50Plateau: "p50 平台期",
  repeatedDecision: "决策重复",
};

export const SCENARIO_TEXT: Record<string, string> = {
  spring: "春季开学季",
  supplycut: "主供应商断供",
  pricewar: "竞品价格战",
};

export const PROFILE_TEXT: Record<string, string> = {
  steady: "稳健策略",
  stressed: "压力策略（会被硬约束打回）",
};
