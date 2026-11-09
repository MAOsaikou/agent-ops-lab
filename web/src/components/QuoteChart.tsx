import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.js";
import { SKU_TEXT, SUPPLIER_TEXT } from "../lib/nodes.js";
import type { QuoteFrame } from "../../../src/server/frames.js";

type Point = {
  readonly label: string;
  readonly round: number;
  readonly quoteRound: number;
  readonly primaryTea?: number;
  readonly primarySnack?: number;
  readonly backupTea?: number;
  readonly backupSnack?: number;
};

const SERIES: readonly {
  readonly key: keyof Omit<Point, "label" | "round" | "quoteRound">;
  readonly name: string;
  readonly color: string;
}[] = [
  { key: "primaryTea", name: "老供应商 · 茶饮", color: "#60a5fa" },
  { key: "primarySnack", name: "老供应商 · 零食", color: "#38bdf8" },
  { key: "backupTea", name: "备选 · 茶饮", color: "#34d399" },
  { key: "backupSnack", name: "备选 · 零食", color: "#a3e635" },
];

function seriesKey(supplier: string, sku: string): keyof Omit<Point, "label" | "round" | "quoteRound"> | null {
  if (supplier === "primary" && sku === "tea") return "primaryTea";
  if (supplier === "primary" && sku === "snack") return "primarySnack";
  if (supplier === "backup" && sku === "tea") return "backupTea";
  if (supplier === "backup" && sku === "snack") return "backupSnack";
  return null;
}

export function buildSeries(quotes: readonly QuoteFrame[]): Point[] {
  const buckets = new Map<string, Point>();
  for (const quote of quotes) {
    const key = `${String(quote.round)}-${String(quote.quoteRound)}`;
    const existing = buckets.get(key);
    const point: Point = existing ?? {
      label: `R${String(quote.round + 1)}·${String(quote.quoteRound)}`,
      round: quote.round,
      quoteRound: quote.quoteRound,
    };
    const target = seriesKey(quote.supplier, quote.sku);
    if (target !== null) {
      const next: Point = { ...point, [target]: quote.unitCost / 100 };
      buckets.set(key, next);
    } else {
      buckets.set(key, point);
    }
  }
  return [...buckets.values()].sort((left, right) =>
    left.round === right.round ? left.quoteRound - right.quoteRound : left.round - right.round,
  );
}

export function QuoteChart({ quotes }: { readonly quotes: readonly QuoteFrame[] }): React.JSX.Element {
  const data = buildSeries(quotes);
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>断供时怎么谈价</CardTitle>
        <CardDescription>每条线是一种「供应商 + 商品」的进货单价（元），每个点是一轮谈价后的价格。店里看得到对方开价，看不到对方的底价。</CardDescription>
      </CardHeader>
      <CardContent className="h-[300px]">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-xl bg-white/[0.02] px-6 text-center text-[12.5px] text-mist-400">
            这一局没有断供，也就没有进货谈判。剧本里没有断供危机时，这一步会被跳过。
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: -10 }}>
              <CartesianGrid stroke="#1b2740" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" stroke="#74849f" tick={{ fontSize: 12, fill: "#93a3c0" }} tickLine={false} />
              <YAxis stroke="#74849f" tick={{ fontSize: 12, fill: "#93a3c0" }} tickLine={false} unit="元" width={68} />
              <Tooltip
                contentStyle={{
                  background: "#0d1422",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 12,
                  fontSize: 12.5,
                  boxShadow: "0 16px 32px -24px rgba(0,0,0,0.85)",
                }}
                labelStyle={{ color: "#b4c2dc" }}
                formatter={(value) => (typeof value === "number" ? `¥${value.toFixed(2)}` : String(value ?? ""))}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: "#b4c2dc", paddingTop: 6 }} />
              {SERIES.map((series) => (
                <Line
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  name={series.name}
                  stroke={series.color}
                  strokeWidth={2.2}
                  dot={{ r: 3.5, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

const RULING: Record<string, { readonly label: string; readonly className: string }> = {
  accept: { label: "成交", className: "bg-lock-400/12 text-lock-400" },
  counter: { label: "再讲讲价", className: "bg-warn-400/12 text-warn-400" },
  walk: { label: "谈崩了", className: "bg-risk-400/12 text-risk-400" },
};

export function QuoteTable({ quotes }: { readonly quotes: readonly QuoteFrame[] }): React.JSX.Element {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>每次进货报价</CardTitle>
        <CardDescription>报价、成交、还价或谈崩，按发生顺序列在这里</CardDescription>
      </CardHeader>
      <CardContent className="max-h-[336px] overflow-y-auto p-0">
        <table className="w-full border-collapse text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-ink-850/95 text-left text-[11px] font-medium text-mist-400 backdrop-blur">
            <tr>
              <th className="px-5 py-2.5 font-medium">回合</th>
              <th className="px-2 py-2.5 font-medium">哪家</th>
              <th className="px-2 py-2.5 font-medium">商品</th>
              <th className="px-2 py-2.5 font-medium">第几轮</th>
              <th className="px-2 py-2.5 font-medium">结果</th>
              <th className="px-2 py-2.5 text-right font-medium">对方开价</th>
              <th className="px-2 py-2.5 text-right font-medium">谈下来的价</th>
              <th className="px-2 py-2.5 text-right font-medium">数量</th>
              <th className="px-5 py-2.5 font-medium">对方怎么说</th>
            </tr>
          </thead>
          <tbody>
            {quotes.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-5 py-8 text-center text-[12.5px] text-mist-400">
          本局没有进货谈判记录
                </td>
              </tr>
            ) : (
              quotes.map((quote) => {
                const ruling = RULING[quote.ruling] ?? { label: quote.ruling, className: "bg-white/[0.06] text-mist-300" };
                return (
                  <tr key={`${String(quote.seq)}`} className="border-t border-white/[0.045] transition-colors hover:bg-white/[0.03]">
                    <td className="px-5 py-3 tabular-nums text-mist-300">{quote.round + 1}</td>
                    <td className="px-2 py-3 text-mist-300">{SUPPLIER_TEXT[quote.supplier]}</td>
                    <td className="px-2 py-3 text-mist-300">{SKU_TEXT[quote.sku]}</td>
                    <td className="px-2 py-3 tabular-nums text-mist-300">{quote.quoteRound}</td>
                    <td className="px-2 py-3">
                      <span className={`inline-flex rounded-md px-2 py-1 text-[11.5px] font-medium ${ruling.className}`}>
                        {ruling.label}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-right tabular-nums text-mist-400">¥{(quote.offerUnitCost / 100).toFixed(2)}</td>
                    <td className="px-2 py-3 text-right font-semibold tabular-nums text-mist-100">
                      ¥{(quote.unitCost / 100).toFixed(2)}
                    </td>
                    <td className="px-2 py-3 text-right tabular-nums text-mist-300">{quote.qty}</td>
                    <td className="max-w-[240px] truncate px-5 py-3 text-mist-400" title={quote.talk}>
                      {quote.talk}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
