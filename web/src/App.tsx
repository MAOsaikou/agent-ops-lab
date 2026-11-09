import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Radio, ServerCog } from "lucide-react";

import { ModeBanner } from "./components/ModeBanner.js";
import { Badge } from "./components/ui/badge.js";
import { Tabs } from "./components/ui/tabs.js";
import { createRun, fetchLedger, fetchMode, fetchRun, fetchRuns } from "./lib/api.js";
import type { LedgerResponse, ModeInfo, RunMeta, RunProfile, ScenarioName } from "./lib/contract.js";
import { SCENARIO_TEXT } from "./lib/nodes.js";
import { useReplay } from "./state/useReplay.js";
import { Compare } from "./views/Compare.js";
import { Ledger } from "./views/Ledger.js";
import { Negotiation } from "./views/Negotiation.js";
import { RunConsole } from "./views/RunConsole.js";
import { RunSetup } from "./views/RunSetup.js";

const TABS = [
  { id: "setup", label: "开局" },
  { id: "console", label: "运行控制台" },
  { id: "negotiation", label: "协商与预算" },
  { id: "ledger", label: "账本" },
  { id: "compare", label: "对比" },
];

export function App(): React.JSX.Element {
  const [mode, setMode] = useState<ModeInfo | null>(null);
  const [runs, setRuns] = useState<readonly RunMeta[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [meta, setMeta] = useState<RunMeta | null>(null);
  const [total, setTotal] = useState(0);
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [tab, setTab] = useState("setup");
  const [scenario, setScenario] = useState<ScenarioName>("supplycut");
  const [seed, setSeed] = useState(7);
  const [profile, setProfile] = useState<RunProfile>("steady");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiOnline, setApiOnline] = useState(false);

  const replay = useReplay(runId, 90);
  const state = replay.state;

  const refreshRuns = useCallback(async () => {
    try {
      const list = await fetchRuns();
      setRuns(list);
      return list;
    } catch {
      setApiOnline(false);
      return [];
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function boot(): Promise<void> {
      try {
        const info = await fetchMode();
        if (cancelled) return;
        setMode(info);
        setApiOnline(true);
      } catch {
        setApiOnline(false);
        return;
      }
      const list = await refreshRuns();
      if (cancelled || list.length === 0) {
        return;
      }
      const first = list[0];
      if (first !== undefined) {
        setRunId(first.runId);
        setMeta(first);
        setTab("console");
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [refreshRuns]);

  useEffect(() => {
    if (runId === null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const record = await fetchRun(runId);
        if (cancelled) return;
        setMeta(record.meta);
        setTotal(record.frames.length);
        const nextLedger = await fetchLedger(runId);
        if (!cancelled) {
          setLedger(nextLedger);
        }
      } catch {
        if (!cancelled) {
          setError("无法读取该运行，检查服务是否在 127.0.0.1:47321");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    if (runId === null) {
      return;
    }
    if (tab !== "ledger" && replay.status !== "done") {
      return;
    }
    void fetchLedger(runId).then(setLedger).catch(() => undefined);
  }, [tab, replay.status, runId]);

  const catalog = useMemo(() => {
    const name = meta?.scenario ?? scenario;
    return mode?.scenarios.find((item) => item.name === name);
  }, [meta, mode, scenario]);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await createRun({ scenario, seed, profile });
      await refreshRuns();
      setMeta(created);
      setRunId(created.runId);
      setTab("console");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "开局失败");
    } finally {
      setBusy(false);
    }
  }, [profile, refreshRuns, scenario, seed]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col gap-3 px-4 py-3">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-flow-400/12 text-flow-400 ring-1 ring-inset ring-flow-400/25">
            <Activity className="h-[18px] w-[18px]" />
          </div>
          <div>
            <div className="text-[15px] font-semibold tracking-tight text-mist-100">多 Agent 经营挑战 · 运行控制台</div>
            <div className="text-[11.5px] text-mist-400">U7 · 中文运行控制台 · 事件溯源回放</div>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2.5 text-[11.5px] text-mist-400">
          <span className="inline-flex items-center gap-1.5">
            <ServerCog className="h-3.5 w-3.5" />
            服务 127.0.0.1:47321
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Radio className="h-3.5 w-3.5" />
            界面 127.0.0.1:47322
          </span>
          <Badge tone={apiOnline ? "lock" : "risk"}>{apiOnline ? "API 在线" : "API 离线"}</Badge>
        </div>
      </header>

      <ModeBanner mode={mode} />

      <div className="flex flex-wrap items-center gap-2">
        <Tabs items={TABS} value={tab} onValueChange={setTab} />
        <div className="ml-auto flex flex-wrap items-center gap-1.5 text-[11.5px] text-mist-400">
          {meta === null ? (
            <Badge tone="muted">未选择运行</Badge>
          ) : (
            <>
              <Badge tone="flow">{SCENARIO_TEXT[meta.scenario]}</Badge>
              <Badge tone="muted">种子 {meta.seed}</Badge>
              <Badge tone="muted">{meta.rounds} 回合</Badge>
              <Badge tone={meta.profile === "stressed" ? "warn" : "muted"}>
                {meta.profile === "stressed" ? "压力画像" : "稳健画像"}
              </Badge>
              <span className="font-mono">{meta.runId}</span>
            </>
          )}
        </div>
      </div>

      <main className="pb-4">
        {tab === "setup" ? (
          <RunSetup
            scenarios={mode?.scenarios ?? []}
            selectedScenario={scenario}
            onScenario={setScenario}
            seed={seed}
            onSeed={setSeed}
            profile={profile}
            onProfile={setProfile}
            onStart={() => {
              void start();
            }}
            busy={busy}
            error={error}
            runs={runs}
            onSelectRun={(id) => {
              setRunId(id);
              setTab("console");
            }}
          />
        ) : null}

        {tab === "console" ? (
          <RunConsole state={state} replay={replay} meta={meta} catalog={catalog} total={total} />
        ) : null}

        {tab === "negotiation" ? <Negotiation state={state} /> : null}

        {tab === "ledger" ? <Ledger state={state} ledger={ledger} runId={runId} /> : null}

        {tab === "compare" ? (
          <Compare
            runs={runs}
            currentRunId={runId}
            onSelectRun={(id) => {
              setRunId(id);
              setTab("console");
            }}
          />
        ) : null}
      </main>
    </div>
  );
}
