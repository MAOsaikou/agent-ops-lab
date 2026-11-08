import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";

import { createAgentRegistry, type AgentSpec } from "../src/engine/agents/registry.js";
import type { EventStore } from "../src/engine/events/store.js";
import { openEventStore } from "../src/engine/events/store.js";
import {
  parseAgentId,
  parseNodeId,
  parsePredicateId,
  parseRunId,
  parseSemVer,
  parseSkillTag,
  parseToolName,
  parseUnitInterval,
  parseVerifierId,
  parseWorkflowId,
  type NodeId,
  type PredicateId,
  type VerifierId,
} from "../src/engine/ids.js";
import { jsonValue, type Json } from "../src/engine/json.js";
import type { LlmClient } from "../src/engine/llm/client.js";
import { promptHash } from "../src/engine/llm/hash.js";
import { createMockLlm } from "../src/engine/llm/mock.js";
import { createToolRegistry, type ToolRegistry } from "../src/engine/tools/registry.js";
import { isHash } from "../src/engine/types.js";
import {
  runWorkflow,
  type AgentSource,
  type HumanGate,
  type NodeTrace,
  type Predicate,
  type Verifier,
  type WorkflowRun,
} from "../src/engine/workflow/executor.js";
import { parseWorkflowDocument } from "../src/engine/workflow/schema.js";

const noteTool = parseToolName("lab.note");
const runId = parseRunId("nodes");

type LogEvent = {
  readonly type: string;
  readonly nodeId: string;
  readonly reason: string;
  readonly agentId?: string;
  readonly version?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readLog(store: EventStore): LogEvent[] {
  return store.list(runId).map((event) => {
    const body: unknown = jsonValue(event.payloadJson);
    if (!isRecord(body)) throw new Error("event payload is not an object");
    const nodeId = body["nodeId"];
    const reason = body["reason"];
    if (typeof nodeId !== "string" || typeof reason !== "string" || reason.length === 0) {
      throw new Error("event payload is missing node id or reason");
    }
    const agentId = body["agentId"];
    const version = body["version"];
    return {
      type: event.type,
      nodeId,
      reason,
      ...(typeof agentId === "string" ? { agentId } : {}),
      ...(typeof version === "string" ? { version } : {}),
    };
  });
}

function registry(): { tools: ToolRegistry; agents: ReturnType<typeof createAgentRegistry> } {
  const tools = createToolRegistry();
  tools.register(
    {
      name: noteTool,
      effect: "read",
      input: z.strictObject({ text: z.string() }),
      output: z.strictObject({ text: z.string() }),
      transport: { kind: "inproc" },
    },
    (input) => ({ text: input.text }),
  );
  return { tools, agents: createAgentRegistry(tools) };
}

function spec(id: string, score = 0.6): AgentSpec {
  const skill = parseSkillTag("work");
  return {
    id: parseAgentId(id),
    version: parseSemVer("1.0.0"),
    role: id,
    promptTemplateId: `${id}-v1`,
    tools: [],
    memory: "none",
    capabilities: { [skill]: parseUnitInterval(score) },
    model: "mock",
    budget: { maxCallsPerRound: 4, maxTokensPerRound: 32 },
  };
}

function source(agents: ReturnType<typeof createAgentRegistry>, specs: readonly AgentSpec[]): AgentSource {
  const versions = new Map<AgentSpec["id"], AgentSpec["version"]>();
  for (const item of specs) {
    agents.register(item);
    versions.set(item.id, item.version);
  }
  return {
    resolve(id) {
      const version = versions.get(id);
      if (version === undefined) throw new Error(`agent is not registered: ${id}`);
      const found = agents.get(id, version);
      if (found === undefined) throw new Error(`agent is not registered: ${id}@${version}`);
      return found;
    },
    promptHashOf(item) {
      return promptHash(item.promptTemplateId);
    },
  };
}

function timeoutLlm(delayMs: number): LlmClient & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    complete() {
      calls += 1;
      return new Promise((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error("llm timeout"));
        }, delayMs);
      });
    },
  };
}

async function execute(input: {
  readonly document: unknown;
  readonly workflowId: string;
  readonly specs?: readonly AgentSpec[];
  readonly llm?: LlmClient;
  readonly predicates?: readonly [string, Predicate][];
  readonly verifiers?: readonly [string, Verifier][];
  readonly stepDelayMs?: number;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly fallback?: Json;
  readonly toolInputs?: ReadonlyMap<NodeId, unknown>;
  readonly humanGate?: HumanGate;
}): Promise<{ result: WorkflowRun; log: LogEvent[] }> {
  const { tools, agents } = registry();
  const dbDir = mkdtempSync(path.join(tmpdir(), "u4-nodes-"));
  const events = openEventStore(path.join(dbDir, "events.sqlite"));
  const predicates = new Map<PredicateId, Predicate>();
  for (const [id, predicate] of input.predicates ?? []) {
    predicates.set(parsePredicateId(id), predicate);
  }
  const verifiers = new Map<VerifierId, Verifier>();
  for (const [id, verifier] of input.verifiers ?? []) {
    verifiers.set(parseVerifierId(id), verifier);
  }
  try {
    const result = await runWorkflow({
      document: parseWorkflowDocument(input.document),
      workflowId: parseWorkflowId(input.workflowId),
      runId,
      round: 1,
      events,
      agents: source(agents, input.specs ?? []),
      tools,
      llm: input.llm ?? createMockLlm(),
      predicates,
      verifiers,
      fallback: input.fallback ?? { kind: "fallback" },
      timeoutMs: input.timeoutMs ?? 1000,
      maxAttempts: input.maxAttempts ?? 2,
      stepDelayMs: input.stepDelayMs ?? 0,
      ...(input.toolInputs === undefined ? {} : { toolInputs: input.toolInputs }),
      ...(input.humanGate === undefined ? {} : { humanGate: input.humanGate }),
    });
    const log = readLog(events);
    for (const trace of result.traces) {
      const related = log.filter((event) => event.nodeId === trace.nodeId);
      expect(related.some((event) => event.type === "NodeScheduled")).toBe(true);
      expect(related.some((event) => event.type === "NodeStarted")).toBe(true);
      expect(
        related.some((event) => event.type === "NodeFinished" || event.type === "NodeDeadLetter"),
      ).toBe(true);
    }
    return { result, log };
  } finally {
    events.close();
    rmSync(dbDir, { recursive: true, force: true });
  }
}

function overlaps(left: NodeTrace, right: NodeTrace): boolean {
  return left.started < right.finished && right.started < left.finished;
}

test("an agent node starts after its dependency finishes", async () => {
  const { result, log } = await execute({
    workflowId: "main",
    specs: [spec("ada"), spec("bea")],
    document: {
      workflows: [
        {
          id: "main",
          nodes: [
            { kind: "agent", id: "first", agent: "ada", task: "draft" },
            { kind: "agent", id: "second", agent: "bea", task: "reply", dependsOn: ["first"] },
          ],
        },
      ],
    },
  });
  expect(result.status).toBe("completed");
  expect(result.usedFallback).toBe(false);
  const firstDone = log.findIndex((event) => event.type === "NodeFinished" && event.nodeId === "first");
  const secondStart = log.findIndex((event) => event.type === "NodeStarted" && event.nodeId === "second");
  expect(firstDone).toBeGreaterThanOrEqual(0);
  expect(secondStart).toBeGreaterThan(firstDone);
  const started = log.find((event) => event.type === "NodeStarted" && event.nodeId === "first");
  expect(started?.agentId).toBe("ada");
  expect(started?.version).toBe("1.0.0");
});

test("a tool node completes with its registered tool", async () => {
  const { result, log } = await execute({
    workflowId: "main",
    toolInputs: new Map([[parseNodeId("note"), { text: "hello" }]]),
    document: {
      workflows: [
        {
          id: "main",
          nodes: [{ kind: "tool", id: "note", tool: "lab.note" }],
        },
      ],
    },
  });
  expect(result.usedFallback).toBe(false);
  expect(log.some((event) => event.nodeId === "note" && event.reason === "completed")).toBe(true);
});

test("parallel all keeps three agent intervals overlapping", async () => {
  const { result } = await execute({
    workflowId: "main",
    specs: [spec("ada"), spec("bea"), spec("cy")],
    stepDelayMs: 30,
    document: {
      workflows: [
        {
          id: "main",
          nodes: [
            { kind: "agent", id: "proposal-a", agent: "ada", task: "propose" },
            { kind: "agent", id: "proposal-b", agent: "bea", task: "propose" },
            { kind: "agent", id: "proposal-c", agent: "cy", task: "propose" },
            {
              kind: "parallel",
              id: "proposals",
              branches: ["proposal-a", "proposal-b", "proposal-c"],
              join: "all",
            },
          ],
        },
      ],
    },
  });
  const traces = result.traces.filter((trace) => trace.nodeId.startsWith("proposal-"));
  expect(traces).toHaveLength(3);
  const [first, second, third] = traces;
  if (first === undefined || second === undefined || third === undefined) {
    throw new Error("missing parallel traces");
  }
  expect(overlaps(first, second)).toBe(true);
  expect(overlaps(first, third)).toBe(true);
  expect(overlaps(second, third)).toBe(true);
  expect(result.usedFallback).toBe(false);
});

test("parallel any succeeds when one branch passes", async () => {
  const { result, log } = await execute({
    workflowId: "main",
    verifiers: [
      ["lab.pass", () => true],
      ["lab.fail", () => false],
    ],
    document: {
      workflows: [
        {
          id: "main",
          nodes: [
            { kind: "verify", id: "pass-a", pipeline: ["lab.pass"] },
            { kind: "verify", id: "fail-b", pipeline: ["lab.fail"] },
            { kind: "parallel", id: "gate", branches: ["pass-a", "fail-b"], join: "any" },
          ],
        },
      ],
    },
  });
  expect(result.usedFallback).toBe(false);
  expect(log.some((event) => event.nodeId === "gate" && event.reason === "join any satisfied")).toBe(true);
});

test("parallel quorum waits for the required number of successes", async () => {
  const met = await execute({
    workflowId: "main",
    verifiers: [
      ["lab.pass", () => true],
      ["lab.fail", () => false],
    ],
    document: {
      workflows: [
        {
          id: "main",
          nodes: [
            { kind: "verify", id: "pass-a", pipeline: ["lab.pass"] },
            { kind: "verify", id: "pass-b", pipeline: ["lab.pass"] },
            { kind: "verify", id: "fail-c", pipeline: ["lab.fail"] },
            {
              kind: "parallel",
              id: "gate",
              branches: ["pass-a", "pass-b", "fail-c"],
              join: { quorum: 2 },
            },
          ],
        },
      ],
    },
  });
  expect(met.result.usedFallback).toBe(false);
  expect(met.log.some((event) => event.reason === "join quorum 2 satisfied")).toBe(true);

  const missed = await execute({
    workflowId: "main",
    verifiers: [
      ["lab.pass", () => true],
      ["lab.fail", () => false],
    ],
    document: {
      workflows: [
        {
          id: "main",
          nodes: [
            { kind: "verify", id: "pass-a", pipeline: ["lab.pass"] },
            { kind: "verify", id: "fail-b", pipeline: ["lab.fail"] },
            { kind: "verify", id: "fail-c", pipeline: ["lab.fail"] },
            {
              kind: "parallel",
              id: "gate",
              branches: ["pass-a", "fail-b", "fail-c"],
              join: { quorum: 3 },
            },
          ],
        },
      ],
    },
  });
  expect(missed.result.usedFallback).toBe(true);
  expect(missed.result.result).toEqual({ kind: "fallback" });
});

test("a condition runs the predicate branch", async () => {
  const { log, result } = await execute({
    workflowId: "main",
    predicates: [["lane.open", () => true]],
    document: {
      workflows: [
        {
          id: "main",
          nodes: [
            { kind: "commit", id: "taken" },
            { kind: "commit", id: "skipped" },
            {
              kind: "condition",
              id: "choose",
              predicate: "lane.open",
              then: "taken",
              else: "skipped",
            },
          ],
        },
      ],
    },
  });
  expect(result.usedFallback).toBe(false);
  expect(log.some((event) => event.nodeId === "taken" && event.type === "NodeFinished")).toBe(true);
  expect(log.some((event) => event.nodeId === "skipped")).toBe(false);
  expect(log.some((event) => event.nodeId === "choose" && event.reason === "predicate true")).toBe(true);
});

test("a loop stops at maxIterations", async () => {
  let checks = 0;
  const { log } = await execute({
    workflowId: "main",
    predicates: [
      [
        "never.done",
        () => {
          checks += 1;
          return false;
        },
      ],
    ],
    document: {
      workflows: [
        {
          id: "main",
          nodes: [
            { kind: "commit", id: "body" },
            { kind: "loop", id: "again", body: "body", until: "never.done", maxIterations: 3 },
          ],
        },
      ],
    },
  });
  const starts = log.filter((event) => event.type === "NodeStarted" && event.nodeId === "body");
  expect(starts).toHaveLength(3);
  expect(checks).toBe(3);
  expect(log.some((event) => event.nodeId === "again" && event.reason === "maxIterations 3")).toBe(true);
});

test("a loop stops early when its predicate holds", async () => {
  const { log } = await execute({
    workflowId: "main",
    predicates: [["ready.now", (context) => context.iteration >= 2]],
    document: {
      workflows: [
        {
          id: "main",
          nodes: [
            { kind: "commit", id: "body" },
            { kind: "loop", id: "again", body: "body", until: "ready.now", maxIterations: 5 },
          ],
        },
      ],
    },
  });
  const starts = log.filter((event) => event.type === "NodeStarted" && event.nodeId === "body");
  expect(starts).toHaveLength(2);
});

test("a two-level subflow runs the leaf", async () => {
  const { result, log } = await execute({
    workflowId: "root",
    toolInputs: new Map([[parseNodeId("leaf-note"), { text: "leaf" }]]),
    document: {
      workflows: [
        {
          id: "leaf",
          nodes: [{ kind: "tool", id: "leaf-note", tool: "lab.note" }],
        },
        {
          id: "mid",
          nodes: [{ kind: "subflow", id: "mid-sub", workflow: "leaf" }],
        },
        {
          id: "root",
          nodes: [
            { kind: "subflow", id: "root-sub", workflow: "mid" },
            { kind: "commit", id: "root-seal", dependsOn: ["root-sub"] },
          ],
        },
      ],
    },
  });
  expect(result.usedFallback).toBe(false);
  expect(isHash(result.terminalHash)).toBe(true);
  expect(log.some((event) => event.nodeId === "leaf-note" && event.type === "NodeFinished")).toBe(true);
  expect(log.some((event) => event.nodeId === "mid-sub" && event.reason === "subflow completed")).toBe(true);
  expect(log.some((event) => event.nodeId === "root-sub" && event.reason === "subflow completed")).toBe(true);
});

test("a verify node runs its pipeline", async () => {
  const { log, result } = await execute({
    workflowId: "main",
    verifiers: [["lab.pass", () => true]],
    document: {
      workflows: [
        {
          id: "main",
          nodes: [{ kind: "verify", id: "check", pipeline: ["lab.pass"] }],
        },
      ],
    },
  });
  expect(result.usedFallback).toBe(false);
  expect(log.some((event) => event.nodeId === "check" && event.reason === "verifiers passed")).toBe(true);
});

test("a human gate uses its timeout policy", async () => {
  const { result, log } = await execute({
    workflowId: "main",
    document: {
      workflows: [
        {
          id: "main",
          nodes: [{ kind: "humanGate", id: "approve", timeoutMs: 0, onTimeout: "approve" }],
        },
      ],
    },
  });
  expect(result.usedFallback).toBe(false);
  expect(log.some((event) => event.nodeId === "approve" && event.reason === "timeout approve")).toBe(true);
});

test("a commit node finishes the run", async () => {
  const { result } = await execute({
    workflowId: "main",
    document: {
      workflows: [
        {
          id: "main",
          nodes: [{ kind: "commit", id: "seal" }],
        },
      ],
    },
  });
  expect(result.status).toBe("completed");
  expect(result.usedFallback).toBe(false);
  expect(isHash(result.terminalHash)).toBe(true);
  expect(result.result).toBe(result.terminalHash);
});

test("an agent timeout becomes a dead letter and the run finishes with the fallback", async () => {
  const llm = timeoutLlm(80);
  const fallback = { kind: "fallback", note: "safe-default" };
  const { result, log } = await execute({
    workflowId: "main",
    specs: [spec("ada")],
    llm,
    timeoutMs: 15,
    maxAttempts: 2,
    fallback,
    document: {
      workflows: [
        {
          id: "main",
          nodes: [{ kind: "agent", id: "slow", agent: "ada", task: "draft" }],
        },
      ],
    },
  });
  expect(llm.calls).toBe(2);
  expect(log.some((event) => event.type === "NodeDeadLetter" && event.nodeId === "slow")).toBe(true);
  expect(result.status).toBe("completed");
  expect(result.usedFallback).toBe(true);
  expect(result.result).toEqual(fallback);
  expect(result.deadLetters).toEqual(["slow"]);
});
