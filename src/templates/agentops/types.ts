import type { Candidate, CandidateId, PlanCopy, ProductInput, UnitCost } from "../pricing/model.js";

export const CAPABILITIES = ["planning", "intake", "cost", "market", "risk", "copy", "report"] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type AgentSpec = {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly version: string;
  readonly capabilities: Readonly<Partial<Record<Capability, number>>>;
  readonly tools: readonly string[];
  readonly maxCallsPerRun: number;
};

export type ToolSpec = {
  readonly name: string;
  readonly title: string;
  readonly kind: "parse" | "compute" | "simulate" | "kb";
};

export type WorkflowNode =
  | { readonly kind: "agent"; readonly id: string; readonly capability: Capability; readonly title: string; readonly dependsOn: readonly string[] }
  | { readonly kind: "tool"; readonly id: string; readonly tool: string; readonly title: string; readonly dependsOn: readonly string[] }
  | { readonly kind: "parallel"; readonly id: string; readonly branches: readonly string[]; readonly title: string; readonly dependsOn: readonly string[] }
  | { readonly kind: "condition"; readonly id: string; readonly predicate: string; readonly then: string; readonly otherwise: string; readonly title: string; readonly dependsOn: readonly string[] }
  | { readonly kind: "loop"; readonly id: string; readonly body: readonly string[]; readonly until: string; readonly maxIterations: number; readonly title: string; readonly dependsOn: readonly string[] }
  | { readonly kind: "verify"; readonly id: string; readonly pipeline: readonly string[]; readonly title: string; readonly dependsOn: readonly string[] }
  | { readonly kind: "humanGate"; readonly id: string; readonly title: string; readonly dependsOn: readonly string[] }
  | { readonly kind: "commit"; readonly id: string; readonly title: string; readonly dependsOn: readonly string[] };

export type WorkflowDocument = {
  readonly id: string;
  readonly title: string;
  readonly intent: string;
  readonly nodes: readonly WorkflowNode[];
};

export type EventType =
  | "run.started"
  | "dispatch.decided"
  | "node.started"
  | "tool.called"
  | "node.output"
  | "verify.checked"
  | "loop.iteration"
  | "loop.adjusted"
  | "gate.awaiting"
  | "gate.decided"
  | "gate.autoApproved"
  | "node.skipped"
  | "llm.completed"
  | "llm.fallback"
  | "run.paused"
  | "run.completed";

export type RunEvent = {
  readonly seq: number;
  readonly type: EventType;
  readonly nodeId: string | null;
  readonly agentId: string | null;
  readonly title: string;
  readonly detail: string;
  readonly hash: string;
  readonly prevHash: string;
};

export type DispatchCandidate = {
  readonly agentId: string;
  readonly score: number;
  readonly note: string;
};

export type Dispatch = {
  readonly nodeId: string;
  readonly need: Capability;
  readonly chosen: string;
  readonly rationale: string;
  readonly candidates: readonly DispatchCandidate[];
};

export type VerificationStatus = "pass" | "warn" | "fail";

export type Verification = {
  readonly stage: string;
  readonly verifier: string;
  readonly title: string;
  readonly status: VerificationStatus;
  readonly detail: string;
};

export type LoopAction = "ad-budget" | "promo-discount" | "switch-candidate";

export type LoopSnapshot = {
  readonly chosenId: string | null;
  readonly priceCents: number;
  readonly promoPriceCents: number;
  readonly margin: number;
  readonly p10Cents: number;
  readonly adDailyBudgetCents: number;
  readonly promoDiscount: number;
  readonly stockoutDays: number;
  readonly failTitles: readonly string[];
};

export type LoopIteration = {
  readonly role: string;
  readonly iteration: number;
  readonly verdicts: readonly Verification[];
  readonly adjustment: string | null;
  readonly action?: LoopAction;
  readonly before: LoopSnapshot;
  readonly after: LoopSnapshot;
};

export type RiskRow = {
  readonly id?: string;
  readonly title: string;
  readonly status: VerificationStatus;
  readonly detail: string;
  readonly owner?: string;
};

export type PriceRow = {
  readonly id: string;
  readonly label: string;
  readonly priceCents: number;
  readonly margin: number;
  readonly profitP50Cents: number;
  readonly profitP10Cents: number;
};

export type Artifacts = {
  readonly product: ProductInput | null;
  readonly unit: UnitCost | null;
  readonly breakEvenCents: number;
  readonly candidates?: readonly Candidate[];
  readonly prices: readonly PriceRow[];
  readonly chosenId: string | null;
  readonly risk: { readonly level: VerificationStatus; readonly rows: readonly RiskRow[] } | null;
  readonly copy: PlanCopy | null;
  readonly bullets: readonly string[];
  readonly report: readonly string[];
  readonly assumptions: readonly string[];
};

export type RunStatus = "running" | "awaiting-approval" | "completed" | "rejected";

export type GateAction = "approve" | "reject";

export type GateDecisionInput = {
  readonly action: GateAction;
  readonly candidateId?: CandidateId | undefined;
};

export type SchedulerState = {
  readonly loads: Readonly<Record<string, number>>;
  readonly calls: Readonly<Record<string, number>>;
  readonly failures: Readonly<Record<string, number>>;
  readonly runs: Readonly<Record<string, number>>;
  readonly preferredCandidateId: CandidateId | null;
  readonly gateDecision: GateAction | null;
  readonly decidedCandidateId: CandidateId | null;
  readonly iteration: number;
  readonly adjustments: readonly string[];
  readonly facts: import("../intake/types.js").IntakeResult | null;
};

export type LlmInfo = {
  readonly mode: "rule" | "live" | "fallback";
  readonly model: string | null;
  readonly note: string;
};

export type AgentRun = {
  readonly id: string;
  readonly createdAt: string;
  readonly status: RunStatus;
  readonly task: { readonly text: string; readonly autoApprove: boolean };
  readonly workflow: WorkflowDocument;
  readonly agents: readonly AgentSpec[];
  readonly dispatches: readonly Dispatch[];
  readonly events: readonly RunEvent[];
  readonly verifications: readonly Verification[];
  readonly loops: readonly LoopIteration[];
  readonly artifacts: Artifacts;
  readonly llm: LlmInfo;
  // When status is "completed" or "rejected", fingerprint seals { workflow, events, artifacts }.
  // When status is "awaiting-approval" or "running", fingerprint reflects the current partial chain.
  readonly fingerprint: string;
  readonly notes: readonly string[];
  readonly gateDecision: GateAction | null;
  readonly preferredCandidateId: CandidateId | null;
  readonly decidedCandidateId: CandidateId | null;
  readonly failures: Readonly<Record<string, number>>;
  readonly loads: Readonly<Record<string, number>>;
  readonly calls: Readonly<Record<string, number>>;
  readonly scheduler: SchedulerState;
};

export type RunEventListener = (event: RunEvent, snapshot: AgentRun) => void;

export type RunSummary = {
  readonly id: string;
  readonly createdAt: string;
  readonly status: RunStatus;
  readonly taskText: string;
  readonly chosenId: string | null;
  readonly priceCents: number;
  readonly margin: number;
  readonly loops: number;
  readonly failures: number;
};

export type InternalState = {
  readonly taskText: string;
  readonly autoApprove: boolean;
  gateDecision: GateAction | null;
  decidedCandidateId: CandidateId | null;
  targetMargin: number;
  facts: import("../intake/types.js").IntakeResult | null;
  product: ProductInput | null;
  unit: UnitCost | null;
  breakEvenCents: number;
  candidates: readonly Candidate[];
  chosenId: string | null;
  preferredCandidateId: CandidateId | null;
  risk: { readonly level: VerificationStatus; readonly rows: readonly RiskRow[] } | null;
  copy: PlanCopy | null;
  bullets: readonly string[];
  report: string[];
  llm: LlmInfo;
  readonly assumptions: string[];
  readonly verifications: Verification[];
  readonly loops: LoopIteration[];
  readonly adjustments: string[];
  readonly loads: Record<string, number>;
  readonly calls: Record<string, number>;
  readonly failures: Record<string, number>;
  readonly runs: Record<string, number>;
  readonly dispatches: Dispatch[];
  gateNeeded: boolean;
};
