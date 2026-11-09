import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useEffect, useMemo, useRef } from "react";

import "@xyflow/react/dist/style.css";

import { GRAPH_NODES, buildGraph } from "../lib/graph.js";
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
  idle: "border-white/[0.06] bg-ink-850/80 text-mist-500",
  queued: "border-warn-400/45 bg-warn-400/10 text-warn-400",
  running: "border-flow-400 bg-flow-400/15 text-flow-400 node-running",
  done: "border-lock-400/50 bg-lock-400/10 text-lock-400",
  dead: "border-risk-400 bg-risk-400/15 text-risk-400",
};

const STATUS_DOT: Record<NodeStatus, string> = {
  idle: "bg-ink-600",
  queued: "bg-warn-400",
  running: "bg-flow-400",
  done: "bg-lock-400",
  dead: "bg-risk-400",
};

const STATUS_TEXT: Record<NodeStatus, string> = {
  idle: "待命",
  queued: "排队",
  running: "运行中",
  done: "完成",
  dead: "死信",
};

const STATUS_ORDER: Record<NodeStatus, number> = {
  running: 0,
  queued: 1,
  dead: 2,
  done: 3,
  idle: 4,
};

function U7Node(props: NodeProps): React.JSX.Element {
  const data = props.data as unknown as U7NodeData;
  return (
    <div
      data-testid={`node-${props.id}`}
      data-status={data.status}
      className={`w-[178px] rounded-xl border px-3 py-2.5 shadow-[0_12px_26px_-18px_rgba(0,0,0,0.95)] backdrop-blur ${STATUS_RING[data.status]}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center justify-between gap-1.5">
        <span className="truncate text-[13.5px] font-semibold tracking-tight">{data.label}</span>
        <span className="shrink-0 rounded bg-black/25 px-1.5 py-0.5 text-[11px] opacity-80">{data.kind}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-1.5 text-[11.5px] opacity-90">
        <span>{STATUS_TEXT[data.status]}</span>
        {data.agent === undefined ? null : <span className="truncate font-mono text-[11px]">{data.agent}</span>}
      </div>
      {data.score === undefined ? null : <div className="mt-0.5 text-[11px] opacity-75">评分 {data.score.toFixed(2)}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { u7: U7Node };

const LEGEND: readonly NodeStatus[] = ["queued", "running", "done", "dead"];

function useGraph(state: UiState): { nodes: Node[]; edges: Edge[] } {
  return useMemo(() => {
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
}

function Camera({ state }: { readonly state: UiState }): null {
  const flow = useReactFlow();
  const last = useRef<string | null>(null);
  const focus = useMemo(() => {
    const order = GRAPH_NODES.map((node) => node.id);
    const running = order.filter((id) => state.nodes[id]?.status === "running");
    if (running.length > 0) {
      return running[running.length - 1] ?? null;
    }
    return order.filter((id) => state.nodes[id]?.status === "done").at(-1) ?? null;
  }, [state.nodes]);

  useEffect(() => {
    if (focus === null || focus === last.current) {
      return;
    }
    const spec = GRAPH_NODES.find((node) => node.id === focus);
    if (spec === undefined) {
      return;
    }
    last.current = focus;
    void flow.setCenter(spec.x + 89, spec.y + 42, { zoom: 0.95, duration: 520 });
  }, [focus, flow]);

  return null;
}

export function WorkflowGraph({ state }: { readonly state: UiState }): React.JSX.Element {
  const { nodes, edges } = useGraph(state);
  const running = Object.values(state.nodes).filter((node) => node.status === "running").length;
  const done = Object.values(state.nodes).filter((node) => node.status === "done").length;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl bg-ink-900/55 shadow-panel ring-1 ring-inset ring-white/[0.06]">
      <div className="pointer-events-none absolute left-4 top-3 z-10 flex flex-wrap items-center gap-2">
        <Badge tone="flow">运行中 {running}</Badge>
        <Badge tone="lock">已完成 {done}</Badge>
        <span className="text-[11.5px] text-mist-400">视图跟随当前节点，可拖拽平移</span>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultViewport={{ x: 36, y: 24, zoom: 0.95 }}
        minZoom={0.35}
        maxZoom={1.6}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1b2740" gap={22} size={1} />
        <Controls showInteractive={false} className="!bg-ink-800 !text-mist-300" />
        <Camera state={state} />
      </ReactFlow>
      <div className="pointer-events-none absolute bottom-3 left-4 flex flex-wrap items-center gap-3 text-[11.5px] text-mist-400">
        {LEGEND.map((status) => (
          <span key={status} className="inline-flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
            {STATUS_TEXT[status]}
          </span>
        ))}
      </div>
    </div>
  );
}

export function WorkflowNodeList({ state }: { readonly state: UiState }): React.JSX.Element {
  const rows = useMemo(() => {
    const base = buildGraph();
    return base.nodes
      .map((node) => {
        const spec = node.data as { label: string; kind: string };
        const live = state.nodes[node.id];
        return {
          id: node.id,
          label: spec.label,
          kind: spec.kind,
          status: live?.status ?? ("idle" as NodeStatus),
          agent: live?.agent,
        };
      })
      .sort((left, right) => STATUS_ORDER[left.status] - STATUS_ORDER[right.status]);
  }, [state.nodes]);
  const running = rows.filter((row) => row.status === "running").length;
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-ink-900/55 p-3 shadow-panel ring-1 ring-inset ring-white/[0.06]">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="flow">运行中 {running}</Badge>
        <Badge tone="lock">已完成 {rows.filter((row) => row.status === "done").length}</Badge>
        <span className="text-[11.5px] text-mist-400">窄屏为节点列表，桌面端为工作流图</span>
      </div>
      <ul className="flex max-h-[320px] flex-col gap-1 overflow-y-auto pr-1">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.03] px-3 py-2"
            data-testid={`node-${row.id}`}
            data-status={row.status}
          >
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-mist-100">{row.label}</span>
              <span className="block truncate text-[11.5px] text-mist-400">
                {row.kind}
                {row.agent === undefined ? "" : ` · ${row.agent}`}
              </span>
            </span>
            <span className={`shrink-0 rounded-md px-2 py-1 text-[11.5px] font-medium ${STATUS_RING[row.status]}`}>
              {STATUS_TEXT[row.status]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
