import { describe, expect, test, vi } from "vitest";

import type { LlmCompletion, LlmRequest } from "../src/engine/llm/client.js";
import { runCollaboration } from "../src/templates/agentops/collaboration.js";
import { runDeliberation, type DeliberationArtifact, type DeliberationNodeEvent, type DeliberationProposal } from "../src/templates/agentops/deliberation.js";
import type { LiveLlm } from "../src/templates/agentops/llm.js";
import type { CollabRole } from "../src/templates/agentops/types.js";
import { buildCandidates } from "../src/templates/pricing/candidates.js";
import type { CandidateId } from "../src/templates/pricing/model.js";
import { PLATFORM_PRESETS } from "../src/templates/pricing/platform.js";
import { SAMPLES } from "../src/templates/pricing/sample.js";

const roles = ["procurement-lead", "pricing-lead", "growth-operator"] as const;
const question = "你的放量目标与备货承压存在冲突，请说明为何仍值得推荐并回应其他角色的顾虑";
const response = "我接受备货约束并修订推荐，优先选择能够兼顾订单增长与资金承压的方案";
const summary = "优先保护利润空间并兼顾当前备货能力，仍需核实商家的履约条件";

function proposal(role: CollabRole, candidateId: CandidateId = "profit"): DeliberationProposal {
  return { candidateId, summary, evidenceRefs: [role + "/" + candidateId], concerns: ["仍需核实商家备货能力"] };
}
function roleFor(request: LlmRequest): CollabRole {
  const role = roles.find((r) => request.nodeId.endsWith(r));
  if (!role) throw new Error("not a specialist request");
  return role;
}
function defaultOutput(request: LlmRequest): unknown {
  if (request.nodeId.includes("-challenge-")) {
    return { challenges: [
      { targetRole: "procurement-lead", question, evidenceRefs: ["growth-operator/match"] },
      { targetRole: "growth-operator", question, evidenceRefs: ["procurement-lead/profit"] },
    ] };
  }
  const role = roleFor(request);
  if (request.nodeId.includes("-revision-")) return { ...proposal(role, "match"), response };
  return proposal(role, role === "growth-operator" ? "match" : "profit");
}
function mockModel(output: (request: LlmRequest) => unknown | Promise<unknown> = defaultOutput) {
  const requests: LlmRequest[] = [];
  const live: LiveLlm = {
    model: "mock-deliberation", baseUrl: "http://mock.invalid",
    client: { complete: async (request): Promise<LlmCompletion> => {
      requests.push(structuredClone(request));
      const result = await output(request);
      return { text: typeof result === "string" ? result : JSON.stringify(result), usage: { promptTokens: 11, completionTokens: 7 } };
    } },
  };
  return { live, requests };
}
function input(live: LiveLlm) {
  const product = SAMPLES[0]!.input;
  const candidates = buildCandidates(product, PLATFORM_PRESETS[product.platform]);
  const collaboration = runCollaboration(product, candidates, "profit");
  // Deliberately equal-risk fixture to isolate the model vote influence from numeric gating.
  return { runId: "model-deliberation", product, candidates, live,
    collaboration: { ...collaboration, comparison: collaboration.comparison!.map((c) => ({ ...c, failCount: 0 })) } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("真实模型多方评审的有界编排", () => {
  test("三方先并发提案，主席消费真实提案，再并发定向修订；最新票取代旧票改变推荐", async () => {
    const proposalGate = deferred<void>();
    const revisionGate = deferred<void>();
    const mock = mockModel(async (request) => {
      if (request.nodeId.includes("-proposal-")) await proposalGate.promise;
      if (request.nodeId.includes("-revision-")) await revisionGate.promise;
      return defaultOutput(request);
    });
    const updates: { artifact: DeliberationArtifact; event: DeliberationNodeEvent }[] = [];
    const args = input(mock.live);
    const unchanged = JSON.stringify({ product: args.product, candidates: args.candidates, collaboration: args.collaboration });
    const pending = runDeliberation({ ...args, onUpdate: (artifact, event) => updates.push({ artifact, event }) });
    expect(mock.requests).toHaveLength(3);
    expect(mock.requests.every((r) => r.nodeId.includes("-proposal-"))).toBe(true);
    expect(updates[0]!.artifact.nodes).toHaveLength(3);
    expect(updates[0]!.artifact.nodes.every((n) => n.status === "running")).toBe(true);
    proposalGate.resolve();
    await vi.waitFor(() => expect(mock.requests).toHaveLength(6));
    const chairRequest = mock.requests.find((r) => r.nodeId.includes("-challenge-"))!;
    expect(chairRequest.prompt).toContain("实际提案");
    expect(chairRequest.prompt).toContain(summary);
    expect(chairRequest.prompt).toContain('"role":"procurement-lead"');
    const revisions = mock.requests.filter((r) => r.nodeId.includes("-revision-"));
    expect(revisions).toHaveLength(2);
    expect(revisions.every((r) => r.prompt.includes(question) && r.prompt.includes("你的原提案"))).toBe(true);
    revisionGate.resolve();
    const result = await pending;
    expect(result.stage).toBe("completed");
    expect(result.nodes).toHaveLength(6);
    expect(result.decision?.recommendedId).toBe("match");
    expect(result.decision?.support).toEqual({ profit: 1, match: 2, volume: 0 });
    expect(updates.filter((u) => u.event.type === "completed")).toHaveLength(6);
    expect(updates.filter((u) => u.event.type === "finished")).toHaveLength(1);
    expect(updates.at(-1)!.artifact).toEqual(result);
    expect(updates[0]!.artifact.nodes.every((n) => n.status === "running")).toBe(true);
    expect(JSON.stringify({ product: args.product, candidates: args.candidates, collaboration: args.collaboration })).toBe(unchanged);
    for (const request of mock.requests) {
      expect(request.maxTokens).toBe(640);
      expect(request.responseFormat).toBe("json_object");
      expect(request.reasoningEffort).toBe("low");
      expect(request.timeoutMs).toBeGreaterThan(0);
      expect(request.timeoutMs).toBeLessThanOrEqual(60_000);
    }
  });

  test("无效证据节点明确失败且不计票，不用规则提案冒充模型成功", async () => {
    const mock = mockModel((request) => {
      if (request.nodeId.endsWith("procurement-lead")) return { ...proposal("procurement-lead"), evidenceRefs: ["invented-report/profit"] };
      if (request.nodeId.includes("-challenge-")) return { challenges: [] };
      return defaultOutput(request);
    });
    const result = await runDeliberation(input(mock.live));
    expect(result.stage).toBe("partial");
    const failed = result.nodes.find((n) => n.role === "procurement-lead")!;
    expect(failed.status).toBe("failed");
    expect(failed.attempts).toBe(2);
    expect(failed.error).toContain("未知 evidenceRef");
    expect(failed.proposal).toBeUndefined();
    expect(result.decision?.support).toEqual({ profit: 1, match: 1, volume: 0 });
    const retry = mock.requests.find((r) => r.nodeId.endsWith("procurement-lead") && r.attempt === 2)!;
    expect(retry.prompt).toContain("invented-report/profit");
    expect(retry.prompt).toContain("最后一次机会");
    expect(failed.usage).toEqual({ promptTokens: 22, completionTokens: 14 });
  });

  test("主席失败不虚构质询或触发修订，保留成功角色的合法初始票", async () => {
    const mock = mockModel((request) => request.nodeId.includes("-challenge-")
      ? { challenges: [{ targetRole: "fictional-agent", question, evidenceRefs: ["pricing-lead/profit"] }] }
      : defaultOutput(request));
    const result = await runDeliberation(input(mock.live));
    expect(result.stage).toBe("partial");
    expect(result.nodes).toHaveLength(4);
    expect(result.nodes.find((n) => n.role === "chair")?.status).toBe("failed");
    expect(result.nodes.find((n) => n.role === "chair")?.challenge).toBeUndefined();
    expect(mock.requests.some((r) => r.nodeId.includes("-revision-"))).toBe(false);
    expect(result.decision?.support).toEqual({ profit: 2, match: 1, volume: 0 });
  });

  test("修订失败不覆盖其合法初始提案，也不能把失败节点计成新票", async () => {
    const mock = mockModel((request) => request.nodeId.includes("-revision-")
      ? { ...proposal(roleFor(request), "match"), response, evidenceRefs: ["not-given/match"] }
      : defaultOutput(request));
    const result = await runDeliberation(input(mock.live));
    expect(result.stage).toBe("partial");
    expect(result.nodes.filter((n) => n.phase === "revision").every((n) => n.status === "failed")).toBe(true);
    expect(result.decision?.support).toEqual({ profit: 2, match: 1, volume: 0 });
    expect(result.decision?.recommendedId).toBe("profit");
  });

  test("即便所有模型票偏好更高风险方案，推荐也不能越过最少失败层", async () => {
    const mock = mockModel((request) => request.nodeId.includes("-challenge-") ? { challenges: [] } : proposal(roleFor(request), "volume"));
    const args = input(mock.live);
    const result = await runDeliberation({ ...args, collaboration: {
      ...args.collaboration,
      comparison: args.collaboration.comparison!.map((row) => ({ ...row, failCount: row.candidateId === "profit" ? 0 : 2 })),
    } });
    expect(result.decision?.support).toEqual({ profit: 0, match: 0, volume: 3 });
    expect(result.decision?.recommendedId).toBe("profit");
    expect(result.decision?.reason).toContain("模型不能覆盖数值风控");
  });

  test("每节点最多两次，具体结构错误进入纠错提示，总请求最多十二次", async () => {
    const mock = mockModel((request) => request.attempt === 1 ? "not json" : defaultOutput(request));
    const result = await runDeliberation(input(mock.live));
    expect(mock.requests).toHaveLength(12);
    expect(result.nodes).toHaveLength(6);
    expect(result.nodes.every((n) => n.attempts === 2 && n.status === "completed")).toBe(true);
    expect(mock.requests.filter((r) => r.attempt === 2).every((r) => r.prompt.includes("完整 JSON 对象"))).toBe(true);
    expect(result.decision?.recommendedId).toBe("match");
  });

  test("整节点截止覆盖纠错时间，永不完成的请求超时后不能继续发布或计票", async () => {
    vi.useFakeTimers();
    try {
      const gate = deferred<unknown>();
      const mock = mockModel(() => gate.promise);
      const updates: DeliberationArtifact[] = [];
      const pending = runDeliberation({ ...input(mock.live), timeoutMs: 50, onUpdate: (artifact) => updates.push(artifact) });
      expect(mock.requests).toHaveLength(3);
      await vi.advanceTimersByTimeAsync(50);
      const result = await pending;
      expect(result.stage).toBe("partial");
      expect(result.decision).toBeNull();
      expect(result.nodes).toHaveLength(3);
      expect(result.nodes.every((n) => n.status === "failed" && n.attempts === 1 && n.elapsedMs === 50)).toBe(true);
      const publishedCount = updates.length;
      gate.resolve(proposal("procurement-lead"));
      await vi.runAllTimersAsync();
      expect(updates).toHaveLength(publishedCount);
      expect(result.nodes.every((n) => n.status === "failed")).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  test("纠错重试继承剩余截止时间而不是重新获得完整预算", async () => {
    vi.useFakeTimers();
    try {
      const mock = mockModel(async (request) => {
        if (request.nodeId.includes("-challenge-")) return { challenges: [] };
        await new Promise((resolve) => setTimeout(resolve, 30));
        return request.attempt === 1 ? "bad json" : defaultOutput(request);
      });
      const pending = runDeliberation({ ...input(mock.live), timeoutMs: 50 });
      await vi.advanceTimersByTimeAsync(50);
      const result = await pending;
      expect(mock.requests.filter((r) => r.attempt === 2)).toHaveLength(3);
      expect(mock.requests.filter((r) => r.attempt === 2).every((r) => r.timeoutMs === 20)).toBe(true);
      expect(result.decision).toBeNull();
      expect(result.nodes.every((n) => n.status === "failed" && n.attempts === 2)).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  test.each([
    { name: "推荐未引用本角色该候选", change: { evidenceRefs: ["pricing-lead/profit"] } },
    { name: "摘要过长", change: { summary: "字".repeat(361) } },
    { name: "额外数字字段", change: { priceCents: 9999 } },
    { name: "摘要编造金额", change: { summary: "我推荐这个商品因为利润可以达到999元且毫无风险" } },
    { name: "未知候选", change: { candidateId: "invented" } },
  ])("$name 被拒绝且两次失败后不投票", async ({ change }) => {
    const mock = mockModel((request) => {
      if (request.nodeId.includes("-challenge-")) return { challenges: [] };
      return { ...proposal(roleFor(request)), ...change };
    });
    const result = await runDeliberation(input(mock.live));
    const valid = result.nodes.filter((n) => n.phase === "proposal" && n.status === "completed");
    // The cross-role citation is valid only for pricing itself; all other malformed payloads fail every role.
    expect(valid.length).toBe(change.evidenceRefs ? 1 : 0);
    expect(result.stage).toBe("partial");
    if (valid.length === 0) expect(result.decision).toBeNull();
  });

  test("单一JSON代码围栏可解析，缺失模型或数值报告在调用模型前拒绝", async () => {
    const mock = mockModel((request) => "```json\n" + JSON.stringify(request.nodeId.includes("-challenge-") ? { challenges: [] } : proposal(roleFor(request))) + "\n```");
    const result = await runDeliberation(input(mock.live));
    expect(result.stage).toBe("completed");
    const invalidModel = input(mock.live);
    await expect(runDeliberation({ ...invalidModel, live: null as unknown as LiveLlm })).rejects.toThrow("configured live model");
    const before = mock.requests.length;
    await expect(runDeliberation({ ...invalidModel, collaboration: { ...invalidModel.collaboration, analyses: [] } })).rejects.toThrow("numeric report");
    expect(mock.requests).toHaveLength(before);
  });
});
