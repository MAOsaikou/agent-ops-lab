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
  { key: "primaryTea", name: "主供 · 茶饮", color: "#60a5fa" },
  { key: "primarySnack", name: "主供 · 零食", color: "#38bdf8" },
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
        <CardTitle>断供协商报价走势</CardTitle>
        <CardDescription>
          单价按元计。每轮报价由 acceptOrCounter 依据隐藏底价、产能与交期裁定，话术不含底价、不改成交价
        </CardDescription>
      </CardHeader>
      <CardContent className="h-[280px]">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-ink-600/70 text-xs text-mist-500">
            本局没有供应协商事件（没有断供危机卡时不会进入子工作流）
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="#1b2740" strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke="#74849f" tick={{ fontSize: 11 }} />
              <YAxis stroke="#74849f" tick={{ fontSize: 11 }} unit="元" width={64} />
              <Tooltip
                contentStyle={{ background: "#0d1422", border: "1px solid #2a3a5c", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "#a9b8d4" }}
                formatter={(value) => (typeof value === "number" ? `¥${value.toFixed(2)}` : String(value ?? ""))}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: "#a9b8d4" }} />
              {SERIES.map((series) => (
                <Line
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  name={series.name}
                  stroke={series.color}
                  strokeWidth={2}
                  dot={{ r: 3 }}
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

export function QuoteTable({ quotes }: { readonly quotes: readonly QuoteFrame[] }): React.JSX.Element {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>报价明细</CardTitle>
        <CardDescription>每行都是一条 SupplierQuote 事件，可直接对照事件流</CardDescription>
      </CardHeader>
      <CardContent className="max-h-[300px] overflow-y-auto p-0">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 bg-ink-850/95 text-left text-[10px] uppercase tracking-wider text-mist-500">
            <tr>
              <th className="px-3 py-1.5">回合</th>
              <th className="px-2 py-1.5">供应商</th>
              <th className="px-2 py-1.5">SKU</th>
              <th className="px-2 py-1.5">轮次</th>
              <th className="px-2 py-1.5">裁定</th>
              <th className="px-2 py-1.5 text-right">表价</th>
              <th className="px-2 py-1.5 text-right">规则价</th>
              <th className="px-2 py-1.5 text-right">数量</th>
              <th className="px-3 py-1.5">话术</th>
            </tr>
          </thead>
          <tbody>
            {quotes.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-mist-500">
                  本局没有协商事件
                </td>
              </tr>
            ) : (
              quotes.map((quote) => (
                <tr key={`${String(quote.seq)}`} className="border-t border-ink-700/50 hover:bg-ink-800/40">
                  <td className="px-3 py-1.5 tabular-nums text-mist-300">{quote.round + 1}</td>
                  <td className="px-2 py-1.5 text-mist-300">{SUPPLIER_TEXT[quote.supplier]}</td>
                  <td className="px-2 py-1.5 text-mist-300">{SKU_TEXT[quote.sku]}</td>
                  <td className="px-2 py-1.5 tabular-nums text-mist-300">{quote.quoteRound}</td>
                  <td className="px-2 py-1.5">
                    <span
                      className={
                        quote.ruling === "walk"
                          ? "text-risk-400"
                          : quote.ruling === "counter"
                            ? "text-warn-400"
                            : "text-lock-400"
                      }
                    >
                      {quote.ruling === "walk" ? "破裂" : quote.ruling === "counter" ? "还价" : "接受"}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-mist-500">¥{(quote.offerUnitCost / 100).toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-mist-100">¥{(quote.unitCost / 100).toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-mist-300">{quote.qty}</td>
                  <td className="max-w-[220px] truncate px-3 py-1.5 text-mist-500" title={quote.talk}>
                    {quote.talk}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
