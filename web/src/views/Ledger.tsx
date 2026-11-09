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
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-lock-400/12 text-lock-400">
                <Lock className="h-3.5 w-3.5" />
              </span>
              为什么这一行不能改
            </CardTitle>
            <CardDescription>一个回合要留三份记录：拍板、结账、复盘。三份齐了，这一行就锁住。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-[12.5px] leading-relaxed text-mist-300">
            <p>
              每回合先记「今天进了多少货、卖多少钱」，再记「卖出去多少、赚了多少」，最后记「这次学到什么」。
              三份记录首尾相接，改中间一份就和前后对不上了。
            </p>
            <p className="text-mist-400">
              页面上没有「重做、回滚、重新结算」这类按钮。下面那个按钮是给审阅用的：它真的去请求改一个已经结算的回合，用来证明账本会拒绝。
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-warn-400/12 text-warn-400">
                <ShieldQuestion className="h-3.5 w-3.5" />
              </span>
              试着改一下已经结算的回合
            </CardTitle>
            <CardDescription>这次请求应该被拒绝。被拒才是对的，说明账本真的锁住了。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || runId === null}
              onClick={() => {
                void probeLock();
              }}
              data-testid="probe-lock"
            >
              {busy ? "正在试…" : "改一改已经结算的第 2 回合"}
            </Button>
            <pre
              className="max-h-[168px] overflow-auto rounded-xl bg-ink-950/70 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-mist-300 ring-1 ring-inset ring-white/[0.05]"
              data-testid="probe-result"
            >
              {probe ?? "还没试。预期会被拒绝，账本不会变。"}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
