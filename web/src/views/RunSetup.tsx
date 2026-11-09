import { CalendarDays, PackageX, TrendingDown } from "lucide-react";

import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.js";
import { Stat } from "../components/ui/stat.js";
import { PROFILE_TEXT, SCENARIO_TEXT } from "../lib/nodes.js";
import type { RunMeta, RunProfile, ScenarioCatalog, ScenarioName } from "../lib/contract.js";
import { shortHash, yuanCompact } from "../lib/utils.js";

const SCENARIO_ICON: Record<ScenarioName, React.JSX.Element> = {
  spring: <CalendarDays className="h-4 w-4" />,
  supplycut: <PackageX className="h-4 w-4" />,
  pricewar: <TrendingDown className="h-4 w-4" />,
};

const SCENARIO_HINT: Record<ScenarioName, string> = {
  spring: "平静回合：只激活定价与采购，用来确认基础回放与账本锁定",
  supplycut: "第 2、3 回合主供应商产能为 0，调度器插入供应协商子工作流，能看到多轮报价与破裂",
  pricewar: "第 3 回合起竞品腰斩，条件节点进入预算仲裁，广告与降价的沙盘边际都是负数",
};

export function RunSetup({
  scenarios,
  selectedScenario,
  onScenario,
  seed,
  onSeed,
  profile,
  onProfile,
  onStart,
  busy,
  error,
  runs,
  onSelectRun,
}: {
  readonly scenarios: readonly ScenarioCatalog[];
  readonly selectedScenario: ScenarioName;
  readonly onScenario: (name: ScenarioName) => void;
  readonly seed: number;
  readonly onSeed: (seed: number) => void;
  readonly profile: RunProfile;
  readonly onProfile: (profile: RunProfile) => void;
  readonly onStart: () => void;
  readonly busy: boolean;
  readonly error: string | null;
  readonly runs: readonly RunMeta[];
  readonly onSelectRun: (runId: string) => void;
}): React.JSX.Element {
  const catalog = scenarios.find((item) => item.name === selectedScenario);
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader>
          <CardTitle>开局</CardTitle>
          <CardDescription>场景、种子、回合数与编排策略在开局后不可修改；危机按种子确定性生效</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-3">
            {scenarios.map((scenario) => {
              const active = scenario.name === selectedScenario;
              return (
                <button
                  key={scenario.name}
                  type="button"
                  onClick={() => {
                    onScenario(scenario.name);
                  }}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    active
                      ? "border-flow-400/70 bg-flow-400/10"
                      : "border-ink-700/70 bg-ink-900/50 hover:border-flow-400/40"
                  }`}
                  data-testid={`scenario-${scenario.name}`}
                >
                  <div className={`flex items-center gap-1.5 text-xs font-semibold ${active ? "text-flow-400" : "text-mist-100"}`}>
                    {SCENARIO_ICON[scenario.name]}
                    {SCENARIO_TEXT[scenario.name]}
                  </div>
                  <div className="mt-1 text-[10px] leading-relaxed text-mist-500">{SCENARIO_HINT[scenario.name]}</div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-mist-500">
                    <Badge tone="muted">{scenario.rounds} 回合</Badge>
                    <Badge tone="muted">初始现金 {yuanCompact(scenario.initial.cash)}</Badge>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-[11px] text-mist-500">
              种子
              <input
                type="number"
                value={seed}
                onChange={(event) => {
                  onSeed(Number(event.target.value));
                }}
                className="h-9 rounded-lg border border-ink-600 bg-ink-900 px-2 text-sm text-mist-100 outline-none focus:border-flow-400/70"
                data-testid="seed-input"
              />
            </label>
            <div className="flex flex-col gap-1 text-[11px] text-mist-500">
              回合数
              <div className="flex h-9 items-center rounded-lg border border-ink-600 bg-ink-900 px-2 text-sm text-mist-100">
                {catalog?.rounds ?? 8}（场景固定）
              </div>
            </div>
            <div className="flex flex-col gap-1 text-[11px] text-mist-500">
              编排策略
              <div className="flex h-9 items-center rounded-lg border border-ink-600 bg-ink-900 px-2 text-sm text-mist-100">
                动态协作（LLM 规划 + 规则裁决）
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1 text-[11px] text-mist-500">
            运行画像
            <div className="flex gap-1.5">
              {(["steady", "stressed"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    onProfile(item);
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-[11px] ${
                    profile === item
                      ? "border-flow-400/70 bg-flow-400/10 text-flow-400"
                      : "border-ink-700 bg-ink-900/50 text-mist-300 hover:border-flow-400/40"
                  }`}
                >
                  {PROFILE_TEXT[item]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={onStart} disabled={busy} data-testid="start-run">
              {busy ? "正在运行 U5 回合…" : "开局并回放"}
            </Button>
            <span className="text-[10px] text-mist-500">
              Mock 运行，无需密钥；开局后立即生成事件流并落盘到 .data
            </span>
          </div>
          {error === null ? null : (
            <div className="rounded-lg border border-risk-400/40 bg-risk-400/10 px-3 py-2 text-[11px] text-risk-400">{error}</div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <Card>
          <CardHeader>
            <CardTitle>本局参数</CardTitle>
            <CardDescription>开局后这些值写入运行元数据，界面上不可改</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <Stat label="场景" value={SCENARIO_TEXT[selectedScenario]} />
            <Stat label="种子" value={seed} />
            <Stat label="回合" value={catalog?.rounds ?? 8} />
            <Stat label="LLM" value="Mock" hint="无密钥" />
            <Stat label="初始现金" value={catalog === undefined ? "—" : yuanCompact(catalog.initial.cash)} />
            <Stat label="初始库存" value={catalog === undefined ? "—" : `茶 ${catalog.initial.inventory.tea} / 零食 ${catalog.initial.inventory.snack}`} />
          </CardContent>
        </Card>

        <Card className="flex-1">
          <CardHeader>
            <CardTitle>已录制运行</CardTitle>
            <CardDescription>点击任意一行切到该运行的控制台</CardDescription>
          </CardHeader>
          <CardContent className="flex max-h-[260px] flex-col gap-1.5 overflow-y-auto">
            {runs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-ink-600/70 px-3 py-6 text-center text-xs text-mist-500">
                还没有运行。选好场景后点「开局并回放」。
              </div>
            ) : (
              runs.map((run) => (
                <button
                  key={run.runId}
                  type="button"
                  onClick={() => {
                    onSelectRun(run.runId);
                  }}
                  className="rounded-lg border border-ink-700/60 bg-ink-900/50 px-2.5 py-1.5 text-left hover:border-flow-400/50"
                >
                  <div className="flex items-center justify-between text-[11px] text-mist-100">
                    <span>{SCENARIO_TEXT[run.scenario]} · 种子 {run.seed}</span>
                    <Badge tone={run.profile === "stressed" ? "warn" : "flow"}>{run.profile === "stressed" ? "压力" : "稳健"}</Badge>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-mist-500">
                    <span>{run.rounds} 回合</span>
                    <span>调用 {run.calls}</span>
                    <span className="font-mono">{shortHash(run.finalHash, 8)}</span>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
