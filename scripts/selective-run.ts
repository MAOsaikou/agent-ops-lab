import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentSpec } from "../src/engine/agents/registry.js";
import { openEventStore } from "../src/engine/events/store.js";
import { jsonValue, type Json } from "../src/engine/json.js";
import {
  parseAgentId,
  parseRunId,
  parseSemVer,
  parseSkillTag,
  parseUnitInterval,
  type AgentId,
} from "../src/engine/ids.js";
import { promptHash } from "../src/engine/llm/hash.js";
import { recordSelection, select, type AgentCandidate, type ScheduleObservation } from "../src/engine/scheduler/select.js";

function isRecord(value: unknown): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function spec(id: string, skill: string, score: number): AgentSpec {
  const tag = parseSkillTag(skill);
  return {
    id: parseAgentId(id),
    version: parseSemVer("1.0.0"),
    role: id,
    promptTemplateId: `${id}-v1`,
    tools: [],
    memory: "none",
    capabilities: { [tag]: parseUnitInterval(score) },
    model: "mock",
    budget: { maxCallsPerRound: 2, maxTokensPerRound: 40 },
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

const specs = [
  spec("pricer", "pricing", 0.9),
  spec("buyer", "procurement", 0.8),
  spec("negotiator", "negotiation", 0.7),
];
const agents = specs.map(candidate);

function planner(observation: ScheduleObservation): { agents: AgentId[]; subflows: string[] } {
  if (observation.signals.includes("supply-cut")) {
    return {
      agents: [parseAgentId("buyer"), parseAgentId("negotiator")],
      subflows: ["supply-negotiation"],
    };
  }
  return { agents: [parseAgentId("pricer")], subflows: [] };
}

const rounds = [
  { round: 1, signals: ["calm"] },
  { round: 2, signals: ["supply-cut"] },
];

const dbDir = mkdtempSync(path.join(tmpdir(), "u4-select-"));
const events = openEventStore(path.join(dbDir, "events.sqlite"));
const runId = parseRunId("selective");
try {
  const activated: string[][] = [];
  for (const observation of rounds) {
    const selection = select({
      observation,
      agents,
      subflows: [
        { id: "supply-negotiation", ready: true },
        { id: "price-war", ready: true },
      ],
      callBudget: 4,
      planner,
      requiredSkill: null,
      minScore: 0,
    });
    recordSelection(events, runId, observation.round, selection);
    activated.push(selection.activatedAgents.map((id) => id));
  }
  for (const event of events.list(runId)) {
    const body = jsonValue(event.payloadJson);
    if (!isRecord(body) || typeof body["reason"] !== "string") {
      throw new Error("NodeScheduled payload is missing a reason");
    }
    console.log(
      JSON.stringify({
        type: event.type,
        nodeId: body["nodeId"],
        reason: body["reason"],
        agent: body["agent"] ?? null,
      }),
    );
  }
  console.log(JSON.stringify({ calm: activated[0], supplyCut: activated[1] }));
  const calm = activated[0];
  const supplyCut = activated[1];
  if (calm === undefined || supplyCut === undefined) throw new Error("missing rounds");
  if (calm.join(",") === supplyCut.join(",")) throw new Error("activated agent sets match");
} finally {
  events.close();
  rmSync(dbDir, { recursive: true, force: true });
}
