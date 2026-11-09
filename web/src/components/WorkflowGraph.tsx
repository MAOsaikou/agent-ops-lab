import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { useMemo } from "react";

import "@xyflow/react/dist/style.css";

import { buildGraph } from "../lib/graph.js";
import type { NodeStatus, UiState } from "../state/reducer.js";
import { Badge } from "./ui/badge.js";

type U7NodeData = {
  label: string;
  kind: string;
  status: NodeStatus;
  agent?: string;
  score?: number;
};

const STATUS_RING: Record<NodeStatus, string> = {
  idle: "border-ink-600/80 bg-ink-850/90 text-mist-500",
  queued: "border-warn-400/50 bg-warn-400/10 text-warn-400",
  running: "border-flow-400 bg-flow-400/15 text-flow-400 node-running",
  done: "border-lock-400/60 bg-lock-400/10 text-lock-400",
  dead: "border-risk-400 bg-risk-400/15 text-risk-400",
};

const STATUS_TEXT: Record<NodeStatus, string> = {
  idle: "待命",
  queued: "排队",
  running: "运行中",
  done: "完成",
  dead: "死信",
};

function U7Node(props: NodeProps): React.JSX.Element {
  const data = props.data as unknown as U7NodeData;
  return (
    <div
      data-testid={`node-${props.id}`}
      data-status={data.status}
      className={`w-[152px] rounded-lg border px-2.5 py-1.5 shadow-lg backdrop-blur ${STATUS_RING[data.status]}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[12px] font-semibold">{data.label}</span>
        <span className="text-[9px] uppercase tracking-wider opacity-80">{data.kind}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-1 text-[10px] opacity-90">
        <span>{STATUS_TEXT[data.status]}</span>
        {data.agent === undefined ? null : <span className="truncate font-mono text-[9px]">{data.agent}</span>}
      </div>
      {data.score === undefined ? null : <div className="text-[9px] opacity-80">评分 {data.score.toFixed(2)}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { u7: U7Node };

const LEGEND: readonly { readonly status: NodeStatus; readonly label: string }[] = [
  { status: "queued", label: "排队" },
  { status: "running", label: "运行中" },
  { status: "done", label: "完成" },
  { status: "dead", label: "死信" },
];

export function WorkflowGraph({ state }: { readonly state: UiState }): React.JSX.Element {
  const { nodes, edges } = useMemo(() => {
    const base = buildGraph();
    const decorated: Node[] = base.nodes.map((node) => {
      const live = state.nodes[node.id];
      const spec = node.data as { label: string; kind: string };
      const extra: U7NodeData = {
        label: spec.label,
        kind: spec.kind,
        status: live?.status ?? "idle",
        ...(live?.agent === undefined ? {} : { agent: live.agent }),
        ...(live?.score === undefined ? {} : { score: live.score }),
      };
      return { ...node, data: extra as unknown as Record<string, unknown> };
    });
    const liveEdges: Edge[] = base.edges.map((edge) => ({
      ...edge,
      animated: state.nodes[edge.source]?.status === "done" && state.nodes[edge.target]?.status === "running",
    }));
    return { nodes: decorated, edges: liveEdges };
  }, [state.nodes]);

  const running = Object.values(state.nodes).filter((node) => node.status === "running").length;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-ink-700/70 bg-ink-900/50">
      <div className="pointer-events-none absolute left-3 top-2 z-10 flex items-center gap-2 text-[11px]">
        <Badge tone="flow">运行中 {running}</Badge>
        <Badge tone="lock">已完成 {Object.values(state.nodes).filter((node) => node.status === "done").length}</Badge>
        <span className="text-mist-500">工作流图 · 节点状态随事件变化</span>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.16, maxZoom: 1 }}
        minZoom={0.42}
        maxZoom={1.4}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1b2740" gap={18} size={1} />
        <Controls showInteractive={false} className="!bg-ink-800 !text-mist-300" />
      </ReactFlow>
      <div className="pointer-events-none absolute bottom-2 left-3 flex items-center gap-3 text-[10px] text-mist-500">
        {LEGEND.map((item) => (
          <span key={item.status} className="inline-flex items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_RING[item.status].split(" ")[0]?.replace("border-", "bg-") ?? ""}`} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
