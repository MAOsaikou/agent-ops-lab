import { describe, expect, test } from "vitest";

import {
  isClarifyRun,
  isSystemReject,
  presentRun,
  type RunViewInput,
} from "../src/templates/agentops/demo-view.js";

function run(partial: Partial<RunViewInput> & Pick<RunViewInput, "status">): RunViewInput {
  return {
    gateDecision: null,
    artifacts: { product: { name: "demo" }, chosenId: "profit" },
    events: [],
    ...partial,
  };
}

describe("demo presentation for honest clarify and system reject", () => {
  test("completed with no product is a needs-info clarify, not a sealed approval", () => {
    const clarify = run({
      status: "completed",
      artifacts: { product: null, chosenId: null },
    });
    expect(isClarifyRun(clarify)).toBe(true);
    const view = presentRun(clarify, false);
    expect(view.dataStatus).toBe("needs-info");
    expect(view.label).toBe("待补充资料");
    expect(view.summary).toContain("不会用演示数字");
    expect(view.sealLabel).toBeNull();
    expect(view.rejectHeadline).toBeNull();
    expect(view.tone).toBe("ochre");
  });

  test("system reject is not labelled as a merchant decision", () => {
    const rejected = run({
      status: "rejected",
      gateDecision: "reject",
      events: [{ title: "系统驳回上架方案" }],
    });
    expect(isSystemReject(rejected)).toBe(true);
    const view = presentRun(rejected, false);
    expect(view.dataStatus).toBe("rejected");
    expect(view.label).toBe("系统已驳回");
    expect(view.rejectHeadline).toBe("系统已驳回上架方案");
    expect(view.sealLabel).toBe("系统已驳回 · 已封存");
    expect(view.summary).toContain("不是掌柜手动驳回");
  });

  test("a merchant reject keeps the palmed-down wording", () => {
    const rejected = run({
      status: "rejected",
      gateDecision: "reject",
      events: [{ title: "掌柜驳回上架方案" }],
    });
    expect(isSystemReject(rejected)).toBe(false);
    const view = presentRun(rejected, false);
    expect(view.label).toBe("已驳回封存");
    expect(view.rejectHeadline).toBe("掌柜已驳回");
    expect(view.sealLabel).toBe("掌柜已驳回 · 已封存");
  });

  test("an ordinary completed approval is unchanged", () => {
    const view = presentRun(run({ status: "completed", gateDecision: "approve" }), false);
    expect(view.dataStatus).toBe("completed");
    expect(view.label).toBe("已拍板封存");
    expect(isClarifyRun(run({ status: "completed", gateDecision: "approve" }))).toBe(false);
  });

  test("busy overrides a finished run so the badge stays in progress", () => {
    const view = presentRun(
      run({ status: "completed", artifacts: { product: null, chosenId: null } }),
      true,
    );
    expect(view.dataStatus).toBe("running");
    expect(view.label).toBe("会签进行中");
  });
});
