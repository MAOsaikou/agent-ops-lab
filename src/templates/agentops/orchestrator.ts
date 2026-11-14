import { verifyRunIntegrity, type RunIntegrity } from "./integrity.js";
import type { LiveLlm } from "./llm.js";
import {
  DecisionConflictError,
  isSameDecision,
  resumeAgentWorkflow,
  runAgentWorkflow,
  type WorkflowRunOptions,
} from "./runner.js";
import { parseStoredRun, summarizeStoredRun } from "./stored-run.js";
import type { AgentRun, GateDecisionInput, RunEventListener, RunSummary } from "./types.js";

export type ProductRunInput = {
  readonly id: string;
  readonly taskText: string;
  readonly autoApprove: boolean;
  readonly createdAt: string;
};

export type StartProductRunConfig = {
  readonly live?: LiveLlm | null | undefined;
  readonly onEvent?: RunEventListener | undefined;
  readonly options?: WorkflowRunOptions | undefined;
};

export type StoredRunInspection =
  | { readonly kind: "ok"; readonly run: AgentRun }
  | { readonly kind: "missing" }
  | { readonly kind: "corrupt"; readonly reason: string };

export type ProductRunStore = {
  save(run: AgentRun): void;
  load(id: string): AgentRun | undefined;
  inspect(id: string): StoredRunInspection;
  list(): readonly RunSummary[];
};

export type ProductVerificationResult =
  | { readonly kind: "ok"; readonly run: AgentRun; readonly integrity: RunIntegrity }
  | { readonly kind: "missing" }
  | { readonly kind: "corrupt"; readonly reason: string };

export class ProductRunNotFoundError extends Error {
  readonly runId: string;

  constructor(runId: string) {
    super(`Run not found: ${runId}`);
    this.name = "ProductRunNotFoundError";
    this.runId = runId;
  }
}

export class ProductRunCorruptError extends Error {
  readonly runId: string;

  constructor(runId: string, reason: string) {
    super(reason);
    this.name = "ProductRunCorruptError";
    this.runId = runId;
  }
}

export type ProductOrchestrator = {
  start(input: ProductRunInput, config?: StartProductRunConfig): Promise<AgentRun>;
  resume(runOrId: AgentRun | string, decision: GateDecisionInput, onEvent?: RunEventListener): Promise<AgentRun>;
  inspect(id: string): StoredRunInspection;
  verify(id: string): ProductVerificationResult;
  list(): readonly RunSummary[];
};

export function verifyProductRun(run: AgentRun): RunIntegrity {
  return verifyRunIntegrity(run);
}

/**
 * Product-domain orchestration facade for AgentOps workflows.
 *
 * Legacy `src/engine/workflow/executor.ts` (`runWorkflow`) and `src/engine/events/store.ts`
 * remain separate for simshop/meeting workflows because their event schema, SQLite store,
 * and workflow document types diverge from AgentOps `AgentRun` and its sealed v1 fingerprints.
 */
export function createProductOrchestrator(deps: { readonly store?: ProductRunStore | undefined } = {}): ProductOrchestrator {
  const { store } = deps;

  return {
    async start(input, config = {}) {
      const run = await runAgentWorkflow(
        input,
        config.live ?? null,
        config.onEvent,
        config.options,
      );
      store?.save(run);
      return run;
    },

    async resume(runOrId, decision, onEvent) {
      let current: AgentRun;
      if (typeof runOrId === "string") {
        if (store === undefined) {
          throw new ProductRunNotFoundError(runOrId);
        }
        const inspected = store.inspect(runOrId);
        if (inspected.kind === "missing") {
          throw new ProductRunNotFoundError(runOrId);
        }
        if (inspected.kind === "corrupt") {
          throw new ProductRunCorruptError(runOrId, inspected.reason);
        }
        current = inspected.run;
      } else {
        current = runOrId;
      }

      if (current.status !== "awaiting-approval") {
        if ((current.status === "completed" || current.status === "rejected") && isSameDecision(current, decision)) {
          return current;
        }
        const code = current.gateDecision !== null ? "decision-conflict" : "run-not-awaiting-decision";
        throw new DecisionConflictError(
          code,
          current.status,
          code === "decision-conflict"
            ? "该运行已封存不同的人工决策，禁止覆盖"
            : "该运行当前不在等待人工确认阶段",
        );
      }

      const updated = await resumeAgentWorkflow(current, decision, onEvent);
      store?.save(updated);
      return updated;
    },

    inspect(id) {
      if (store === undefined) {
        return { kind: "missing" };
      }
      return store.inspect(id);
    },

    verify(id) {
      if (store === undefined) {
        return { kind: "missing" };
      }
      const inspected = store.inspect(id);
      if (inspected.kind !== "ok") {
        return inspected;
      }
      return {
        kind: "ok",
        run: inspected.run,
        integrity: verifyRunIntegrity(inspected.run),
      };
    },

    list() {
      return store ? store.list() : [];
    },
  };
}

export const defaultProductOrchestrator: ProductOrchestrator = createProductOrchestrator();

export { DecisionConflictError, isSameDecision, parseStoredRun, summarizeStoredRun };
