import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createAgentRegistry, type AgentSpec } from "../../engine/agents/registry.js";
import { NODE_FINISHED } from "../../engine/events/node.js";
import { openEventStore } from "../../engine/events/store.js";
import {
  parseAgentId,
  parseNodeId,
  parseRunId,
  parseSemVer,
  parseSkillTag,
  parseTaskTemplateId,
  parseUnitInterval,
  parseVerifierId,
  parseWorkflowId,
} from "../../engine/ids.js";
import { jsonValue, type Json } from "../../engine/json.js";
import { promptHash } from "../../engine/llm/hash.js";
import { createMockLlm } from "../../engine/llm/mock.js";
import { createToolRegistry } from "../../engine/tools/registry.js";
import type { Hash } from "../../engine/types.js";
import {
  runWorkflow,
  type AgentSource,
  type StepContext,
} from "../../engine/workflow/executor.js";
import { parseWorkflowDocument, type WorkflowDocument } from "../../engine/workflow/schema.js";

export const meetingWorkflowId = parseWorkflowId("meeting");
export const chairAgentId = parseAgentId("chair");
export const scribeAgentId = parseAgentId("scribe");
export const chairNodeId = parseNodeId("chair-open");
export const scribeNodeId = parseNodeId("scribe-record");
export const constraintNodeId = parseNodeId("hard-constraint");
export const sealNodeId = parseNodeId("seal");
export const bothSpoke = parseVerifierId("meeting.both-spoke");

export type MeetingFinish = {
  readonly nodeId: string;
  readonly reason: string;
};

export type MeetingRun = {
  readonly terminalHash: Hash;
  readonly usedFallback: boolean;
  readonly finished: readonly MeetingFinish[];
};

export function meetingConstraint(context: StepContext): boolean {
  const chair = context.output(chairNodeId);
  const scribe = context.output(scribeNodeId);
  return (
    typeof chair === "string" &&
    chair.length > 0 &&
    typeof scribe === "string" &&
    scribe.length > 0
  );
}

export function meetingDocument(): WorkflowDocument {
  return parseWorkflowDocument({
    workflows: [
      {
        id: meetingWorkflowId,
        nodes: [
          {
            kind: "agent",
            id: chairNodeId,
            agent: chairAgentId,
            task: parseTaskTemplateId("open"),
          },
          {
            kind: "agent",
            id: scribeNodeId,
            agent: scribeAgentId,
            task: parseTaskTemplateId("record"),
            dependsOn: [chairNodeId],
          },
          {
            kind: "verify",
            id: constraintNodeId,
            pipeline: [bothSpoke],
            dependsOn: [scribeNodeId],
          },
          {
            kind: "commit",
            id: sealNodeId,
            dependsOn: [constraintNodeId],
          },
        ],
      },
    ],
  });
}

function agentSpec(id: "chair" | "scribe", skill: "facilitate" | "record"): AgentSpec {
  const tag = parseSkillTag(skill);
  return {
    id: parseAgentId(id),
    version: parseSemVer("1.0.0"),
    role: id,
    promptTemplateId: `${id}-v1`,
    tools: [],
    memory: "none",
    capabilities: { [tag]: parseUnitInterval(0.8) },
    model: "mock",
    budget: { maxCallsPerRound: 2, maxTokensPerRound: 40 },
  };
}

function agentSource(specs: readonly AgentSpec[]): AgentSource {
  const registry = createAgentRegistry(createToolRegistry());
  const versions = new Map<AgentSpec["id"], AgentSpec["version"]>();
  for (const spec of specs) {
    registry.register(spec);
    versions.set(spec.id, spec.version);
  }
  return {
    resolve(id) {
      const version = versions.get(id);
      if (version === undefined) throw new Error(`agent is not registered: ${id}`);
      const spec = registry.get(id, version);
      if (spec === undefined) throw new Error(`agent is not registered: ${id}@${version}`);
      return spec;
    },
    promptHashOf(spec) {
      return promptHash(`${spec.promptTemplateId}@${spec.version}`);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFinish(payloadJson: string): MeetingFinish {
  const body: unknown = jsonValue(payloadJson);
  if (!isRecord(body)) throw new Error("meeting event payload is not an object");
  const nodeId = body["nodeId"];
  const reason = body["reason"];
  if (typeof nodeId !== "string" || typeof reason !== "string") {
    throw new Error("meeting event payload is missing node id or reason");
  }
  return { nodeId, reason };
}

function temporaryDb(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "u4-meeting-")), "events.sqlite");
}

export async function runMeeting(): Promise<MeetingRun> {
  const specs = [agentSpec("chair", "facilitate"), agentSpec("scribe", "record")];
  const dbPath = temporaryDb();
  const events = openEventStore(dbPath);
  const runId = parseRunId("meeting");
  try {
    const result = await runWorkflow({
      document: meetingDocument(),
      workflowId: meetingWorkflowId,
      runId,
      round: 1,
      events,
      agents: agentSource(specs),
      tools: createToolRegistry(),
      llm: createMockLlm(),
      predicates: new Map(),
      verifiers: new Map([[bothSpoke, meetingConstraint]]),
      fallback: { kind: "fallback" } satisfies Json,
      timeoutMs: 1000,
      maxAttempts: 2,
    });
    const finished = events
      .list(runId)
      .filter((event) => event.type === NODE_FINISHED)
      .map((event) => readFinish(event.payloadJson));
    return {
      terminalHash: result.terminalHash,
      usedFallback: result.usedFallback,
      finished,
    };
  } finally {
    events.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  }
}
