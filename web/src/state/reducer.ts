import type {
  BudgetFrame,
  CommitFrame,
  LoopFrame,
  NodeFrame,
  OutcomeRow,
  QuoteFrame,
  ReflectFrame,
  SettleFrame,
  UiFrame,
} from "../../../src/server/frames.js";
import { NODE_EVENT_TEXT, RULING_TEXT, nodeLabel } from "../lib/nodes.js";

export type NodeStatus = "idle" | "queued" | "running" | "done" | "dead";

export type NodeUiState = {
  readonly status: NodeStatus;
  readonly agent?: string;
  readonly version?: string;
  readonly score?: number;
  readonly reason: string;
  readonly updates: number;
};

export type RoundUiState = {
  readonly round: number;
  readonly committed: boolean;
  readonly settled: boolean;
  readonly reflected: boolean;
  readonly locked: boolean;
  readonly source?: string;
  readonly decisionHash?: string;
  readonly observationHash?: string;
  readonly adSpendCents?: number;
  readonly orders?: CommitFrame["orders"];
  readonly outcome?: OutcomeRow;
  readonly beliefHash?: string;
  readonly overlayHash?: string;
};

export type LogEntry = {
  readonly seq: number;
  readonly kind: UiFrame["kind"];
  readonly round: number | null;
  readonly text: string;
  readonly tone: "muted" | "flow" | "lock" | "warn" | "risk";
};

export type UiState = {
  readonly lastSeq: number;
  readonly applied: number;
  readonly nodes: Readonly<Record<string, NodeUiState>>;
  readonly rounds: readonly RoundUiState[];
  readonly quotes: readonly QuoteFrame[];
  readonly budgets: readonly BudgetFrame[];
  readonly loops: readonly LoopFrame[];
  readonly log: readonly LogEntry[];
  readonly duplicates: number;
  readonly outOfOrder: number;
  readonly buffered: readonly UiFrame[];
};

const LOG_LIMIT = 140;

export function initialUiState(): UiState {
  return {
    lastSeq: 0,
    applied: 0,
    nodes: {},
    rounds: [],
    quotes: [],
    budgets: [],
    loops: [],
    log: [],
    duplicates: 0,
    outOfOrder: 0,
    buffered: [],
  };
}

function pushLog(state: UiState, entry: LogEntry): readonly LogEntry[] {
  const next = [...state.log, entry];
  return next.length > LOG_LIMIT ? next.slice(next.length - LOG_LIMIT) : next;
}

function statusOfEvent(event: NodeFrame["event"]): NodeStatus {
  switch (event) {
    case "scheduled":
      return "queued";
    case "started":
      return "running";
    case "finished":
      return "done";
    case "dead-letter":
      return "dead";
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function nodeTone(status: NodeStatus): LogEntry["tone"] {
  switch (status) {
    case "running":
      return "flow";
    case "done":
      return "lock";
    case "dead":
      return "risk";
    case "queued":
      return "warn";
    default:
      return "muted";
  }
}

function applyNode(state: UiState, frame: NodeFrame): UiState {
  const status = statusOfEvent(frame.event);
  const previous = state.nodes[frame.nodeId];
  const node: NodeUiState = {
    status,
    reason: frame.reason,
    updates: (previous?.updates ?? 0) + 1,
    ...(frame.agent === undefined ? {} : { agent: frame.agent }),
    ...(frame.version === undefined ? {} : { version: frame.version }),
    ...(frame.score === undefined ? {} : { score: frame.score }),
  };
  return {
    ...state,
    nodes: { ...state.nodes, [frame.nodeId]: node },
    log: pushLog(state, {
      seq: frame.seq,
      kind: "node",
      round: null,
      text: `${nodeLabel(frame.nodeId)} · ${NODE_EVENT_TEXT[frame.event] ?? frame.event}${
        frame.agent === undefined ? "" : ` · ${frame.agent}`
      }`,
      tone: nodeTone(status),
    }),
  };
}

function findRound(state: UiState, round: number): RoundUiState {
  const existing = state.rounds.find((row) => row.round === round);
  if (existing !== undefined) {
    return existing;
  }
  return { round, committed: false, settled: false, reflected: false, locked: false };
}

function replaceRound(state: UiState, next: RoundUiState): readonly RoundUiState[] {
  const rows = state.rounds.filter((row) => row.round !== next.round);
  rows.push(next);
  rows.sort((left, right) => left.round - right.round);
  return rows;
}

function sealed(row: RoundUiState): RoundUiState {
  return { ...row, locked: row.committed && row.settled && row.reflected };
}

function applyQuote(state: UiState, frame: QuoteFrame): UiState {
  return {
    ...state,
    quotes: [...state.quotes, frame],
    rounds: replaceRound(state, sealed(findRound(state, frame.round))),
    log: pushLog(state, {
      seq: frame.seq,
      kind: "quote",
      round: frame.round,
      text: `第 ${String(frame.round + 1)} 回合 · 供应商报价 · ${frame.supplier} ${frame.sku} · 第 ${String(
        frame.quoteRound,
      )} 轮 ${RULING_TEXT[frame.ruling] ?? frame.ruling} · ¥${(frame.unitCost / 100).toFixed(2)}`,
      tone: frame.ruling === "walk" ? "risk" : frame.ruling === "counter" ? "warn" : "lock",
    }),
  };
}

function applyBudget(state: UiState, frame: BudgetFrame): UiState {
  return {
    ...state,
    budgets: [...state.budgets, frame],
    rounds: replaceRound(state, sealed(findRound(state, frame.round))),
    log: pushLog(state, {
      seq: frame.seq,
      kind: "budget",
      round: frame.round,
      text: `第 ${String(frame.round + 1)} 回合 · 预算仲裁 · 广告边际 ${String(frame.amounts.ads)} 分 / 降价边际 ${String(
        frame.amounts.priceCut,
      )} 分 → 分配 ${String(frame.allocation.ads)} 分 / ${String(frame.allocation.priceCut)} 分`,
      tone: "flow",
    }),
  };
}

function applyLoop(state: UiState, frame: LoopFrame): UiState {
  return {
    ...state,
    loops: [...state.loops, frame],
    rounds: replaceRound(state, sealed(findRound(state, frame.round))),
    log: pushLog(state, {
      seq: frame.seq,
      kind: "loop",
      round: frame.round,
      text: `第 ${String(frame.round + 1)} 回合 · 修正循环第 ${String(frame.iteration)} 次 · ${
        frame.verdict === "pass" ? "通过" : frame.verdict === "revise" ? "退回修正" : "拒绝"
      } · p50 ${String(frame.p50)} 分`,
      tone: frame.verdict === "pass" ? "lock" : "warn",
    }),
  };
}

function applyCommit(state: UiState, frame: CommitFrame): UiState {
  const row = findRound(state, frame.round);
  const next: RoundUiState = sealed({
    ...row,
    committed: true,
    source: frame.source,
    decisionHash: frame.decisionHash,
    observationHash: frame.observationHash,
    adSpendCents: frame.adSpend,
    orders: frame.orders,
  });
  return {
    ...state,
    rounds: replaceRound(state, next),
    log: pushLog(state, {
      seq: frame.seq,
      kind: "commit",
      round: frame.round,
      text: `第 ${String(frame.round + 1)} 回合 · 决策提交锁定 · ${frame.source === "fallback" ? "安全兜底决策" : "验证通过决策"} · ${
        frame.decisionHash.slice(0, 10)
      }`,
      tone: "lock",
    }),
  };
}

function applySettle(state: UiState, frame: SettleFrame): UiState {
  const row = findRound(state, frame.round);
  const next = sealed({ ...row, settled: true, outcome: frame.outcome });
  return {
    ...state,
    rounds: replaceRound(state, next),
    log: pushLog(state, {
      seq: frame.seq,
      kind: "settle",
      round: frame.round,
      text: `第 ${String(frame.round + 1)} 回合 · 结算完成 · 利润 ${String(frame.outcome.profit)} 分 · 现金 ${String(
        frame.outcome.cash,
      )} 分`,
      tone: frame.outcome.profit >= 0 ? "lock" : "warn",
    }),
  };
}

function applyReflect(state: UiState, frame: ReflectFrame): UiState {
  const row = findRound(state, frame.round);
  const next = sealed({
    ...row,
    reflected: true,
    beliefHash: frame.beliefHash,
    overlayHash: frame.overlayHash,
  });
  return {
    ...state,
    rounds: replaceRound(state, next),
    log: pushLog(state, {
      seq: frame.seq,
      kind: "reflect",
      round: frame.round,
      text: `第 ${String(frame.round + 1)} 回合 · 复盘写入知识库 · 账本行闭合`,
      tone: "muted",
    }),
  };
}

export function applyFrame(state: UiState, frame: UiFrame): UiState {
  if (frame.kind === "node") {
    return applyNode(state, frame);
  }
  if (frame.kind === "quote") {
    return applyQuote(state, frame);
  }
  if (frame.kind === "budget") {
    return applyBudget(state, frame);
  }
  if (frame.kind === "loop") {
    return applyLoop(state, frame);
  }
  if (frame.kind === "commit") {
    return applyCommit(state, frame);
  }
  if (frame.kind === "settle") {
    return applySettle(state, frame);
  }
  return applyReflect(state, frame);
}

function applyOrdered(state: UiState, frame: UiFrame): UiState {
  const base: UiState = { ...state, lastSeq: frame.seq, applied: state.applied + 1 };
  return applyFrame(base, frame);
}

export function enqueue(state: UiState, frame: UiFrame): UiState {
  if (frame.seq <= state.lastSeq) {
    return { ...state, duplicates: state.duplicates + 1 };
  }
  if (state.buffered.some((pending) => pending.seq === frame.seq)) {
    return { ...state, duplicates: state.duplicates + 1 };
  }
  if (frame.seq === state.lastSeq + 1) {
    let next = applyOrdered(state, frame);
    let buffer = [...next.buffered];
    let guard = 0;
    for (;;) {
      const ready = buffer.find((pending) => pending.seq === next.lastSeq + 1);
      if (ready === undefined) {
        break;
      }
      buffer = buffer.filter((pending) => pending.seq !== ready.seq);
      next = applyOrdered({ ...next, buffered: buffer }, ready);
      guard += 1;
      if (guard > 10000) {
        throw new Error("buffered frame drain did not terminate");
      }
    }
    return { ...next, buffered: buffer };
  }
  const buffer = [...state.buffered, frame].sort((left, right) => left.seq - right.seq);
  return { ...state, buffered: buffer, outOfOrder: state.outOfOrder + 1 };
}

export function foldFrames(frames: readonly UiFrame[]): UiState {
  let state = initialUiState();
  const ordered = [...frames].sort((left, right) => left.seq - right.seq);
  for (const frame of ordered) {
    state = enqueue(state, frame);
  }
  return state;
}

export function activeRound(state: UiState): number | null {
  const last = state.rounds.at(-1);
  return last === undefined ? null : last.round;
}

export function nodeCounts(state: UiState): { queued: number; running: number; done: number; dead: number } {
  const counts = { queued: 0, running: 0, done: 0, dead: 0 };
  for (const node of Object.values(state.nodes)) {
    if (node.status === "queued") counts.queued += 1;
    else if (node.status === "running") counts.running += 1;
    else if (node.status === "done") counts.done += 1;
    else if (node.status === "dead") counts.dead += 1;
  }
  return counts;
}
