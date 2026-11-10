import type { ProductInput } from "./model.js";
import { PLATFORM_PRESETS } from "./platform.js";

export type Sample = {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly input: ProductInput;
};

function withRates(base: ProductInput): ProductInput {
  const preset = PLATFORM_PRESETS[base.platform];
  return {
    ...base,
    commissionRate: preset.commissionRate,
    payFeeRate: preset.payFeeRate,
    settleDays: preset.settleDays,
  };
}

export const SAMPLES: readonly Sample[] = [
  {
    id: "bottle",
    label: "折叠水壶 · 淘宝",
    hint: "标品、客单价中等，竞品打得很凶",
    input: withRates({
      platform: "taobao",
      name: "便携折叠水壶",
      category: "户外水具",
      keywords: "户外,折叠,便携",
      buyCents: 1280,
      packagingCents: 80,
      shippingCents: 260,
      commissionRate: 0.005,
      payFeeRate: 0.006,
      returnRate: 0.12,
      returnSalvage: 0.6,
      adDailyBudgetCents: 3000,
      adCpcCents: 60,
      adCvr: 0.04,
      competitorCents: 3900,
      marketOrders: 40,
      elasticity: 2.2,
      targetMargin: 0.25,
      cashCents: 800000,
      settleDays: 7,
      services: ["包邮", "48 小时发货", "七天无理由"],
      promoEnabled: true,
      promoDiscount: 0.85,
      seed: 7,
    }),
  },
  {
    id: "tee",
    label: "纯棉短袖 · 拼多多",
    hint: "走量款，退货率高，靠单量摊成本",
    input: withRates({
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
      services: ["包邮", "七天无理由", "退货运费险"],
      promoEnabled: true,
      promoDiscount: 0.9,
      seed: 11,
    }),
  },
  {
    id: "pillow",
    label: "护颈枕 · 抖音小店",
    hint: "高客单、靠内容成交，平台扣点多",
    input: withRates({
      platform: "douyin",
      name: "记忆棉护颈枕",
      category: "家纺",
      keywords: "护颈,记忆棉,助眠",
      buyCents: 3200,
      packagingCents: 120,
      shippingCents: 380,
      commissionRate: 0.05,
      payFeeRate: 0.006,
      returnRate: 0.28,
      returnSalvage: 0.55,
      adDailyBudgetCents: 8000,
      adCpcCents: 120,
      adCvr: 0.03,
      competitorCents: 8900,
      marketOrders: 35,
      elasticity: 2.0,
      targetMargin: 0.3,
      cashCents: 2000000,
      settleDays: 7,
      services: ["包邮", "七天无理由", "支持开票"],
      promoEnabled: true,
      promoDiscount: 0.85,
      seed: 23,
    }),
  },
];

export function sampleById(id: string): Sample | undefined {
  return SAMPLES.find((sample) => sample.id === id);
}