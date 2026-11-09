import { useEffect, useState } from "react";

import { EventLog, AgentCards, GateBar, LedgerSummary, SandboxPanel, VerifyPanel } from "../components/panels.js";
import { ReplayBar } from "../components/ReplayBar.js";
import { RoundStory } from "../components/RoundStory.js";
import { WorkflowGraph, WorkflowNodeList } from "../components/WorkflowGraph.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.js";
import { PROFILE_TEXT, SCENARIO_TEXT } from "../lib/nodes.js";
import type { RunMeta, ScenarioCatalog } from "../lib/contract.js";
import { shortHash } from "../lib/utils.js";
import { activeRound, type UiState } from "../state/reducer.js";
import type { Replay } from "../state/useReplay.js";

function useNarrowViewport(query = "(max-width: 1023px)"): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = (): void => {
      setNarrow(list.matches);
    };
    update();
    list.addEventListener("change", update);
    return () => {
      list.removeEventListener("change", update);
    };
  }, [query]);
  return narrow;
}

export function RunInfoCard({ meta }: { readonly meta: RunMeta | null }): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>本局档案</CardTitle>
        <CardDescription>换一局就换一套数字，同一局随时可以重看</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-[12.5px]">
        {meta === null ? (
          <div className="text-mist-400">先去「开店」开一局。</div>
        ) : (
          <>
            <Row label="剧本" value={SCENARIO_TEXT[meta.scenario]} />
            <Row label="经营风格" value={PROFILE_TEXT[meta.profile]} />
            <Row label="回合数" value={`${String(meta.rounds)} 回合`} />
            <Row label="AI 出手" value={`${String(meta.calls)} 次`} />
            <Row label="拍板记录核对" value={meta.replayVerified ? "对得上" : "对不上"} />
            <details className="mt-2 rounded-xl bg-white/[0.03] px-3 py-2 text-[11.5px] text-mist-400">
              <summary className="cursor-pointer text-mist-300">技术备注（给工程看的）</summary>
              <div className="mt-1.5 flex flex-col gap-1">
                <Row label="本局编号" value={<span className="font-mono text-[11px]">{meta.runId}</span>} />
                <Row label="随机种子" value={String(meta.seed)} />
                <Row label="数据来源" value={meta.eventSource} />
                <Row label="记录指纹" value={<span className="font-mono text-[11px]">{shortHash(meta.finalHash, 16)}</span>} />
                <p className="mt-1 leading-relaxed">{meta.orchestrationNote}</p>
              </div>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="shrink-0 text-mist-400">{label}</span>
      <span className="truncate text-mist-100">{value}</span>
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
  const narrow = useNarrowViewport();
  return (
    <div className="flex flex-col gap-3">
      <ReplayBar replay={replay} total={total} />
      <RoundStory state={state} catalog={catalog} />
      <div className="grid gap-3 xl:grid-cols-[272px_minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-3">
          <AgentCards state={state} />
          <GateBar state={state} round={round} />
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          {narrow ? (
            <WorkflowNodeList state={state} />
          ) : (
            <div className="h-[400px]">
              <WorkflowGraph state={state} />
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            <VerifyPanel state={state} round={round} />
            <EventLog state={state} />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <LedgerSummary state={state} expected={meta?.rounds ?? 8} />
          <SandboxPanel state={state} meta={meta} round={round} />
          <RunInfoCard meta={meta} />
        </div>
      </div>
    </div>
  );
}
