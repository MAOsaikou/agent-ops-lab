import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { SimResult } from "../../../src/templates/pricing/model.js";

export function ProfitCurve({ sim }: { readonly sim: SimResult }): React.JSX.Element {
  const data = sim.days.map((day) => ({
    day: day.day,
    profit: Math.round(day.profitCents / 100),
    cum: Math.round(day.cumProfitCents / 100),
    orders: day.orders,
  }));

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 2 }}>
          <CartesianGrid stroke="#eae1cf" vertical={false} />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={{ stroke: "#d9cdb4" }}
            tick={{ fontSize: 10, fill: "#8c8172" }}
            interval={4}
            tickFormatter={(value: number) => `${String(value)}日`}
          />
          <YAxis
            yAxisId="cum"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "#2e6b52" }}
            width={46}
            tickFormatter={(value: number) => `${String(Math.round(value / 1000))}k`}
          />
          <YAxis
            yAxisId="day"
            orientation="right"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "#b07a2e" }}
            width={40}
            tickFormatter={(value: number) => `${String(Math.round(value))}`}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 10,
              border: "1px solid #e3dac8",
              background: "#fdfbf5",
              fontSize: 12,
              boxShadow: "0 12px 28px -22px rgba(32,28,22,0.6)",
            }}
            labelFormatter={(value) => `第 ${String(value)} 天`}
            formatter={(value, name) => {
              const amount = typeof value === "number" ? value : Number(value);
              return [
                `¥${amount.toLocaleString("zh-CN")}`,
                String(name) === "profit" ? "当天利润（右轴）" : "累计利润（左轴）",
              ];
            }}
          />
          <Bar yAxisId="day" dataKey="profit" fill="#e0b877" radius={[3, 3, 0, 0]} maxBarSize={14} />
          <Line
            yAxisId="cum"
            type="monotone"
            dataKey="cum"
            stroke="#2e6b52"
            strokeWidth={2.2}
            dot={false}
            animationDuration={900}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}