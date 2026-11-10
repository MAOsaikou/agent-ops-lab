import type { PlatformId } from "../pricing/platform.js";
import type { LinkHit, LinkKind } from "./types.js";

type HostRule = {
  readonly domains: readonly string[];
  readonly platform: PlatformId | null;
  readonly label: string;
  readonly note: string | null;
};

const HOST_RULES: readonly HostRule[] = [
  {
    domains: ["goofish.com"],
    platform: null,
    label: "闲鱼",
    note: "闲鱼是二手平台，价格不能直接当新品竞品价",
  },
  { domains: ["taobao.com", "tmall.com", "tmall.hk", "taobao.hk", "tb.cn"], platform: "taobao", label: "淘宝 / 天猫", note: null },
  { domains: ["pinduoduo.com", "yangkeduo.com"], platform: "pdd", label: "拼多多", note: null },
  { domains: ["jinritemai.com", "douyin.com", "douyinec.com"], platform: "douyin", label: "抖音小店", note: null },
  { domains: ["jd.com", "jd.hk", "jd.cn", "3.cn"], platform: "jd", label: "京东", note: null },
  { domains: ["1688.com", "alibaba.com"], platform: "alibaba", label: "1688 / 阿里巴巴", note: null },
  { domains: ["xiaohongshu.com", "xhslink.com", "xhs.cn"], platform: "xhs", label: "小红书", note: null },
  {
    domains: ["kuaishou.com", "gifshow.com", "chenzhongtech.com"],
    platform: null,
    label: "快手小店",
    note: "快手小店不在预设的 6 个平台里，费率要按你后台的实际扣点填",
  },
  { domains: ["weidian.com", "koudai.com"], platform: null, label: "微店", note: null },
  { domains: ["youzan.com"], platform: null, label: "有赞店铺", note: null },
  {
    domains: ["amazon.com", "amazon.cn", "amazon.co.jp", "amazon.co.uk", "amazon.de", "amazon.com.au"],
    platform: null,
    label: "亚马逊",
    note: "海外站点的价格是外币，别直接填进竞品价",
  },
  { domains: ["aliexpress.com", "aliexpress.ru"], platform: null, label: "速卖通", note: null },
  { domains: ["temu.com"], platform: null, label: "TEMU", note: null },
  { domains: ["shein.com"], platform: null, label: "SHEIN", note: null },
  { domains: ["ebay.com", "ebay.co.uk", "ebay.de"], platform: null, label: "eBay", note: null },
  { domains: ["etsy.com"], platform: null, label: "Etsy", note: null },
  {
    domains: ["shopee.sg", "shopee.tw", "shopee.co.id", "shopee.com.my", "shopee.co.th", "shopee.ph", "shopee.vn", "shopee.com.br"],
    platform: null,
    label: "Shopee",
    note: null,
  },
  { domains: ["walmart.com"], platform: null, label: "沃尔玛", note: null },
  { domains: ["rakuten.co.jp"], platform: null, label: "乐天", note: null },
  { domains: ["mercadolibre.com", "mercadolivre.com.br"], platform: null, label: "Mercado Libre", note: null },
  { domains: ["myshopify.com"], platform: null, label: "Shopify 独立站", note: null },
  {
    domains: ["weibo.com", "zhihu.com", "bilibili.com", "youtube.com", "tiktok.com", "mp.weixin.qq.com"],
    platform: null,
    label: "内容平台",
    note: "这条更像内容页，不是商品详情页",
  },
];

const SHORT_HOSTS: readonly string[] = [
  "m.tb.cn",
  "tb.cn",
  "e.tb.cn",
  "s.click.taobao.com",
  "v.douyin.com",
  "3.cn",
  "u.jd.com",
  "p.pinduoduo.com",
  "xhslink.com",
  "k.kuaishou.com",
  "url.cn",
  "dwz.cn",
  "t.cn",
  "bit.ly",
  "tinyurl.com",
];

const LINK_PATTERN =
  /(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}(?::[0-9]{2,5})?(?:\/[^\s<>"'`，。、；;：！!（）()【】\u005B\u005D{}“”‘’《》]*)?/gi;

const ID_PATTERNS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: "goods_id", pattern: /[?&](?:goods_id|goodsId)=([0-9]{4,25})/i },
  { label: "item_id", pattern: /[?&](?:item_?id|itemID)=([0-9a-zA-Z]{4,25})/i },
  { label: "skuId", pattern: /[?&](?:sku_?id|skuId|sku)=([0-9a-zA-Z]{4,25})/i },
  { label: "productId", pattern: /[?&](?:product_?id|productId)=([0-9a-zA-Z]{4,25})/i },
  { label: "offerId", pattern: /\/offer\/([0-9]{5,25})\.html/i },
  { label: "ASIN", pattern: /\/dp\/([A-Z0-9]{10})(?:[/?#]|$)/ },
  { label: "笔记 id", pattern: /\/(?:goods-detail|discovery\/item)\/([a-z0-9]{6,40})/i },
  { label: "id", pattern: /[?&]id=([0-9a-zA-Z]{4,25})/i },
  { label: "路径里的商品号", pattern: /\/(?:item|goods|product|detail)\/([0-9]{5,25})(?:\.html)?(?:[/?#]|$)/i },
  { label: "路径里的数字", pattern: /(?:^|\/)([0-9]{8,25})(?:[/.?#]|$)/ },
];

function trimTail(value: string): string {
  return value.replace(/[.,;:!?。，、；：！？）》」”’"'/\\]+$/g, "");
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function findRule(host: string): HostRule | null {
  for (const rule of HOST_RULES) {
    if (rule.domains.some((domain) => hostMatches(host, domain))) {
      return rule;
    }
  }
  return null;
}

function findItemId(url: string): { readonly itemId: string | null; readonly idLabel: string } {
  for (const rule of ID_PATTERNS) {
    const match = rule.pattern.exec(url);
    const id = match?.[1];
    if (id !== undefined && id.length > 0) {
      return { itemId: id, idLabel: rule.label };
    }
  }
  return { itemId: null, idLabel: "" };
}

function findSlug(pathname: string): string | null {
  const match = /\/products\/([a-z0-9-]{2,80})/i.exec(pathname);
  const handle = match?.[1];
  if (handle === undefined) {
    return null;
  }
  const words = handle.replace(/-+/g, " ").trim();
  return words.length === 0 ? null : words.slice(0, 60);
}

export function normalizeUrl(raw: string): string | null {
  const trimmed = trimTail(raw.trim());
  if (trimmed.length === 0) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,24}$/i.test(url.hostname)) {
    return null;
  }
  url.hash = "";
  return url.toString();
}

export function extractLinkCandidates(text: string): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(LINK_PATTERN)) {
    const raw = trimTail(match[0]);
    if (raw.length === 0) {
      continue;
    }
    const key = raw.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(raw);
  }
  return out;
}

export function analyzeLink(raw: string): LinkHit | null {
  const url = normalizeUrl(raw);
  if (url === null) {
    return null;
  }
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const rule = findRule(host);
  const platform = rule?.platform ?? null;
  const id = findItemId(url);
  const segments = parsed.pathname.split("/").filter((part) => part.length > 0);
  const shortHost = SHORT_HOSTS.some((entry) => hostMatches(host, entry));
  const productPath = /(?:^|\/)(?:items?|products?|goods|product|details?|share)\/[^/?#]*/i.test(parsed.pathname);
  const looksShort = id.itemId === null && segments.length <= 1 && parsed.pathname.length <= 16;
  const looksShop = /(shop|store|seller|category|search|list|mall|brand)/i.test(parsed.pathname);
  const kind: LinkKind =
    shortHost || looksShort ? "short" : productPath ? "item" : id.itemId !== null ? "item" : looksShop ? "shop" : "page";

  const notes: string[] = [];
  if (rule === null) {
    notes.push("没见过的域名：按通用规则找商品号，平台费率请你按实际填");
  } else {
    if (rule.note !== null) {
      notes.push(rule.note);
    }
    if (rule.platform === null) {
      notes.push("这个平台不在预设的 6 个里，费率要按你后台的实际扣点填");
    }
  }
  if (kind === "short") {
    notes.push("短链要跳转才知道是哪个商品，本机不联网，跳不了");
  }
  if (kind === "shop") {
    notes.push("这条像店铺页或搜索页，不是单个商品");
  }
  if (kind === "page" && id.itemId === null) {
    notes.push("没找到商品号，按普通页面处理");
  }

  const platformLabel = rule === null ? `${host}（没见过的站）` : rule.label;

  return {
    raw,
    url,
    host,
    platform,
    platformLabel,
    inPreset: platform !== null,
    kind,
    itemId: id.itemId,
    idLabel: id.idLabel,
    slug: findSlug(parsed.pathname),
    notes,
  };
}
