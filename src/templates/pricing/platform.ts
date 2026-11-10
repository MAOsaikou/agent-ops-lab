export const PLATFORM_IDS = ["taobao", "pdd", "douyin", "jd", "alibaba", "xhs"] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

export type PlatformPreset = {
  readonly id: PlatformId;
  readonly label: string;
  readonly short: string;
  readonly commissionRate: number;
  readonly payFeeRate: number;
  readonly returnRate: number;
  readonly settleDays: number;
  readonly titleMax: number;
  readonly titleNote: string;
  readonly promoLabel: string;
  readonly promoNote: string;
  readonly tips: readonly string[];
};

export const RATE_DISCLAIMER =
  "默认费率只是常见参考值，各平台按类目浮动，请对照你后台的「技术服务费 / 支付服务费」实际扣点改。";

export const PLATFORM_PRESETS: Record<PlatformId, PlatformPreset> = {
  taobao: {
    id: "taobao",
    label: "淘宝 / 天猫",
    short: "淘宝",
    commissionRate: 0.005,
    payFeeRate: 0.006,
    returnRate: 0.15,
    settleDays: 7,
    titleMax: 30,
    titleNote: "标题 30 个汉字以内，超出会被截断",
    promoLabel: "店铺宝 / 满减",
    promoNote: "报名活动前，先确认活动价还高于保本价",
    tips: [
      "淘宝 C 店多数类目不收佣金，天猫按类目扣 2%–5%，这里填你实际的数",
      "确认收货后才结算，账期一般按 7 天估",
      "退货率 15% 是日用/服饰常见的量级，标品会低很多",
    ],
  },
  pdd: {
    id: "pdd",
    label: "拼多多",
    short: "拼多多",
    commissionRate: 0.006,
    payFeeRate: 0.006,
    returnRate: 0.18,
    settleDays: 3,
    titleMax: 30,
    titleNote: "标题 30 个汉字以内，拼多多更看重关键词密度",
    promoLabel: "限时秒杀 / 百亿补贴",
    promoNote: "秒杀价通常要求低于历史成交价，报名前先跑一遍利润",
    tips: [
      "拼多多账期短，现金流压力小，但价格战更凶",
      "参与活动常要求包邮，运费必须算进单件成本",
      "退货率高时，来回运费会吃掉大半毛利",
    ],
  },
  douyin: {
    id: "douyin",
    label: "抖音小店",
    short: "抖音",
    commissionRate: 0.05,
    payFeeRate: 0.006,
    returnRate: 0.25,
    settleDays: 7,
    titleMax: 27,
    titleNote: "标题 27 个汉字以内，短标题转化更高",
    promoLabel: "直播间价 / 短视频价",
    promoNote: "达人带货还要另付佣金，务必单独算一笔",
    tips: [
      "平台技术服务费常见 5%，达人佣金通常再 10%–20%",
      "退货率偏高，服饰类到 30% 很常见",
      "内容电商靠视频成交，标题只做辅助搜索",
    ],
  },
  jd: {
    id: "jd",
    label: "京东",
    short: "京东",
    commissionRate: 0.05,
    payFeeRate: 0.006,
    returnRate: 0.12,
    settleDays: 7,
    titleMax: 30,
    titleNote: "标题 30 个汉字以内，属性词越全越好",
    promoLabel: "京东秒杀 / 京补",
    promoNote: "京东价保规则会追溯降价，定价别一步定死",
    tips: [
      "SOP 类目扣点常见 3%–8%，自营另算",
      "退货率低，但运费和时效要求高",
      "硬拼价格不如自营，走差异化更稳",
    ],
  },
  alibaba: {
    id: "alibaba",
    label: "1688",
    short: "1688",
    commissionRate: 0,
    payFeeRate: 0.006,
    returnRate: 0.05,
    settleDays: 3,
    titleMax: 30,
    titleNote: "标题 30 个汉字以内，写明起订量和规格",
    promoLabel: "拿样价 / 批发价",
    promoNote: "批发价要按阶梯量算，别拿零售价套",
    tips: [
      "1688 主要做批发，买家更看起订量和交期",
      "不包邮是常态，运费由买家承担时别重复计入成本",
      "一件代发的利润要靠量，单件毛利天然薄",
    ],
  },
  xhs: {
    id: "xhs",
    label: "小红书",
    short: "小红书",
    commissionRate: 0.05,
    payFeeRate: 0.006,
    returnRate: 0.2,
    settleDays: 7,
    titleMax: 20,
    titleNote: "标题 20 个汉字以内，口语化更容易被点开",
    promoLabel: "笔记价 / 店铺券",
    promoNote: "内容种草期先别压价，把复购和口碑算进去",
    tips: [
      "小红书重内容，标题像朋友说话比堆词更有效",
      "客单价偏高，退货率也不低",
      "平台服务费约 5%，投流成本另计",
    ],
  },
};

export function isPlatformId(value: string): value is PlatformId {
  return PLATFORM_IDS.some((id) => id === value);
}

export function platformOf(value: PlatformId): PlatformPreset {
  return PLATFORM_PRESETS[value];
}

export const SERVICE_TAGS = [
  "包邮",
  "48 小时发货",
  "七天无理由",
  "退货运费险",
  "支持开票",
  "现货直发",
  "一件代发",
] as const;

export type ServiceTag = (typeof SERVICE_TAGS)[number];

export function isServiceTag(value: string): value is ServiceTag {
  return SERVICE_TAGS.some((tag) => tag === value);
}