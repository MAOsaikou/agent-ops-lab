import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

import { createAgentRegistry, type AgentSpec } from "../src/engine/agents/registry.js";
import { openEventStore } from "../src/engine/events/store.js";
import {
  parseAgentId,
  parseRunId,
  parseSemVer,
  parseSkillTag,
  parseUnitInterval,
  type PromptHash,
} from "../src/engine/ids.js";
import { jsonValue } from "../src/engine/json.js";
import { promptHash } from "../src/engine/llm/hash.js";
import { createToolRegistry } from "../src/engine/tools/registry.js";
import {
  recordSelection,
  select,
  type AgentCandidate,
  type Planner,
  type ScheduleObservation,
  type SelectInput,
} from "../src/engine/scheduler/select.js";

const pricing = parseSkillTag("pricing");
const observation: ScheduleObservation = { round: 1, signals: ["calm"] };

function tempDb(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "u4-schedule-")), "events.sqlite");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function candidate(input: {
  id: string;
  version?: string;
  score: number;
  skill?: string;
  remainingCalls?: number;
  ready?: boolean;
  prompt?: string;
}): AgentCandidate {
  const skill = parseSkillTag(input.skill ?? "pricing");
  const version = parseSemVer(input.version ?? "1.0.0");
  const spec: AgentSpec = {
    id: parseAgentId(input.id),
    version,
    role: input.id,
    promptTemplateId: `${input.id}-v1`,
    tools: [],
    memory: "none",
    capabilities: { [skill]: parseUnitInterval(input.score) },
    model: "mock",
    budget: { maxCallsPerRound: 2, maxTokensPerRound: 40 },
  };
  return {
    spec,
    promptHash: promptHash(input.prompt ?? `${input.id}@${version}`),
    remainingCalls: input.remainingCalls ?? 2,
    ready: input.ready ?? true,
  };
}

function input(patch: Partial<SelectInput> & Pick<SelectInput, "agents" | "planner">): SelectInput {
  return {
    observation,
    subflows: [],
    callBudget: 4,
    requiredSkill: null,
    minScore: 0,
    ...patch,
  };
}

test("the same input selects the same agents", () => {
  const agents = [candidate({ id: "pricer", score: 0.9 }), candidate({ id: "buyer", score: 0.4 })];
  const request = input({ agents, planner: "off" });
  expect(select(request)).toEqual(select(request));
});

test("a zero call budget skips the low-score agent and records the reason", () => {
  const high = candidate({ id: "pricer", score: 0.9 });
  const low = candidate({ id: "buyer", score: 0.2 });
  const result = select(
    input({
      agents: [high, low],
      callBudget: 0,
      requiredSkill: pricing,
      planner: () => ({ agents: [high.spec.id, low.spec.id], subflows: [] }),
    }),
  );
  const lowDecision = result.decisions.find((decision) => decision.nodeId === low.spec.id);
  if (lowDecision === undefined) throw new Error("missing low-score decision");
  expect(lowDecision.accepted).toBe(false);
  expect(lowDecision.score).toBe(0.2);
  expect(lowDecision.reason).toContain("remaining call budget is 0");
  expect(result.activatedAgents.includes(low.spec.id)).toBe(false);
});

test("a tight budget keeps the higher score", () => {
  const high = candidate({ id: "pricer", score: 0.9 });
  const low = candidate({ id: "buyer", score: 0.2 });
  const result = select(
    input({
      agents: [low, high],
      callBudget: 1,
      requiredSkill: pricing,
      planner: () => ({ agents: [low.spec.id, high.spec.id], subflows: [] }),
    }),
  );
  expect(result.activatedAgents).toEqual([high.spec.id]);
  const lowDecision = result.decisions.find((decision) => decision.nodeId === low.spec.id);
  expect(lowDecision?.reason).toContain("remaining call budget is 0");
});

test("planner off and planner on differ when the planner returns a subset", () => {
  const pricer = candidate({ id: "pricer", score: 0.9 });
  const buyer = candidate({ id: "buyer", score: 0.4, skill: "procurement" });
  const agents = [pricer, buyer];
  const planner: Planner = () => {
    throw new Error("planner ran");
  };
  const off = select(input({ agents, planner: "off" }));
  const on = select(
    input({
      agents,
      planner: () => ({ agents: [pricer.spec.id], subflows: [] }),
    }),
  );
  expect(off.activatedAgents).toEqual([pricer.spec.id, buyer.spec.id]);
  expect(on.activatedAgents).toEqual([pricer.spec.id]);
  expect(() => select(input({ agents, planner }))).toThrow(/planner ran/);
});

test("planner off keeps registration order", () => {
  const buyer = candidate({ id: "buyer", score: 0.2, skill: "procurement" });
  const pricer = candidate({ id: "pricer", score: 0.9 });
  const result = select(input({ agents: [buyer, pricer], planner: "off" }));
  expect(result.activatedAgents).toEqual([buyer.spec.id, pricer.spec.id]);
});

test("the rule layer does not add a subflow the planner left out", () => {
  const pricer = candidate({ id: "pricer", score: 0.9 });
  const result = select(
    input({
      agents: [pricer],
      subflows: [
        { id: "supply-negotiation", ready: true },
        { id: "price-war", ready: true },
      ],
      planner: () => ({ agents: [pricer.spec.id], subflows: ["price-war"] }),
    }),
  );
  expect(result.activatedSubflows).toEqual(["price-war"]);
  expect(result.activatedSubflows.includes("supply-negotiation")).toBe(false);
  expect(result.decisions.some((decision) => decision.nodeId === "supply-negotiation")).toBe(false);
});

test("a pick that is not ready is rejected", () => {
  const pricer = candidate({ id: "pricer", score: 0.9, ready: false });
  const result = select(
    input({
      agents: [pricer],
      planner: () => ({ agents: [pricer.spec.id], subflows: ["supply-negotiation"] }),
      subflows: [{ id: "supply-negotiation", ready: false }],
    }),
  );
  expect(result.activatedAgents).toEqual([]);
  expect(result.activatedSubflows).toEqual([]);
  expect(result.decisions.every((decision) => decision.reason.includes("dependencies are not ready"))).toBe(
    true,
  );
});

test("the next selection names the newly registered prompt version", () => {
  const tools = createToolRegistry();
  const registry = createAgentRegistry(tools);
  const first = candidate({ id: "pricer", version: "1.0.0", score: 0.8, prompt: "price-v1" });
  registry.register(first.spec);
  const hash1: PromptHash = first.promptHash;
  const dbPath = tempDb();
  const events = openEventStore(dbPath);
  const runId = parseRunId("hot");
  try {
    const firstSelection = select(
      input({
        agents: [first],
        callBudget: 1,
        requiredSkill: pricing,
        planner: "off",
        observation: { round: 1, signals: ["calm"] },
      }),
    );
    recordSelection(events, runId, 1, firstSelection);
    const hash2 = promptHash("price-v1-patched");
    const secondSpec = registry.registerPromptVersion({
      id: first.spec.id,
      version: parseSemVer("1.0.1"),
      parentVersion: first.spec.version,
      promptHash: hash2,
    });
    expect(registry.recordedPromptHash(secondSpec.id, secondSpec.version)).toBe(hash2);
    const second = {
      spec: secondSpec,
      promptHash: registry.recordedPromptHash(secondSpec.id, secondSpec.version),
      remainingCalls: 1,
      ready: true,
    } satisfies AgentCandidate;
    const secondSelection = select(
      input({
        agents: [first, second],
        callBudget: 1,
        requiredSkill: pricing,
        planner: "off",
        observation: { round: 2, signals: ["calm"] },
      }),
    );
    recordSelection(events, runId, 2, secondSelection);
    expect(secondSelection.decisions[0]?.version).toBe("1.0.1");
    expect(secondSelection.decisions[0]?.promptHash).toBe(hash2);
    expect(hash1).not.toBe(hash2);
    const stored = events.list(runId);
    const opening = stored[0];
    const closing = stored[stored.length - 1];
    if (opening === undefined || closing === undefined) throw new Error("missing schedule events");
    expect(opening.payloadJson).toContain("pricer@1.0.0");
    expect(opening.payloadJson).toContain(hash1);
    expect(closing.type).toBe("NodeScheduled");
    expect(closing.payloadJson).toContain("pricer@1.0.1");
    expect(closing.payloadJson).toContain(hash2);
    expect(closing.payloadJson).not.toContain(hash1);
  } finally {
    events.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  }
});

test("recordSelection stores a reason on every NodeScheduled event", () => {
  const pricer = candidate({ id: "pricer", score: 0.4, remainingCalls: 0 });
  const dbPath = tempDb();
  const events = openEventStore(dbPath);
  const runId = parseRunId("reasons");
  try {
    const selection = select(input({ agents: [pricer], planner: "off", callBudget: 2 }));
    recordSelection(events, runId, 1, selection);
    const stored = events.list(runId);
    expect(stored.length).toBeGreaterThan(0);
    for (const event of stored) {
      expect(event.type).toBe("NodeScheduled");
      const body = jsonValue(event.payloadJson);
      if (!isRecord(body)) throw new Error("missing reason");
      const reason = body["reason"];
      expect(typeof reason).toBe("string");
      if (typeof reason !== "string" || reason.length === 0) throw new Error("missing reason");
    }
  } finally {
    events.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  }
});
