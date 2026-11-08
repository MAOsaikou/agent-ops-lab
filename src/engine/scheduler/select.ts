import type { AgentSpec } from "../agents/registry.js";
import { NODE_SCHEDULED, appendNodeEvent, type NodeEventBody } from "../events/node.js";
import type { EventStore } from "../events/store.js";
import {
  type AgentId,
  type PromptHash,
  type RunId,
  type SemVer,
  type SkillTag,
} from "../ids.js";

export type ScheduleObservation = {
  readonly round: number;
  readonly signals: readonly string[];
};

export type PlannerPick = {
  readonly agents: readonly AgentId[];
  readonly subflows: readonly string[];
};

export type Planner = (observation: ScheduleObservation) => PlannerPick;

export type AgentCandidate = {
  readonly spec: AgentSpec;
  readonly promptHash: PromptHash;
  readonly remainingCalls: number;
  readonly ready: boolean;
};

export type SubflowCandidate = {
  readonly id: string;
  readonly ready: boolean;
};

export type SelectInput = {
  readonly observation: ScheduleObservation;
  readonly agents: readonly AgentCandidate[];
  readonly subflows: readonly SubflowCandidate[];
  readonly callBudget: number;
  readonly planner: Planner | "off";
  readonly requiredSkill: SkillTag | null;
  readonly minScore: number;
};

export type SelectionDecision = {
  readonly kind: "agent" | "subflow";
  readonly nodeId: string;
  readonly accepted: boolean;
  readonly reason: string;
  readonly score: number;
  readonly agentId: AgentId | null;
  readonly version: SemVer | null;
  readonly promptHash: PromptHash | null;
};

export type Selection = {
  readonly decisions: readonly SelectionDecision[];
  readonly activatedAgents: readonly AgentId[];
  readonly activatedSubflows: readonly string[];
};

type LatestAgent = {
  readonly candidate: AgentCandidate;
  readonly index: number;
};

type EligibleAgent = {
  readonly candidate: AgentCandidate;
  readonly index: number;
  readonly score: number;
};

function assertWhole(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
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

function latestAgents(agents: readonly AgentCandidate[]): LatestAgent[] {
  const chosen = new Map<string, LatestAgent>();
  const order: string[] = [];
  for (let index = 0; index < agents.length; index += 1) {
    const candidate = agents[index];
    if (candidate === undefined) continue;
    assertWhole(candidate.remainingCalls, "remainingCalls");
    const key = candidate.spec.id;
    const current = chosen.get(key);
    if (current === undefined) {
      chosen.set(key, { candidate, index });
      order.push(key);
      continue;
    }
    if (compareSemVer(candidate.spec.version, current.candidate.spec.version) > 0) {
      chosen.set(key, { candidate, index: current.index });
    }
  }
  const latest: LatestAgent[] = [];
  for (const key of order) {
    const found = chosen.get(key);
    if (found === undefined) throw new Error(`missing agent ${key}`);
    latest.push(found);
  }
  return latest;
}

function uniqueIds(ids: readonly AgentId[]): AgentId[] {
  const seen = new Set<string>();
  const unique: AgentId[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

function uniqueStrings(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

function propose(input: SelectInput, latest: readonly LatestAgent[]): {
  readonly agents: readonly AgentId[];
  readonly subflows: readonly string[];
} {
  if (input.planner === "off") {
    return {
      agents: latest.map((agent) => agent.candidate.spec.id),
      subflows: [],
    };
  }
  const pick = input.planner(input.observation);
  return {
    agents: uniqueIds(pick.agents),
    subflows: uniqueStrings(pick.subflows),
  };
}

function capabilityScore(
  spec: AgentSpec,
  requiredSkill: SkillTag | null,
  minScore: number,
): { readonly ok: true; readonly score: number } | { readonly ok: false; readonly reason: string } {
  if (requiredSkill === null) {
    let best = 0;
    let found = false;
    for (const value of Object.values(spec.capabilities)) {
      if (value === undefined) continue;
      found = true;
      if (value > best) best = value;
    }
    if (!found) return { ok: false, reason: "rejected because capability is not registered" };
    if (best < minScore) {
      return {
        ok: false,
        reason: `rejected score ${String(best)} because capability is below ${String(minScore)}`,
      };
    }
    return { ok: true, score: best };
  }
  const value = spec.capabilities[requiredSkill];
  if (value === undefined) {
    return { ok: false, reason: `rejected because capability ${requiredSkill} is not registered` };
  }
  if (value < minScore) {
    return {
      ok: false,
      reason: `rejected score ${String(value)} because capability is below ${String(minScore)}`,
    };
  }
  return { ok: true, score: value };
}

function agentDecision(
  id: string,
  accepted: boolean,
  reason: string,
  score: number,
  candidate: AgentCandidate | null,
): SelectionDecision {
  if (candidate === null) {
    return {
      kind: "agent",
      nodeId: id,
      accepted,
      reason,
      score,
      agentId: null,
      version: null,
      promptHash: null,
    };
  }
  return {
    kind: "agent",
    nodeId: candidate.spec.id,
    accepted,
    reason,
    score,
    agentId: candidate.spec.id,
    version: candidate.spec.version,
    promptHash: candidate.promptHash,
  };
}

function subflowDecision(id: string, accepted: boolean, reason: string): SelectionDecision {
  return {
    kind: "subflow",
    nodeId: id,
    accepted,
    reason,
    score: 0,
    agentId: null,
    version: null,
    promptHash: null,
  };
}

function catalogSubflows(subflows: readonly SubflowCandidate[]): Map<string, SubflowCandidate> {
  const catalog = new Map<string, SubflowCandidate>();
  for (const subflow of subflows) {
    if (catalog.has(subflow.id)) throw new Error(`duplicate subflow ${subflow.id}`);
    catalog.set(subflow.id, subflow);
  }
  return catalog;
}

export function select(input: SelectInput): Selection {
  assertWhole(input.callBudget, "callBudget");
  if (!Number.isFinite(input.minScore)) throw new RangeError("minScore must be finite");
  const latest = latestAgents(input.agents);
  const byId = new Map<string, LatestAgent>();
  for (const agent of latest) byId.set(agent.candidate.spec.id, agent);
  const proposed = propose(input, latest);
  const decided = new Map<string, SelectionDecision>();
  const eligible: EligibleAgent[] = [];

  for (const id of proposed.agents) {
    const found = byId.get(id);
    if (found === undefined) {
      decided.set(id, agentDecision(id, false, "rejected because agent is not registered", 0, null));
      continue;
    }
    const scored = capabilityScore(found.candidate.spec, input.requiredSkill, input.minScore);
    if (!scored.ok) {
      decided.set(id, agentDecision(id, false, scored.reason, 0, found.candidate));
      continue;
    }
    if (!found.candidate.ready) {
      decided.set(
        id,
        agentDecision(
          id,
          false,
          `rejected score ${String(scored.score)} because dependencies are not ready`,
          scored.score,
          found.candidate,
        ),
      );
      continue;
    }
    if (found.candidate.remainingCalls === 0) {
      decided.set(
        id,
        agentDecision(
          id,
          false,
          `rejected score ${String(scored.score)} because remaining call budget is 0`,
          scored.score,
          found.candidate,
        ),
      );
      continue;
    }
    eligible.push({ candidate: found.candidate, index: found.index, score: scored.score });
  }

  if (input.planner !== "off") {
    eligible.sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.index - right.index;
    });
  }

  let budget = input.callBudget;
  for (const agent of eligible) {
    if (budget === 0) {
      decided.set(
        agent.candidate.spec.id,
        agentDecision(
          agent.candidate.spec.id,
          false,
          `rejected score ${String(agent.score)} because remaining call budget is 0`,
          agent.score,
          agent.candidate,
        ),
      );
      continue;
    }
    budget -= 1;
    decided.set(
      agent.candidate.spec.id,
      agentDecision(
        agent.candidate.spec.id,
        true,
        `accepted score ${String(agent.score)}`,
        agent.score,
        agent.candidate,
      ),
    );
  }

  const decisions: SelectionDecision[] = [];
  const activatedAgents: AgentId[] = [];
  for (const id of proposed.agents) {
    const decision = decided.get(id);
    if (decision === undefined) throw new Error(`missing decision ${id}`);
    decisions.push(decision);
    if (decision.accepted && decision.agentId !== null) activatedAgents.push(decision.agentId);
  }

  const catalog = catalogSubflows(input.subflows);
  const activatedSubflows: string[] = [];
  for (const id of proposed.subflows) {
    const subflow = catalog.get(id);
    if (subflow === undefined) {
      decisions.push(subflowDecision(id, false, "rejected because subflow is not registered"));
      continue;
    }
    if (!subflow.ready) {
      decisions.push(subflowDecision(id, false, "rejected because dependencies are not ready"));
      continue;
    }
    decisions.push(subflowDecision(id, true, `accepted subflow ${id}`));
    activatedSubflows.push(id);
  }

  return { decisions, activatedAgents, activatedSubflows };
}

function decisionBody(decision: SelectionDecision): NodeEventBody {
  if (decision.agentId === null || decision.version === null || decision.promptHash === null) {
    return {
      nodeId: decision.nodeId,
      reason: decision.reason,
      score: decision.score,
    };
  }
  return {
    nodeId: decision.nodeId,
    reason: decision.reason,
    score: decision.score,
    agentId: decision.agentId,
    version: decision.version,
    promptHash: decision.promptHash,
    agent: `${decision.agentId}@${decision.version}`,
  };
}

export function recordSelection(
  events: EventStore,
  runId: RunId,
  round: number,
  selection: Selection,
): void {
  assertWhole(round, "round");
  for (let index = 0; index < selection.decisions.length; index += 1) {
    const decision = selection.decisions[index];
    if (decision === undefined) continue;
    const version = decision.version ?? "-";
    const promptHash = decision.promptHash ?? "-";
    appendNodeEvent(events, {
      runId,
      type: NODE_SCHEDULED,
      idempotencyKey: `${runId}|${String(round)}|${String(index)}|${decision.nodeId}|${version}|${promptHash}|schedule`,
      body: decisionBody(decision),
    });
  }
}

export function allocateBudget(input: {
  readonly budget: number;
  readonly bids: readonly { readonly id: string; readonly value: number }[];
}): readonly { readonly id: string; readonly amount: number }[] {
  if (!Number.isSafeInteger(input.budget) || input.budget < 0) {
    throw new RangeError("budget must be a non-negative integer");
  }
  const weights: number[] = [];
  for (const bid of input.bids) {
    if (!Number.isFinite(bid.value)) {
      throw new RangeError("bid must be finite");
    }
    weights.push(bid.value > 0 ? bid.value : 0);
  }
  const sum = weights.reduce((total, value) => total + value, 0);
  const amounts = input.bids.map(() => 0);
  if (sum > 0 && input.budget > 0) {
    let spent = 0;
    let remainderIndex = -1;
    for (let index = 0; index < input.bids.length; index += 1) {
      const weight = weights[index] ?? 0;
      if (weight <= 0) continue;
      if (remainderIndex < 0) remainderIndex = index;
      const share = Math.floor((input.budget * weight) / sum);
      amounts[index] = share;
      spent += share;
    }
    if (remainderIndex >= 0) {
      const current = amounts[remainderIndex] ?? 0;
      amounts[remainderIndex] = current + (input.budget - spent);
    }
  }
  return input.bids.map((bid, index) => ({ id: bid.id, amount: amounts[index] ?? 0 }));
}
