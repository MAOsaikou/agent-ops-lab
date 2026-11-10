import { sha256Hex } from "../../engine/hash.js";
import { canonicalJson } from "../../engine/json.js";
import { PLATFORM_IDS, PLATFORM_PRESETS, type PlatformId } from "../pricing/platform.js";
import { analyzeLink, extractLinkCandidates } from "./link.js";
import { parseText, cleanName } from "./text.js";
import type { Confidence, Evidence, IntakeField, IntakePatch, IntakeResult, IntakeCheck, IntakeQuestion, LinkHit, ToolCall } from "./types.js";

export type IntakeInput = { readonly text: string; readonly links?: readonly string[] | undefined };

function confidence(needsConfirm: boolean, evidence: readonly Evidence[]): Confidence {
  if (needsConfirm) return "low";
  if (evidence.some((item) => item.kind === "link")) return "high";
  return "medium";
}

function field(id: IntakeField["id"], label: string, display: string, evidence: readonly Evidence[], needsConfirm: boolean): IntakeField {
  return { id, label, display, evidence, needsConfirm, confidence: confidence(needsConfirm, evidence) };
}

function money(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

function firstPlatform(links: readonly LinkHit[]): PlatformId | null {
  for (const link of links) {
    if (link.platform !== null) {
      return link.platform;
    }
  }
  return null;
}

function buildFields(links: readonly LinkHit[], text: string, facts: ReturnType<typeof parseText>): readonly IntakeField[] {
  const platformLink = links.find((link) => link.platform !== null);
  const platform = firstPlatform(links) ?? undefined;
  const name = facts.title?.text ?? facts.category ?? "未识别商品名";
  const nameEvidence: Evidence[] = facts.title === null ? [] : [{ kind: "text", quote: facts.title.quote }];
  const priceEvidence: Evidence[] = facts.bestPrice === null ? [] : [{ kind: "text", quote: facts.bestPrice.quote }];
  const salesEvidence: Evidence[] = facts.sales.length === 0 ? [] : [{ kind: "text", quote: facts.sales[0]?.quote ?? "" }];
  const keywords = facts.keywords.join(",");
  const categoryEvidence: Evidence[] = facts.category === null ? [] : [{ kind: "text", quote: facts.categoryWords.join("、") }];
  const serviceEvidence: Evidence[] = facts.services.length === 0 ? [] : [{ kind: "text", quote: "商品文本中的承诺词" }];
  return [
    field("platform", "平台", platform === undefined ? "未确认" : PLATFORM_PRESETS[platform].label, platformLink === undefined ? [] : [{ kind: "link", quote: platformLink.host }], platform === undefined),
    field("name", "商品名", name, nameEvidence, facts.title === null),
    field("category", "类目", facts.category ?? "待确认", categoryEvidence, facts.category === null),
    field("keywords", "关键词", keywords.length === 0 ? "待补充" : keywords, nameEvidence, keywords.length === 0),
    field("competitorCents", "参考价", facts.bestPrice === null ? "待确认" : money(facts.bestPrice.cents), priceEvidence, facts.bestPrice === null),
    field("marketOrders", "可见销量", facts.sales[0] === undefined ? "待确认" : `${String(facts.sales[0].count)} 件（单件商品，不是价格带日单量）`, salesEvidence, true),
    field("services", "服务承诺", facts.services.length === 0 ? "未识别" : facts.services.join("、"), serviceEvidence, false),
  ];
}

function buildPatch(links: readonly LinkHit[], facts: ReturnType<typeof parseText>): IntakePatch {
  const platform = firstPlatform(links);
  const patch: { -readonly [Key in keyof IntakePatch]?: IntakePatch[Key] } = {};
  if (platform !== null) patch.platform = platform;
  if (facts.title !== null) patch.name = cleanName(facts.title.text);
  if (facts.category !== null) patch.category = facts.category;
  if (facts.keywords.length > 0) patch.keywords = facts.keywords.join(",");
  if (facts.bestPrice !== null) patch.competitorCents = facts.bestPrice.cents;
  if (facts.orderHint !== null) patch.marketOrders = facts.orderHint;
  if (facts.services.length > 0) patch.services = facts.services;
  return patch;
}

function formatCount(count: number): string {
  return count >= 10_000 ? `${(count / 10_000).toFixed(1)}万` : String(count);
}

function buildQuestions(facts: ReturnType<typeof parseText>, links: readonly LinkHit[]): readonly IntakeQuestion[] {
  const scored: { readonly priority: number; readonly question: IntakeQuestion }[] = [];

  const shortLink = links.find((link) => link.kind === "short");
  if (shortLink !== undefined) {
    scored.push({
      priority: 1,
      question: {
        id: "short-link",
        ask: `${shortLink.platformLabel}的短链要跳转才知道是哪个商品，你看到的是哪件？`,
        why: "本机不联网跳短链；带错商品会把整份定价带偏。",
        options: [],
      },
    });
  }

  const gap = facts.priceGap;
  if (gap !== null) {
    scored.push({
      priority: 2,
      question: {
        id: "price-gap",
        ask: `文字里有两个价：${money(gap.low.cents)} 和 ${money(gap.high.cents)}，竞品主流价按哪个算？`,
        why: "到手价和划线价差距不小，选错一个整套方案都变。",
        options: [
          { label: `按 ${money(gap.low.cents)}`, patch: { competitorCents: gap.low.cents } },
          { label: `按 ${money(gap.high.cents)}`, patch: { competitorCents: gap.high.cents } },
        ],
      },
    });
  }

  const unknownLink = links.find((link) => link.platform === null && link.kind !== "short");
  if (unknownLink !== undefined) {
    scored.push({
      priority: 3,
      question: {
        id: "platform",
        ask: `${unknownLink.platformLabel}不在预设的 6 个平台里，费率按哪个平台估？`,
        why: "各平台佣金和账期差很多，平台选错保本价就错。",
        options: PLATFORM_IDS.map((id) => ({
          label: `按${PLATFORM_PRESETS[id].short}的费率`,
          patch: { platform: id },
        })),
      },
    });
  }

  const sales = facts.sales[0];
  if (sales !== undefined && facts.orderHint === null) {
    const daily = Math.max(1, Math.round(sales.count / 30));
    scored.push({
      priority: 4,
      question: {
        id: "market-orders",
        ask: `它标着卖了 ${formatCount(sales.count)} 件。要拿它当价格带日单量的起点吗？`,
        why: "这是单件商品的累计销量，整个价格带一天的单量通常更多，填进去只是起点。",
        options: [{ label: `先按 ${String(daily)} 单/天`, patch: { marketOrders: daily } }],
      },
    });
  }

  if (facts.title === null) {
    scored.push({
      priority: 5,
      question: { id: "name", ask: "这件商品叫什么？", why: "链接里没有标题，本机也不联网读详情。", options: [] },
    });
  }

  if (facts.bestPrice === null) {
    scored.push({
      priority: 6,
      question: { id: "price", ask: "竞品现在卖多少？", why: "文字里一个价格都没有，不能凭空估。", options: [] },
    });
  }

  return scored
    .slice()
    .sort((left, right) => left.priority - right.priority)
    .slice(0, 3)
    .map((row) => row.question);
}

function buildTrace(links: readonly LinkHit[], facts: ReturnType<typeof parseText>): readonly ToolCall[] {
  return [
    { index: 1, tool: "link_classifier", args: `${String(links.length)} 条候选商品链接`, observation: links.length === 0 ? "未发现商品链接" : `识别 ${String(links.length)} 条，保留域名、商品号和页面类型` },
    { index: 2, tool: "text_extractor", args: `${String(facts.prices.length)} 个价格候选`, observation: facts.bestPrice === null ? "没有足够证据判断参考价" : `找到 ${money(facts.bestPrice.cents)}，证据：${facts.bestPrice.quote}` },
    { index: 3, tool: "evidence_checker", args: "逐字段保留证据", observation: "不把推断写成事实；缺失字段进入待确认" },
    { index: 4, tool: "pricing_handoff", args: "生成可回填 patch", observation: "只回填有证据的字段，最终定价仍由核算引擎计算" },
  ];
}

export function analyzeProductInput(input: IntakeInput): IntakeResult {
  const text = input.text.trim();
  const candidates = [...(input.links ?? []), ...extractLinkCandidates(text)];
  const links: LinkHit[] = [];
  const seen = new Set<string>();
  for (const raw of candidates) {
    const hit = analyzeLink(raw);
    if (hit !== null && !seen.has(hit.url)) {
      seen.add(hit.url);
      links.push(hit);
    }
  }
  const facts = parseText(text);
  const patch = buildPatch(links, facts);
  const fields = buildFields(links, text, facts);
  const questions = buildQuestions(facts, links);
  const checks: IntakeCheck[] = [
    { id: "link", label: "商品链接识别", status: links.length > 0 ? "pass" : "warn", detail: links.length > 0 ? `识别 ${String(links.length)} 条链接` : "没有商品链接，仍可粘贴商品标题或详情文字" },
    { id: "evidence", label: "字段证据", status: questions.length === 0 ? "pass" : "warn", detail: questions.length === 0 ? "可带入字段都有文本或链接证据" : `${String(questions.length)} 个字段需要你确认` },
    { id: "network", label: "联网边界", status: "pass", detail: "未请求商品页，不把猜测伪装成抓取结果" },
  ];
  const stats = { chars: text.length, lines: text.length === 0 ? 0 : text.split(/\r?\n/).length, links: links.length, digits: (text.match(/[0-9]/g) ?? []).length };
  const fingerprint = sha256Hex(canonicalJson({ text: input.text, links: links.map((link) => link.url), patch, stats }));
  return {
    version: 1,
    fingerprint,
    headline: links.length > 0 ? `识别到 ${String(links.length)} 条商品链接` : "先把商品资料交给链接识别子 agent",
    stats,
    plan: ["识别商品链接平台与页面类型", "从文字中提取价格、销量、标题和服务承诺", "逐字段保留证据并标出不确定项", "把可确认字段交给定价核算"],
    links,
    fields,
    questions,
    checks,
    trace: buildTrace(links, facts),
    patch,
    notes: ["这一步不需要 API key：链接分类、字段提取、证据检查和定价计算都是本地规则。", "短链、动态商品页和未见过的平台不会被假装解析；需要联网读取页面时再单独接浏览器工具或模型。"],
    salesHint: facts.orderHint ?? facts.sales[0]?.count ?? null,
  };
}
