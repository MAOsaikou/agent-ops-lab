import type { PlanCopy, ProductInput, TitleVariant } from "./model.js";
import { RATE_DISCLAIMER, type PlatformPreset } from "./platform.js";

function money(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

export function keywordList(input: ProductInput): readonly string[] {
  const parts = input.keywords.split(/[,，、;；\s]+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const word = part.trim();
    if (word.length === 0 || seen.has(word)) {
      continue;
    }
    seen.add(word);
    out.push(word);
  }
  return out;
}

function trimTo(text: string, max: number): string {
  const chars = [...text.replace(/\s+/g, " ").trim()];
  if (chars.length <= max) {
    return chars.join("");
  }
  const cut = chars.slice(0, max).join("").replace(/[·,，、\s|/]+$/u, "");
  return cut;
}

function serviceWord(input: ProductInput): string {
  if (input.services.includes("包邮")) {
    return "包邮";
  }
  if (input.services.includes("现货直发")) {
    return "现货";
  }
  return "";
}

export function buildTitles(
  input: ProductInput,
  preset: PlatformPreset,
  priceCents: number,
): readonly TitleVariant[] {
  const name = input.name.trim().length > 0 ? input.name.trim() : "商品名";
  const rawCategory = input.category.trim();
  const keywords = keywordList(input).filter(
    (word) =>
      !name.includes(word) &&
      !word.includes(name) &&
      !(rawCategory.length > 0 && rawCategory.includes(word)),
  );
  const category = rawCategory.length > 0 && !name.includes(rawCategory) ? rawCategory : "";
  const tail = serviceWord(input);
  const gap = input.competitorCents > 0 ? (input.competitorCents - priceCents) / input.competitorCents : 0;
  const priceHook = gap >= 0.03 ? "价格实在" : "";

  const spaced = (...parts: string[]): string =>
    parts.filter((part) => part.length > 0).join(" ");

  const info = spaced(name, ...keywords.slice(0, 3), category, tail);
  const selling = spaced(name, keywords[0] ?? category, priceHook, tail);
  const scene = [keywords[0] ?? category, name, tail].filter((part) => part.length > 0).join("");

  const variants: { label: string; raw: string }[] = [
    { label: "信息型", raw: info },
    { label: "卖点型", raw: selling },
    { label: "场景型", raw: scene },
  ];
  const seen = new Set<string>();
  const out: TitleVariant[] = [];
  for (const variant of variants) {
    const text = trimTo(variant.raw, preset.titleMax);
    if (text.length === 0 || seen.has(text)) {
      continue;
    }
    seen.add(text);
    out.push({ label: variant.label, text, length: [...text].length });
  }
  return out;
}

export function buildCopy(
  input: ProductInput,
  preset: PlatformPreset,
  priceCents: number,
  breakEvenCents: number,
): PlanCopy {
  const keywords = keywordList(input);
  const searchTerms = [
    ...keywords,
    input.category.trim(),
    input.name.trim(),
    serviceWord(input),
  ].filter((word) => word.length > 0 && [...word].length <= 12);
  const uniqueTerms = [...new Set(searchTerms)].slice(0, 12);

  const notes: string[] = [
    preset.titleNote,
    RATE_DISCLAIMER,
    `保本价 ${money(breakEvenCents)}：低于这个价，卖得越多亏得越多。`,
    "标题里不要写「全网最低」「销量第一」这类极限词，平台会判违规。",
    "发布前把「需你确认」的卖点换成你自己实拍或实测能对上的话。",
    ...preset.tips,
  ];

  return {
    titles: buildTitles(input, preset, priceCents),
    keywords: uniqueTerms,
    searchTerms: uniqueTerms,
    notes,
  };
}