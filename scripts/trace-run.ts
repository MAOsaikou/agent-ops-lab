import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createAgentRegistry, type AgentSpec } from "../src/engine/agents/registry.js";
import { openEventStore } from "../src/engine/events/store.js";
import {
  parseAgentId,
  parseRunId,
  parseSemVer,
  parseSkillTag,
  parseUnitInterval,
  parseWorkflowId,
} from "../src/engine/ids.js";
import { promptHash } from "../src/engine/llm/hash.js";
import { createMockLlm } from "../src/engine/llm/mock.js";
import { recordSelection, select, type AgentCandidate } from "../src/engine/scheduler/select.js";
import { createToolRegistry } from "../src/engine/tools/registry.js";
import { runWorkflow, type AgentSource, type NodeTrace } from "../src/engine/workflow/executor.js";
import { parseWorkflowDocument } from "../src/engine/workflow/schema.js";

const STEP_DELAY_MS = 25;

function parsePlanner(argv: readonly string[]): "on" | "off" {
  const index = argv.indexOf("--planner");
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (value === "on" || value === "off") return value;
  throw new Error("usage: tsx scripts/trace-run.ts --planner on|off");
}

function spec(id: string): AgentSpec {
  const skill = parseSkillTag("propose");
  return {
    id: parseAgentId(id),
    version: parseSemVer("1.0.0"),
    role: id,
    promptTemplateId: `${id}-v1`,
    tools: [],
    memory: "none",
    capabilities: { [skill]: parseUnitInterval(0.7) },
    model: "mock",
    budget: { maxCallsPerRound: 2, maxTokensPerRound: 32 },
  };
}

function source(specs: readonly AgentSpec[]): AgentSource {
  const registry = createAgentRegistry(createToolRegistry());
  const versions = new Map<AgentSpec["id"], AgentSpec["version"]>();
  for (const item of specs) {
    registry.register(item);
    versions.set(item.id, item.version);
  }
  return {
    resolve(id) {
      const version = versions.get(id);
      if (version === undefined) throw new Error(`agent is not registered: ${id}`);
      const found = registry.get(id, version);
      if (found === undefined) throw new Error(`agent is not registered: ${id}@${version}`);
      return found;
    },
    promptHashOf(item) {
      return promptHash(item.promptTemplateId);
    },
  };
}

function candidate(item: AgentSpec): AgentCandidate {
  return {
    spec: item,
    promptHash: promptHash(item.promptTemplateId),
    remainingCalls: 2,
    ready: true,
  };
}

function overlaps(left: NodeTrace, right: NodeTrace): boolean {
  return left.started < right.finished && right.started < left.finished;
}

const plannerFlag = parsePlanner(process.argv.slice(2));
const specs = [spec("ada"), spec("bea"), spec("cy")];
const agents = specs.map(candidate);
const selection = select({
  observation: { round: 1, signals: ["calm"] },
  agents,
  subflows: [],
  callBudget: 3,
  planner:
    plannerFlag === "off"
      ? "off"
      : () => ({
          agents: specs.map((item) => item.id),
          subflows: [],
        }),
  requiredSkill: parseSkillTag("propose"),
  minScore: 0,
});
if (selection.activatedAgents.length !== 3) {
  throw new Error(`expected 3 agents, got ${String(selection.activatedAgents.length)}`);
}

const document = parseWorkflowDocument({
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
});

const dbDir = mkdtempSync(path.join(tmpdir(), "u4-trace-"));
const events = openEventStore(path.join(dbDir, "events.sqlite"));
try {
  recordSelection(events, parseRunId("trace"), 1, selection);
  const result = await runWorkflow({
    document,
    workflowId: parseWorkflowId("main"),
    runId: parseRunId("trace-run"),
    round: 1,
    events,
    agents: source(specs),
    tools: createToolRegistry(),
    llm: createMockLlm(),
    predicates: new Map(),
    verifiers: new Map(),
    fallback: { kind: "fallback" },
    timeoutMs: 1000,
    maxAttempts: 1,
    stepDelayMs: STEP_DELAY_MS,
  });
  const proposals = result.traces.filter((trace) => trace.nodeId.startsWith("proposal-"));
  for (const trace of result.traces) {
    console.log(
      JSON.stringify({
        nodeId: trace.nodeId,
        queued: trace.queued,
        started: trace.started,
        finished: trace.finished,
      }),
    );
  }
  const [first, second, third] = proposals;
  if (
    proposals.length !== 3 ||
    first === undefined ||
    second === undefined ||
    third === undefined ||
    !overlaps(first, second) ||
    !overlaps(first, third) ||
    !overlaps(second, third)
  ) {
    throw new Error("parallel intervals do not overlap");
  }
} finally {
  events.close();
  rmSync(dbDir, { recursive: true, force: true });
}
