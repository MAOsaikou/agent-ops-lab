import { EventLog, AgentCards, CrisisCard, GateBar, LedgerSummary, SandboxPanel, VerifyPanel } from "../components/panels.js";
import { ReplayBar } from "../components/ReplayBar.js";
import { WorkflowGraph } from "../components/WorkflowGraph.js";
import { Badge } from "../components/ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.js";
import { PROFILE_TEXT, SCENARIO_TEXT } from "../lib/nodes.js";
import type { RunMeta, ScenarioCatalog } from "../lib/contract.js";
import { shortHash } from "../lib/utils.js";
import { activeRound, type UiState } from "../state/reducer.js";
import type { Replay } from "../state/useReplay.js";

export function RunInfoCard({ meta }: { readonly meta: RunMeta | null }): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>运行元数据</CardTitle>
        <CardDescription>{meta === null ? "未选择运行" : meta.runId}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5 text-[11px]">
        {meta === null ? (
          <div className="text-mist-500">先在「开局」里创建一局。</div>
        ) : (
          <>
            <Row label="场景" value={SCENARIO_TEXT[meta.scenario]} />
            <Row label="种子 / 回合" value={`${String(meta.seed)} / ${String(meta.rounds)}`} />
            <Row label="运行画像" value={PROFILE_TEXT[meta.profile]} />
            <Row label="Mock 调用" value={`${String(meta.calls)} 次`} />
            <Row label="报价事件" value={`${String(meta.quotes)} 条`} />
            <Row label="预算仲裁" value={`${String(meta.priceWars)} 次`} />
            <Row label="最终哈希" value={<span className="font-mono">{shortHash(meta.finalHash, 16)}</span>} />
            <div className="mt-0.5 flex items-center gap-1.5">
              <Badge tone={meta.replayVerified ? "lock" : "risk"}>
                {meta.replayVerified ? "fold 重算与运行哈希一致" : "重放不一致"}
              </Badge>
              <Badge tone="muted">{meta.eventSource}</Badge>
            </div>
            <div className="mt-1 rounded-lg border border-dashed border-ink-600/70 px-2 py-1.5 text-[10px] leading-relaxed text-mist-500">
              {meta.orchestrationNote}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-mist-500">{label}</span>
      <span className="truncate text-mist-300">{value}</span>
    </div>
  );
}

export function RunConsole({
  state,
  replay,
  meta,
  catalog,
  total,
}: {
  readonly state: UiState;
  readonly replay: Replay;
  readonly meta: RunMeta | null;
  readonly catalog: ScenarioCatalog | undefined;
  readonly total: number;
}): React.JSX.Element {
  const round = activeRound(state);
  const locked = state.rounds.filter((row) => row.locked).length;
  return (
    <div className="grid gap-3 xl:grid-cols-[252px_minmax(0,1fr)_292px]">
      <div className="flex flex-col gap-3">
        <AgentCards state={state} />
        <CrisisCard catalog={catalog} round={round} />
        <GateBar state={state} round={round} />
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <ReplayBar replay={replay} total={total} />
        <div className="h-[420px]">
          <WorkflowGraph state={state} />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <VerifyPanel state={state} round={round} />
          <EventLog state={state} />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <LedgerSummary state={state} expected={meta?.rounds ?? 8} />
        <div className="rounded-xl border border-ink-700/70 bg-ink-900/60 px-3 py-2 text-[11px] text-mist-300">
          <div className="flex items-center justify-between">
            <span className="text-mist-500">当前回合</span>
            <span className="tabular-nums text-mist-100">{round === null ? "—" : `第 ${String(round + 1)} 回合`}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-mist-500">已结算回合</span>
            <span className="tabular-nums text-lock-400">{locked} / {meta?.rounds ?? 8}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-mist-500">事件进度</span>
            <span className="tabular-nums text-mist-100">
              {state.lastSeq} / {total}
            </span>
          </div>
        </div>
        <SandboxPanel state={state} meta={meta} round={round} />
        <RunInfoCard meta={meta} />
      </div>
    </div>
  );
}
