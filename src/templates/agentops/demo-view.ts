/**
 * Presentation for the merchant demo. Run status stays on the runner contract;
 * the console maps honest clarify / system-reject onto labels judges can read.
 */
import type { RunStatus } from "./types.js";

export type DemoTone = "ochre" | "seal" | "jade" | "ink";

export type DemoDataStatus = RunStatus | "needs-info" | "idle";

export type RunViewInput = {
  readonly status: RunStatus;
  readonly gateDecision: "approve" | "reject" | null;
  readonly artifacts: {
    readonly product: object | null;
    readonly chosenId: string | null;
  };
  readonly events: readonly { readonly title: string }[];
};

export type DemoView = {
  readonly dataStatus: DemoDataStatus;
  readonly label: string;
  readonly summary: string;
  readonly tone: DemoTone;
  readonly gatePrompt: string;
  readonly sealLabel: string | null;
  readonly rejectHeadline: string | null;
  readonly rejectBody: string | null;
};

export function isClarifyRun(run: Pick<RunViewInput, "status" | "artifacts">): boolean {
  return run.status === "completed" && run.artifacts.product === null && run.artifacts.chosenId === null;
}

export function isSystemReject(run: Pick<RunViewInput, "status" | "events">): boolean {
  return run.status === "rejected" && run.events.some((event) => event.title === "系统驳回上架方案");
}

export function presentRun(run: RunViewInput | null, busy: boolean): DemoView {
  if (busy) {
    return {
      dataStatus: "running",
      label: "会签进行中",
      summary: "各角色正在核算",
      tone: "ochre",
      gatePrompt: "结果按实际执行进度更新，全部评审完成后解锁拍板。",
      sealLabel: null,
      rejectHeadline: null,
      rejectBody: null,
    };
  }
  if (run === null) {
    return {
      dataStatus: "idle",
      label: "还没开始",
      summary: "各环节的结论会记在下面",
      tone: "ink",
      gatePrompt: "评审结束后，在这里选稳价、跟价或冲量，然后通过或驳回。",
      sealLabel: null,
      rejectHeadline: null,
      rejectBody: null,
    };
  }
  if (isClarifyRun(run)) {
    return {
      dataStatus: "needs-info",
      label: "待补充资料",
      summary: "缺了关键经营数据，先补上再核算，不会用演示数字给出上架建议",
      tone: "ochre",
      gatePrompt: "补齐采购价、运费或竞品价后，再开始核算。",
      sealLabel: null,
      rejectHeadline: null,
      rejectBody: null,
    };
  }
  if (isSystemReject(run)) {
    return {
      dataStatus: "rejected",
      label: "系统已驳回",
      summary: "按竞品价核算无法保本，系统已驳回上架，不是掌柜手动驳回",
      tone: "seal",
      gatePrompt: "系统已按竞品价驳回，不能再改决定。",
      sealLabel: "系统已驳回 · 已封存",
      rejectHeadline: "系统已驳回上架方案",
      rejectBody: "按竞品价核算无法保本且毛利为负，这件不能上架。",
    };
  }
  if (run.status === "awaiting-approval") {
    return {
      dataStatus: "awaiting-approval",
      label: "待掌柜拍板",
      summary: "核算和修正已经好了，就等你拍板",
      tone: "seal",
      gatePrompt: "现在选策略，通过后会按这个方案记下。",
      sealLabel: null,
      rejectHeadline: null,
      rejectBody: null,
    };
  }
  if (run.status === "rejected") {
    return {
      dataStatus: "rejected",
      label: "已驳回封存",
      summary: "你已驳回，这件不上架",
      tone: "seal",
      gatePrompt: "这次方案已被驳回，不能再改决定。",
      sealLabel: "掌柜已驳回 · 已封存",
      rejectHeadline: "掌柜已驳回",
      rejectBody: "这件不上架，也不会生成通过报告。",
    };
  }
  return {
    dataStatus: "completed",
    label: "已拍板封存",
    summary: "已经通过，并记下了这一次的结论",
    tone: "jade",
    gatePrompt: "已记下这次结论。",
    sealLabel: "掌柜已拍板 · 已封存",
    rejectHeadline: null,
    rejectBody: null,
  };
}
