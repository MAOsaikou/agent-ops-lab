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
} from "../src/engine/ids.js";
import { promptHash } from "../src/engine/llm/hash.js";
import { recordSelection, select, type AgentCandidate } from "../src/engine/scheduler/select.js";
import { createToolRegistry } from "../src/engine/tools/registry.js";

function baseSpec(): AgentSpec {
  const skill = parseSkillTag("pricing");
  return {
    id: parseAgentId("pricer"),
    version: parseSemVer("1.0.0"),
    role: "pricer",
    promptTemplateId: "price-v1",
    tools: [],
    memory: "none",
    capabilities: { [skill]: parseUnitInterval(0.8) },
    model: "mock",
    budget: { maxCallsPerRound: 2, maxTokensPerRound: 40 },
  };
}

function candidate(spec: AgentSpec, hash: ReturnType<typeof promptHash>): AgentCandidate {
  return {
    spec,
    promptHash: hash,
    remainingCalls: 1,
    ready: true,
  };
}

const tools = createToolRegistry();
const registry = createAgentRegistry(tools);
const first = baseSpec();
registry.register(first);
const hash1 = promptHash(first.promptTemplateId);
const dbDir = mkdtempSync(path.join(tmpdir(), "u4-hot-"));
const events = openEventStore(path.join(dbDir, "events.sqlite"));
const runId = parseRunId("hot");
try {
  const opening = select({
    observation: { round: 1, signals: ["calm"] },
    agents: [candidate(first, hash1)],
    subflows: [],
    callBudget: 1,
    planner: "off",
    requiredSkill: parseSkillTag("pricing"),
    minScore: 0,
  });
  recordSelection(events, runId, 1, opening);
  const hash2 = promptHash("price-v1-patched");
  const second = registry.registerPromptVersion({
    id: first.id,
    version: parseSemVer("1.0.1"),
    parentVersion: first.version,
    promptHash: hash2,
  });
  const closing = select({
    observation: { round: 2, signals: ["calm"] },
    agents: [candidate(first, hash1), candidate(second, registry.recordedPromptHash(second.id, second.version))],
    subflows: [],
    callBudget: 1,
    planner: "off",
    requiredSkill: parseSkillTag("pricing"),
    minScore: 0,
  });
  recordSelection(events, runId, 2, closing);
  for (const event of events.list(runId)) {
    console.log(event.payloadJson);
  }
  const stored = events.list(runId);
  const last = stored[stored.length - 1];
  if (last === undefined || !last.payloadJson.includes("pricer@1.0.1") || !last.payloadJson.includes(hash2)) {
    throw new Error("second selection did not name pricer@1.0.1");
  }
  if (hash1 === hash2 || !stored[0]?.payloadJson.includes(hash1)) {
    throw new Error("prompt hash did not change");
  }
} finally {
  events.close();
  rmSync(dbDir, { recursive: true, force: true });
}
