import { useState } from "react";
import { Lock, ShieldQuestion } from "lucide-react";

import { LedgerTable } from "../components/LedgerTable.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.js";
import { tryCommitRound } from "../lib/api.js";
import type { LedgerResponse } from "../lib/contract.js";
import type { UiState } from "../state/reducer.js";

export function Ledger({
  state,
  ledger,
  runId,
}: {
  readonly state: UiState;
  readonly ledger: LedgerResponse | null;
  readonly runId: string | null;
}): React.JSX.Element {
  const [probe, setProbe] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function probeLock(): Promise<void> {
    if (runId === null) {
      return;
    }
    setBusy(true);
    try {
      const result = await tryCommitRound(runId, 1);
      setProbe(`HTTP ${String(result.status)} · ${JSON.stringify(result.body)}`);
    } catch (error) {
      setProbe(error instanceof Error ? error.message : "调用失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <LedgerTable state={state} ledger={ledger} />
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-lock-400" />
              锁定语义
            </CardTitle>
            <CardDescription>已提交回合不可回滚，这是设计里的提交边界，不是界面限制</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-[11px] leading-relaxed text-mist-300">
            <p>
              每回合按 DecisionCommitted → RoundSettled → RoundReflected 三事件闭合。账本行哈希取自
              prevHash、回合号、观察哈希、决策哈希、结算 JSON、信念哈希与覆盖层哈希，逐行串成链。
            </p>
            <p className="text-mist-500">
              界面上没有任何「重做 / 回滚 / 重新结算」入口。下面这个按钮是审阅用取证：它直接调用提交接口，用来证明接口本身也会拒绝。
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <ShieldQuestion className="h-3.5 w-3.5 text-warn-400" />
              锁定校验（取证，不是重做入口）
            </CardTitle>
            <CardDescription>向 POST /api/runs/:runId/rounds/1/commit 提交一次重做请求</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || runId === null}
              onClick={() => {
                void probeLock();
              }}
              data-testid="probe-lock"
            >
              {busy ? "调用中…" : "锁定取证：提交第 2 回合（预期 409）"}
            </Button>
            <pre
              className="max-h-[150px] overflow-auto rounded-lg border border-ink-700/60 bg-ink-950/80 p-2 font-mono text-[10px] leading-relaxed text-mist-300"
              data-testid="probe-result"
            >
              {probe ?? "尚未调用。预期返回 409 round-locked，账本不变。"}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
