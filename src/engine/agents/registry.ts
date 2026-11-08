import type { AgentId, PromptHash, SemVer, SkillTag, ToolName, UnitInterval } from "../ids.js";
import { isSkillTag, isUnitInterval } from "../ids.js";
import type { ToolEffect, ToolRegistry } from "../tools/registry.js";

export type AgentBudget = {
  readonly maxCallsPerRound: number;
  readonly maxTokensPerRound: number;
};

export type AgentMemory = "none" | "window" | "kb";

export type AgentSpec = {
  readonly id: AgentId;
  readonly version: SemVer;
  readonly role: string;
  readonly promptTemplateId: string;
  readonly tools: readonly ToolName[];
  readonly memory: AgentMemory;
  readonly capabilities: Readonly<Record<string, UnitInterval>>;
  readonly model: string;
  readonly budget: AgentBudget;
};

export type BudgetUse = {
  readonly agentId: AgentId;
  readonly version: SemVer;
  readonly calls: number;
  readonly tokens: number;
};

export type BudgetVerdict =
  | { ok: true }
  | { ok: false; reason: "maxCallsPerRound" | "maxTokensPerRound" };

export type ActorStamp = {
  readonly agent: string;
  readonly promptHash: PromptHash;
};

export class AgentToolGradeError extends Error {
  readonly tool: ToolName;
  readonly effect: "commit";

  constructor(tool: ToolName) {
    super(`agent cannot register commit tool ${tool}`);
    this.name = "AgentToolGradeError";
    this.tool = tool;
    this.effect = "commit";
  }
}

type StoredAgent = {
  spec: AgentSpec;
  promptHash?: PromptHash;
};

export type AgentRegistry = {
  register(spec: AgentSpec): void;
  get(id: AgentId, version: SemVer): AgentSpec | undefined;
  discover(query: { skill: SkillTag; min: number }): AgentSpec[];
  registerPromptVersion(input: {
    id: AgentId;
    version: SemVer;
    promptHash: PromptHash;
    parentVersion: SemVer;
  }): AgentSpec;
  recordedPromptHash(id: AgentId, version: SemVer): PromptHash;
};

function agentKey(id: AgentId, version: SemVer): string {
  return `${id}@${version}`;
}

function assertText(label: string, value: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertBudget(budget: AgentBudget): void {
  if (!Number.isInteger(budget.maxCallsPerRound) || budget.maxCallsPerRound < 0) {
    throw new Error("maxCallsPerRound must be a non-negative integer");
  }
  if (!Number.isInteger(budget.maxTokensPerRound) || budget.maxTokensPerRound < 0) {
    throw new Error("maxTokensPerRound must be a non-negative integer");
  }
}

function copyCapabilities(
  capabilities: Readonly<Record<string, UnitInterval>>,
): Readonly<Record<string, UnitInterval>> {
  const copy: Record<string, UnitInterval> = {};
  for (const [key, value] of Object.entries(capabilities)) {
    if (value === undefined || !isSkillTag(key) || !isUnitInterval(value)) {
      throw new Error(`capability ${key} failed its guard`);
    }
    copy[key] = value;
  }
  return Object.freeze(copy);
}

function freezeSpec(spec: AgentSpec): AgentSpec {
  assertText("role", spec.role);
  assertText("promptTemplateId", spec.promptTemplateId);
  assertText("model", spec.model);
  assertBudget(spec.budget);
  return Object.freeze({
    id: spec.id,
    version: spec.version,
    role: spec.role,
    promptTemplateId: spec.promptTemplateId,
    tools: Object.freeze([...spec.tools]),
    memory: spec.memory,
    capabilities: copyCapabilities(spec.capabilities),
    model: spec.model,
    budget: Object.freeze({
      maxCallsPerRound: spec.budget.maxCallsPerRound,
      maxTokensPerRound: spec.budget.maxTokensPerRound,
    }),
  });
}

function compareSemVer(left: SemVer, right: SemVer): number {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  for (let index = 0; index < 3; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined || rightPart === undefined) {
      throw new Error("semver shape");
    }
    const delta = Number(leftPart) - Number(rightPart);
    if (delta !== 0) return delta;
  }
  return 0;
}

function assertToolsAllowed(spec: AgentSpec, tools: ToolRegistry): void {
  for (const name of spec.tools) {
    const effect = tools.effectOf(name);
    if (effect === undefined) {
      throw new Error(`tool is not registered: ${name}`);
    }
    rejectCommitTool(name, effect);
  }
}

function rejectCommitTool(name: ToolName, effect: ToolEffect): void {
  switch (effect) {
    case "read":
    case "sandbox":
      return;
    case "commit":
      throw new AgentToolGradeError(name);
    default: {
      const _exhaustive: never = effect;
      throw new Error(`unknown tool effect ${String(_exhaustive)}`);
    }
  }
}

export function foldBudget(spec: AgentSpec, events: readonly BudgetUse[]): BudgetVerdict {
  let calls = 0;
  let tokens = 0;
  for (const event of events) {
    if (event.agentId !== spec.id || event.version !== spec.version) continue;
    calls += event.calls;
    tokens += event.tokens;
  }
  if (calls > spec.budget.maxCallsPerRound) {
    return { ok: false, reason: "maxCallsPerRound" };
  }
  if (tokens > spec.budget.maxTokensPerRound) {
    return { ok: false, reason: "maxTokensPerRound" };
  }
  return { ok: true };
}

export function actorStamp(spec: AgentSpec, promptHash: PromptHash): ActorStamp {
  return {
    agent: `${spec.id}@${spec.version}`,
    promptHash,
  };
}

export function createAgentRegistry(tools: ToolRegistry): AgentRegistry {
  const agents = new Map<string, StoredAgent>();

  function requireStored(id: AgentId, version: SemVer): StoredAgent {
    const stored = agents.get(agentKey(id, version));
    if (stored === undefined) {
      throw new Error(`agent version is not registered: ${id}@${version}`);
    }
    return stored;
  }

  return {
    register(spec) {
      const key = agentKey(spec.id, spec.version);
      if (agents.has(key)) {
        throw new Error(`agent version already registered: ${key}`);
      }
      assertToolsAllowed(spec, tools);
      agents.set(key, { spec: freezeSpec(spec) });
    },

    get(id, version) {
      return agents.get(agentKey(id, version))?.spec;
    },

    discover(query) {
      const found: AgentSpec[] = [];
      for (const stored of agents.values()) {
        const score = stored.spec.capabilities[query.skill];
        if (score !== undefined && score >= query.min) found.push(stored.spec);
      }
      found.sort((left, right) => {
        if (left.id < right.id) return -1;
        if (left.id > right.id) return 1;
        return compareSemVer(left.version, right.version);
      });
      return found;
    },

    registerPromptVersion(input) {
      const parent = requireStored(input.id, input.parentVersion);
      const key = agentKey(input.id, input.version);
      if (agents.has(key)) {
        throw new Error(`agent version already registered: ${key}`);
      }
      const spec = freezeSpec({
        id: parent.spec.id,
        version: input.version,
        role: parent.spec.role,
        promptTemplateId: parent.spec.promptTemplateId,
        tools: parent.spec.tools,
        memory: parent.spec.memory,
        capabilities: parent.spec.capabilities,
        model: parent.spec.model,
        budget: parent.spec.budget,
      });
      assertToolsAllowed(spec, tools);
      agents.set(key, { spec, promptHash: input.promptHash });
      return spec;
    },

    recordedPromptHash(id, version) {
      const stored = requireStored(id, version);
      if (stored.promptHash === undefined) {
        throw new Error(`prompt hash is not recorded: ${id}@${version}`);
      }
      return stored.promptHash;
    },
  };
}
