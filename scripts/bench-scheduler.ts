import { mkdtempSync, rmSync } from "node:fs";
import { availableParallelism, loadavg, tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { type AgentSpec } from "../src/engine/agents/registry.js";
import { openEventStore } from "../src/engine/events/store.js";
import {
  parseAgentId,
  parseRunId,
  parseSemVer,
  parseSkillTag,
  parseUnitInterval,
  type AgentId,
} from "../src/engine/ids.js";
import { promptHash } from "../src/engine/llm/hash.js";
import { recordSelection, select, type AgentCandidate, type SelectInput } from "../src/engine/scheduler/select.js";

const repeats = 5;
const rounds = 1000;
const skills = ["pricing", "procurement", "marketing", "critique", "forecast"] as const;

function candidate(index: number): AgentCandidate {
  const skill = skills[index];
  if (skill === undefined) throw new Error("missing skill");
  const tag = parseSkillTag(skill);
  const spec: AgentSpec = {
    id: parseAgentId(`agent${String(index)}`),
    version: parseSemVer("1.0.0"),
    role: skill,
    promptTemplateId: `${skill}-v1`,
    tools: [],
    memory: "none",
    capabilities: { [tag]: parseUnitInterval(0.5 + index / 10) },
    model: "mock",
    budget: { maxCallsPerRound: 4, maxTokensPerRound: 64 },
  };
  return {
    spec,
    promptHash: promptHash(spec.promptTemplateId),
    remainingCalls: 4,
    ready: true,
  };
}

const agents = [0, 1, 2, 3, 4].map(candidate);
const picked: AgentId[] = [];
for (const agent of agents.slice(0, 3)) picked.push(agent.spec.id);

function request(round: number): SelectInput {
  return {
    observation: { round, signals: round % 2 === 0 ? ["calm"] : ["supply-cut"] },
    agents,
    subflows: [
      { id: "supply-negotiation", ready: true },
      { id: "price-war", ready: false },
    ],
    callBudget: 3,
    planner: () => ({
      agents: picked,
      subflows: roundSignals(round),
    }),
    requiredSkill: null,
    minScore: 0,
  };
}

function roundSignals(round: number): string[] {
  return round % 2 === 0 ? [] : ["supply-negotiation"];
}

function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  const value = sorted[index];
  if (value === undefined) throw new Error("empty samples");
  return value;
}

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    const value = sorted[mid];
    if (value === undefined) throw new Error("empty samples");
    return value;
  }
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  if (lower === undefined || upper === undefined) throw new Error("empty samples");
  return (lower + upper) / 2;
}

function warmup(step: (round: number) => void, base: number): void {
  for (let warm = 0; warm < 50; warm += 1) step(base + warm);
}

function timeRepeats(step: (round: number) => void, base: number): number[] {
  const p95s: number[] = [];
  let cursor = base + 1_000;
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    const samples: number[] = [];
    for (let round = 0; round < rounds; round += 1) {
      const start = performance.now();
      step(cursor);
      samples.push(performance.now() - start);
      cursor += 1;
    }
    p95s.push(percentile(samples, 95));
  }
  return p95s;
}

const dbDir = mkdtempSync(path.join(tmpdir(), "u4-bench-"));
const events = openEventStore(path.join(dbDir, "events.sqlite"));
const runId = parseRunId("bench");
let errors = 0;
try {
  const step = (round: number): void => {
    const selection = select(request(round));
    if (selection.activatedAgents.length !== 3) errors += 1;
    if (round % 2 === 1 && selection.activatedSubflows.length !== 1) errors += 1;
    if (round % 2 === 0 && selection.activatedSubflows.length !== 0) errors += 1;
    recordSelection(events, runId, round, selection);
  };
  warmup(step, 0);
  const cpu = process.cpuUsage();
  const combined = timeRepeats(step, 0);
  const spent = process.cpuUsage(cpu);
  const selectStep = (round: number): void => {
    const selection = select(request(round));
    if (selection.decisions.length === 0) errors += 1;
  };
  warmup(selectStep, 100_000);
  const selectOnly = timeRepeats(selectStep, 100_000);
  const fixed = select(request(1));
  const recordStep = (round: number): void => {
    recordSelection(events, runId, round, fixed);
  };
  warmup(recordStep, 200_000);
  const recordOnly = timeRepeats(recordStep, 200_000);
  const timedSteps = repeats * rounds;
  console.log(`cores ${String(availableParallelism())}`);
  console.log(`loadavg ${loadavg().map((value) => value.toFixed(2)).join(",")}`);
  console.log(`repeats ${String(repeats)}`);
  console.log(`rounds ${String(rounds)}`);
  console.log(`errors ${String(errors)}`);
  console.log(`mock_delay_ms 0`);
  console.log(`step select+record`);
  console.log(`p95_ms ${combined.map((value) => value.toFixed(4)).join(",")}`);
  console.log(`median_p95_ms ${median(combined).toFixed(4)}`);
  console.log(`min_p95_ms ${Math.min(...combined).toFixed(4)}`);
  console.log(`max_p95_ms ${Math.max(...combined).toFixed(4)}`);
  console.log(`select_only_p95_ms ${selectOnly.map((value) => value.toFixed(4)).join(",")}`);
  console.log(`select_only_median_p95_ms ${median(selectOnly).toFixed(4)}`);
  console.log(`record_only_p95_ms ${recordOnly.map((value) => value.toFixed(4)).join(",")}`);
  console.log(`record_only_median_p95_ms ${median(recordOnly).toFixed(4)}`);
  console.log(`cpu_user_ms_per_step ${(spent.user / 1000 / timedSteps).toFixed(4)}`);
  console.log(`cpu_system_ms_per_step ${(spent.system / 1000 / timedSteps).toFixed(4)}`);
  if (errors !== 0) throw new Error(`scheduler bench errors: ${String(errors)}`);
} finally {
  events.close();
  rmSync(dbDir, { recursive: true, force: true });
}
