import type { Edge, Node } from "@xyflow/react";

export type GraphNodeSpec = {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly x: number;
  readonly y: number;
};

export const GRAPH_NODES: readonly GraphNodeSpec[] = [
  { id: "plan", label: "排今天的活", kind: "步骤", x: 0, y: 150 },
  { id: "proposals", label: "三个人出主意", kind: "并行", x: 210, y: 150 },
  { id: "buyer", label: "采购进货", kind: "角色", x: 420, y: 40 },
  { id: "pricer", label: "定价", kind: "角色", x: 420, y: 150 },
  { id: "marketer", label: "营销", kind: "角色", x: 420, y: 260 },
  { id: "price-war", label: "跟不跟降价", kind: "岔路", x: 630, y: 150 },
  { id: "arbitrate", label: "钱怎么分", kind: "步骤", x: 840, y: 40 },
  { id: "hold-budget", label: "保持原样", kind: "步骤", x: 840, y: 260 },
  { id: "supply", label: "查断供", kind: "岔路", x: 1050, y: 150 },
  { id: "negotiate", label: "谈进货价", kind: "小组", x: 1260, y: 40 },
  { id: "skip-supply", label: "不用谈", kind: "步骤", x: 1260, y: 260 },
  { id: "quotes", label: "谈价循环", kind: "来回", x: 1470, y: 40 },
  { id: "quote", label: "供应商还价", kind: "步骤", x: 1680, y: 40 },
  { id: "revise", label: "拍板前复核", kind: "步骤", x: 1890, y: 150 },
  { id: "reflect", label: "复盘", kind: "角色", x: 2100, y: 150 },
  { id: "seal", label: "记账上锁", kind: "收尾", x: 2310, y: 150 },
];

const EDGES: readonly (readonly [string, string])[] = [
  ["plan", "proposals"],
  ["proposals", "buyer"],
  ["proposals", "pricer"],
  ["proposals", "marketer"],
  ["buyer", "price-war"],
  ["pricer", "price-war"],
  ["marketer", "price-war"],
  ["price-war", "arbitrate"],
  ["price-war", "hold-budget"],
  ["arbitrate", "supply"],
  ["hold-budget", "supply"],
  ["supply", "negotiate"],
  ["supply", "skip-supply"],
  ["negotiate", "quotes"],
  ["quotes", "quote"],
  ["quote", "revise"],
  ["skip-supply", "revise"],
  ["revise", "reflect"],
  ["reflect", "seal"],
];

export function buildGraph(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = GRAPH_NODES.map((spec) => ({
    id: spec.id,
    position: { x: spec.x, y: spec.y },
    data: { label: spec.label, kind: spec.kind },
    type: "u7",
    draggable: false,
    connectable: false,
    selectable: false,
  }));
  const edges: Edge[] = EDGES.map(([source, target]) => ({
    id: `${source}-${target}`,
    source,
    target,
    animated: false,
  }));
  return { nodes, edges };
}
