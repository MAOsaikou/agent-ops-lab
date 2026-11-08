import { z } from "zod";

import { createAgentRegistry, type AgentRegistry, type AgentSpec } from "../../engine/agents/registry.js";
import type { ToolRegistry } from "../../engine/tools/registry.js";
import {
  isAgentId,
  parseAgentId,
  parseSemVer,
  parseSkillTag,
  parseToolName,
  parseUnitInterval,
  type AgentId,
  type PromptHash,
} from "../../engine/ids.js";
import { canonicalJson, jsonValue } from "../../engine/json.js";
import type { LlmClient, LlmRequest } from "../../engine/llm/client.js";
import { promptHash } from "../../engine/llm/hash.js";
import { PRIMARY_CANNOT_DELIVER } from "./market/project.js";
import type { ShelfSupplier, ShopDecision } from "./constraints.js";

export const SHOP_ROLES = ["buyer", "pricer", "marketer", "critic", "reflect"] as const;
export type ShopRole = (typeof SHOP_ROLES)[number];
export const PRICER_ID = parseAgentId("pricer");
export const PRICER_V1 = parseSemVer("1.0.0");
export const PRICER_PATCH = parseSemVer("1.0.1");
export const FORECAST_TOOL = parseToolName("shop.forecast");

export type ShopProfile = "steady" | "stressed";

export type ShopMockContext = {
  readonly profile: ShopProfile;
  readonly round: number;
  readonly news: string;
  readonly cash: number;
  readonly unitCost: {
    readonly primary: { readonly tea: number; readonly snack: number };
    readonly backup: { readonly tea: number; readonly snack: number };
  };
  readonly capacity: { readonly primary: number; readonly backup: number };
  readonly demand: { readonly tea: number; readonly snack: number };
};

export type ShopMock = LlmClient & {
  readonly mode: "mock";
  readonly calls: readonly LlmRequest[];
  textAt(index: number): string;
  setContext(context: ShopMockContext): void;
};

const plannerSchema = z.strictObject({
  agents: z.array(z.string()),
  subflows: z.array(z.string()),
});

const criticSchema = z.strictObject({
  confidence: z.number(),
  objections: z.array(z.strictObject({ claim: z.string(), evidence: z.string() })),
});

const talkSchema = z.strictObject({ talk: z.string() });
const reflectSchema = z.strictObject({ note: z.string(), patch: z.string() });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readPrompt(prompt: string): { role: string; iteration: number; news: string } {
  const value = jsonValue(prompt);
  if (!isRecord(value)) throw new Error("prompt is not json");
  const role = value["role"];
  if (typeof role !== "string") throw new Error("prompt role is missing");
  const iteration = value["iteration"];
  const news = value["news"];
  return {
    role,
    iteration: typeof iteration === "number" && Number.isInteger(iteration) ? iteration : 1,
    news: typeof news === "string" ? news : "",
  };
}

function steadyDecision(ctx: ShopMockContext): ShopDecision {
  const supplier: ShelfSupplier = ctx.news.includes(PRIMARY_CANNOT_DELIVER) ? "backup" : "primary";
  let left = ctx.capacity[supplier];
  const order = (sku: "tea" | "snack") => {
    const qty = Math.min(left, 10, Math.max(0, ctx.demand[sku]));
    left -= qty;
    return { price: ctx.unitCost[supplier][sku] + 100, qty, supplier };
  };
  return { adSpend: 0, orders: { tea: order("tea"), snack: order("snack") } };
}

function stressedDecision(ctx: ShopMockContext, iteration: number): ShopDecision {
  const supplier: ShelfSupplier = ctx.capacity.primary > 0 ? "primary" : "backup";
  const cap = ctx.capacity[supplier];
  const order = (sku: "tea" | "snack") => ({
    price: ctx.unitCost[supplier][sku] + iteration,
    qty: Math.min(1, cap),
    supplier,
  });
  return { adSpend: ctx.cash + iteration, orders: { tea: order("tea"), snack: order("snack") } };
}

function decisionFor(ctx: ShopMockContext, iteration: number): ShopDecision {
  if (ctx.profile === "stressed") return stressedDecision(ctx, iteration);
  return steadyDecision(ctx);
}

function render(ctx: ShopMockContext, prompt: string): string {
  const read = readPrompt(prompt);
  const news = read.news.length > 0 ? read.news : ctx.news;
  switch (read.role) {
    case "planner":
      return canonicalJson({
        agents: ["buyer", "pricer", "marketer"],
        subflows: news.includes(PRIMARY_CANNOT_DELIVER) ? ["supply-negotiation"] : [],
      });
    case "buyer":
    case "pricer":
    case "marketer":
    case "revision":
      return canonicalJson(decisionFor(ctx, read.iteration));
    case "critic":
      if (ctx.profile === "stressed") {
        return canonicalJson({
          confidence: 0.99,
          objections: [{ claim: "ad spend is above cash", evidence: "ad-spend" }],
        });
      }
      return canonicalJson({ confidence: 0.15, objections: [] });
    case "supplier":
      return canonicalJson({ talk: "We can ship on the published lead time." });
    case "reflect":
      return canonicalJson({
        note: `round ${String(ctx.round)} kept orders inside visible capacity`,
        patch: "keep a backup supplier when the primary cannot deliver",
      });
    default:
      throw new Error(`mock has no completion for role ${read.role}`);
  }
}

export function createShopMock(): ShopMock {
  const calls: LlmRequest[] = [];
  const texts: string[] = [];
  let context: ShopMockContext | null = null;
  return {
    mode: "mock",
    get calls() {
      return [...calls];
    },
    textAt(index: number) {
      const text = texts[index];
      if (text === undefined) throw new Error(`mock text ${String(index)} is missing`);
      return text;
    },
    setContext(next) {
      context = next;
    },
    async complete(request) {
      if (context === null) throw new Error("shop mock has no round context");
      const text = render(context, request.prompt);
      calls.push({
        runId: request.runId,
        round: request.round,
        nodeId: request.nodeId,
        attempt: request.attempt,
        prompt: request.prompt,
        maxTokens: request.maxTokens,
      });
      texts.push(text);
      return { text, usage: { promptTokens: 10, completionTokens: 10 } };
    },
  };
}

export function lastCompletion(mock: ShopMock, role: string, round: number): string | null {
  for (let index = mock.calls.length - 1; index >= 0; index -= 1) {
    const call = mock.calls[index];
    if (call === undefined || call.round !== round) continue;
    if (readPrompt(call.prompt).role !== role) continue;
    return mock.textAt(index);
  }
  return null;
}

export function parsePlanner(text: string): { agents: AgentId[]; subflows: string[] } {
  const parsed = plannerSchema.safeParse(jsonValue(text));
  if (!parsed.success) return { agents: [], subflows: [] };
  const agents: AgentId[] = [];
  for (const id of parsed.data.agents) {
    if (isAgentId(id)) agents.push(id);
  }
  return { agents, subflows: parsed.data.subflows };
}

export function parseCriticText(text: string): { objections: { claim: string; evidence: string }[]; confidence: number } {
  const parsed = criticSchema.safeParse(jsonValue(text));
  if (!parsed.success) return { objections: [], confidence: 0 };
  return parsed.data;
}

export function parseTalk(text: string): string {
  const parsed = talkSchema.safeParse(jsonValue(text));
  if (!parsed.success) return "";
  return parsed.data.talk;
}

export function parseReflect(text: string): { note: string; patch: string } {
  const parsed = reflectSchema.safeParse(jsonValue(text));
  if (!parsed.success) return { note: "", patch: "" };
  return parsed.data;
}

const ROLE_SKILL: Record<ShopRole, string> = {
  buyer: "procure",
  pricer: "price",
  marketer: "promote",
  critic: "review",
  reflect: "reflect",
};

export function shopAgentSpec(role: ShopRole): AgentSpec {
  const skill = parseSkillTag(ROLE_SKILL[role]);
  const tools = role === "critic" || role === "reflect" ? [] : [FORECAST_TOOL];
  return {
    id: parseAgentId(role),
    version: PRICER_V1,
    role,
    promptTemplateId: `${role}-v1`,
    tools,
    memory: role === "reflect" ? "kb" : "none",
    capabilities: { [skill]: parseUnitInterval(0.8) },
    model: "mock",
    budget: { maxCallsPerRound: 8, maxTokensPerRound: 200 },
  };
}

export function registerShopAgents(registry: AgentRegistry): AgentSpec[] {
  const specs: AgentSpec[] = [];
  for (const role of SHOP_ROLES) {
    const spec = shopAgentSpec(role);
    registry.register(spec);
    specs.push(spec);
  }
  return specs;
}

export function createShopRegistry(tools: ToolRegistry): { registry: AgentRegistry; specs: AgentSpec[] } {
  const registry = createAgentRegistry(tools);
  const specs = registerShopAgents(registry);
  return { registry, specs };
}

export function registerPricerPatch(input: {
  readonly registry: AgentRegistry;
  readonly specs: AgentSpec[];
  readonly patch: string;
}): AgentSpec | null {
  if (input.registry.get(PRICER_ID, PRICER_PATCH) !== undefined) return null;
  const parent = input.registry.get(PRICER_ID, PRICER_V1);
  if (parent === undefined) throw new Error("pricer@1.0.0 is not registered");
  const recorded: PromptHash = promptHash(`pricer@1.0.1\n${input.patch}`);
  const spec = input.registry.registerPromptVersion({
    id: PRICER_ID,
    version: PRICER_PATCH,
    promptHash: recorded,
    parentVersion: PRICER_V1,
  });
  input.specs.push(spec);
  return spec;
}

export function basePromptHash(spec: AgentSpec): PromptHash {
  return promptHash(`${spec.promptTemplateId}@${spec.version}`);
}
