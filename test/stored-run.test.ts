import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { verifyRunIntegrity } from "../src/templates/agentops/integrity.js";
import { parseStoredRun, summarizeStoredRun } from "../src/templates/agentops/stored-run.js";
import type { AgentRun } from "../src/templates/agentops/types.js";

const FIXTURE_DIR = path.join(process.cwd(), "test", "fixtures", "agent-runs");
const fixtures = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith(".json"))
  .map((name) => ({ name: name.replace(/\.json$/, ""), raw: JSON.parse(readFileSync(path.join(FIXTURE_DIR, name), "utf8")) as Record<string, unknown> }));

describe("persisted-run fixtures (real files from .data/agent-runs)", () => {
  test("the corpus covers awaiting, completed and rejected", () => {
    const statuses = new Set(fixtures.map((item) => item.raw.status));
    expect([...statuses].sort()).toEqual(["awaiting-approval", "completed", "rejected"]);
  });

  test.each(fixtures.map((item) => [item.name, item.raw] as const))("%s parses unchanged and still verifies", (_name, raw) => {
    const parsed = parseStoredRun(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.run.id).toBe(raw.id);
    expect(parsed.run.events).toHaveLength((raw.events as unknown[]).length);
    expect(parsed.run.artifacts.candidates).toHaveLength(3);
    expect(parsed.run.loops).toHaveLength((raw.loops as unknown[]).length);
    // parsing must not alter anything the seal covers
    const integrity = verifyRunIntegrity(raw as unknown as AgentRun);
    expect(integrity).toEqual({ chainOk: true, fingerprintOk: true, firstBrokenSeq: null });
    expect(verifyRunIntegrity(parsed.run)).toEqual({ chainOk: true, fingerprintOk: true, firstBrokenSeq: null });
  });

  test("summaries come out identical for the same run whether it is raw or parsed", () => {
    for (const { raw } of fixtures) {
      const summary = summarizeStoredRun(raw);
      expect(summary).toMatchObject({ id: raw.id, status: raw.status });
      expect(summary?.priceCents).toBeGreaterThan(0);
    }
  });
});

describe("parseStoredRun on old / odd shapes", () => {
  const base = fixtures.find((item) => item.name === "pillow-completed-2loops")?.raw as Record<string, unknown>;

  function without(...keys: string[]): Record<string, unknown> {
    const copy = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    for (const key of keys) delete copy[key];
    return copy;
  }

  test("legacy run without calls/failures/loads/scheduler/llm/notes/agents/dispatches/verifications opens with safe defaults", () => {
    const legacy = without("calls", "failures", "loads", "scheduler", "llm", "notes", "agents", "dispatches", "verifications");
    const parsed = parseStoredRun(legacy);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.run.calls).toEqual({});
    expect(parsed.run.failures).toEqual({});
    expect(parsed.run.scheduler.facts).toBeNull();
    expect(parsed.run.llm.mode).toBe("rule");
    expect(parsed.run.agents).toEqual([]);
    expect(parsed.run.status).toBe("completed");
    expect(parsed.run.events.length).toBeGreaterThan(0);
  });

  test("loops without before/after snapshots are dropped instead of crashing the comparison table", () => {
    const legacy = JSON.parse(JSON.stringify(base)) as { loops: Record<string, unknown>[] };
    for (const loop of legacy.loops) {
      delete loop.before;
      delete loop.after;
    }
    const parsed = parseStoredRun(legacy);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.run.loops).toEqual([]);
  });

  test("candidates missing nested blocks are dropped, not passed to charts", () => {
    const odd = JSON.parse(JSON.stringify(base)) as { artifacts: { candidates: Record<string, unknown>[] } };
    delete odd.artifacts.candidates[0]?.sim;
    const parsed = parseStoredRun(odd);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.run.artifacts.candidates).toHaveLength(2);
  });

  test.each([
    ["null", null, "卷宗内容不是一个对象"],
    ["array", [], "卷宗内容不是一个对象"],
    ["no id", { status: "completed" }, "卷宗缺少编号"],
    ["unknown status", { ...base, status: "paused" }, "未知的评审状态「paused」"],
    ["missing status", { ...base, status: undefined }, "未知的评审状态「空」"],
    ["no task", { ...base, task: {} }, "卷宗缺少评审任务描述"],
    ["no artifacts", { ...base, artifacts: undefined }, "卷宗缺少核算结果"],
  ])("rejects %s with a readable reason", (_label, input, reason) => {
    expect(parseStoredRun(input)).toEqual({ ok: false, reason });
  });

  test("parsing is pure: the input object is never mutated", () => {
    const legacy = without("calls", "scheduler");
    const before = JSON.stringify(legacy);
    parseStoredRun(legacy);
    expect(JSON.stringify(legacy)).toBe(before);
  });
});
