import { Badge } from "./ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.js";
import { yuan } from "../lib/utils.js";
import type { BudgetFrame } from "../../../src/server/frames.js";

function weight(value: number): string {
  return value > 0 ? value.toFixed(0) : `${value.toFixed(0)}（负边际，权重取 0）`;
}

export function BudgetPanel({ budgets }: { readonly budgets: readonly BudgetFrame[] }): React.JSX.Element {
  const zero = budgets.filter((row) => row.allocation.ads === 0 && row.allocation.priceCut === 0).length;
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>预算决定</CardTitle>
        <CardDescription>
          出价取沙盘边际收益（不是 Agent 自报），allocateBudget 按现金分配；负边际的权重为 0，所以分配就是 0
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {budgets.length === 0 ? (
          <div className="m-3 rounded-lg border border-dashed border-ink-600/70 px-3 py-6 text-center text-xs text-mist-500">
            本局没有触发价格战仲裁（竞品没有降价，条件节点走维持预算分支）
          </div>
        ) : (
          <table className="w-full border-collapse text-[11px]">
            <thead className="text-left text-[10px] uppercase tracking-wider text-mist-500">
              <tr>
                <th className="px-3 py-1.5">回合</th>
                <th className="px-2 py-1.5 text-right">现金</th>
                <th className="px-2 py-1.5 text-right">广告边际</th>
                <th className="px-2 py-1.5 text-right">降价边际</th>
                <th className="px-2 py-1.5 text-right">分配 · 广告</th>
                <th className="px-2 py-1.5 text-right">分配 · 降价</th>
                <th className="px-3 py-1.5">结论</th>
              </tr>
            </thead>
            <tbody>
              {budgets.map((row) => (
                <tr key={String(row.seq)} className="border-t border-ink-700/50">
                  <td className="px-3 py-1.5 tabular-nums text-mist-300">{row.round + 1}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-mist-300">{yuan(row.cash)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-risk-400">{weight(row.amounts.ads)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-risk-400">{weight(row.amounts.priceCut)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-mist-100">{row.allocation.ads.toFixed(0)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-mist-100">{row.allocation.priceCut.toFixed(0)}</td>
                  <td className="px-3 py-1.5">
                    <Badge tone={row.allocation.ads === 0 && row.allocation.priceCut === 0 ? "warn" : "lock"}>
                      广告与降价都判为负边际
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="border-t border-ink-700/60 px-3 py-2 text-[10px] leading-relaxed text-mist-500">
          共 {budgets.length} 次仲裁，其中 {zero} 次分配为 0。这是沙盘的负边际结果，不是界面缺省值，也不是被抹掉的数字。
        </div>
      </CardContent>
    </Card>
  );
}
