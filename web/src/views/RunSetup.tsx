import { CalendarDays, PackageX, TrendingDown } from "lucide-react";

import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.js";
import { Stat } from "../components/ui/stat.js";
import { PROFILE_TEXT, SCENARIO_TEXT } from "../lib/nodes.js";
import type { RunMeta, RunProfile, ScenarioCatalog, ScenarioName } from "../lib/contract.js";
import { yuanCompact } from "../lib/utils.js";

const SCENARIO_ICON: Record<ScenarioName, React.JSX.Element> = {
  spring: <CalendarDays className="h-4 w-4" />,
  supplycut: <PackageX className="h-4 w-4" />,
  pricewar: <TrendingDown className="h-4 w-4" />,
};

const SCENARIO_HINT: Record<ScenarioName, string> = {
  spring: "天气正常的一个开学季，看的全是进货和定价的基本功",
  supplycut: "第 2、3 回合老供应商交不出货，得临时找备选供应商谈价",
  pricewar: "第 3 回合起隔壁把价压到一半，店里要决定跟不跟",
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
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader>
          <CardTitle>开店准备</CardTitle>
          <CardDescription>挑一个剧本，定好起点，再选这家店怎么经营。开张之后剧本和起点就不能改了。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2.5 sm:grid-cols-3">
            {scenarios.map((scenario) => {
              const active = scenario.name === selectedScenario;
              return (
                <button
                  key={scenario.name}
                  type="button"
                  onClick={() => {
                    onScenario(scenario.name);
                  }}
                  className={`rounded-xl p-3.5 text-left transition-all ${
                    active
                      ? "bg-flow-400/12 ring-1 ring-inset ring-flow-400/50"
                      : "bg-white/[0.03] ring-1 ring-inset ring-white/[0.05] hover:bg-white/[0.06]"
                  }`}
                  data-testid={`scenario-${scenario.name}`}
                >
                  <div className={`flex items-center gap-2 text-[14px] font-semibold ${active ? "text-flow-400" : "text-mist-100"}`}>
                    {SCENARIO_ICON[scenario.name]}
                    {SCENARIO_TEXT[scenario.name]}
                  </div>
                  <div className="mt-1.5 text-[11.5px] leading-relaxed text-mist-400">{SCENARIO_HINT[scenario.name]}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge tone="muted">{scenario.rounds} 回合</Badge>
                    <Badge tone="muted">初始现金 {yuanCompact(scenario.initial.cash)}</Badge>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5 text-[12px] text-mist-400">
              随机起点
              <input
                type="number"
                value={seed}
                onChange={(event) => {
                  onSeed(Number(event.target.value));
                }}
                className="h-10 rounded-xl bg-white/[0.04] px-3 text-[14px] tabular-nums text-mist-100 outline-none ring-1 ring-inset ring-white/[0.08] focus:ring-flow-400/60"
                data-testid="seed-input"
              />
            </label>
            <div className="flex flex-col gap-1.5 text-[12px] text-mist-400">
              营业回合
              <div className="flex h-10 items-center rounded-xl bg-white/[0.04] px-3 text-[14px] text-mist-100 ring-1 ring-inset ring-white/[0.06]">
                {catalog?.rounds ?? 8} 回合（剧本固定）
              </div>
            </div>
            <div className="flex flex-col gap-1.5 text-[12px] text-mist-400">
              店里的做事方式
              <div className="flex h-10 items-center rounded-xl bg-white/[0.04] px-3 text-[13px] text-mist-100 ring-1 ring-inset ring-white/[0.06]">
                三个角色各出主意，一起商量
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 text-[12px] text-mist-400">
            经营风格
            <div className="flex flex-wrap gap-1.5">
              {(["steady", "stressed"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    onProfile(item);
                  }}
                  className={`rounded-xl px-3.5 py-2 text-[12.5px] transition-colors ${
                    profile === item
                      ? "bg-flow-400/12 text-flow-400 ring-1 ring-inset ring-flow-400/50"
                      : "bg-white/[0.03] text-mist-300 ring-1 ring-inset ring-white/[0.05] hover:bg-white/[0.06]"
                  }`}
                >
                  {PROFILE_TEXT[item]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={onStart} disabled={busy} data-testid="start-run">
              {busy ? "正在算这一局…" : "开张，跑完这一局"}
            </Button>
            <span className="text-[11.5px] text-mist-400">演示用模拟对话，不需要密钥；开张后立刻能看每一回合</span>
          </div>
          {error === null ? null : (
            <div className="rounded-xl bg-risk-400/10 px-3 py-2.5 text-[12.5px] text-risk-400 ring-1 ring-inset ring-risk-400/30">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <Card>
          <CardHeader>
            <CardTitle>开张时的家底</CardTitle>
            <CardDescription>这些是开局条件，开张之后不会变</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <Stat label="剧本" value={SCENARIO_TEXT[selectedScenario]} />
            <Stat label="随机起点" value={seed} />
            <Stat label="营业回合" value={catalog?.rounds ?? 8} />
            <Stat label="对话方式" value="模拟" hint="不用密钥" />
            <Stat label="手上的现金" value={catalog === undefined ? "—" : yuanCompact(catalog.initial.cash)} />
            <Stat label="一开始的库存" value={catalog === undefined ? "—" : `茶 ${catalog.initial.inventory.tea} / 零食 ${catalog.initial.inventory.snack}`} />
          </CardContent>
        </Card>

        <Card className="flex-1">
          <CardHeader>
            <CardTitle>开过的店</CardTitle>
            <CardDescription>点一行就切到那一局的账</CardDescription>
          </CardHeader>
          <CardContent className="flex max-h-[280px] flex-col gap-1.5 overflow-y-auto">
            {runs.length === 0 ? (
              <div className="rounded-xl bg-white/[0.02] px-3 py-6 text-center text-[12.5px] text-mist-400">
                还没有开过店。挑好剧本，点「开张，跑完这一局」。
              </div>
            ) : (
              runs.map((run) => (
                <button
                  key={run.runId}
                  type="button"
                  onClick={() => {
                    onSelectRun(run.runId);
                  }}
                  className="rounded-xl bg-white/[0.03] px-3 py-2 text-left ring-1 ring-inset ring-white/[0.04] transition-colors hover:bg-white/[0.06]"
                >
                  <div className="flex items-center justify-between gap-2 text-[12.5px] text-mist-100">
                    <span>{SCENARIO_TEXT[run.scenario]} · 起点 {run.seed}</span>
                    <Badge tone={run.profile === "stressed" ? "warn" : "flow"}>{run.profile === "stressed" ? "激进" : "稳妥"}</Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-mist-400">
                    <span>{run.rounds} 回合</span>
                    <span>店里出手 {run.calls} 次</span>
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
