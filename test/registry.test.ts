import { expect, test } from "vitest";
import { z } from "zod";
import {
  actorStamp,
  AgentToolGradeError,
  createAgentRegistry,
  foldBudget,
  type AgentSpec,
} from "../src/engine/agents/registry.js";
import {
  parseAgentId,
  parsePromptHash,
  parseSemVer,
  parseSkillTag,
  parseToolName,
  parseUnitInterval,
} from "../src/engine/ids.js";
import { createToolRegistry, jsonSchema, type ToolSpec } from "../src/engine/tools/registry.js";

const readTool = parseToolName("market.read_prices");
const sandboxTool = parseToolName("market.sandbox_forecast");
const commitTool = parseToolName("market.commit_order");

function spec(input: {
  id?: string;
  version?: string;
  tools?: ReturnType<typeof parseToolName>[];
  skill?: string;
  score?: number;
  calls?: number;
  tokens?: number;
}): AgentSpec {
  const skill = parseSkillTag(input.skill ?? "pricing");
  return {
    id: parseAgentId(input.id ?? "pricer"),
    version: parseSemVer(input.version ?? "1.0.0"),
    role: "pricer",
    promptTemplateId: "price-v1",
    tools: input.tools ?? [readTool],
    memory: "kb",
    capabilities: { [skill]: parseUnitInterval(input.score ?? 0.8) },
    model: "mock",
    budget: {
      maxCallsPerRound: input.calls ?? 2,
      maxTokensPerRound: input.tokens ?? 40,
    },
  };
}

function registryWithBasics() {
  const tools = createToolRegistry();
  tools.register(
    {
      name: readTool,
      effect: "read",
      input: z.object({ sku: z.string() }),
      output: z.object({ price: z.number().int() }),
      transport: { kind: "inproc" },
    },
    (input) => ({ price: input.sku === "tea" ? 1000 : 500 }),
  );
  tools.register(
    {
      name: sandboxTool,
      effect: "sandbox",
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      transport: { kind: "mcp", server: "simshop" },
    },
    () => ({ ok: true }),
  );
  tools.register(
    {
      name: commitTool,
      effect: "commit",
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      transport: { kind: "inproc" },
    },
    () => ({ ok: true }),
  );
  return { tools, agents: createAgentRegistry(tools) };
}

test("a commit-grade tool fails agent registration", () => {
  const { agents } = registryWithBasics();
  const agent = spec({ tools: [readTool, commitTool] });
  let thrown: unknown;
  try {
    agents.register(agent);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AgentToolGradeError);
  if (!(thrown instanceof AgentToolGradeError)) {
    throw new Error("expected AgentToolGradeError");
  }
  expect(thrown.tool).toBe(commitTool);
  expect(thrown.effect).toBe("commit");
  expect(agents.get(agent.id, agent.version)).toBeUndefined();
});

test("read and sandbox tools can be registered on an agent", () => {
  const { agents } = registryWithBasics();
  const agent = spec({ tools: [readTool, sandboxTool] });
  agents.register(agent);
  expect(agents.get(agent.id, agent.version)?.tools).toEqual([readTool, sandboxTool]);
});

test("two versions of one agent stay registered", () => {
  const { agents } = registryWithBasics();
  const first = spec({ version: "1.0.0" });
  const second = spec({ version: "1.2.0", score: 0.4 });
  agents.register(first);
  agents.register(second);
  expect(agents.get(first.id, first.version)?.version).toBe(parseSemVer("1.0.0"));
  expect(agents.get(second.id, second.version)?.version).toBe(parseSemVer("1.2.0"));
  expect(agents.get(first.id, parseSemVer("9.9.9"))).toBeUndefined();
});

test("discover returns agents whose skill score is at least the minimum", () => {
  const { agents } = registryWithBasics();
  const pricing = parseSkillTag("pricing");
  agents.register(spec({ id: "pricer", version: "1.0.0", score: 0.4 }));
  agents.register(spec({ id: "pricer", version: "1.0.1", score: 0.8 }));
  agents.register(spec({ id: "buyer", version: "1.0.0", score: 0.9 }));
  agents.register(spec({ id: "critic", version: "1.0.0", skill: "review", score: 1 }));
  const found = agents.discover({ skill: pricing, min: 0.5 }).map((item) => `${item.id}@${item.version}`);
  expect(found).toEqual(["buyer@1.0.0", "pricer@1.0.1"]);
  expect(agents.discover({ skill: pricing, min: 0.8 }).map((item) => item.id)).toEqual([
    parseAgentId("buyer"),
    parseAgentId("pricer"),
  ]);
});

test("a prompt version copies tools and budget and changes the actor stamp", () => {
  const { agents } = registryWithBasics();
  const parent = spec({ version: "1.0.0", tools: [readTool, sandboxTool] });
  agents.register(parent);
  const nextHash = parsePromptHash("b".repeat(64));
  const parentHash = parsePromptHash("a".repeat(64));
  const next = agents.registerPromptVersion({
    id: parent.id,
    version: parseSemVer("1.0.1"),
    promptHash: nextHash,
    parentVersion: parent.version,
  });
  expect(agents.get(parent.id, parent.version)?.version).toBe(parent.version);
  expect(next.tools).toEqual(parent.tools);
  expect(next.budget).toEqual(parent.budget);
  expect(next.role).toBe(parent.role);
  expect(next.memory).toBe(parent.memory);
  const parentStamp = actorStamp(parent, parentHash);
  const nextStamp = actorStamp(next, nextHash);
  expect(parentStamp.agent).toBe("pricer@1.0.0");
  expect(nextStamp.agent).toBe("pricer@1.0.1");
  expect(nextStamp.agent).not.toBe(parentStamp.agent);
  expect(nextStamp.promptHash).toBe(nextHash);
  expect(nextStamp.promptHash).not.toBe(parentStamp.promptHash);
  expect(agents.recordedPromptHash(parent.id, next.version)).toBe(nextHash);
});

test("foldBudget sums only the spec version and has no hidden counter", () => {
  const agent = spec({ calls: 1, tokens: 20 });
  const other = spec({ version: "1.0.1" });
  const within = [{ agentId: agent.id, version: agent.version, calls: 1, tokens: 20 }];
  expect(foldBudget(agent, [])).toEqual({ ok: true });
  expect(foldBudget(agent, within)).toEqual({ ok: true });
  expect(foldBudget(agent, within)).toEqual(foldBudget(agent, within));
  expect(
    foldBudget(agent, [{ agentId: agent.id, version: agent.version, calls: 2, tokens: 0 }]),
  ).toEqual({ ok: false, reason: "maxCallsPerRound" });
  expect(
    foldBudget(agent, [
      { agentId: agent.id, version: agent.version, calls: 1, tokens: 0 },
      { agentId: agent.id, version: agent.version, calls: 0, tokens: 21 },
    ]),
  ).toEqual({ ok: false, reason: "maxTokensPerRound" });
  expect(
    foldBudget(agent, [{ agentId: other.id, version: other.version, calls: 9, tokens: 900 }]),
  ).toEqual({ ok: true });
  expect(
    foldBudget(agent, [{ agentId: agent.id, version: agent.version, calls: 2, tokens: 100 }]),
  ).toEqual({ ok: false, reason: "maxCallsPerRound" });
});

test("tool call parses unknown input and jsonSchema comes from the zod object", async () => {
  const { tools } = registryWithBasics();
  const toolSpec: ToolSpec<{ sku: string }, { price: number }> = {
    name: readTool,
    effect: "read",
    input: z.object({ sku: z.string() }),
    output: z.object({ price: z.number().int() }),
    transport: { kind: "inproc" },
  };
  expect(jsonSchema(toolSpec)).toMatchObject({
    type: "object",
    properties: { sku: { type: "string" } },
    required: ["sku"],
  });
  let calls = 0;
  const local = createToolRegistry();
  local.register(toolSpec, (input) => {
    calls += 1;
    return { price: input.sku === "tea" ? 1000 : 1 };
  });
  expect(await local.call(readTool, { sku: "tea" })).toEqual({ price: 1000 });
  await expect(local.call(readTool, { sku: 4 })).rejects.toThrow();
  expect(calls).toBe(1);
  expect(tools.effectOf(commitTool)).toBe("commit");
});

test("id and semver parsers reject malformed boundary values", () => {
  expect(() => parseAgentId("")).toThrow();
  expect(() => parseAgentId("Pricer")).toThrow();
  expect(() => parseToolName("Market")).toThrow();
  expect(() => parseSemVer("01.0.0")).toThrow();
  expect(() => parseSemVer("-1.0.0")).toThrow();
  expect(() => parseSemVer("1.0")).toThrow();
  expect(parseSemVer("1.0.0")).toBe("1.0.0");
  expect(() => parseUnitInterval(1.2)).toThrow();
  expect(() => parseUnitInterval(-0.1)).toThrow();
});
