import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:47321";

const INPUT = {
  platform: "pdd",
  name: "纯棉短袖 T 恤",
  category: "女装上衣",
  keywords: "纯棉,短袖,显瘦",
  buyCents: 1850,
  packagingCents: 50,
  shippingCents: 240,
  commissionRate: 0.006,
  payFeeRate: 0.006,
  returnRate: 0.22,
  returnSalvage: 0.5,
  adDailyBudgetCents: 5000,
  adCpcCents: 35,
  adCvr: 0.05,
  competitorCents: 3990,
  marketOrders: 120,
  elasticity: 2.6,
  targetMargin: 0.2,
  cashCents: 1500000,
  settleDays: 3,
  services: ["包邮", "七天无理由"],
  promoEnabled: true,
  promoDiscount: 0.9,
  seed: 11,
};

test("从填数字一路走到能复制的上架物料", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /折叠水壶 · 淘宝/ })).toBeVisible();

  await page.getByRole("button", { name: "开始核算" }).click();
  await page.getByRole("button", { name: /跳过动画/ }).click();
  await expect(page.getByText("核算完了")).toBeVisible();
  await page.getByRole("button", { name: /看三套方案/ }).click();

  await expect(page.getByRole("button", { name: /稳价 · 保目标毛利/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /跟价 · 对齐竞品/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /冲量 · 压价抢单/ })).toBeVisible();
  await expect(page.locator("svg.recharts-surface").first()).toBeVisible();

  await page.getByRole("button", { name: /锁定 ¥/ }).click();
  await expect(page.getByText("已锁定").first()).toBeVisible();
  await page.getByRole("button", { name: "去复制上架" }).click();

  await expect(page.getByText("商品标题")).toBeVisible();
  await expect(page.getByText("五条卖点")).toBeVisible();
  await expect(page.getByRole("link", { name: /下载价格表 CSV/ })).toBeVisible();
});

test("接口算出三套方案并导出 CSV", async ({ request }) => {
  const created = await request.post(`${API}/api/plans`, { data: INPUT });
  expect(created.status()).toBe(201);
  const plan = (await created.json()) as {
    id: string;
    candidates: readonly { id: string; priceCents: number }[];
    recommendedId: string;
    trace: readonly unknown[];
  };
  expect(plan.candidates).toHaveLength(3);
  expect(plan.trace.length).toBeGreaterThan(6);

  const locked = await request.post(`${API}/api/plans/${plan.id}/lock`, {
    data: { candidateId: plan.recommendedId },
  });
  expect(locked.status()).toBe(200);

  const csv = await request.get(`${API}/api/plans/${plan.id}/export.csv`);
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("方案,售价(元)");
});