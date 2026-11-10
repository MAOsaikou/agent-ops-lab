import type { PlanResult } from "../templates/pricing/model.js";

const HEADERS = [
  "方案",
  "售价(元)",
  "活动价(元)",
  "保本价(元)",
  "单件成本(元)",
  "推广分摊(元)",
  "单件净利(元)",
  "毛利率",
  "日均单量",
  "30天中位利润(元)",
  "30天最差10%(元)",
  "30天缺货天数",
  "标题",
];

function cell(value: string | number): string {
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function yuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

function ratio(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function planCsv(plan: PlanResult): string {
  const title = plan.copy.titles[0]?.text ?? "";
  const lines = [HEADERS.map(cell).join(",")];
  for (const candidate of plan.candidates) {
    lines.push(
      [
        candidate.label,
        yuan(candidate.priceCents),
        yuan(candidate.promoPriceCents),
        yuan(candidate.evaluation.breakEvenCents),
        yuan(candidate.evaluation.unit.totalCents),
        yuan(candidate.evaluation.daily.adPerOrderCents),
        yuan(candidate.evaluation.daily.netPerOrderCents),
        ratio(candidate.evaluation.daily.margin),
        String(Math.round(candidate.evaluation.daily.orders)),
        yuan(candidate.sim.p50Cents),
        yuan(candidate.sim.p10Cents),
        String(candidate.sim.stockoutDays),
        title,
      ]
        .map(cell)
        .join(","),
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}