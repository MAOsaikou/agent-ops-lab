export const NODE_LABELS: Record<string, string> = {
  plan: "排今天的活",
  proposals: "三个人出主意",
  buyer: "采购进货",
  pricer: "定价",
  marketer: "营销",
  "price-war": "跟不跟降价",
  arbitrate: "钱怎么分",
  "hold-budget": "保持原样",
  supply: "查断供",
  negotiate: "谈进货价",
  "supply-negotiation": "谈进货价",
  quotes: "谈价循环",
  quote: "供应商还价",
  "skip-supply": "不用谈",
  revise: "拍板前复核",
  reflect: "复盘",
  seal: "记账上锁",
  critic: "复核员挑刺",
  revision: "改一版再算",
};

export const NODE_KINDS: Record<string, string> = {
  plan: "步骤",
  proposals: "并行",
  buyer: "角色",
  pricer: "角色",
  marketer: "角色",
  "price-war": "岔路",
  arbitrate: "步骤",
  "hold-budget": "步骤",
  supply: "岔路",
  negotiate: "小组",
  "supply-negotiation": "小组",
  quotes: "来回",
  quote: "步骤",
  "skip-supply": "步骤",
  revise: "步骤",
  reflect: "角色",
  seal: "收尾",
  critic: "角色",
  revision: "步骤",
};

export const AGENT_LABELS: Record<string, string> = {
  buyer: "采购",
  pricer: "定价",
  marketer: "营销",
  critic: "复核员",
  reflect: "复盘",
};

export function nodeLabel(nodeId: string): string {
  return NODE_LABELS[nodeId] ?? nodeId;
}

export function nodeKind(nodeId: string): string {
  return NODE_KINDS[nodeId] ?? "步骤";
}

export const NODE_EVENT_TEXT: Record<string, string> = {
  scheduled: "排上队",
  started: "开始干活",
  finished: "做完了",
  "dead-letter": "卡住了",
};

export const RULING_TEXT: Record<string, string> = {
  accept: "成交",
  counter: "再讲讲价",
  walk: "谈崩了",
};

export const SUPPLIER_TEXT: Record<string, string> = {
  primary: "老供应商",
  backup: "备选供应商",
};

export const SKU_TEXT: Record<string, string> = {
  tea: "茶饮",
  snack: "零食",
};

export const STOP_TEXT: Record<string, string> = {
  passed: "检查全过",
  maxIterations: "改到次数上限",
  budget: "预算用完",
  p50Plateau: "再改也不涨",
  repeatedDecision: "主意没变",
};

export const SCENARIO_TEXT: Record<string, string> = {
  spring: "开学季",
  supplycut: "老供应商断供",
  pricewar: "隔壁打价格战",
};

export const PROFILE_TEXT: Record<string, string> = {
  steady: "稳妥经营",
  stressed: "激进经营（会被规则打回）",
};
