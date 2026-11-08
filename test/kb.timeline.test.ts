import { expect, test } from "vitest";
import { z } from "zod";

import { createToolRegistry } from "../src/engine/tools/registry.js";
import { parseRunId, parseSkillTag } from "../src/engine/ids.js";
import { select } from "../src/engine/scheduler/select.js";
import { basePromptHash, createShopRegistry, FORECAST_TOOL, PRICER_ID, PRICER_PATCH, registerPricerPatch } from "../src/templates/simshop/agents.js";
import { createRoundMemory, roundNoteId } from "../src/templates/simshop/memory.js";

test("search during round n hides notes whose round is n or later", () => {
  const memory = createRoundMemory();
  const runId = parseRunId("kb-round");
  memory.beginRun(runId);
  memory.write(runId, {
    id: roundNoteId(2, "tea"),
    text: "backup supplier covered the tea gap",
    round: 2,
  });
  memory.write(runId, {
    id: roundNoteId(4, "snack"),
    text: "snack ads outran the tea wholesale note",
    round: 4,
  });

  expect(memory.search({ runId, round: 2, query: "backup supplier tea gap" })).toEqual([]);
  expect(memory.search({ runId, round: 1, query: "backup supplier tea" })).toEqual([]);
  expect(memory.search({ runId, round: 4, query: "backup supplier tea gap" }).map((hit) => hit.id)).toEqual([
    roundNoteId(2, "tea"),
  ]);
  expect(memory.search({ runId, round: 5, query: "snack ads" }).map((hit) => hit.id)).toContain(roundNoteId(4, "snack"));
  expect(memory.search({ runId, round: 4, query: "snack ads" })).toEqual([]);
});

test("pricer@1.0.1 is registered after the reflect note and is the version select uses next", () => {
  const tools = createToolRegistry();
  tools.register(
    {
      name: FORECAST_TOOL,
      effect: "sandbox",
      input: z.strictObject({}),
      output: z.strictObject({ ok: z.boolean() }),
      transport: { kind: "inproc" },
    },
    () => ({ ok: true }),
  );
  const { registry, specs } = createShopRegistry(tools);
  const memory = createRoundMemory();
  const runId = parseRunId("kb-patch");
  memory.beginRun(runId);
  expect(registry.get(PRICER_ID, PRICER_PATCH)).toBeUndefined();

  memory.write(runId, {
    id: roundNoteId(0, "reflect"),
    text: "round 0 kept orders inside visible capacity",
    round: 0,
  });
  expect(memory.search({ runId, round: 0, query: "round kept orders" })).toEqual([]);
  expect(registry.get(PRICER_ID, PRICER_PATCH)).toBeUndefined();

  const patched = registerPricerPatch({ registry, specs, patch: "keep a backup supplier when the primary cannot deliver" });
  expect(patched?.version).toBe("1.0.1");
  expect(registerPricerPatch({ registry, specs, patch: "again" })).toBeNull();
  expect(memory.search({ runId, round: 1, query: "round kept orders" }).map((hit) => hit.id)).toEqual([
    roundNoteId(0, "reflect"),
  ]);

  const selection = select({
    observation: { round: 1, signals: [] },
    agents: specs.map((spec) => ({
      spec,
      promptHash: spec.version === PRICER_PATCH ? registry.recordedPromptHash(spec.id, spec.version) : basePromptHash(spec),
      remainingCalls: 4,
      ready: true,
    })),
    subflows: [],
    callBudget: 5,
    planner: () => ({ agents: [PRICER_ID], subflows: [] }),
    requiredSkill: parseSkillTag("price"),
    minScore: 0,
  });
  const original = specs.find((spec) => spec.id === PRICER_ID && spec.version === "1.0.0");
  if (original === undefined) throw new Error("pricer@1.0.0 is missing");
  const chosen = selection.decisions[0];
  if (chosen === undefined) throw new Error("select returned no decision");
  expect(selection.activatedAgents).toEqual([PRICER_ID]);
  expect(chosen.version).toBe("1.0.1");
  expect(chosen.promptHash).not.toBe(basePromptHash(original));
});
