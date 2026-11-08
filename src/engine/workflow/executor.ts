import { performance } from "node:perf_hooks";

import {
  NODE_DEAD_LETTER,
  NODE_FINISHED,
  NODE_SCHEDULED,
  NODE_STARTED,
  appendNodeEvent,
} from "../events/node.js";
import type { EventStore } from "../events/store.js";
import { sha256Hex } from "../hash.js";
import type { AgentSpec } from "../agents/registry.js";
import {
  type AgentId,
  type NodeId,
  type PredicateId,
  type PromptHash,
  type RunId,
  type VerifierId,
  type WorkflowId,
} from "../ids.js";
import { canonicalJson, parseJson, type Json } from "../json.js";
import type { LlmClient } from "../llm/client.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { Hash } from "../types.js";
import { controlChildIds, type Join, type Workflow, type WorkflowDocument, type WorkflowNode } from "./schema.js";

export class StepTimeoutError extends Error {
  readonly nodeId: NodeId;

  constructor(nodeId: NodeId) {
    super(`node ${nodeId} timed out`);
    this.name = "StepTimeoutError";
    this.nodeId = nodeId;
  }
}

export type StepContext = {
  readonly iteration: number;
  output(id: NodeId): Json | null;
};

export type Predicate = (context: StepContext) => boolean;
export type Verifier = (context: StepContext) => boolean;
export type HumanDecision = "approve" | "fallback";
export type HumanGate = (nodeId: NodeId) => Promise<HumanDecision>;

export type AgentSource = {
  resolve(id: AgentId): AgentSpec;
  promptHashOf(spec: AgentSpec): PromptHash;
};

export type NodeTrace = {
  readonly nodeId: string;
  readonly queued: number;
  readonly started: number;
  readonly finished: number;
};

export type WorkflowRun = {
  readonly status: "completed";
  readonly usedFallback: boolean;
  readonly result: Json;
  readonly terminalHash: Hash;
  readonly traces: readonly NodeTrace[];
  readonly deadLetters: readonly string[];
};

export type WorkflowRunOptions = {
  readonly document: WorkflowDocument;
  readonly workflowId: WorkflowId;
  readonly runId: RunId;
  readonly round: number;
  readonly events: EventStore;
  readonly agents: AgentSource;
  readonly tools: ToolRegistry;
  readonly llm: LlmClient;
  readonly predicates: ReadonlyMap<PredicateId, Predicate>;
  readonly verifiers: ReadonlyMap<VerifierId, Verifier>;
  readonly fallback: unknown;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly backoffMs?: number;
  readonly stepDelayMs?: number;
  readonly humanGate?: HumanGate;
  readonly toolInputs?: ReadonlyMap<NodeId, unknown>;
  readonly now?: () => number;
};

type Outcome = {
  readonly ok: boolean;
  readonly deadLetter: boolean;
  readonly output: Json;
  readonly reason: string;
};

type StepStatus = "idle" | "queued" | "running" | "done";

type Indexed = {
  readonly workflows: ReadonlyMap<WorkflowId, Workflow>;
  readonly nodes: ReadonlyMap<NodeId, WorkflowNode>;
  readonly owned: ReadonlyMap<WorkflowId, ReadonlySet<NodeId>>;
};

type Runtime = {
  readonly runId: RunId;
  readonly round: number;
  readonly events: EventStore;
  readonly agents: AgentSource;
  readonly tools: ToolRegistry;
  readonly llm: LlmClient;
  readonly predicates: ReadonlyMap<PredicateId, Predicate>;
  readonly verifiers: ReadonlyMap<VerifierId, Verifier>;
  readonly fallback: Json;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly backoffMs: number;
  readonly stepDelayMs: number;
  readonly humanGate: HumanGate | null;
  readonly toolInputs: ReadonlyMap<NodeId, Json>;
  readonly indexed: Indexed;
  readonly now: () => number;
  readonly state: Map<NodeId, StepStatus>;
  readonly succeeded: Set<NodeId>;
  readonly outputs: Map<NodeId, Json>;
  readonly queuedAt: Map<string, number>;
  readonly activeKey: Map<NodeId, string>;
  readonly traces: NodeTrace[];
  readonly deadLetters: NodeId[];
  readonly entries: { key: string; output: Json }[];
  readonly pending: Promise<unknown>[];
  readonly stack: WorkflowId[];
  nonce: number;
};

function assertWhole(value: number, label: string, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${label} must be an integer >= ${String(min)}`);
  }
}

function indexDocument(document: WorkflowDocument): Indexed {
  const workflows = new Map<WorkflowId, Workflow>();
  const nodes = new Map<NodeId, WorkflowNode>();
  const owned = new Map<WorkflowId, ReadonlySet<NodeId>>();
  for (const workflow of document.workflows) {
    if (workflows.has(workflow.id)) throw new Error(`duplicate workflow ${workflow.id}`);
    workflows.set(workflow.id, workflow);
    const children = new Set<NodeId>();
    for (const node of workflow.nodes) {
      if (nodes.has(node.id)) throw new Error(`duplicate node ${node.id}`);
      nodes.set(node.id, node);
      for (const child of controlChildIds(node)) children.add(child);
    }
    owned.set(workflow.id, children);
  }
  return { workflows, nodes, owned };
}

function parseToolInputs(input: ReadonlyMap<NodeId, unknown> | undefined): Map<NodeId, Json> {
  const parsed = new Map<NodeId, Json>();
  if (input === undefined) return parsed;
  for (const [id, value] of input) parsed.set(id, parseJson(value));
  return parsed;
}

function createRuntime(options: WorkflowRunOptions, indexed: Indexed): Runtime {
  assertWhole(options.round, "round", 0);
  assertWhole(options.timeoutMs, "timeoutMs", 0);
  assertWhole(options.maxAttempts, "maxAttempts", 1);
  assertWhole(options.backoffMs ?? 0, "backoffMs", 0);
  assertWhole(options.stepDelayMs ?? 0, "stepDelayMs", 0);
  return {
    runId: options.runId,
    round: options.round,
    events: options.events,
    agents: options.agents,
    tools: options.tools,
    llm: options.llm,
    predicates: options.predicates,
    verifiers: options.verifiers,
    fallback: parseJson(options.fallback),
    timeoutMs: options.timeoutMs,
    maxAttempts: options.maxAttempts,
    backoffMs: options.backoffMs ?? 0,
    stepDelayMs: options.stepDelayMs ?? 0,
    humanGate: options.humanGate ?? null,
    toolInputs: parseToolInputs(options.toolInputs),
    indexed,
    now: options.now ?? (() => performance.now()),
    state: new Map(),
    succeeded: new Set(),
    outputs: new Map(),
    queuedAt: new Map(),
    activeKey: new Map(),
    traces: [],
    deadLetters: [],
    entries: [],
    pending: [],
    stack: [],
    nonce: 0,
  };
}

function requireNode(runtime: Runtime, id: NodeId): WorkflowNode {
  const node = runtime.indexed.nodes.get(id);
  if (node === undefined) throw new Error(`missing node ${id}`);
  return node;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isTimeout(error: unknown): boolean {
  if (error instanceof StepTimeoutError) return true;
  return error instanceof Error && error.message.toLowerCase().includes("timeout");
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number, nodeId: NodeId): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new StepTimeoutError(nodeId));
    }, timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function agentBody(runtime: Runtime, node: WorkflowNode): {
  readonly agentId: string;
  readonly version: string;
  readonly promptHash: string;
  readonly agent: string;
} | null {
  if (node.kind !== "agent") return null;
  const spec = runtime.agents.resolve(node.agent);
  const promptHash = runtime.agents.promptHashOf(spec);
  return {
    agentId: spec.id,
    version: spec.version,
    promptHash,
    agent: `${spec.id}@${spec.version}`,
  };
}

function append(
  runtime: Runtime,
  type: typeof NODE_SCHEDULED | typeof NODE_STARTED | typeof NODE_FINISHED | typeof NODE_DEAD_LETTER,
  node: WorkflowNode,
  key: string,
  reason: string,
): void {
  const stamp = agentBody(runtime, node);
  appendNodeEvent(runtime.events, {
    runId: runtime.runId,
    type,
    idempotencyKey: `${runtime.runId}|${type}|${key}`,
    body: stamp === null
      ? { nodeId: node.id, reason }
      : {
          nodeId: node.id,
          reason,
          agentId: stamp.agentId,
          version: stamp.version,
          promptHash: stamp.promptHash,
          agent: stamp.agent,
        },
  });
}

function markQueued(runtime: Runtime, node: WorkflowNode): void {
  runtime.nonce += 1;
  const key = `${node.id}#${String(runtime.nonce)}`;
  runtime.activeKey.set(node.id, key);
  runtime.queuedAt.set(key, runtime.now());
  append(runtime, NODE_SCHEDULED, node, key, "ready");
}

function arm(runtime: Runtime, node: WorkflowNode, queue: NodeId[]): void {
  runtime.state.set(node.id, "queued");
  markQueued(runtime, node);
  queue.push(node.id);
}

function stepContext(runtime: Runtime, iteration: number): StepContext {
  return {
    iteration,
    output(id: NodeId): Json | null {
      const value = runtime.outputs.get(id);
      return value === undefined ? null : value;
    },
  };
}

function requirePredicate(runtime: Runtime, id: PredicateId): Predicate {
  const predicate = runtime.predicates.get(id);
  if (predicate === undefined) throw new Error(`predicate is not registered: ${id}`);
  return predicate;
}

function revive(runtime: Runtime, id: NodeId): void {
  const node = requireNode(runtime, id);
  runtime.state.set(id, "idle");
  runtime.succeeded.delete(id);
  for (const child of controlChildIds(node)) revive(runtime, child);
}

async function withRetries(
  runtime: Runtime,
  nodeId: NodeId,
  run: (attempt: number) => Promise<Json>,
): Promise<Outcome> {
  if (runtime.stepDelayMs > 0) await delay(runtime.stepDelayMs);
  for (let attempt = 1; attempt <= runtime.maxAttempts; attempt += 1) {
    try {
      const output = await withTimeout(run(attempt), runtime.timeoutMs, nodeId);
      return { ok: true, deadLetter: false, output, reason: "completed" };
    } catch (error) {
      if (!isTimeout(error)) {
        const message = error instanceof Error ? error.message : "failed";
        return { ok: false, deadLetter: false, output: runtime.fallback, reason: message };
      }
      if (attempt === runtime.maxAttempts) {
        return {
          ok: false,
          deadLetter: true,
          output: runtime.fallback,
          reason: `timeout after ${String(runtime.maxAttempts)} attempts`,
        };
      }
      if (runtime.backoffMs > 0) await delay(runtime.backoffMs * attempt);
    }
  }
  return {
    ok: false,
    deadLetter: true,
    output: runtime.fallback,
    reason: `timeout after ${String(runtime.maxAttempts)} attempts`,
  };
}

async function runAgent(runtime: Runtime, node: Extract<WorkflowNode, { kind: "agent" }>, iteration: number): Promise<Outcome> {
  const spec = runtime.agents.resolve(node.agent);
  const prompt = canonicalJson({
    agent: spec.id,
    iteration,
    role: spec.role,
    task: node.task,
    template: spec.promptTemplateId,
    version: spec.version,
  });
  return withRetries(runtime, node.id, (attempt) =>
    runtime.llm
      .complete({
        runId: runtime.runId,
        round: runtime.round,
        nodeId: node.id,
        attempt,
        prompt,
        maxTokens: spec.budget.maxTokensPerRound,
      })
      .then((completion) => completion.text),
  );
}

async function runTool(runtime: Runtime, node: Extract<WorkflowNode, { kind: "tool" }>): Promise<Outcome> {
  const input = runtime.toolInputs.get(node.id) ?? {};
  return withRetries(runtime, node.id, async () => parseJson(await runtime.tools.call(node.tool, input)));
}

function neededSuccesses(join: Join, count: number): number {
  if (join === "all") return count;
  if (join === "any") return 1;
  return join.quorum;
}

function joinReason(join: Join, ok: boolean): string {
  const status = ok ? "satisfied" : "unsatisfied";
  if (join === "all" || join === "any") return `join ${join} ${status}`;
  return `join quorum ${String(join.quorum)} ${status}`;
}

async function runParallel(runtime: Runtime, node: Extract<WorkflowNode, { kind: "parallel" }>): Promise<Outcome> {
  const tasks = node.branches.map((id) => executeNode(runtime, requireNode(runtime, id), 1));
  const needed = neededSuccesses(node.join, tasks.length);
  let successes = 0;
  let settled = 0;
  if (tasks.length > 0) {
    await new Promise<void>((resolve, reject) => {
      for (const task of tasks) {
        task.then(
          (outcome) => {
            settled += 1;
            if (outcome.ok) successes += 1;
            if (successes >= needed || settled === tasks.length) resolve();
          },
          (error: unknown) => {
            reject(error instanceof Error ? error : new Error("branch failed"));
          },
        );
      }
    });
    runtime.pending.push(Promise.allSettled(tasks));
  }
  const ok = successes >= needed;
  return {
    ok,
    deadLetter: false,
    output: { successes, needed },
    reason: joinReason(node.join, ok),
  };
}

async function runCondition(
  runtime: Runtime,
  node: Extract<WorkflowNode, { kind: "condition" }>,
  iteration: number,
): Promise<Outcome> {
  const takeThen = requirePredicate(runtime, node.predicate)(stepContext(runtime, iteration));
  const next = requireNode(runtime, takeThen ? node.then : node.else);
  const outcome = await executeNode(runtime, next, 1);
  return {
    ok: outcome.ok,
    deadLetter: false,
    output: outcome.output,
    reason: takeThen ? "predicate true" : "predicate false",
  };
}

async function runLoop(runtime: Runtime, node: Extract<WorkflowNode, { kind: "loop" }>): Promise<Outcome> {
  let last: Json = null;
  for (let iteration = 1; iteration <= node.maxIterations; iteration += 1) {
    revive(runtime, node.body);
    const outcome = await executeNode(runtime, requireNode(runtime, node.body), iteration);
    if (!outcome.ok) {
      return {
        ok: false,
        deadLetter: false,
        output: outcome.output,
        reason: `loop stopped on iteration ${String(iteration)}`,
      };
    }
    last = outcome.output;
    if (requirePredicate(runtime, node.until)(stepContext(runtime, iteration))) {
      return {
        ok: true,
        deadLetter: false,
        output: last,
        reason: `until ${node.until} on iteration ${String(iteration)}`,
      };
    }
  }
  return {
    ok: true,
    deadLetter: false,
    output: last,
    reason: `maxIterations ${String(node.maxIterations)}`,
  };
}

async function runSubflow(runtime: Runtime, node: Extract<WorkflowNode, { kind: "subflow" }>): Promise<Outcome> {
  const ok = await runGraph(runtime, node.workflow);
  return {
    ok,
    deadLetter: false,
    output: { workflow: node.workflow, ok },
    reason: ok ? "subflow completed" : "subflow failed",
  };
}

function runVerify(
  runtime: Runtime,
  node: Extract<WorkflowNode, { kind: "verify" }>,
  iteration: number,
): Outcome {
  const context = stepContext(runtime, iteration);
  for (const id of node.pipeline) {
    const verifier = runtime.verifiers.get(id);
    if (verifier === undefined) throw new Error(`verifier is not registered: ${id}`);
    if (!verifier(context)) {
      return {
        ok: false,
        deadLetter: false,
        output: { verifier: id, pass: false },
        reason: `verifier ${id} failed`,
      };
    }
  }
  return { ok: true, deadLetter: false, output: { pass: true }, reason: "verifiers passed" };
}

async function runHumanGate(runtime: Runtime, node: Extract<WorkflowNode, { kind: "humanGate" }>): Promise<Outcome> {
  if (runtime.humanGate !== null) {
    try {
      const decision = await withTimeout(runtime.humanGate(node.id), node.timeoutMs, node.id);
      switch (decision) {
        case "approve":
          return { ok: true, deadLetter: false, output: { decision: "approve" }, reason: "human approved" };
        case "fallback":
          return { ok: false, deadLetter: false, output: { decision: "fallback" }, reason: "human fallback" };
        default: {
          const _exhaustive: never = decision;
          throw new Error(`unknown human decision ${String(_exhaustive)}`);
        }
      }
    } catch (error) {
      if (!isTimeout(error)) throw error;
    }
  } else if (node.timeoutMs > 0) {
    await delay(node.timeoutMs);
  }
  switch (node.onTimeout) {
    case "approve":
      return { ok: true, deadLetter: false, output: { decision: "approve" }, reason: "timeout approve" };
    case "fallback":
      return { ok: false, deadLetter: false, output: { decision: "fallback" }, reason: "timeout fallback" };
    default: {
      const _exhaustive: never = node.onTimeout;
      throw new Error(`unknown timeout policy ${String(_exhaustive)}`);
    }
  }
}

function runCommit(): Outcome {
  return { ok: true, deadLetter: false, output: { committed: true }, reason: "committed" };
}

async function dispatch(runtime: Runtime, node: WorkflowNode, iteration: number): Promise<Outcome> {
  switch (node.kind) {
    case "agent":
      return runAgent(runtime, node, iteration);
    case "tool":
      return runTool(runtime, node);
    case "parallel":
      return runParallel(runtime, node);
    case "condition":
      return runCondition(runtime, node, iteration);
    case "loop":
      return runLoop(runtime, node);
    case "subflow":
      return runSubflow(runtime, node);
    case "verify":
      return runVerify(runtime, node, iteration);
    case "humanGate":
      return runHumanGate(runtime, node);
    case "commit":
      return runCommit();
    default: {
      const _exhaustive: never = node;
      throw new Error(`unknown node ${String(_exhaustive)}`);
    }
  }
}

async function executeNode(runtime: Runtime, node: WorkflowNode, iteration: number): Promise<Outcome> {
  const status = runtime.state.get(node.id) ?? "idle";
  if (status === "running" || status === "done") {
    throw new Error(`node ${node.id} cannot start from ${status}`);
  }
  if (status === "idle") {
    runtime.state.set(node.id, "queued");
    markQueued(runtime, node);
  }
  runtime.state.set(node.id, "running");
  const key = runtime.activeKey.get(node.id);
  if (key === undefined) throw new Error(`node ${node.id} has no queue key`);
  const queued = runtime.queuedAt.get(key);
  if (queued === undefined) throw new Error(`node ${node.id} has no queue time`);
  const started = runtime.now();
  append(runtime, NODE_STARTED, node, key, "started");
  const outcome = await dispatch(runtime, node, iteration);
  const finished = runtime.now();
  runtime.traces.push({ nodeId: node.id, queued, started, finished });
  if (outcome.deadLetter) {
    append(runtime, NODE_DEAD_LETTER, node, key, outcome.reason);
    runtime.deadLetters.push(node.id);
  } else {
    append(runtime, NODE_FINISHED, node, key, outcome.reason);
  }
  runtime.state.set(node.id, "done");
  runtime.outputs.set(node.id, outcome.output);
  runtime.entries.push({ key, output: outcome.output });
  if (outcome.ok) runtime.succeeded.add(node.id);
  return outcome;
}

async function runGraph(runtime: Runtime, workflowId: WorkflowId): Promise<boolean> {
  if (runtime.stack.includes(workflowId)) {
    throw new Error(`subflow cycle at ${workflowId}`);
  }
  const workflow = runtime.indexed.workflows.get(workflowId);
  const owned = runtime.indexed.owned.get(workflowId);
  if (workflow === undefined || owned === undefined) {
    throw new Error(`missing workflow ${workflowId}`);
  }
  runtime.stack.push(workflowId);
  try {
    const queue: NodeId[] = [];
    for (const node of workflow.nodes) {
      if (owned.has(node.id) || node.dependsOn.length > 0) continue;
      arm(runtime, node, queue);
    }
    while (queue.length > 0) {
      const batch = queue.splice(0, queue.length);
      const outcomes = await Promise.all(batch.map((id) => executeNode(runtime, requireNode(runtime, id), 1)));
      if (outcomes.some((outcome) => !outcome.ok) || runtime.deadLetters.length > 0) return false;
      for (const node of workflow.nodes) {
        if (owned.has(node.id)) continue;
        if ((runtime.state.get(node.id) ?? "idle") !== "idle") continue;
        if (node.dependsOn.every((dep) => runtime.succeeded.has(dep))) arm(runtime, node, queue);
      }
    }
    return true;
  } finally {
    runtime.stack.pop();
  }
}

function terminalHash(runtime: Runtime): Hash {
  const sorted = [...runtime.entries].sort((left, right) => {
    if (left.key < right.key) return -1;
    if (left.key > right.key) return 1;
    return 0;
  });
  return sha256Hex(canonicalJson(sorted));
}

export async function runWorkflow(options: WorkflowRunOptions): Promise<WorkflowRun> {
  const indexed = indexDocument(options.document);
  if (!indexed.workflows.has(options.workflowId)) {
    throw new Error(`missing workflow ${options.workflowId}`);
  }
  const runtime = createRuntime(options, indexed);
  const ok = await runGraph(runtime, options.workflowId);
  await Promise.all(runtime.pending);
  const hash = terminalHash(runtime);
  const usedFallback = !ok || runtime.deadLetters.length > 0;
  return {
    status: "completed",
    usedFallback,
    result: usedFallback ? runtime.fallback : hash,
    terminalHash: hash,
    traces: runtime.traces,
    deadLetters: [...runtime.deadLetters],
  };
}
