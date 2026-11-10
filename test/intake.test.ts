import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { analyzeProductInput } from "../src/templates/intake/agent.js";
import { analyzeLink, extractLinkCandidates } from "../src/templates/intake/link.js";
import { parseText } from "../src/templates/intake/text.js";

const pddText = `【拼多多】纯棉短袖T恤女夏季新款宽松显瘦百搭上衣
https://mobile.yangkeduo.com/goods.html?goods_id=412345678901
¥39.90 券后 已拼10万+件
包邮 · 7天无理由退货 · 退货包运费`;

const jdText = `记忆棉护颈枕 慢回弹颈椎枕 京东价 ¥89.00 已售 2.3万+ 件
https://item.jd.com/100012043978.html
支持开票 · 48小时内发货 · 现货`;

const linkTable: readonly { readonly url: string; readonly platform: string | null; readonly kind: string; readonly itemId: string | null }[] = [
  { url: "https://item.taobao.com/item.htm?id=678901234567", platform: "taobao", kind: "item", itemId: "678901234567" },
  { url: "https://detail.tmall.com/item.htm?id=678901234567", platform: "taobao", kind: "item", itemId: "678901234567" },
  { url: "https://m.tb.cn/h.gKJ8sQ2", platform: "taobao", kind: "short", itemId: null },
  { url: "https://mobile.yangkeduo.com/goods2.html?goods_id=412345678901", platform: "pdd", kind: "item", itemId: "412345678901" },
  { url: "https://haohuo.jinritemai.com/views/product/item2?id=3400000000000000000", platform: "douyin", kind: "item", itemId: "3400000000000000000" },
  { url: "https://item.jd.com/100012043978.html", platform: "jd", kind: "item", itemId: "100012043978" },
  { url: "https://u.jd.com/abcd", platform: "jd", kind: "short", itemId: null },
  { url: "https://detail.1688.com/offer/678901234567.html", platform: "alibaba", kind: "item", itemId: "678901234567" },
  { url: "https://www.xiaohongshu.com/goods-detail/65f0a1b2c3d4e5f6a7b8c9d0", platform: "xhs", kind: "item", itemId: "65f0a1b2c3d4e5f6a7b8c9d0" },
  { url: "https://v.kuaishou.com/abcd", platform: null, kind: "short", itemId: null },
  { url: "https://shop.example.com/products/foldable-bottle", platform: null, kind: "item", itemId: null },
  { url: "https://www.amazon.com/dp/B08N5WRWNW", platform: null, kind: "item", itemId: "B08N5WRWNW" },
  { url: "https://www.goofish.com/item?id=889900112233", platform: null, kind: "item", itemId: "889900112233" },
];

describe("商品链接识别", () => {
  test.each(linkTable)("$url → $platform / $kind", ({ url, platform, kind, itemId }) => {
    const hit = analyzeLink(url);
    expect(hit).not.toBeNull();
    expect(hit?.platform).toBe(platform);
    expect(hit?.kind).toBe(kind);
    expect(hit?.itemId).toBe(itemId);
  });

  test("不在预设里的平台照样认，并说明为什么要人填费率", () => {
    const hit = analyzeLink("https://v.kuaishou.com/abcd");
    expect(hit?.inPreset).toBe(false);
    expect(hit?.notes.join()).toContain("短链");
  });

  test("只从混着中文的分享文案里挑出链接", () => {
    expect(extractLinkCandidates(pddText)).toEqual([
      "https://mobile.yangkeduo.com/goods.html?goods_id=412345678901",
    ]);
    expect(extractLinkCandidates("满 39.90 元，3.5kg 装，包邮到家")).toEqual([]);
  });
});

describe("分享文案解析", () => {
  test("拼多多文案：平台、商品名、券后价、服务承诺、销量都对上", () => {
    const result = analyzeProductInput({ text: pddText });
    expect(result.patch.platform).toBe("pdd");
    expect(result.patch.name).toBe("纯棉短袖T恤女夏季新款宽松显瘦百搭上衣");
    expect(result.patch.category).toBe("女装上衣");
    expect(result.patch.competitorCents).toBe(3990);
    expect(result.patch.services).toEqual(["包邮", "七天无理由", "退货运费险"]);
    expect(result.salesHint).toBe(100_000);
    expect(result.links[0]?.itemId).toBe("412345678901");
  });

  test("销量只当参考，不冒充价格带日单量", () => {
    const result = analyzeProductInput({ text: pddText });
    expect(result.patch.marketOrders).toBeUndefined();
    const question = result.questions.find((item) => item.id === "market-orders");
    expect(question).toBeDefined();
    expect(question?.options[0]?.patch.marketOrders).toBe(3333);
  });

  test("京东文案：把价格和销量从标题里剥掉", () => {
    const result = analyzeProductInput({ text: jdText });
    expect(result.patch.name).toBe("记忆棉护颈枕 慢回弹颈椎枕");
    expect(result.patch.competitorCents).toBe(8900);
    expect(result.patch.services).toEqual(["48 小时发货", "支持开票", "现货直发"]);
    expect(result.patch.platform).toBe("jd");
  });

  test("到手价和原价差得多时，问一句再填", () => {
    const facts = parseText("牙膏 ¥39.90 券后 ¥59.00 原价 已售 5万+ 件 支持开票");
    expect(facts.bestPrice?.cents).toBe(3990);
    expect(facts.priceGap).toEqual({ low: expect.objectContaining({ cents: 3990 }), high: expect.objectContaining({ cents: 5900 }) });
    const result = analyzeProductInput({ text: "牙膏 ¥39.90 券后 ¥59.00 原价" });
    expect(result.questions.map((item) => item.id)).toContain("price-gap");
  });

  test("短链只认平台，不装成知道是哪件商品", () => {
    const result = analyzeProductInput({ text: "【淘宝】https://m.tb.cn/h.gKJ8sQ2 「便携折叠水壶户外运动大容量」" });
    expect(result.patch.platform).toBe("taobao");
    expect(result.patch.name).toBe("便携折叠水壶户外运动大容量");
    expect(result.patch.competitorCents).toBeUndefined();
    expect(result.questions.map((item) => item.id)).toEqual(expect.arrayContaining(["short-link", "price"]));
  });

  test("没见过的域名会问平台，选项能一键回填", () => {
    const result = analyzeProductInput({ text: "https://shop.example.com/products/foldable-bottle\nFoldable Bottle 折叠水壶 USD 19.90" });
    expect(result.patch.platform).toBeUndefined();
    const question = result.questions.find((item) => item.id === "platform");
    expect(question?.options).toHaveLength(6);
    expect(question?.options[0]?.patch.platform).toBe("taobao");
  });

  test("空输入不编东西出来，直接问", () => {
    const result = analyzeProductInput({ text: "   " });
    expect(result.patch).toEqual({});
    expect(result.fields.filter((field) => field.id !== "services").every((field) => field.needsConfirm)).toBe(true);
    expect(result.checks.find((check) => check.id === "link")?.status).toBe("warn");
  });

  test("官方预设 2（无链接护颈枕）：诚实提取文字证据，不冒充类目为商品名，不把采购/包装/快递当竞品价差距", () => {
    const preset2 =
      "评估护颈枕价格与现金流。京东价 ¥89，竞品日单量约 50，采购 18 元，包装 2 元，快递 7 元，平台费率按默认，目标毛利 30%，预算 500 元。";
    const result = analyzeProductInput({ text: preset2 });

    expect(result.headline).toBe("未附商品链接，已从粘贴文字提取商品资料");
    expect(result.headline).not.toContain("子 agent");

    const nameField = result.fields.find((field) => field.id === "name");
    expect(nameField?.display).toBe("护颈枕");
    expect(nameField?.needsConfirm).toBe(false);
    expect(result.patch.name).toBe("护颈枕");

    const platformField = result.fields.find((field) => field.id === "platform");
    expect(platformField?.display).toBe("按默认费率");
    expect(platformField?.needsConfirm).toBe(false);
    expect(result.patch.platform).toBeUndefined();

    const ordersField = result.fields.find((field) => field.id === "marketOrders");
    expect(ordersField?.display).toBe("约 50 单/天（价格带日单量）");
    expect(ordersField?.needsConfirm).toBe(false);
    expect(result.patch.marketOrders).toBe(50);

    expect(result.patch.competitorCents).toBe(8900);
    expect(result.questions.find((question) => question.id === "name")).toBeUndefined();
    expect(result.questions.find((question) => question.id === "price-gap")).toBeUndefined();
  });

  test("纯文字无商品名且无链接时：商品名显示待确认而非类目，且追问原因不怪链接缺失", () => {
    const result = analyzeProductInput({
      text: "采购 18 元，包装 2 元，快递 7 元，竞品主流价 89 元，目标毛利 30%，预算 500 元。",
    });
    const nameField = result.fields.find((field) => field.id === "name");
    expect(nameField?.display).toBe("待确认");
    expect(nameField?.needsConfirm).toBe(true);
    const nameQuestion = result.questions.find((question) => question.id === "name");
    expect(nameQuestion).toBeDefined();
    expect(nameQuestion?.why).not.toContain("链接");
    expect(result.questions.find((question) => question.id === "price-gap")).toBeUndefined();
  });

  test("泛指令语句不会把『这个拼多多商品』臆造为商品标题，且多零售价仍保留真实价差提示", () => {
    const generic = analyzeProductInput({
      text: "分析这个拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。到手价 ¥49，划线价 ¥79，采购 18 元，包装 2 元，快递 7 元。",
    });
    expect(generic.patch.name).toBeUndefined();
    expect(generic.fields.find((field) => field.id === "name")?.display).toBe("待确认");
    const gap = generic.questions.find((question) => question.id === "price-gap");
    expect(gap).toBeDefined();
    expect(gap?.ask).toContain("¥49.00");
    expect(gap?.ask).toContain("¥79.00");
    expect(gap?.ask).not.toContain("¥2.00");
  });
});

describe("确定性", () => {
  test("同样输入永远同一份结果和指纹", () => {
    const first = analyzeProductInput({ text: pddText });
    const second = analyzeProductInput({ text: pddText });
    expect(second).toEqual(first);
    expect(first.fingerprint).toHaveLength(64);
  });

  test("文本变了指纹就变", () => {
    expect(analyzeProductInput({ text: pddText }).fingerprint).not.toBe(
      analyzeProductInput({ text: `${pddText} ` }).fingerprint,
    );
  });

  test("任意乱写的文字都不崩，也不会伪造平台", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (text) => {
        const result = analyzeProductInput({ text });
        expect(result.fingerprint).toHaveLength(64);
        expect(result.trace.length).toBeGreaterThanOrEqual(4);
        for (const link of result.links) {
          expect(link.url.startsWith("https://")).toBe(true);
        }
        for (const question of result.questions) {
          expect(question.ask.length).toBeGreaterThan(0);
        }
      }),
    );
  });
});
