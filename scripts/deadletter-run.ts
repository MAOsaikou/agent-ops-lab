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
import type { LlmClient } from "../src/engine/llm/client.js";
import { promptHash } from "../src/engine/llm/hash.js";
import { createToolRegistry } from "../src/engine/tools/registry.js";
import { runWorkflow, type AgentSource } from "../src/engine/workflow/executor.js";
import { parseWorkflowDocument } from "../src/engine/workflow/schema.js";

const fallback = { kind: "fallback", note: "safe-default" };

function timeoutLlm(): LlmClient {
  return {
    complete() {
      return new Promise((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error("llm timeout"));
        }, 80);
      });
    },
  };
}

function spec(): AgentSpec {
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
    budget: { maxCallsPerRound: 2, maxTokensPerRound: 32 },
  };
}

function source(item: AgentSpec): AgentSource {
  const registry = createAgentRegistry(createToolRegistry());
  registry.register(item);
  return {
    resolve(id) {
      const found = registry.get(id, item.version);
      if (found === undefined) throw new Error(`agent is not registered: ${id}`);
      return found;
    },
    promptHashOf(agent) {
      return promptHash(agent.promptTemplateId);
    },
  };
}

const agent = spec();
const dbDir = mkdtempSync(path.join(tmpdir(), "u4-dead-"));
const events = openEventStore(path.join(dbDir, "events.sqlite"));
const runId = parseRunId("deadletter");
try {
  const result = await runWorkflow({
    document: parseWorkflowDocument({
      workflows: [
        {
          id: "main",
          nodes: [{ kind: "agent", id: "price", agent: "pricer", task: "quote" }],
        },
      ],
    }),
    workflowId: parseWorkflowId("main"),
    runId,
    round: 1,
    events,
    agents: source(agent),
    tools: createToolRegistry(),
    llm: timeoutLlm(),
    predicates: new Map(),
    verifiers: new Map(),
    fallback,
    timeoutMs: 15,
    maxAttempts: 2,
  });
  for (const event of events.list(runId)) {
    console.log(JSON.stringify({ type: event.type, payload: event.payloadJson }));
  }
  console.log(JSON.stringify({ status: result.status, result: result.result, deadLetters: result.deadLetters }));
  const dead = events.list(runId).some((event) => event.type === "NodeDeadLetter");
  if (!dead || JSON.stringify(result.result) !== JSON.stringify(fallback)) {
    throw new Error("dead letter run did not finish with the fallback");
  }
} finally {
  events.close();
  rmSync(dbDir, { recursive: true, force: true });
}
