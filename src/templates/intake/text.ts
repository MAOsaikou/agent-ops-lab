import { SERVICE_TAGS, type ServiceTag } from "../pricing/platform.js";
import type { Confidence } from "./types.js";

export type PriceChoice = {
  readonly cents: number;
  readonly label: string;
  readonly quote: string;
  readonly confidence: Confidence;
};

export type SalesHit = {
  readonly count: number;
  readonly quote: string;
};

export type TitleHit = {
  readonly text: string;
  readonly quote: string;
  readonly score: number;
};

export type PriceGap = {
  readonly low: PriceChoice;
  readonly high: PriceChoice;
};

export type TextFacts = {
  readonly prices: readonly PriceChoice[];
  readonly bestPrice: PriceChoice | null;
  readonly priceGap: PriceGap | null;
  readonly sales: readonly SalesHit[];
  readonly title: TitleHit | null;
  readonly services: readonly ServiceTag[];
  readonly category: string | null;
  readonly categoryWords: readonly string[];
  readonly keywords: readonly string[];
  readonly orderHint: number | null;
  readonly taokouling: string | null;
};

const PRICE_LABEL = "(到手价|券后价|券后|活动价|秒杀价|拼单价|批发价|起批价|京东价|售价|现价|促销价|原价|划线价|日常价|单价|价格)";
const LABELED_PRICE = new RegExp(`${PRICE_LABEL}\\s*[:：]?\\s*[¥￥]?\\s*([0-9]{1,6}(?:\\.[0-9]{1,2})?)`, "g");
const CURRENCY_PRICE = /[¥￥]\s*([0-9]{1,6}(?:\.[0-9]{1,2})?)/g;
const YUAN_PRICE = /([0-9]{1,6}(?:\.[0-9]{1,2})?)\s*元/g;

const STRONG_PRICE_LABELS = ["到手价", "券后价", "券后", "活动价", "秒杀价", "拼单价", "批发价", "起批价", "京东价", "售价", "现价", "促销价"];

const TRAILING_PRICE =
  /([0-9]{1,6}(?:\.[0-9]{1,2})?)\s*元?\s*(到手价|券后价?|活动价|秒杀价|拼单价|原价|划线价)/g;
const STRONG_TRAILING_LABELS = ["券后价", "券后", "活动价", "秒杀价", "拼单价", "划线价"];

const SALES_PATTERN =
  /(?:已拼|已售出|已售|月销|销量|成交|总销量|累计销量)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)\s*(万|千|[wWkK])?\s*\+?\s*(?:件|单|笔|人)?/g;
const BUYER_PATTERN = /([0-9]+(?:\.[0-9]+)?)\s*(万|千|[wWkK])?\s*\+?\s*(?:人付款|人已买|人收货|人购买)/g;
const ORDER_PATTERN = /(?:日销|日单|日均|每天)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)\s*(万|千|[wWkK])?/;

const QUOTED_TITLE_PATTERNS: readonly RegExp[] = [
  /「([^」]{2,60})」/g,
  /“([^”]{2,60})”/g,
  /《([^》]{2,60})》/g,
  /【([^】]{2,40})】/g,
  /"([^"]{2,60})"/g,
];

const LABELED_TITLE = /(?:商品名|商品标题|宝贝标题|标题|品名|商品名称)\s*[:：]\s*([^\n]{2,60})/;

const PLATFORM_TAG_PREFIX = /^(淘宝|天猫|拼多多|抖音|京东|小红书|快手|1688|阿里巴巴|闲鱼|微店|有赞|TEMU|SHEIN|Shopee|亚马逊)/i;

const SERVICE_RULES: readonly { readonly tag: ServiceTag; readonly pattern: RegExp }[] = [
  { tag: "包邮", pattern: /包邮|免运费|全国包邮/ },
  { tag: "48 小时发货", pattern: /48\s*小时(?:内)?发货|48h发货|极速发货/ },
  { tag: "七天无理由", pattern: /七天无理由|7\s*天无理由|无理由退换|无理由退货/ },
  { tag: "退货运费险", pattern: /运费险|退货包运费|退货运费/ },
  { tag: "支持开票", pattern: /开票|发票|专票|普票/ },
  { tag: "现货直发", pattern: /现货|当日发货|当天发货|现货直发/ },
  { tag: "一件代发", pattern: /一件代发|一件直发/ },
];

const CATEGORY_RULES: readonly { readonly category: string; readonly words: readonly string[] }[] = [
  { category: "户外水具", words: ["水壶", "水杯", "保温杯", "折叠水", "户外", "露营"] },
  { category: "女装上衣", words: ["短袖", "t恤", "衬衫", "卫衣", "吊带", "针织", "上衣"] },
  { category: "家纺", words: ["枕", "被", "床单", "四件套", "床垫", "夏凉"] },
  { category: "数码配件", words: ["手机壳", "充电", "数据线", "耳机", "支架", "键盘", "鼠标"] },
  { category: "食品零食", words: ["零食", "坚果", "饼干", "牛肉干", "糖果", "咖啡", "茶叶"] },
  { category: "美妆个护", words: ["面霜", "精华", "口红", "洗发", "牙膏", "面膜", "防晒"] },
  { category: "宠物用品", words: ["猫砂", "狗粮", "猫粮", "宠物", "牵引"] },
  { category: "母婴用品", words: ["奶瓶", "纸尿裤", "婴儿", "宝宝", "童装"] },
  { category: "家居日用", words: ["收纳", "垃圾桶", "抹布", "挂钩", "置物", "拖把"] },
  { category: "鞋包配饰", words: ["鞋", "背包", "帽子", "腰带", "袜子"] },
];

const KEYWORD_POOL: readonly string[] = [
  "纯棉",
  "短袖",
  "长袖",
  "宽松",
  "显瘦",
  "百搭",
  "新款",
  "冰丝",
  "加厚",
  "大容量",
  "便携",
  "折叠",
  "防漏",
  "护颈",
  "助眠",
  "记忆棉",
  "防滑",
  "防水",
  "儿童",
  "加大",
  "户外",
  "露营",
  "车载",
  "办公",
  "宿舍",
  "轻便",
  "耐摔",
  "保温",
  "一次性",
];

function centsOf(value: string): number | null {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return null;
  }
  const cents = Math.round(amount * 100);
  if (cents < 100 || cents > 10_000_000) {
    return null;
  }
  return cents;
}

function quoteAt(text: string, index: number, width: number): string {
  const start = Math.max(0, index);
  return text
    .slice(start, Math.min(text.length, start + width))
    .replace(/\s+/g, " ")
    .trim();
}

function cjkCount(text: string): number {
  return (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
}

function scaleCount(raw: string, unit: string | undefined): number | null {  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  const factor = unit === "万" || unit === "w" || unit === "W" ? 10_000 : unit === "千" || unit === "k" || unit === "K" ? 1000 : 1;
  return Math.round(value * factor);
}

function collectPrices(text: string): readonly PriceChoice[] {
  type Scored = { readonly cents: number; readonly label: string; readonly quote: string; readonly score: number };
  const seen = new Map<number, Scored>();
  const add = (cents: number, label: string, quote: string, score: number): void => {
    const existing = seen.get(cents);
    if (existing === undefined || score > existing.score) {
      seen.set(cents, { cents, label, quote, score });
    }
  };

  for (const match of text.matchAll(LABELED_PRICE)) {
    const label = match[1] ?? "";
    const cents = centsOf(match[2] ?? "");
    if (cents === null) {
      continue;
    }
    add(cents, label, quoteAt(text, match.index ?? 0, 18), STRONG_PRICE_LABELS.includes(label) ? 3 : 1);
  }
  for (const match of text.matchAll(CURRENCY_PRICE)) {
    const cents = centsOf(match[1] ?? "");
    if (cents === null) {
      continue;
    }
    add(cents, "", quoteAt(text, match.index ?? 0, 14), 2);
  }
  for (const match of text.matchAll(YUAN_PRICE)) {
    const cents = centsOf(match[1] ?? "");
    if (cents === null) {
      continue;
    }
    add(cents, "", quoteAt(text, match.index ?? 0, 14), 1);
  }
  for (const match of text.matchAll(TRAILING_PRICE)) {
    const cents = centsOf(match[1] ?? "");
    if (cents === null) {
      continue;
    }
    add(cents, match[2] ?? "", quoteAt(text, match.index ?? 0, 24), STRONG_TRAILING_LABELS.includes(match[2] ?? "") ? 3 : 1);
  }

  const rows = [...seen.values()];
  rows.sort((left, right) => (right.score === left.score ? left.cents - right.cents : right.score - left.score));
  return rows.map((row) => ({
    cents: row.cents,
    label: row.label,
    quote: row.quote,
    confidence: row.score >= 3 ? "high" : row.score === 2 ? "medium" : "low",
  }));
}

function collectSales(text: string): readonly SalesHit[] {
  const out: SalesHit[] = [];
  const push = (count: number | null, quote: string): void => {
    if (count !== null) {
      out.push({ count, quote });
    }
  };
  for (const match of text.matchAll(SALES_PATTERN)) {
    push(scaleCount(match[1] ?? "", match[2]), quoteAt(text, match.index ?? 0, 18));
  }
  for (const match of text.matchAll(BUYER_PATTERN)) {
    push(scaleCount(match[1] ?? "", match[2]), quoteAt(text, match.index ?? 0, 16));
  }
  return out;
}

function cleanName(raw: string): string {
  return raw
    .replace(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,24}(?:\/\S*)?/gi, " ")
    .replace(/【[^】]{1,12}】/g, " ")
    .replace(/[#＃][^\s#＃]+/g, " ")
    .replace(/[¥￥$]\s*[0-9]{1,6}(?:\.[0-9]{1,2})?/g, " ")
    .replace(/(?:京东|拼多多|淘宝|天猫|抖音|小红书|闲鱼|京东价|售价|现价|券后价|活动价|原价|促销价)\S{0,16}/g, " ")
    .replace(/(?:已售出|已售|月销|已拼|销量|成交)\S{0,24}/g, " ")
    .replace(/[0-9]{1,9}(?:\.[0-9]{1,9})?\s*(?:万|千|[wWkK])?\s*\+?\s*(?:件|单|笔|人)?/g, " ")
    .replace(/(?:包邮|免运费|七天无理由|无理由退换|退货运费险|运费险|支持开票|开票|现货直发|现货|48小时内发货|48小时发货|一件代发|券后|到手价)/g, " ")
    .replace(/[，。、；：!！?？]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

function collectTitles(text: string): readonly TitleHit[] {
  const hits: TitleHit[] = [];
  for (const pattern of QUOTED_TITLE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const raw = (match[1] ?? "").trim();
      if (PLATFORM_TAG_PREFIX.test(raw) || cjkCount(raw) + raw.length < 4) {
        continue;
      }
      hits.push({ text: cleanName(raw), quote: match[0].slice(0, 40), score: 3 });
    }
  }

  const labeled = LABELED_TITLE.exec(text);
  if (labeled !== null) {
    const raw = (labeled[1] ?? "").trim();
    if (raw.length > 0) {
      hits.push({ text: cleanName(raw), quote: raw.slice(0, 40), score: 3 });
    }
  }

  text.split("\n").forEach((line) => {
    const raw = line.trim();
    if (raw.length < 2 || raw.length > 60) {
      return;
    }
    if (/^https?:\/\//i.test(raw)) {
      return;
    }
    const cleaned = cleanName(raw);
    if (cjkCount(cleaned) < 2) {
      return;
    }
    hits.push({ text: cleaned, quote: raw.slice(0, 40), score: 2 });
  });

  const unique = new Map<string, TitleHit>();
  for (const hit of hits) {
    if (hit.text.length === 0) {
      continue;
    }
    const key = hit.text.toLowerCase();
    const existing = unique.get(key);
    if (existing === undefined || hit.score > existing.score) {
      unique.set(key, hit);
    }
  }
  const rows = [...unique.values()];
  rows.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return cjkCount(right.text) - cjkCount(left.text);
  });
  return rows;
}

function collectServices(text: string): readonly ServiceTag[] {
  return SERVICE_TAGS.filter((tag) => SERVICE_RULES.some((rule) => rule.tag === tag && rule.pattern.test(text)));
}

function guessCategory(text: string): { readonly category: string | null; readonly words: readonly string[] } {
  const lower = text.toLowerCase();
  let best: { category: string; words: readonly string[]; hits: number } | null = null;
  for (const rule of CATEGORY_RULES) {
    const hits = rule.words.filter((word) => lower.includes(word.toLowerCase()));
    if (hits.length === 0) {
      continue;
    }
    if (best === null || hits.length > best.hits) {
      best = { category: rule.category, words: hits, hits: hits.length };
    }
  }
  return best === null ? { category: null, words: [] } : { category: best.category, words: best.words };
}

function guessKeywords(name: string | null, text: string, categoryWords: readonly string[]): readonly string[] {
  const source = (name ?? text).toLowerCase();
  const picked: string[] = [];
  const add = (word: string): void => {
    const covered = picked.find((item) => item.includes(word) || word.includes(item));
    if (covered === undefined) {
      picked.push(word);
    } else if (word.length > covered.length) {
      picked.splice(picked.indexOf(covered), 1, word);
    }
  };
  for (const word of KEYWORD_POOL) {
    if (picked.length >= 4) {
      break;
    }
    if (source.includes(word.toLowerCase())) {
      add(word);
    }
  }
  for (const word of categoryWords) {
    if (picked.length < 4) {
      add(word);
    }
  }
  if (picked.length === 0 && name !== null) {
    for (const chunk of name.split(/[^\u4e00-\u9fff]+/)) {
      const trimmed = chunk.trim();
      if (picked.length < 3 && cjkCount(trimmed) >= 2) {
        add(trimmed.slice(0, 4));
      }
    }
  }
  return picked.slice(0, 4);
}

export function parseText(text: string): TextFacts {
  const prices = collectPrices(text);
  const bestPrice = prices[0] ?? null;
  const runnerUp = prices.find((price) => price.cents !== bestPrice?.cents) ?? null;
  const ratio =
    bestPrice !== null && runnerUp !== null
      ? Math.max(bestPrice.cents, runnerUp.cents) / Math.min(bestPrice.cents, runnerUp.cents)
      : 1;
  const priceGap: PriceGap | null =
    bestPrice !== null && runnerUp !== null && ratio >= 1.08
      ? bestPrice.cents < runnerUp.cents
        ? { low: bestPrice, high: runnerUp }
        : { low: runnerUp, high: bestPrice }
      : null;

  const sales = collectSales(text);
  const titles = collectTitles(text);
  const title = titles[0] ?? null;
  const category = guessCategory(`${text}\n${title?.text ?? ""}`);
  const orderMatch = ORDER_PATTERN.exec(text);
  const orderHint = orderMatch === null ? null : scaleCount(orderMatch[1] ?? "", orderMatch[2]);
  const taokouling = /[€￥$]\s?[0-9A-Za-z]{8,14}\s?[€￥$]/.exec(text);

  return {
    prices,
    bestPrice,
    priceGap,
    sales,
    title,
    services: collectServices(text),
    category: category.category,
    categoryWords: category.words,
    keywords: guessKeywords(title?.text ?? null, text, category.words),
    orderHint,
    taokouling: taokouling === null ? null : taokouling[0].replace(/\s+/g, ""),
  };
}

export { cleanName };
