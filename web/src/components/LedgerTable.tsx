import { Lock, Unlock } from "lucide-react";

import { Badge } from "./ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.js";
import type { LedgerResponse } from "../lib/contract.js";
import { shortHash, yuan } from "../lib/utils.js";
import type { RoundUiState, UiState } from "../state/reducer.js";

type Row = {
  readonly round: number;
  readonly locked: boolean;
  readonly source: string;
  readonly profit: number;
  readonly cash: number;
  readonly revenue: number;
  readonly sales: number;
  readonly missed: number;
  readonly adSpend: number;
  readonly hash: string;
  readonly prevHash: string;
  readonly decisionHash: string;
};

function rowsOf(state: UiState, ledger: LedgerResponse | null): Row[] {
  if (ledger !== null) {
    return ledger.rounds.map((row) => ({
      round: row.round,
      locked: row.locked,
      source: row.source,
      profit: row.outcome.profit,
      cash: row.outcome.cash,
      revenue: row.outcome.revenue,
      sales: row.outcome.sales,
      missed: row.outcome.missed,
      adSpend: row.outcome.adSpend,
      hash: row.hash,
      prevHash: row.prevHash,
      decisionHash: row.decisionHash,
    }));
  }
  return state.rounds.map((row: RoundUiState) => ({
    round: row.round,
    locked: row.locked,
    source: row.source ?? "—",
    profit: row.outcome?.profit ?? 0,
    cash: row.outcome?.cash ?? 0,
    revenue: row.outcome?.revenue ?? 0,
    sales: row.outcome?.sales ?? 0,
    missed: row.outcome?.missed ?? 0,
    adSpend: row.outcome?.adSpend ?? 0,
    hash: "—",
    prevHash: "—",
    decisionHash: row.decisionHash ?? "—",
  }));
}

export function LedgerTable({
  state,
  ledger,
  compact = false,
}: {
  readonly state: UiState;
  readonly ledger: LedgerResponse | null;
  readonly compact?: boolean;
}): React.JSX.Element {
  const rows = rowsOf(state, ledger);
  const lockedCount = rows.filter((row) => row.locked).length;
  return (
    <Card className="h-full">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 pb-2">
        <div className="min-w-0">
          <CardTitle>锁定账本</CardTitle>
          <CardDescription>
            每回合三事件（DecisionCommitted → RoundSettled → RoundReflected）闭合后才算锁定；哈希链逐行相连
          </CardDescription>
        </div>
        <Badge tone={lockedCount === rows.length && rows.length > 0 ? "lock" : "warn"} data-testid="ledger-locked-badge">
          {lockedCount}/{rows.length === 0 ? 0 : rows.length} 已锁定
        </Badge>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full border-collapse text-[12.5px]">
          <thead className="text-left text-[11px] font-medium text-mist-400">
            <tr>
              <th className="px-5 py-2.5 font-medium">回合</th>
              <th className="px-2 py-2.5 font-medium">状态</th>
              <th className="px-2 py-2.5 font-medium">来源</th>
              <th className="px-2 py-2.5 text-right font-medium">销量</th>
              <th className="px-2 py-2.5 text-right font-medium">营收</th>
              <th className="px-2 py-2.5 text-right font-medium">投放</th>
              <th className="px-2 py-2.5 text-right font-medium">利润</th>
              <th className="px-2 py-2.5 text-right font-medium">现金</th>
              <th className="px-2 py-2.5 text-right font-medium">缺货</th>
              <th className="px-5 py-2.5 font-medium">行哈希</th>
              {compact ? null : <th className="px-3 py-2.5 font-medium">决策哈希</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={compact ? 10 : 11} className="px-5 py-10 text-center text-[12.5px] text-mist-400">
                  还没有结算回合。开始回放后，每结算一回合这里就多一行带锁记录。
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.round} className="border-t border-white/[0.045] transition-colors hover:bg-white/[0.03]">
                  <td className="px-5 py-3 tabular-nums text-mist-300">第 {row.round + 1} 回合</td>
                  <td className="px-2 py-3">
                    {row.locked ? (
                      <span className="inline-flex items-center gap-1 text-lock-400">
                        <Lock className="h-3.5 w-3.5" />
                        锁定
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-mist-500">
                        <Unlock className="h-3.5 w-3.5" />
                        未闭合
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    <Badge tone={row.source === "fallback" ? "warn" : "muted"}>
                      {row.source === "fallback" ? "安全兜底" : row.source === "verified" ? "验证通过" : row.source}
                    </Badge>
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums text-mist-300">{row.sales}</td>
                  <td className="px-2 py-3 text-right tabular-nums text-mist-300">{yuan(row.revenue)}</td>
                  <td className="px-2 py-3 text-right tabular-nums text-mist-400">{yuan(row.adSpend)}</td>
                  <td className={`px-2 py-3 text-right text-[13.5px] font-semibold tabular-nums ${row.profit >= 0 ? "text-lock-400" : "text-risk-400"}`}>
                    {yuan(row.profit)}
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums text-mist-100">{yuan(row.cash)}</td>
                  <td className="px-2 py-3 text-right tabular-nums text-mist-400">{row.missed}</td>
                  <td className="px-5 py-3 font-mono text-[11px] text-mist-400" title={`prev ${row.prevHash}`}>
                    {shortHash(row.hash, 12)}
                  </td>
                  {compact ? null : (
                    <td className="px-3 py-3 font-mono text-[11px] text-mist-500">{shortHash(row.decisionHash, 12)}</td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.05] px-5 py-3 text-[11.5px] text-mist-400">
          <span>最终哈希 {shortHash(ledger?.finalHash ?? "—", 16)}</span>
          {ledger === null ? null : (
            <span className={ledger.matchesRunHash ? "text-lock-400" : "text-risk-400"}>
              {ledger.matchesRunHash ? "与本局运行哈希一致（fold 重算）" : "与运行哈希不一致"}
            </span>
          )}
          <span>重做入口：无</span>
        </div>
      </CardContent>
    </Card>
  );
}
