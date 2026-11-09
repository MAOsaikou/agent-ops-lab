import { Badge } from "./ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.js";
import { yuan } from "../lib/utils.js";
import type { BudgetFrame } from "../../../src/server/frames.js";

function weight(value: number): string {
  return value > 0 ? value.toFixed(0) : `${value.toFixed(0)}（算下来会亏）`;
}

export function BudgetPanel({ budgets }: { readonly budgets: readonly BudgetFrame[] }): React.JSX.Element {
  const zero = budgets.filter((row) => row.allocation.ads === 0 && row.allocation.priceCut === 0).length;
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>营销钱怎么花</CardTitle>
        <CardDescription>把手上的钱分给广告和降价，先在小账本里算一遍，算下来会亏的项目不花钱</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {budgets.length === 0 ? (
          <div className="m-4 rounded-xl bg-white/[0.02] px-3 py-6 text-center text-[12.5px] text-mist-400">
            这一回合没有遇到隔壁降价，营销按平时的计划走
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="text-left text-[11px] font-medium text-mist-400">
                <tr>
                  <th className="px-4 py-2.5 font-medium">回合</th>
                  <th className="px-2 py-2.5 text-right font-medium">手头现金</th>
                  <th className="px-2 py-2.5 text-right font-medium">广告值不值</th>
                  <th className="px-2 py-2.5 text-right font-medium">降价值不值</th>
                  <th className="px-2 py-2.5 text-right font-medium">广告花费</th>
                  <th className="px-2 py-2.5 text-right font-medium">降价让利</th>
                  <th className="px-4 py-2.5 font-medium">最后决定</th>
                </tr>
              </thead>
              <tbody>
                {budgets.map((row) => (
                  <tr key={String(row.seq)} className="border-t border-white/[0.045]">
                    <td className="px-4 py-3 tabular-nums text-mist-300">第 {row.round + 1} 回合</td>
                    <td className="px-2 py-3 text-right tabular-nums text-mist-300">{yuan(row.cash)}</td>
                    <td className="px-2 py-3 text-right tabular-nums text-risk-400">{weight(row.amounts.ads)}</td>
                    <td className="px-2 py-3 text-right tabular-nums text-risk-400">{weight(row.amounts.priceCut)}</td>
                    <td className="px-2 py-3 text-right text-[13.5px] font-semibold tabular-nums text-mist-100">{yuan(row.allocation.ads)}</td>
                    <td className="px-2 py-3 text-right text-[13.5px] font-semibold tabular-nums text-mist-100">{yuan(row.allocation.priceCut)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={row.allocation.ads === 0 && row.allocation.priceCut === 0 ? "warn" : "lock"}>
                        {row.allocation.ads === 0 && row.allocation.priceCut === 0 ? "先不花" : "值得投入"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-white/[0.05] px-4 py-2.5 text-[11.5px] leading-relaxed text-mist-400">
          共做了 {budgets.length} 次小账本，其中 {zero} 次决定不花钱。每一分钱都来自这一回合的预计收益。
        </div>
      </CardContent>
    </Card>
  );
}
