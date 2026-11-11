import { expect, test, type Page } from "@playwright/test";

import {
  loadFixture,
  mockHistory,
  overflowX,
  rootIsBlank,
  summaryOf,
  toLegacyShape,
  type FixtureName,
  type RawRun,
} from "./history-helpers.js";

const NAMES: readonly FixtureName[] = [
  "pillow-awaiting-2loops",
  "pillow-completed-2loops",
  "pdd-awaiting",
  "pdd-completed",
  "pdd-rejected",
];

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function openFromHistory(page: Page, id: string): Promise<void> {
  await page.getByTestId(`history-run-${id}`).click();
}

test.describe("最近几次：历史卷宗打开、报错与返回", () => {
  test("真实旧卷宗（待拍板 / 已封存 / 已驳回）逐个打开：不白屏、状态对得上、能返回空闲工作台", async ({ page }) => {
    const errors = watchErrors(page);
    const runs = NAMES.map((name) => loadFixture(name));
    await mockHistory(
      page,
      runs.map((run) => ({ summary: summaryOf(run), serve: { kind: "json", body: run } })),
    );
    await page.goto("/");
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "idle");
    for (const run of runs) {
      await openFromHistory(page, run.id);
      await expect(page.getByTestId("status")).toHaveAttribute("data-status", run.status);
      await expect(page.getByTestId("run-proof")).toContainText(run.id);
      expect(await rootIsBlank(page)).toBe(false);
      await expect(page.getByTestId("history-back")).toBeVisible();
      await page.getByTestId("history-back").click();
      await expect(page.getByTestId("status")).toHaveAttribute("data-status", "idle");
      await expect(page.getByTestId("run-proof")).toHaveCount(0);
      await expect(page.getByTestId("history-back")).toHaveCount(0);
      await expect(page.getByTestId("run-button")).toBeEnabled();
    }
    expect(errors).toEqual([]);
  });

  test("390px 打开已封存历史：可见返回入口、不横向溢出，返回后回到空闲", async ({ page }) => {
    const errors = watchErrors(page);
    const run = loadFixture("pillow-completed-2loops");
    await mockHistory(page, [{ summary: summaryOf(run), serve: { kind: "json", body: run } }]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await openFromHistory(page, run.id);
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "completed");
    const back = page.getByTestId("history-back");
    await expect(back).toBeVisible();
    await expect.poll(() => overflowX(page)).toBe(0);
    const box = await back.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.y ?? 9999) < 844).toBe(true);
    await back.click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "idle");
    expect(errors).toEqual([]);
  });

  test("旧结构卷宗（缺 calls / failures / scheduler / llm / 回路快照，由真实卷宗裁剪）仍能打开，不白屏", async ({ page }) => {
    const errors = watchErrors(page);
    const legacy = toLegacyShape(loadFixture("pillow-completed-2loops"));
    await mockHistory(page, [{ summary: summaryOf(legacy), serve: { kind: "json", body: legacy } }]);
    await page.goto("/");
    await openFromHistory(page, legacy.id);
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "completed");
    await expect(page.getByTestId("three-strategies")).toBeVisible();
    expect(await rootIsBlank(page)).toBe(false);
    await expect(page.getByTestId("history-back")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("历史摘要里出现未知状态时，列表照常渲染，点开给出可恢复的提示而不是白屏", async ({ page }) => {
    const errors = watchErrors(page);
    const good = loadFixture("pdd-completed");
    const odd = { ...loadFixture("pdd-awaiting"), id: "oddstatus01", status: "paused" } as RawRun;
    await mockHistory(page, [
      { summary: summaryOf(good), serve: { kind: "json", body: good } },
      { summary: summaryOf(odd), serve: { kind: "json", body: odd } },
    ]);
    await page.goto("/");
    await expect(page.getByTestId("history-run-oddstatus01")).toBeVisible();
    await openFromHistory(page, good.id);
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "completed");
    await openFromHistory(page, "oddstatus01");
    await expect(page.getByRole("alert")).toContainText("无法打开");
    // 打不开的卷宗不能顶掉正在看的那一份
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "completed");
    expect(await rootIsBlank(page)).toBe(false);
    expect(errors).toEqual([]);
  });

  const BAD_PAYLOADS: readonly {
    readonly label: string;
    readonly serve: { kind: "json"; body: unknown; status?: number } | { kind: "raw"; body: string; status?: number; contentType?: string } | { kind: "abort" };
    readonly message: RegExp;
  }[] = [
    { label: "文件不存在（404）", serve: { kind: "json", status: 404, body: { code: "run-not-found" } }, message: /找不到/ },
    { label: "文件损坏（422 run-corrupt）", serve: { kind: "json", status: 422, body: { code: "run-corrupt", detail: "卷宗文件已损坏" } }, message: /损坏/ },
    { label: "返回 null", serve: { kind: "raw", body: "null" }, message: /无法打开/ },
    { label: "返回不是 JSON（代理页）", serve: { kind: "raw", body: "<html>proxy</html>", contentType: "text/html" }, message: /无法打开|不是有效/ },
    { label: "JSON 能解析但不是卷宗", serve: { kind: "json", body: { id: "bad", hello: 1 } }, message: /无法打开/ },
    { label: "网络中断（fetch 被中止）", serve: { kind: "abort" }, message: /连不上|网络|后端/ },
  ];

  for (const bad of BAD_PAYLOADS) {
    test(`读取失败可恢复：${bad.label} → 提示 + 当前视图不丢 + 仍可操作`, async ({ page }) => {
      const errors = watchErrors(page);
      const good = loadFixture("pdd-rejected");
      await mockHistory(page, [
        { summary: summaryOf(good), serve: { kind: "json", body: good } },
        { summary: { ...summaryOf(good), id: "badrun01" }, serve: bad.serve },
      ]);
      await page.goto("/");
      await openFromHistory(page, good.id);
      await expect(page.getByTestId("status")).toHaveAttribute("data-status", "rejected");
      await openFromHistory(page, "badrun01");
      await expect(page.getByRole("alert")).toContainText(bad.message);
      await expect(page.getByTestId("status")).toHaveAttribute("data-status", "rejected");
      expect(await rootIsBlank(page)).toBe(false);
      await expect(page.getByTestId("run-button")).toBeEnabled();
      await expect(page.getByTestId("history-back")).toBeVisible();
      await page.getByTestId("history-back").click();
      await expect(page.getByTestId("status")).toHaveAttribute("data-status", "idle");
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test("从空闲直接打开一份读不了的卷宗：留在空闲，给出提示和可用的输入区", async ({ page }) => {
    const errors = watchErrors(page);
    const run = loadFixture("pdd-completed");
    await mockHistory(page, [{ summary: summaryOf(run), serve: { kind: "json", status: 422, body: { code: "run-corrupt", detail: "卷宗文件已损坏" } } }]);
    await page.goto("/");
    await openFromHistory(page, run.id);
    await expect(page.getByRole("alert")).toContainText("损坏");
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "idle");
    await expect(page.getByTestId("run-button")).toBeEnabled();
    expect(await rootIsBlank(page)).toBe(false);
    expect(errors).toEqual([]);
  });

  test("渲染意外抛错时有兜底：显示可读提示和「回到工作台」，不白屏（MOCK 故障注入：强制 toFixed 抛错）", async ({ page }) => {
    const run = loadFixture("pdd-completed");
    await mockHistory(page, [{ summary: summaryOf(run), serve: { kind: "json", body: run } }]);
    await page.addInitScript(() => {
      const original = Number.prototype.toFixed;
      Object.defineProperty(Number.prototype, "toFixed", {
        configurable: true,
        value: function (this: number, digits?: number) {
          if ((window as unknown as { __forceRenderCrash?: boolean }).__forceRenderCrash === true) {
            throw new Error("MOCK forced render crash");
          }
          return original.call(this, digits);
        },
      });
    });
    await page.goto("/");
    await page.evaluate(() => {
      (window as unknown as { __forceRenderCrash: boolean }).__forceRenderCrash = true;
    });
    await openFromHistory(page, run.id);
    const fallback = page.getByTestId("render-crash");
    await expect(fallback).toBeVisible();
    await expect(fallback).toContainText("回到工作台");
    expect(await rootIsBlank(page)).toBe(false);
    await page.evaluate(() => {
      (window as unknown as { __forceRenderCrash: boolean }).__forceRenderCrash = false;
    });
    await fallback.getByRole("button", { name: "回到工作台" }).click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "idle");
    await expect(page.getByTestId("run-button")).toBeEnabled();
  });

  test("在看历史时按 Esc 也能回到工作台", async ({ page }) => {
    const run = loadFixture("pdd-awaiting");
    await mockHistory(page, [{ summary: summaryOf(run), serve: { kind: "json", body: run } }]);
    await page.goto("/");
    await openFromHistory(page, run.id);
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "idle");
  });

  test("真实后端：先跑出一份待拍板评审，再翻历史，返回后仍是那份评审且拍板门可用", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/");
    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval");
    const currentProof = (await page.getByTestId("run-proof").textContent()) ?? "";
    const currentId = /卷宗\s+(\S+)/.exec(currentProof)?.[1] ?? "";
    expect(currentId.length).toBeGreaterThan(4);
    const other = page.locator('[data-testid^="history-run-"]:not([data-testid="history-run-' + currentId + '"])').first();
    await expect(other).toBeVisible();
    await other.click();
    await expect(page.getByTestId("history-back")).toBeVisible();
    await expect(page.getByTestId("run-proof")).not.toContainText(currentId);
    await page.getByTestId("history-back").click();
    await expect(page.getByTestId("run-proof")).toContainText(currentId);
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval");
    await expect(page.getByTestId("approve")).toBeEnabled();
    expect(errors).toEqual([]);
  });
});
