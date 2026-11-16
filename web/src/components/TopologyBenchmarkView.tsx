import {
  Activity,
  AlertTriangle,
  Award,
  BarChart3,
  CheckCircle2,
  GitCompare,
  Play,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ALL_EVAL_TOPOLOGIES,
  compareSimShopCampaign,
  runAgentOpsEval,
  type AgentOpsEvalResponse,
  type EvalTopologyName,
  type SimShopCompareResponse,
  type SimShopScenarioName,
} from "../lib/agentops.js";
import { cn } from "../lib/cn.js";
import { money, pct, shortHash } from "../lib/format.js";
import { ActionButton, Panel, PanelHead, Pill, type PillTone } from "./Primitives.js";

const TOPOLOGY_META: Readonly<
  Record<
    EvalTopologyName,
    { readonly label: string; readonly shortLabel: string; readonly color: string; readonly tone: PillTone }
  >
> = {
  rule: {
    label: "静态规则基线 (rule)",
    shortLabel: "静态规则",
    color: "#8c8172",
    tone: "ink",
  },
  "single-agent": {
    label: "单 Agent (single-agent)",
    shortLabel: "单 Agent",
    color: "#b07a2e",
    tone: "ochre",
  },
  "collab-no-review": {
    label: "无审多 Agent (collab-no-review)",
    shortLabel: "无审多 Agent",
    color: "#c4442b",
    tone: "seal",
  },
  "collab-with-review": {
    label: "完整多 Agent 会签 (collab-with-review)",
    shortLabel: "完整多 Agent",
    color: "#2e6b52",
    tone: "jade",
  },
};

const ARCHETYPE_LABELS: Readonly<Record<string, string>> = {
  standard: "标准商品",
  missing_facts: "缺失事实",
  conflict_evidence: "证据冲突",
  cash_constraint: "现金约束",
  failure_recovery: "容错降级",
  should_reject: "应当拒绝",
};

const OUTCOME_LABELS: Readonly<Record<string, string>> = {
  approve: "通过/放行",
  reject: "驳回",
  clarify: "追问补料",
  incomplete: "未完成",
};

const SCENARIO_FILTER_OPTIONS: readonly {
  readonly id: "all" | SimShopScenarioName;
  readonly label: string;
}[] = [
  { id: "all", label: "全部 3 场景汇总" },
  { id: "spring", label: "spring 春季大促" },
  { id: "supplycut", label: "supplycut 主供断供" },
  { id: "pricewar", label: "pricewar 价格战" },
];

function signedMoneyFromCents(centsValue: number): string {
  const prefix = centsValue > 0 ? "+" : "";
  return `${prefix}${money(centsValue)}`;
}

export function TopologyBenchmarkView(): React.JSX.Element {
  const [evalResult, setEvalResult] = useState<AgentOpsEvalResponse | null>(null);
  const [campaignResult, setCampaignResult] = useState<SimShopCompareResponse | null>(null);
  const [campaignScenarioScope, setCampaignScenarioScope] = useState<"all" | SimShopScenarioName>("all");
  const [campaignSeedInput, setCampaignSeedInput] = useState<string>("7");
  const [caseFilter, setCaseFilter] = useState<string>("all");
  const [chartScenario, setChartScenario] = useState<SimShopScenarioName>("supplycut");
  const [chartMetric, setChartMetric] = useState<"cumulativeProfit" | "cash" | "reputation">(
    "cumulativeProfit",
  );
  const [busyBoth, setBusyBoth] = useState<boolean>(false);
  const [busyCampaign, setBusyCampaign] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const parseSeed = (): number | null => {
    const numVal = Number(campaignSeedInput.trim());
    if (!Number.isInteger(numVal) || numVal < -1_000_000 || numVal > 1_000_000) {
      setError("随机种子必须为 -1,000,000 到 1,000,000 之间的整数");
      return null;
    }
    return numVal;
  };

  const handleRunDualBenchmark = async (): Promise<void> => {
    if (busyBoth || busyCampaign) return;
    const seed = parseSeed();
    if (seed === null) return;
    setBusyBoth(true);
    setError(null);

    try {
      const [evalRes, compareRes] = await Promise.all([
        runAgentOpsEval({ topologies: ALL_EVAL_TOPOLOGIES }),
        compareSimShopCampaign({
          ...(campaignScenarioScope === "all" ? {} : { scenario: campaignScenarioScope }),
          seed,
          includeStressedAudit: true,
        }),
      ]);
      setEvalResult(evalRes);
      setCampaignResult(compareRes);
      if (compareRes.scenarios.length > 0 && !compareRes.scenarios.includes(chartScenario)) {
        setChartScenario(compareRes.scenarios[0]!);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "运行双基准评测失败");
    } finally {
      setBusyBoth(false);
    }
  };

  const handleRunCampaignOnly = async (): Promise<void> => {
    if (busyBoth || busyCampaign) return;
    const seed = parseSeed();
    if (seed === null) return;
    setBusyCampaign(true);
    setError(null);

    try {
      const compareRes = await compareSimShopCampaign({
        ...(campaignScenarioScope === "all" ? {} : { scenario: campaignScenarioScope }),
        seed,
        includeStressedAudit: true,
      });
      setCampaignResult(compareRes);
      if (compareRes.scenarios.length > 0 && !compareRes.scenarios.includes(chartScenario)) {
        setChartScenario(compareRes.scenarios[0]!);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "刷新 8 回合博弈对比失败");
    } finally {
      setBusyCampaign(false);
    }
  };

  const partAChartData = useMemo(() => {
    if (evalResult === null) return [];
    return ALL_EVAL_TOPOLOGIES.map((topology) => {
      const stat = evalResult.topologyStats[topology];
      const metrics = evalResult.summary[topology];
      return {
        topology,
        name: TOPOLOGY_META[topology].shortLabel,
        passRatePct: stat ? Number((stat.passRate * 100).toFixed(1)) : 0,
        toolCalls: metrics?.totalToolCalls ?? 0,
        missedPct: metrics ? Number((metrics.missedRiskRate * 100).toFixed(1)) : 0,
      };
    });
  }, [evalResult]);

  const filteredCases = useMemo(() => {
    if (evalResult === null) return [];
    if (caseFilter === "all") return evalResult.caseComparisons;
    if (caseFilter === "divergent") {
      return evalResult.caseComparisons.filter((item) => {
        const passes = ALL_EVAL_TOPOLOGIES.map((t) => item.results[t]?.pass).filter(
          (v): v is boolean => v !== undefined,
        );
        return passes.some((v) => !v) && passes.some((v) => v);
      });
    }
    return evalResult.caseComparisons.filter((item) => item.archetype === caseFilter);
  }, [evalResult, caseFilter]);

  const activeSeries = useMemo(() => {
    if (campaignResult === null) return null;
    return (
      campaignResult.roundSeries.find((s) => s.scenario === chartScenario) ??
      campaignResult.roundSeries[0] ??
      null
    );
  }, [campaignResult, chartScenario]);

  const campaignChartRows = useMemo(() => {
    if (activeSeries === null) return [];
    return activeSeries.rounds.map((row) => {
      const readMetric = (topology: EvalTopologyName): number => {
        const m = row.byTopology[topology];
        if (m === undefined) return 0;
        if (chartMetric === "cumulativeProfit") return Number((m.cumulativeProfitCents / 100).toFixed(2));
        if (chartMetric === "cash") return Number((m.cashCents / 100).toFixed(2));
        return m.reputation;
      };
      return {
        roundLabel: `R${String(row.round)}`,
        rule: readMetric("rule"),
        "single-agent": readMetric("single-agent"),
        "collab-no-review": readMetric("collab-no-review"),
        "collab-with-review": readMetric("collab-with-review"),
      };
    });
  }, [activeSeries, chartMetric]);

  return (
    <div data-testid="topology-benchmark-view" className="flex min-w-0 flex-col gap-3 sm:gap-4">
      <Panel>
        <PanelHead
          title="多 Agent vs 单 Agent 双基准评测竞技场"
          desc="同屏公平对照 rule、single-agent、collab-no-review、collab-with-review 四种编排拓扑，覆盖 12 案冻结上架会签（Part A）与 8 回合动态市场博弈（Part B）。"
          right={
            evalResult === null ? (
              <Pill tone="plain">待评测</Pill>
            ) : (
              <Pill tone="jade">
                <ShieldCheck className="h-3 w-3" />
                冻结数据集 {shortHash(evalResult.datasetHash, 10)}
              </Pill>
            )
          }
        />

        <div className="flex flex-col gap-3 p-3.5 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-wrap items-end gap-2.5">
              <div>
                <div className="mb-1 text-[11px] font-medium text-ink-500">
                  Part B 博弈对比场景范围
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SCENARIO_FILTER_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`arena-scenario-scope-${opt.id}`}
                      onClick={() => setCampaignScenarioScope(opt.id)}
                      className={cn(
                        "rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium ring-1 ring-inset transition-colors",
                        campaignScenarioScope === opt.id
                          ? "bg-ink-900 text-paper-50 ring-ink-900"
                          : "bg-paper-100 text-ink-700 ring-paper-300 hover:bg-paper-150",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="w-24">
                <label
                  htmlFor="arena-seed-input"
                  className="block text-[11px] font-medium text-ink-500"
                >
                  博弈种子
                </label>
                <input
                  id="arena-seed-input"
                  data-testid="arena-seed-input"
                  type="number"
                  step={1}
                  value={campaignSeedInput}
                  onChange={(event) => setCampaignSeedInput(event.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-paper-300 bg-paper-50 px-2.5 font-mono text-[12.5px] text-ink-900 tabular"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <ActionButton
                data-testid="arena-run-eval-button"
                onClick={() => {
                  void handleRunDualBenchmark();
                }}
                disabled={busyBoth || busyCampaign}
              >
                <Play className="h-4 w-4" />
                {busyBoth ? "双基准评测中…" : "一键拉取双基准对比"}
              </ActionButton>

              <ActionButton
                data-testid="arena-compare-button"
                variant="ghost"
                onClick={() => {
                  void handleRunCampaignOnly();
                }}
                disabled={busyBoth || busyCampaign}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", busyCampaign ? "animate-spin" : "")} />
                {busyCampaign ? "刷新博弈中…" : "仅刷新 8 回合博弈对比"}
              </ActionButton>
            </div>
          </div>

          {error === null ? null : (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-xl border border-seal-500/35 bg-seal-100/80 px-3.5 py-2.5 text-[12px] text-seal-600"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </Panel>

      {evalResult === null && campaignResult === null ? (
        <Panel className="border-dashed bg-paper-50/70 p-6 text-center text-[13px] text-ink-500">
          点击「一键拉取双基准对比」，实时跑通 12 案冻结上架会签基准（Part A）与 8 回合 SimShop 动态市场博弈对照（Part B），展示四拓扑得分、通过率差异与逐案归因证据。
        </Panel>
      ) : null}

      {evalResult === null ? null : (
        <Panel data-testid="arena-part-a">
          <PanelHead
            title="Part A · 12 案商品上架会签评测基准（4 拓扑同屏 PK）"
            desc={`统一预算上限：maxTokens=${String(evalResult.budgetCeiling.maxTokens)} · maxToolCalls=${String(evalResult.budgetCeiling.maxToolCalls)} · timeoutMs=${String(evalResult.budgetCeiling.timeoutMs)}`}
            right={
              <span className="font-mono text-[10.5px] text-ink-500">
                hash: {shortHash(evalResult.datasetHash, 14)}
              </span>
            }
          />

          <div className="flex flex-col gap-4 p-3.5 sm:p-5">
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {ALL_EVAL_TOPOLOGIES.map((topology) => {
                const stat = evalResult.topologyStats[topology];
                const metrics = evalResult.summary[topology];
                const meta = TOPOLOGY_META[topology];
                if (stat === undefined || metrics === undefined) return null;
                return (
                  <div
                    key={topology}
                    data-testid={`arena-part-a-card-${topology}`}
                    className={cn(
                      "rounded-xl border p-3.5",
                      topology === "collab-with-review"
                        ? "border-jade-500/50 bg-jade-100/30"
                        : "border-paper-300 bg-paper-50",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12.5px] font-semibold text-ink-900">{meta.shortLabel}</span>
                      <Pill tone={meta.tone}>
                        {stat.passedCases}/{stat.totalCases} ({pct(stat.passRate)})
                      </Pill>
                    </div>
                    <div className="mt-0.5 font-mono text-[10.5px] text-ink-400">{topology}</div>

                    <dl className="mt-2.5 grid grid-cols-2 gap-y-1.5 text-[11.5px] tabular">
                      <div>
                        <dt className="text-ink-400">漏检率</dt>
                        <dd className="font-semibold text-ink-900">{pct(metrics.missedRiskRate)}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-400">正确拒答率</dt>
                        <dd className="font-semibold text-ink-900">{pct(metrics.correctRefusalRate)}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-400">工具调用</dt>
                        <dd className="font-semibold text-ink-900">{metrics.totalToolCalls} 次</dd>
                      </div>
                      <div>
                        <dt className="text-ink-400">耗时 p50 / p90</dt>
                        <dd className="font-semibold text-ink-900">
                          {metrics.p50LatencyMs} / {metrics.p90LatencyMs} ms
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-2 border-t border-paper-200 pt-1.5 text-[10.5px] text-ink-500">
                      未匹配项：{metrics.unmatchedConditions.length} 条
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-xl border border-paper-200 bg-paper-100/40 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-ink-800">
                <BarChart3 className="h-4 w-4 text-jade-600" />
                <span>4 拓扑 12 案通过率 (%) 与工具调用次数对照</span>
              </div>
              <div className="h-[200px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={partAChartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#eae1cf" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tickLine={false}
                      axisLine={{ stroke: "#d9cdb4" }}
                      tick={{ fontSize: 11, fill: "#3d362c" }}
                    />
                    <YAxis
                      yAxisId="rate"
                      domain={[0, 100]}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 10.5, fill: "#2e6b52" }}
                      width={42}
                      tickFormatter={(v: number) => `${String(v)}%`}
                    />
                    <YAxis
                      yAxisId="calls"
                      orientation="right"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 10.5, fill: "#b07a2e" }}
                      width={40}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 10,
                        border: "1px solid #d9cdb4",
                        background: "#fdfbf5",
                        fontSize: 12,
                      }}
                      formatter={(value, name) => {
                        const val = Number(value ?? 0);
                        if (String(name) === "passRatePct") return [`${val.toFixed(1)}%`, "通过率"];
                        return [String(val), "工具调用总数"];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar
                      yAxisId="rate"
                      dataKey="passRatePct"
                      name="通过率 (%)"
                      fill="#2e6b52"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={36}
                    />
                    <Bar
                      yAxisId="calls"
                      dataKey="toolCalls"
                      name="工具调用"
                      fill="#b07a2e"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={36}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-[12.5px] font-semibold text-ink-900">
                  逐案 4 拓扑矩阵与「多 Agent 质询/修正归因」
                </div>
                <div className="flex flex-wrap gap-1">
                  {[
                    { id: "all", label: "全部 12 案" },
                    { id: "divergent", label: "仅看拓扑分歧案" },
                    { id: "standard", label: "标准" },
                    { id: "cash_constraint", label: "现金约束" },
                    { id: "conflict_evidence", label: "证据冲突" },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setCaseFilter(tab.id)}
                      className={cn(
                        "rounded-lg px-2 py-1 text-[11px] font-medium ring-1 ring-inset transition-colors",
                        caseFilter === tab.id
                          ? "bg-ink-900 text-paper-50 ring-ink-900"
                          : "bg-paper-50 text-ink-600 ring-paper-300 hover:bg-paper-100",
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table
                  data-testid="arena-case-table"
                  className="w-full min-w-[820px] border-collapse text-left text-[11.5px]"
                >
                  <thead>
                    <tr className="border-b border-paper-300 text-[10.5px] text-ink-500">
                      <th className="py-2 pr-2 font-medium">案例</th>
                      <th className="py-2 px-2 font-medium">类型 / 预期</th>
                      <th className="py-2 px-2 font-medium">rule</th>
                      <th className="py-2 px-2 font-medium">single-agent</th>
                      <th className="py-2 px-2 font-medium">collab-no-review</th>
                      <th className="py-2 px-2 font-medium">collab-with-review</th>
                      <th className="py-2 pl-2 font-medium">胜出与分歧归因解析</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-paper-200">
                    {filteredCases.map((entry) => (
                      <tr key={entry.caseId} className="align-top hover:bg-paper-100/40">
                        <td className="py-2.5 pr-2">
                          <div className="font-semibold text-ink-900">{entry.title}</div>
                          <div className="font-mono text-[10px] text-ink-400">{entry.caseId}</div>
                        </td>
                        <td className="py-2.5 px-2 whitespace-nowrap">
                          <div className="text-ink-700">
                            {ARCHETYPE_LABELS[entry.archetype] ?? entry.archetype}
                          </div>
                          <div className="text-[10.5px] text-ink-500">
                            {OUTCOME_LABELS[entry.expectedOutcome] ?? entry.expectedOutcome}
                            {entry.targetCandidateId === null ? "" : ` · ${entry.targetCandidateId}`}
                          </div>
                        </td>
                        {ALL_EVAL_TOPOLOGIES.map((topology) => {
                          const cell = entry.results[topology];
                          if (cell === undefined) {
                            return (
                              <td key={topology} className="py-2.5 px-2 text-ink-400">
                                —
                              </td>
                            );
                          }
                          return (
                            <td key={topology} className="py-2.5 px-2">
                              <div className="flex items-center gap-1">
                                {cell.pass ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-jade-600" />
                                ) : (
                                  <XCircle className="h-3.5 w-3.5 shrink-0 text-seal-600" />
                                )}
                                <span
                                  className={cn(
                                    "font-medium",
                                    cell.pass ? "text-jade-600" : "text-seal-600",
                                  )}
                                >
                                  {cell.pass ? "通过" : "未过"}
                                </span>
                              </div>
                              <div className="mt-0.5 text-[10px] text-ink-500">
                                {OUTCOME_LABELS[cell.outcome] ?? cell.outcome} · {cell.elapsedMs}ms
                              </div>
                              {cell.unmatched.length === 0 ? null : (
                                <div className="mt-0.5 text-[10px] leading-snug text-seal-600">
                                  {cell.unmatched.join("；")}
                                </div>
                              )}
                            </td>
                          );
                        })}
                        <td className="max-w-[280px] py-2.5 pl-2 text-[11px] leading-relaxed text-ink-700">
                          {entry.attribution}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {campaignResult === null ? null : (
        <Panel data-testid="arena-part-b">
          <PanelHead
            title="Part B · 8 回合动态市场博弈 4 拓扑同屏对比"
            desc={`评测场景：${campaignResult.scenarios.join(" / ")} · 随机种子：${String(campaignResult.seed)} · 每局 ${String(campaignResult.roundsPerRun)} 回合`}
            right={
              <Pill tone="jade">
                <GitCompare className="h-3 w-3" />
                {campaignResult.runs.length} 局实测对照
              </Pill>
            }
          />

          <div className="flex flex-col gap-4 p-3.5 sm:p-5">
            <div className="overflow-x-auto">
              <table
                data-testid="arena-campaign-summary"
                className="w-full min-w-[820px] border-collapse text-left text-[11.5px] tabular"
              >
                <thead>
                  <tr className="border-b border-paper-300 text-[10.5px] text-ink-500">
                    <th className="py-2 pr-2 font-medium">编排拓扑</th>
                    <th className="py-2 px-2 font-medium">累计净利</th>
                    <th className="py-2 px-2 font-medium">期末平均现金</th>
                    <th className="py-2 px-2 font-medium">期末平均声誉</th>
                    <th className="py-2 px-2 font-medium">总销量 / 缺货</th>
                    <th className="py-2 px-2 font-medium">断供议价成效</th>
                    <th className="py-2 px-2 font-medium">价格战零分配</th>
                    <th className="py-2 px-2 font-medium">Critic 审校</th>
                    <th className="py-2 px-2 font-medium">热升级 / 账本</th>
                    <th className="py-2 pl-2 font-medium">关键归因</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-paper-200">
                  {campaignResult.topologies.map((topology) => {
                    const sum = campaignResult.summary[topology];
                    if (sum === undefined) return null;
                    const meta = TOPOLOGY_META[topology];
                    return (
                      <tr
                        key={topology}
                        data-testid={`arena-part-b-row-${topology}`}
                        className={topology === "collab-with-review" ? "bg-jade-100/25" : ""}
                      >
                        <td className="py-2.5 pr-2">
                          <div className="font-semibold text-ink-900">{meta.shortLabel}</div>
                          <div className="font-mono text-[10px] text-ink-400">{topology}</div>
                        </td>
                        <td
                          className={cn(
                            "py-2.5 px-2 font-display text-[13.5px] font-semibold",
                            sum.totalProfitCents >= 0 ? "text-jade-600" : "text-seal-600",
                          )}
                        >
                          {signedMoneyFromCents(sum.totalProfitCents)}
                        </td>
                        <td className="py-2.5 px-2">{money(sum.avgFinalCashCents)}</td>
                        <td className="py-2.5 px-2">{sum.avgFinalReputation}</td>
                        <td className="py-2.5 px-2">
                          {sum.totalSales} /{" "}
                          <span className={sum.totalMissed > 150 ? "text-seal-600 font-medium" : ""}>
                            缺 {sum.totalMissed}
                          </span>
                        </td>
                        <td className="py-2.5 px-2">
                          {sum.negotiatedDealsCount} / {sum.negotiatedQuotesCount}
                        </td>
                        <td className="py-2.5 px-2">{sum.priceWarZeroInterceptions} 次</td>
                        <td className="py-2.5 px-2">
                          {sum.stressedAuditReviewPassRate !== undefined ? (
                            <span className="text-seal-600">
                              无审 / stressed {pct(sum.stressedAuditReviewPassRate)} (回退{" "}
                              {sum.stressedAuditFallbackRounds ?? 0} 次)
                            </span>
                          ) : topology === "collab-with-review" ? (
                            <Pill tone="jade">{pct(sum.reviewPassRate)} 通过</Pill>
                          ) : (
                            <span className="text-ink-400">无审核</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2">
                          <div>{sum.versionUpgradeCount} 次</div>
                          <div className="text-[10px] text-ink-500">
                            {sum.allLedgerConsistent ? "账本一致" : "不一致"}
                          </div>
                        </td>
                        <td className="max-w-[260px] py-2.5 pl-2 text-[11px] leading-snug text-ink-700">
                          {sum.keyAttribution}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {activeSeries === null ? null : (
              <div
                data-testid="arena-campaign-charts"
                className="rounded-xl border border-paper-300 bg-paper-100/45 p-3.5"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Activity className="h-4 w-4 text-seal-500" />
                    <span className="text-[12.5px] font-semibold text-ink-900">
                      8 回合 4 拓扑走势对比图
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {campaignResult.roundSeries.map((series) => (
                        <button
                          key={series.scenario}
                          type="button"
                          onClick={() => setChartScenario(series.scenario)}
                          className={cn(
                            "rounded-lg px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset transition-colors",
                            activeSeries.scenario === series.scenario
                              ? "bg-seal-500 text-paper-50 ring-seal-500"
                              : "bg-paper-50 text-ink-700 ring-paper-300 hover:bg-paper-150",
                          )}
                        >
                          {series.scenario}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {[
                      { id: "cumulativeProfit" as const, label: "累计净利 (¥)" },
                      { id: "cash" as const, label: "现金走势 (¥)" },
                      { id: "reputation" as const, label: "声誉曲线" },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setChartMetric(m.id)}
                        className={cn(
                          "rounded-lg px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset transition-colors",
                          chartMetric === m.id
                            ? "bg-ink-900 text-paper-50 ring-ink-900"
                            : "bg-paper-50 text-ink-600 ring-paper-300 hover:bg-paper-100",
                        )}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="h-[240px] w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={campaignChartRows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                      <CartesianGrid stroke="#eae1cf" vertical={false} />
                      <XAxis
                        dataKey="roundLabel"
                        tickLine={false}
                        axisLine={{ stroke: "#d9cdb4" }}
                        tick={{ fontSize: 11, fill: "#3d362c" }}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 10.5, fill: "#554c40" }}
                        width={56}
                        tickFormatter={(v: number) =>
                          chartMetric === "reputation" ? String(Math.round(v)) : `¥${String(Math.round(v))}`
                        }
                      />
                      <Tooltip
                        contentStyle={{
                          borderRadius: 10,
                          border: "1px solid #d9cdb4",
                          background: "#fdfbf5",
                          fontSize: 12,
                        }}
                        formatter={(value, name) => {
                          const numVal = Number(value ?? 0);
                          const formatted =
                            chartMetric === "reputation" ? String(Math.round(numVal)) : `¥${numVal.toFixed(2)}`;
                          return [formatted, String(name)];
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {campaignResult.topologies.map((topology) => {
                        const meta = TOPOLOGY_META[topology];
                        return (
                          <Line
                            key={topology}
                            type="monotone"
                            dataKey={topology}
                            name={meta.shortLabel}
                            stroke={meta.color}
                            strokeWidth={topology === "collab-with-review" ? 2.8 : 1.8}
                            {...(topology === "rule" ? { strokeDasharray: "4 3" } : {})}
                            dot={{ r: topology === "collab-with-review" ? 3.5 : 2.5 }}
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <div className="grid gap-2.5 md:grid-cols-3">
              {campaignResult.scenarios.map((scenario) => {
                const winner = campaignResult.scenarioWinners[scenario];
                if (winner === undefined) return null;
                return (
                  <div
                    key={scenario}
                    className="rounded-xl border border-paper-300 bg-paper-50 p-3 text-[12px]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 font-mono text-[11.5px] font-semibold text-ink-900">
                        <Award className="h-3.5 w-3.5 text-ochre-500" />
                        {scenario} 利润最高拓扑
                      </span>
                      <Pill tone={TOPOLOGY_META[winner.topology].tone}>{winner.topology}</Pill>
                    </div>
                    <div className="mt-1 font-display text-[17px] font-semibold text-ink-900 tabular">
                      {signedMoneyFromCents(winner.totalProfitCents)}
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-600">{winner.reason}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
