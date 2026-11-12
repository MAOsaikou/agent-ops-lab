import { describe, expect, test } from "vitest";

import type { LlmCompletion, LlmRequest } from "../src/engine/llm/client.js";
import { runCollaboration } from "../src/templates/agentops/collaboration.js";
import {
  runDeliberation,
  type DeliberationProposal,
} from "../src/templates/agentops/deliberation.js";
import type { LiveLlm } from "../src/templates/agentops/llm.js";
import { buildCandidates } from "../src/templates/pricing/candidates.js";
import type { CandidateId, ProductInput } from "../src/templates/pricing/model.js";
import { PLATFORM_PRESETS } from "../src/templates/pricing/platform.js";
import { SAMPLES } from "../src/templates/pricing/sample.js";

const question = "你的放量目标与备货承压存在冲突，请说明为何仍值得推荐并回应其他角色的顾虑";
const response = "我接受备货约束并修订推荐，优先选择能够兼顾订单增长与资金承压的方案";
const summary = "优先保护利润空间并兼顾当前备货能力，仍需核实商家的履约条件";

const roles = ["procurement-lead", "pricing-lead", "growth-operator"] as const;
type CollabRole = (typeof roles)[number];

function roleFor(request: LlmRequest): CollabRole {
  const role = roles.find((r) => request.nodeId.endsWith(r));
  if (!role) return "pricing-lead";
  return role;
}

function proposal(role: string, candidateId: CandidateId = "profit"): DeliberationProposal {
  return {
    candidateId,
    summary,
    evidenceRefs: [`${role}/${candidateId}`],
    concerns: ["仍需核实商家备货能力"],
  };
}

function mockModel(output: (req: LlmRequest) => unknown) {
  const requests: LlmRequest[] = [];
  const live: LiveLlm = {
    model: "mock-loop-model",
    baseUrl: "http://mock.invalid",
    client: {
      complete: async (req: LlmRequest): Promise<LlmCompletion> => {
        requests.push(structuredClone(req));
        const res = await output(req);
        return {
          text: typeof res === "string" ? res : JSON.stringify(res),
          usage: { promptTokens: 30, completionTokens: 20 },
        };
      },
    },
  };
  return { live, requests };
}

describe("Task 4: Substantive Reasoning & Whitelisted Tool Calling Closed Loop", () => {
  const baseProduct: ProductInput = SAMPLES[0]!.input;

  test("proposal and chair interrogation phases actually dispatch whitelisted tools", async () => {
    const mock = mockModel((req) => {
      if (req.nodeId.includes("-challenge-")) {
        return {
          challenges: [
            {
              targetRole: "growth-operator",
              question,
              evidenceRefs: ["procurement-lead/profit"],
            },
          ],
        };
      }
      if (req.nodeId.includes("-revision-")) {
        return { ...proposal("growth-operator", "profit"), response };
      }
      return proposal(roleFor(req), "profit");
    });

    const candidates = buildCandidates(baseProduct, PLATFORM_PRESETS[baseProduct.platform]);
    const collab = runCollaboration(baseProduct, candidates, "profit");

    const result = await runDeliberation({
      runId: "tool-loop-run-1",
      round: 1,
      product: baseProduct,
      candidates,
      collaboration: {
        ...collab,
        comparison: collab.comparison!.map((c) => ({ ...c, failCount: 0 })),
      },
      live: mock.live,
    });

    expect(result.stage).toBe("completed");
    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBeGreaterThan(0);

    const toolNames = result.toolCalls!.map((t) => t.tool);
    expect(toolNames).toContain("pricing.verify");
  });

  test("identical product input produces observably distinct tool paths driven by model reasoning", async () => {
    const candidates = buildCandidates(baseProduct, PLATFORM_PRESETS[baseProduct.platform]);
    const collab = runCollaboration(baseProduct, candidates, "profit");
    const profitCand = candidates.find((c) => c.id === "profit")!;
    const matchCand = candidates.find((c) => c.id === "match")!;
    const volumeCand = candidates.find((c) => c.id === "volume")!;

    // Model Reasoning A: Conservative / Profit-centric
    // All roles propose "profit", chair challenges pricing on "profit"
    const mockProfit = mockModel((req) => {
      if (req.nodeId.includes("-challenge-")) {
        return {
          challenges: [
            {
              targetRole: "pricing-lead",
              question: "为何坚持高利润方案而忽视冲量潜力？",
              evidenceRefs: ["pricing-lead/profit"],
            },
          ],
        };
      }
      if (req.nodeId.includes("-revision-")) {
        return { ...proposal("pricing-lead", "profit"), response: "高毛利是抵抗后期流量波动的关键壁垒" };
      }
      return proposal(roleFor(req), "profit");
    });

    // Model Reasoning B: Aggressive / Volume-driven with competitive match
    // Pricing proposes "volume", Procurement proposes "volume", Growth proposes "match"
    // Chair challenges growth on "volume"
    const mockVolume = mockModel((req) => {
      if (req.nodeId.includes("-challenge-")) {
        return {
          challenges: [
            {
              targetRole: "growth-operator",
              question: "放量低价是否会导致供应链缺货与周转断流？",
              evidenceRefs: ["growth-operator/volume"],
            },
          ],
        };
      }
      if (req.nodeId.includes("-revision-")) {
        return { ...proposal("growth-operator", "volume"), response: "已与供应链对齐，放量期间通过阶梯备货控制断流" };
      }
      const role = roleFor(req);
      if (role === "growth-operator") return proposal("growth-operator", "match");
      return proposal(role, "volume");
    });

    const resultProfit = await runDeliberation({
      runId: "path-reasoning-profit",
      product: baseProduct,
      candidates,
      collaboration: { ...collab, comparison: collab.comparison!.map((c) => ({ ...c, failCount: 0 })) },
      live: mockProfit.live,
    });

    const resultVolume = await runDeliberation({
      runId: "path-reasoning-volume",
      product: baseProduct,
      candidates,
      collaboration: { ...collab, comparison: collab.comparison!.map((c) => ({ ...c, failCount: 0 })) },
      live: mockVolume.live,
    });

    expect(resultProfit.toolCalls).toBeDefined();
    expect(resultVolume.toolCalls).toBeDefined();

    // 1. Tool parameter difference: Simulation priceCents strictly driven by proposed candidate
    const simCallProfit = resultProfit.toolCalls?.find((t) => t.tool === "pricing.simulate" && t.callerRole === "procurement-lead");
    const simCallVolume = resultVolume.toolCalls?.find((t) => t.tool === "pricing.simulate" && t.callerRole === "procurement-lead");
    expect(simCallProfit).toBeDefined();
    expect(simCallVolume).toBeDefined();
    expect((simCallProfit?.params as { priceCents: number }).priceCents).toBe(profitCand.priceCents);
    expect((simCallVolume?.params as { priceCents: number }).priceCents).toBe(volumeCand.priceCents);
    expect((simCallProfit?.params as { priceCents: number }).priceCents).not.toBe(
      (simCallVolume?.params as { priceCents: number }).priceCents,
    );

    // 2. Tool parameter difference: Pricing verify priceCents strictly driven by proposed candidate
    const verifyCallProfit = resultProfit.toolCalls?.find((t) => t.tool === "pricing.verify" && t.callerRole === "pricing-lead");
    const verifyCallVolume = resultVolume.toolCalls?.find((t) => t.tool === "pricing.verify" && t.callerRole === "pricing-lead");
    expect(verifyCallProfit).toBeDefined();
    expect(verifyCallVolume).toBeDefined();
    expect((verifyCallProfit?.params as { priceCents: number }).priceCents).toBe(profitCand.priceCents);
    expect((verifyCallVolume?.params as { priceCents: number }).priceCents).toBe(volumeCand.priceCents);

    // 3. Tool parameter difference: Growth unit-cost priceCents driven by proposed candidate (profit vs match)
    const unitCostProfit = resultProfit.toolCalls?.find((t) => t.tool === "pricing.unit-cost" && t.callerRole === "growth-operator");
    const unitCostVolume = resultVolume.toolCalls?.find((t) => t.tool === "pricing.unit-cost" && t.callerRole === "growth-operator");
    expect(unitCostProfit).toBeDefined();
    expect(unitCostVolume).toBeDefined();
    expect((unitCostProfit?.params as { priceCents: number }).priceCents).toBe(profitCand.priceCents);
    expect((unitCostVolume?.params as { priceCents: number }).priceCents).toBe(matchCand.priceCents);

    // 4. Tool existence difference: Volume proposal triggers break-even and match triggers knowledge search
    const breakEvenProfit = resultProfit.toolCalls?.find((t) => t.tool === "pricing.break-even");
    const breakEvenVolume = resultVolume.toolCalls?.find((t) => t.tool === "pricing.break-even");
    expect(breakEvenProfit).toBeUndefined();
    expect(breakEvenVolume).toBeDefined();

    const kbProfit = resultProfit.toolCalls?.find((t) => t.tool === "knowledge.search");
    const kbVolume = resultVolume.toolCalls?.find((t) => t.tool === "knowledge.search");
    expect(kbProfit).toBeUndefined();
    expect(kbVolume).toBeDefined();

    // 5. Chair tool calls: Chair questioning targets different roles/candidates
    const chairCallsProfit = resultProfit.toolCalls?.filter((t) => t.callerRole === "chair");
    const chairCallsVolume = resultVolume.toolCalls?.filter((t) => t.callerRole === "chair");
    expect(chairCallsProfit).toBeDefined();
    expect(chairCallsVolume).toBeDefined();
    expect(chairCallsProfit?.some((t) => t.tool === "pricing.verify")).toBe(true);
    expect(chairCallsVolume?.some((t) => t.tool === "pricing.simulate")).toBe(true);

    // 6. Overall tool call count differences
    expect(resultProfit.toolCalls!.length).not.toBe(resultVolume.toolCalls!.length);
  });

  test("chair challenge presence and targets directly alter chair tool calls and invocation count", async () => {
    const candidates = buildCandidates(baseProduct, PLATFORM_PRESETS[baseProduct.platform]);
    const collab = runCollaboration(baseProduct, candidates, "profit");

    // Case C: Chair finds consensus, issues 0 challenges
    const mockZeroChallenges = mockModel((req) => {
      if (req.nodeId.includes("-challenge-")) return { challenges: [] };
      return proposal(roleFor(req), "profit");
    });

    // Case D: Chair finds 2 conflicts, challenges procurement and growth
    const mockTwoChallenges = mockModel((req) => {
      if (req.nodeId.includes("-challenge-")) {
        return {
          challenges: [
            {
              targetRole: "procurement-lead",
              question: "备货周期能否支撑当前订单？",
              evidenceRefs: ["procurement-lead/profit"],
            },
            {
              targetRole: "growth-operator",
              question: "放量价格是否会造成负毛利？",
              evidenceRefs: ["growth-operator/volume"],
            },
          ],
        };
      }
      if (req.nodeId.includes("-revision-")) {
        return { ...proposal("procurement-lead", "profit"), response: "已确认备货周期并调整补货计划" };
      }
      return proposal(roleFor(req), "profit");
    });

    const resultZero = await runDeliberation({
      runId: "chair-zero-run",
      product: baseProduct,
      candidates,
      collaboration: { ...collab, comparison: collab.comparison!.map((c) => ({ ...c, failCount: 0 })) },
      live: mockZeroChallenges.live,
    });

    const resultTwo = await runDeliberation({
      runId: "chair-two-run",
      product: baseProduct,
      candidates,
      collaboration: { ...collab, comparison: collab.comparison!.map((c) => ({ ...c, failCount: 0 })) },
      live: mockTwoChallenges.live,
    });

    const chairCallsZero = resultZero.toolCalls?.filter((t) => t.callerRole === "chair") ?? [];
    const chairCallsTwo = resultTwo.toolCalls?.filter((t) => t.callerRole === "chair") ?? [];

    expect(chairCallsZero).toHaveLength(0);
    expect(chairCallsTwo).toHaveLength(2);
    expect(resultZero.toolCalls!.length).toBeLessThan(resultTwo.toolCalls!.length);
  });

  test("price inversion / cost conflict input triggers pricing.break-even tool call", async () => {
    // Input C: Price inversion (competitor price 29.90, but buy + shipping is 35.00)
    const conflictProduct: ProductInput = {
      ...baseProduct,
      buyCents: 3000,
      shippingCents: 800,
      competitorCents: 2500, // strictly lower than cost!
    };
    const conflictCandidates = buildCandidates(conflictProduct, PLATFORM_PRESETS[conflictProduct.platform]);
    const conflictCollab = runCollaboration(conflictProduct, conflictCandidates, "profit");

    const mock = mockModel((req) => {
      if (req.nodeId.includes("-challenge-")) return { challenges: [] };
      return proposal(roleFor(req), "profit");
    });

    const result = await runDeliberation({
      runId: "path-conflict",
      product: conflictProduct,
      candidates: conflictCandidates,
      collaboration: { ...conflictCollab, comparison: conflictCollab.comparison!.map((c) => ({ ...c, failCount: 0 })) },
      live: mock.live,
    });

    expect(result.toolCalls).toBeDefined();
    const breakEvenCall = result.toolCalls?.find((t) => t.tool === "pricing.break-even");
    expect(breakEvenCall).toBeDefined();
    expect(breakEvenCall?.ok).toBe(true);
  });

  test("model output JSON corruption triggers retry with error feedback and safe partial failure", async () => {
    const mock = mockModel((req) => {
      if (req.nodeId.endsWith("procurement-lead")) {
        // Return corrupt unparseable JSON on first attempt, then valid on retry
        if (req.attempt === 1) return "Corrupted { non-json output";
        return proposal("procurement-lead", "profit");
      }
      if (req.nodeId.includes("-challenge-")) return { challenges: [] };
      return proposal(roleFor(req), "profit");
    });

    const candidates = buildCandidates(baseProduct, PLATFORM_PRESETS[baseProduct.platform]);
    const collab = runCollaboration(baseProduct, candidates, "profit");

    const result = await runDeliberation({
      runId: "json-corrupt-run",
      product: baseProduct,
      candidates,
      collaboration: { ...collab, comparison: collab.comparison!.map((c) => ({ ...c, failCount: 0 })) },
      live: mock.live,
    });

    // The node retried once with error feedback
    const procNode = result.nodes.find((n) => n.role === "procurement-lead")!;
    expect(procNode.attempts).toBe(2);
    expect(procNode.status).toBe("completed");

    const retryReq = mock.requests.find((r) => r.nodeId.endsWith("procurement-lead") && r.attempt === 2);
    expect(retryReq).toBeDefined();
    expect(retryReq?.prompt).toContain("上次输出校验或调用失败");
  });

  test("unrecoverable model failure marks node as failed and does not count as live success", async () => {
    const mock = mockModel((req) => {
      if (req.nodeId.endsWith("pricing-lead")) {
        return "Permanent { unparseable syntax error";
      }
      if (req.nodeId.includes("-challenge-")) return { challenges: [] };
      return proposal(roleFor(req), "profit");
    });

    const candidates = buildCandidates(baseProduct, PLATFORM_PRESETS[baseProduct.platform]);
    const collab = runCollaboration(baseProduct, candidates, "profit");

    const result = await runDeliberation({
      runId: "permanent-fail-run",
      product: baseProduct,
      candidates,
      collaboration: { ...collab, comparison: collab.comparison!.map((c) => ({ ...c, failCount: 0 })) },
      live: mock.live,
    });

    expect(result.stage).toBe("partial");
    const failedNode = result.nodes.find((n) => n.role === "pricing-lead")!;
    expect(failedNode.status).toBe("failed");
    expect(failedNode.proposal).toBeUndefined();
    // Failed node must not vote
    expect(result.decision?.support["profit"]).toBe(2); // only procurement and growth voted
  });
});
