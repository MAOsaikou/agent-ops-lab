import type { Edge, Node } from "@xyflow/react";

export type GraphNodeSpec = {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly x: number;
  readonly y: number;
};

export const GRAPH_NODES: readonly GraphNodeSpec[] = [
  { id: "plan", label: "调度规划", kind: "工具", x: 0, y: 150 },
  { id: "proposals", label: "并行提案", kind: "并行", x: 160, y: 150 },
  { id: "buyer", label: "采购 Agent", kind: "Agent", x: 320, y: 40 },
  { id: "pricer", label: "定价 Agent", kind: "Agent", x: 320, y: 150 },
  { id: "marketer", label: "营销 Agent", kind: "Agent", x: 320, y: 260 },
  { id: "price-war", label: "价格战判定", kind: "条件", x: 480, y: 150 },
  { id: "arbitrate", label: "预算仲裁", kind: "工具", x: 640, y: 40 },
  { id: "hold-budget", label: "维持预算", kind: "工具", x: 640, y: 260 },
  { id: "supply", label: "断供判定", kind: "条件", x: 800, y: 150 },
  { id: "negotiate", label: "供应协商", kind: "子工作流", x: 960, y: 40 },
  { id: "skip-supply", label: "跳过协商", kind: "工具", x: 960, y: 260 },
  { id: "quotes", label: "报价循环", kind: "循环", x: 1120, y: 40 },
  { id: "quote", label: "供应商报价", kind: "工具", x: 1280, y: 40 },
  { id: "revise", label: "验证与修正", kind: "工具", x: 1440, y: 150 },
  { id: "reflect", label: "复盘", kind: "Agent", x: 1600, y: 150 },
  { id: "seal", label: "提交锁定", kind: "提交", x: 1760, y: 150 },
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
