# Evidence-Driven Agent Review System Specification

## 1. Overview & Problem Definition

The **AgentOps Listing Review Console** evaluates e-commerce product launch viability by synthesizing merchant inputs, platform rules, cost models, and demand estimates. 

Currently, the platform has deterministic financial tools and heuristic multi-specialist collaboration. However, the LLM integration has three major gaps:
1. **Shallow Reasoning & Tool Disconnect (P1)**: Models primarily vote on pre-calculated candidate rows rather than exercising substantive reasoning through active, whitelisted read-only tool calls, scenario stress-testing, and dynamic parameter correction.
2. **Lack of an Objective Benchmark (P2)**: There is no frozen, fair evaluation benchmark comparing agent orchestration topologies (rule baseline vs. self-checking single agent vs. multi-agent with independent review vs. ablation without review) under strictly matched conditions.
3. **Evidence Legibility & Honest Demo Claims (P3)**: Merchants need an intuitive, paper-and-stamp walkthrough showing proposal, interrogation, local correction, and palm approval, clearly distinguishing synthetic test fixtures from real materials and simulated projections from historical track records.

This specification defines the convergence of the listing review system into a **closed-loop reasoning, tool-grounded, benchmarked, and merchant-verifiable architecture**.

---

## 2. Core Design Principles & Trade-offs

| Design Decision | Chosen Approach | Rejected Alternative | Rationale |
| --- | --- | --- | --- |
| **Arithmetic & Economic Execution** | Deterministic whitelisted tools ONLY (`pricing.unit-cost`, `pricing.simulate`, etc.) | LLM generating or adjusting numbers directly in prose | Language models hallucinate financial numbers. Arithmetic and Monte Carlo simulations must remain 100% deterministic and mathematically sound. |
| **Tool Calling Surface** | Strict read-only whitelist with Zod schemas and call budgets | Free-form function calling or shell execution | Prevents unintended side effects, security escalations, and cost blowups. Read-only tools guarantee execution safety. |
| **Agent Collaboration Topology** | 3 Specialists (Procurement, Pricing, Growth) + 1 Independent Chair Auditor | Generic multi-agent swarms (8-15 agents) or single prompt | 3 business roles represent genuine conflicting incentives (supply vs. margin vs. scale). The independent chair provides objective adversarial review without role bloat. |
| **Correction Mechanism** | Local parameter adjustment and candidate switching, bounded to $\le 2$ retry attempts | Unbounded ReAct loops or prompt retraining | Unbounded loops cause runaway latency and token costs. Bounded local correction converges predictably or halts. |
| **Evaluation Integrity** | Frozen 12-case synthetic benchmark + offline deterministic harness before model tuning | Evaluating on live arbitrary queries or cherry-picked test runs | Prevents overfitting and gaming of results. Golden benchmarks must be frozen upfront. |
| **Fallback Status** | `llm.mode = "fallback"` explicitly tracked; never counted as `live.success` | Silently substituting rule outputs as live model success | Absolute honesty in benchmarking and operations. Fallback is error recovery, not live AI success. |
| **Visual Direction** | Paper & stamp aesthetic (`#fdfbf5`, `#201c16`, `#c4442b`, `#2e6b52`), 320px responsive | Modern generic SaaS card UI with neon gradients | Respects merchant ledger metaphor, preserves existing brand identity, avoids generic AI interface tropes. |

---

## 3. Subsystem Architecture

### 3.1 Whitelisted Read-Only Tool Contracts (`src/templates/agentops/tools.ts`)

The tool subsystem provides a structured, sandboxed interface between agent reasoning and deterministic calculations:

```typescript
export type ToolName =
  | "pricing.unit-cost"
  | "pricing.break-even"
  | "pricing.candidates"
  | "pricing.simulate"
  | "pricing.verify"
  | "knowledge.search"
  | "product.parse";

export type ToolCallRequest<T = unknown> = {
  readonly tool: ToolName;
  readonly params: T;
  readonly callerRole: string;
  readonly runId: string;
};

export type ToolCallResult<R = unknown> = {
  readonly tool: ToolName;
  readonly ok: boolean;
  readonly data?: R;
  readonly error?: string;
  readonly elapsedMs: number;
};
```

#### Whitelist Specifications:
1. `pricing.unit-cost`: Input: `{ buyCents, packagingCents, shippingCents, commissionRate, payFeeRate, returnRate, returnSalvage }`. Output: `UnitCost`.
2. `pricing.break-even`: Input: `{ unitCostCents, commissionRate, payFeeRate }`. Output: `{ breakEvenCents }`.
3. `pricing.candidates`: Input: `{ product: ProductInput, platformPreset: PlatformPreset }`. Output: `readonly Candidate[]`.
4. `pricing.simulate`: Input: `{ product: ProductInput, priceCents: number, days?: number, runs?: number }`. Output: `SimulationSummary` (p10, p50, p90, minCashCents, stockoutDays).
5. `pricing.verify`: Input: `{ product: ProductInput, priceCents: number, promoPriceCents?: number }`. Output: `readonly CheckRow[]`.
6. `knowledge.search`: Input: `{ query: string, platform?: string }`. Output: `readonly KbEntry[]` (platform commission floors, return rate benchmarks).
7. `product.parse`: Input: `{ text: string }`. Output: `IntakeResult` (extracted verifiable facts).

**Budget Ceiling**:
- Maximum 6 tool calls per specialist node.
- Maximum 24 tool calls per complete review run.
- Per-call timeout: 5,000ms.

---

### 3.2 Evidence Ledger & Anti-Hallucination Protocol (`src/templates/agentops/evidence-ledger.ts`)

To ensure that model conjectures are never recorded as merchant facts:
- **Fact Provenance Tagging**:
  - `merchant_explicit`: Sourced directly from user task text or structured input.
  - `link_extracted`: Extracted from parsed URL/text with verifiable evidence.
  - `rule_assumption`: Explicit system default, visually tagged as "演示假设" (simulation assumption).
- **Output Reference Validation**:
  - Agent proposals must strictly cite valid Evidence IDs (e.g. `procurement-lead/profit`, `sim/match/stress-buy`).
  - Prose outputs are checked via regex and Zod schemas to forbid inline invented numbers. Numeric claims must resolve to referenced tool outputs.

---

### 3.3 Closed-Loop Deliberation & Correction (`src/templates/agentops/deliberation.ts`)

The deliberation workflow enforces an adversarial, tool-grounded 4-stage protocol:

```
[Specialists Parallel Analysis]
      │ (Invoke whitelisted tools: simulate, verify, unit-cost)
      ▼
[Phase 1: Structured Proposals] (procurement, pricing, growth)
      │
      ▼
[Phase 2: Independent Chair Interrogation] (Auditor identifies conflict & stress tests)
      │
      ▼
[Phase 3: Targeted Revision or Stopping] (Specialists respond, adjust parameter or halt)
      │
      ▼
[Phase 4: Algorithmic Adjudication] (Code enforces hard financial & risk gates)
      │
      ├─► Pass ──► Proceed to Copy & Palm Approval Gate
      └─► Fail ──► Reject / Propose Merchant Refusal
```

#### Node Protocol:
1. **Proposal**: Specialist submits proposal `{ candidateId, summary, evidenceRefs, concerns }`.
2. **Interrogation**: Chair reviews actual proposals, identifies contradictions (e.g., volume strategy causing negative cashflow under supplier stress), and issues targeted questions with evidence references.
3. **Revision / Stop**: Specialist may re-run `pricing.simulate` with modified assumptions (e.g., lower ad budget), switch candidate recommendation, or recommend halting.
4. **Adjudication**: Code calculates consensus, verifies hard risk constraints, and selects the lowest-risk candidate with highest p10 profit. If all candidates fail critical checks (e.g., negative margin), the system outputs a formal `reject` decision.

---

### 3.4 Frozen Evaluation Benchmark & Topologies (`src/templates/agentops/eval/`)

#### Frozen Synthetic Dataset (12 Cases across 6 Archetypes):
1. **Standard Normal (2 cases)**:
   - `std-apparel`: T-shirt on Pinduoduo, complete facts, standard margins.
   - `std-home`: Cervical pillow on JD, standard pricing, positive cashflow.
2. **Missing Facts (2 cases)**:
   - `missing-buy-shipping`: Missing purchase and shipping costs -> Must trigger active clarification, cannot hallucinate costs.
   - `missing-competitor-price`: Missing competitor anchor -> Must trigger clarification.
3. **Conflicting Evidence (2 cases)**:
   - `conflict-demand-orders`: User claims 1,000 daily orders on niche item with category cap of 50 -> Must trigger interrogation and risk warning.
   - `conflict-price-inversion`: User claims competitor price lower than raw procurement cost -> Must flag break-even impossibility.
4. **Cash & Capital Constraints (2 cases)**:
   - `cash-tight-volume`: Low working capital (¥500), high volume demand -> Volume strategy causes 22 days stockout; must downgrade or reject volume strategy.
   - `cash-settle-delay`: Long settlement platform (15 days), cash drained -> Must warn on cashflow collapse.
5. **Tool & Model Failures (2 cases)**:
   - `fail-llm-timeout`: Model fails to complete within budget -> Must safely fall back to deterministic rules with `llm.mode = 'fallback'`.
   - `fail-malformed-json`: Model outputs unparseable markdown -> Retry once with error feedback; on second failure, fallback.
6. **Hard Refusal Cases (2 cases)**:
   - `reject-negative-margin`: Cost ¥45, competitor ¥30, negative margin across all strategies -> Must recommend merchant rejection.
   - `reject-extreme-return`: 60% return rate on fragile goods wiping out profits -> Must advise against launch.

#### 4 Comparative Orchestration Topologies:
1. `rule`: Deterministic rule baseline (0 model calls).
2. `single-agent`: Single model prompt given all facts, tasked with analysis, invoking tools, and verifying itself.
3. `collab-with-review`: Multi-agent team with 3 specialists, independent chair review, revision, and adjudication.
4. `collab-no-review`: Multi-agent team with 3 specialists proposing, directly adjudicated without chair challenge/revision.

#### Strict Experimental Controls:
- **Same Model**: Default `inherit` / current session model; in mock tests, identical deterministic responses.
- **Same Tools**: Identical whitelisted tool registry.
- **Same Input Set**: Evaluated across all 12 frozen cases.
- **Same Budget Ceiling**: Max 16,000 total tokens, max 24 tool calls, 60s total timeout per run.

#### Evaluation Metrics:
1. `missed_risk_rate`: $\frac{\text{Unidentified Critical Violations}}{\text{Total Ground-Truth Violations}} \times 100\%$ (Target: $0\%$).
2. `groundless_rate`: $\frac{\text{Invented Numbers / Unbacked Claims}}{\text{Total Claims}} \times 100\%$ (Target: $0\%$).
3. `correct_refusal_rate`: $\frac{\text{Correct Clarifications / Rejections}}{\text{Incomplete / Unviable Cases}} \times 100\%$ (Target: $100\%$).
4. `cost_and_latency`: p50/p90 latency (ms), prompt tokens, completion tokens, tool call count.
5. `unmatched_conditions_count`: Total unmatched expectations logged.

---

### 3.5 Demo Evidence & Merchant Walkthrough (P3)

- **Walkthrough Pipeline**:
  `Merchant Input / Intake` $\rightarrow$ `Specialist Proposals` $\rightarrow$ `Chair Interrogation` $\rightarrow$ `Local Revision / Parameter Adjustment` $\rightarrow$ `Merchant Palm Gate (Approve/Reject)` $\rightarrow$ `Sealed Event Replay`.
- **Honest Disclaimers**:
  - Constructed sample banner: `[构造样例] 本案例为测试构造数据，非真实店铺经营材料`.
  - Simulation disclaimer: `[仿真推演] 30天蒙特卡洛随机模拟（200次采样），非确定性经营业绩承诺`.
- **Responsive Layout**:
  - 320px viewport guaranteed zero horizontal scroll.
  - Risk summary and approval actions prominently displayed above the fold.

---

## 4. Protection Boundaries & Zero Semantic Mutation Check

The following files and components are strictly protected:
1. `src/engine/**`: Engine scheduler, replay, hash, verification pipelines, LLM client, JSON canonicalizer.
2. `src/templates/simshop/**`: Simshop simulation engine, market dynamics, supplier workflows.
3. `pricing math` (`src/templates/pricing/economics.ts`, `src/templates/pricing/simulate.ts`): Mathematical formulas for unit costs, break-even price, Monte Carlo cashflow distributions.
4. `legacy APIs`: `/api/platforms`, `/api/plans`, `/api/agentops/catalog`, `/api/agentops/runs` (must retain backward-compatible responses).
5. `v1 fingerprints`: Existing event hash structures (`eventHash`) and sealed run verification (`verifyRunIntegrity`) must remain valid.

> [!IMPORTANT]
> **Boundary Finding**: No modifications to protected files (`src/engine/`, `src/templates/simshop/`, `pricing math`) are necessary. All new capabilities (tool contracts, evidence ledger, deliberation loop, evaluation harness) are implemented strictly in the template, server, and web application layers.

---

## 5. Live Blockers & Degradation Strategy

| Risk / Dependency | Blocker Condition | Graceful Degradation Strategy |
| --- | --- | --- |
| **Model Credentials / Budget** | `AGENTOPS_LLM_BASE_URL` or `API_KEY` missing, unauthorized (401/403), or paid token quota unconfirmed | Default to offline harness with deterministic `MockLlm` contracts. All unit tests, contract checks, and synthetic benchmarks run 100% offline. Zero paid API calls. |
| **Model Failure / Timeout** | Upstream LLM gateway timeout (>45s) or HTTP 5xx | Automatically fall back to deterministic rule analysis; record `llm.mode = "fallback"` and `llm.fallback` event; never misrepresent fallback as live success. |
| **Malformed Output** | Model outputs non-JSON or invalid schema | Retry once with explicit syntax error prompt; on second failure, fall back to rule-based defaults. |
| **Merchant Input Incomplete** | Critical fields (`buyCents`, `shippingCents`) missing | Intake preflight triggers active clarification questions; halts execution before running full review. |
