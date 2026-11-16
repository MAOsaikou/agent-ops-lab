import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cpu,
  GitBranch,
  History,
  Lock,
  Play,
  RefreshCw,
  Scale,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  Truck,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  attemptSimShopRoundCommit,
  createSimShopRun,
  fetchSimShopRun,
  fetchSimShopRuns,
  fetchSimShopScenarios,
  type SimShopCommitConflict,
  type SimShopProfile,
  type SimShopRoundView,
  type SimShopRunMeta,
  type SimShopRunView,
  type SimShopScenarioDetail,
  type SimShopScenarioName,
  type SimShopSourceProduct,
} from "../lib/agentops.js";
import { cn } from "../lib/cn.js";
import { money, shortHash } from "../lib/format.js";
import { ActionButton, Panel, PanelHead, Pill, type PillTone } from "./Primitives.js";

const PROFILE_OPTIONS: readonly {
  readonly id: SimShopProfile;
  readonly label: string;
  readonly badge: string;
  readonly summary: string;
}[] = [
  {
    id: "steady",
    label: "稳健完整编排 (steady)",
    badge: "按需子流 + 边际仲裁 + 热升级",
    summary: "触发断供时激活 3 轮议价子工作流；价格战触发负边际归零仲裁；Critic 核验通过并完成版本热升级。",
  },
  {
    id: "stressed",
    label: "高压极限测试 (stressed)",
    badge: "Critic 驳回 + 3 轮修正回退",
    summary: "注入超预算高风险提案，检验 Critic 拦截、3 轮 revisionLoop 耗尽与规则兜底安全收敛。",
  },
];

const WORKFLOW_PIPELINE_STEPS: readonly {
  readonly id: string;
  readonly label: string;
  readonly desc: string;
}[] = [
  { id: "plan", label: "1. 动态规划器", desc: "按信号与预算裁决激活子流" },
  { id: "proposals", label: "2. 三方并行提案", desc: "buyer / pricer / marketer" },
  { id: "price-war", label: "3. 价格战分支", desc: "marginalBids 边际收益仲裁" },
  { id: "supply", label: "4. 断供分支", desc: "supply-negotiation 三轮议价" },
  { id: "revise", label: "5. Critic 修正环", desc: "规则与预测门禁多轮复核" },
  { id: "reflect", label: "6. 跨回合复盘", desc: "生成补丁触发 pricer 热升级" },
  { id: "seal", label: "7. SHA-256 封存", desc: "commit + settle + reflect" },
];

function rulingTone(ruling: "accept" | "counter" | "walk"): PillTone {
  if (ruling === "accept") return "jade";
  if (ruling === "counter") return "ochre";
  return "seal";
}

function verdictTone(verdict: "pass" | "revise" | "reject"): PillTone {
  if (verdict === "pass") return "jade";
  if (verdict === "revise") return "ochre";
  return "seal";
}

function formatCentsSigned(centsValue: number): string {
  const prefix = centsValue > 0 ? "+" : "";
  return `${prefix}${money(centsValue)}`;
}

export function SimShopArena({
  sourceProduct,
  onClearSourceProduct,
}: {
  readonly sourceProduct: SimShopSourceProduct | null;
  readonly onClearSourceProduct: () => void;
}): React.JSX.Element {
  const [scenarios, setScenarios] = useState<readonly SimShopScenarioDetail[]>([]);
  const [runsHistory, setRunsHistory] = useState<readonly SimShopRunMeta[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<SimShopScenarioName>("supplycut");
  const [selectedProfile, setSelectedProfile] = useState<SimShopProfile>("steady");
  const [seedInput, setSeedInput] = useState<string>("7");
  const [activeRun, setActiveRun] = useState<SimShopRunView | null>(null);
  const [selectedRound, setSelectedRound] = useState<number | "all">("all");
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [tamperBusyRound, setTamperBusyRound] = useState<number | null>(null);
  const [tamperConflict, setTamperConflict] = useState<SimShopCommitConflict | null>(null);
  const [tamperNotice, setTamperNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchSimShopScenarios()
      .then((list) => {
        if (!active) return;
        setScenarios(list);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "加载 SimShop 场景目录失败");
      });
    void fetchSimShopRuns()
      .then((list) => {
        if (!active) return;
        setRunsHistory(list);
      })
      .catch(() => {
        if (!active) return;
        setRunsHistory([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const currentScenarioMeta = useMemo(
    () => scenarios.find((item) => item.name === selectedScenario) ?? null,
    [scenarios, selectedScenario],
  );

  const handleStartSimulation = async (): Promise<void> => {
    if (busy) return;
    const trimmedSeed = seedInput.trim();
    const parsedSeed = Number(trimmedSeed);
    if (!Number.isInteger(parsedSeed) || parsedSeed < -1_000_000 || parsedSeed > 1_000_000) {
      setError("随机种子必须为 -1,000,000 到 1,000,000 之间的整数");
      return;
    }

    setBusy(true);
    setError(null);
    setTamperConflict(null);
    setTamperNotice(null);

    try {
      const created = await createSimShopRun({
        scenario: selectedScenario,
        seed: parsedSeed,
        profile: selectedProfile,
        ...(sourceProduct !== null ? { sourceProduct } : {}),
      });
      setActiveRun(created);
      setSelectedRound("all");
      const latest = await fetchSimShopRuns().catch(() => null);
      if (latest !== null) setRunsHistory(latest);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "启动 8 回合博弈失败");
    } finally {
      setBusy(false);
    }
  };

  const handleOpenHistoryRun = async (runId: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setTamperConflict(null);
    setTamperNotice(null);
    try {
      const loaded = await fetchSimShopRun(runId);
      setActiveRun(loaded);
      setSelectedScenario(loaded.meta.scenario);
      setSelectedProfile(loaded.meta.profile);
      setSeedInput(String(loaded.meta.seed));
      setSelectedRound("all");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取历史沙盘记录失败");
    } finally {
      setBusy(false);
    }
  };

  const handleTamperAttempt = async (roundIndex: number): Promise<void> => {
    if (activeRun === null || tamperBusyRound !== null) return;
    setTamperBusyRound(roundIndex);
    setTamperNotice(null);
    try {
      const res = await attemptSimShopRoundCommit(activeRun.meta.runId, roundIndex, {
        tamperAttempt: true,
        forgedPriceCents: 9999,
      });
      if (res.locked) {
        setTamperConflict(res.conflict);
      } else {
        setTamperConflict(null);
        setTamperNotice(`服务端返回 HTTP ${String(res.status)}：${res.detail}`);
      }
    } catch (caught) {
      setTamperNotice(caught instanceof Error ? caught.message : "尝试提交篡改请求失败");
    } finally {
      setTamperBusyRound(null);
    }
  };

  const visibleRounds: readonly SimShopRoundView[] = useMemo(() => {
    if (activeRun === null) return [];
    if (selectedRound === "all") return activeRun.rounds;
    return activeRun.rounds.filter((item) => item.round === selectedRound);
  }, [activeRun, selectedRound]);

  const visibleQuotes = useMemo(() => {
    if (activeRun === null) return [];
    if (selectedRound === "all") return activeRun.quotes;
    return activeRun.quotes.filter((item) => item.round === selectedRound);
  }, [activeRun, selectedRound]);

  const visiblePriceWars = useMemo(() => {
    if (activeRun === null) return [];
    if (selectedRound === "all") return activeRun.priceWars;
    return activeRun.priceWars.filter((item) => item.round === selectedRound);
  }, [activeRun, selectedRound]);

  const visibleLoops = useMemo(() => {
    if (activeRun === null) return [];
    if (selectedRound === "all") return activeRun.loops;
    return activeRun.loops.filter((item) => item.round === selectedRound);
  }, [activeRun, selectedRound]);

  const roundChartData = useMemo(() => {
    if (activeRun === null) return [];
    return activeRun.rounds.map((row) => ({
      name: `R${String(row.round + 1)}`,
      roundLabel: row.roundLabel,
      profitYuan: Math.round((row.outcome?.profit ?? 0)) / 100,
      cashYuan: Math.round((row.outcome?.cash ?? 0)) / 100,
      reputation: row.outcome?.reputation ?? 0,
      missed: row.outcome?.missed ?? 0,
    }));
  }, [activeRun]);

  const stepPrev = (): void => {
    if (activeRun === null || activeRun.rounds.length === 0) return;
    if (selectedRound === "all") {
      setSelectedRound(0);
      return;
    }
    setSelectedRound(Math.max(0, selectedRound - 1));
  };

  const stepNext = (): void => {
    if (activeRun === null || activeRun.rounds.length === 0) return;
    if (selectedRound === "all") {
      setSelectedRound(0);
      return;
    }
    setSelectedRound(Math.min(activeRun.rounds.length - 1, selectedRound + 1));
  };

  return (
    <div data-testid="simshop-arena" className="flex min-w-0 flex-col gap-3 sm:gap-4">
      <p className="rounded-xl border border-paper-300 bg-paper-100/80 px-3 py-2 text-[11.5px] leading-relaxed text-ink-600">
        【仿真推演 · 确定性双 SKU 沙盘】基于 U5 市场规则与 Mock LLM 多 Agent 编排运行 8 回合博弈（茶叶礼盒 tea / 坚果零食 snack），所有决策与结算实时写入不可逆 SHA-256 哈希链。
      </p>

      {sourceProduct === null ? null : (
        <div
          data-testid="simshop-source-context"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-jade-500/35 bg-jade-100/50 px-3.5 py-2.5 text-[12px] text-ink-800"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 font-semibold text-jade-600">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span>已从单品多维会签台带入商品上下文</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-700 tabular">
              {sourceProduct.name !== undefined ? <span>商品：{sourceProduct.name}</span> : null}
              {sourceProduct.priceCents !== undefined ? (
                <span>建议售价：{money(sourceProduct.priceCents)}</span>
              ) : null}
              {sourceProduct.buyCents !== undefined ? (
                <span>采购成本：{money(sourceProduct.buyCents)}</span>
              ) : null}
              {sourceProduct.competitorCents !== undefined ? (
                <span>竞品价：{money(sourceProduct.competitorCents)}</span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClearSourceProduct}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-paper-50 px-2.5 py-1 text-[11px] font-medium text-ink-600 ring-1 ring-inset ring-paper-300 hover:bg-paper-150"
          >
            <X className="h-3 w-3" />
            清除背景
          </button>
        </div>
      )}

      <Panel>
        <PanelHead
          title="8 回合动态市场与供应链博弈沙盘"
          desc="选择剧本、编排画像与随机种子，检验按需子工作流、三轮议价、边际预算仲裁、热升级与防篡改账本。"
          right={
            activeRun === null ? (
              <Pill tone="plain">待启动仿真</Pill>
            ) : (
              <Pill tone={activeRun.ledger.matchesRunHash ? "jade" : "seal"}>
                {activeRun.ledger.matchesRunHash ? "8 回合账本链校验一致" : "账本校验异常"}
              </Pill>
            )
          }
        />

        <div className="flex flex-col gap-3.5 p-3.5 sm:p-5">
          <div>
            <div className="mb-2 text-[12px] font-semibold text-ink-800">一、选择博弈剧本</div>
            <div className="grid gap-2.5 md:grid-cols-3">
              {(scenarios.length > 0
                ? scenarios
                : [
                    {
                      name: "spring" as const,
                      title: "春季开学大促（稳态基准对照）",
                      highlight: "主备产能充足 · 检验日常补货与热升级",
                      description: "8 回合需求平稳，验证基准多 Agent 协作与策略热升级。",
                    },
                    {
                      name: "supplycut" as const,
                      title: "主供应商突发断供（供应链应急博弈）",
                      highlight: "第 2-3 回合主供断供 · 三轮议价子流",
                      description: "主供应商产能归零，触发 3 轮让步报价与规则脱敏校验。",
                    },
                    {
                      name: "pricewar" as const,
                      title: "竞品恶性价格战（边际收益预算仲裁）",
                      highlight: "第 3 回合竞品腰斩 · 零分配防亏损仲裁",
                      description: "竞品骤降 60%，沙盘仲裁识别负边际后分配 0 元避免亏损。",
                    },
                  ]
              ).map((scenario) => {
                const selected = selectedScenario === scenario.name;
                return (
                  <button
                    key={scenario.name}
                    type="button"
                    data-testid={`simshop-scenario-${scenario.name}`}
                    onClick={() => setSelectedScenario(scenario.name)}
                    className={cn(
                      "flex min-w-0 flex-col items-start rounded-xl border p-3 text-left transition-all",
                      selected
                        ? "border-seal-500 bg-seal-100/35 ring-1 ring-seal-500/30 shadow-card"
                        : "border-paper-300 bg-paper-50 hover:border-paper-400 hover:bg-paper-100/60",
                    )}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-semibold uppercase text-seal-600">
                        {scenario.name}
                      </span>
                      <Pill tone={selected ? "seal" : "ink"}>{selected ? "当前剧本" : "8 回合"}</Pill>
                    </div>
                    <div className="mt-1 text-[13px] font-semibold text-ink-900">{scenario.title}</div>
                    <div className="mt-0.5 text-[11px] font-medium text-ochre-500">{scenario.highlight}</div>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-600">
                      {scenario.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {currentScenarioMeta === null ? null : (
            <div className="grid gap-2 rounded-xl border border-paper-200 bg-paper-100/60 px-3 py-2.5 text-[11.5px] text-ink-700 sm:grid-cols-3">
              <div>
                <span className="text-ink-400">初始状态：</span>
                <span className="tabular font-medium text-ink-900">
                  现金 {money(currentScenarioMeta.initial.cash)} · 声誉 {currentScenarioMeta.initial.reputation} · 库存 tea{" "}
                  {currentScenarioMeta.initial.inventory.tea} / snack {currentScenarioMeta.initial.inventory.snack}
                </span>
              </div>
              <div>
                <span className="text-ink-400">主/备供产能：</span>
                <span className="tabular font-mono text-[11px] text-ink-800">
                  主[{currentScenarioMeta.primaryCapacity.join(",")}]
                </span>
              </div>
              <div>
                <span className="text-ink-400">竞品 tea 价程：</span>
                <span className="tabular font-mono text-[11px] text-ink-800">
                  [{currentScenarioMeta.competitorPrice.tea.map((p) => (p / 100).toFixed(2)).join(", ")}]
                </span>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-paper-200 pt-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="grid flex-1 gap-2 sm:grid-cols-2">
              {PROFILE_OPTIONS.map((profile) => {
                const active = selectedProfile === profile.id;
                return (
                  <button
                    key={profile.id}
                    type="button"
                    data-testid={`simshop-profile-${profile.id}`}
                    onClick={() => setSelectedProfile(profile.id)}
                    className={cn(
                      "flex min-w-0 flex-col rounded-xl border px-3 py-2 text-left transition-colors",
                      active
                        ? "border-ink-900 bg-ink-900 text-paper-50"
                        : "border-paper-300 bg-paper-100/70 text-ink-800 hover:bg-paper-150",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="text-[12.5px] font-semibold">{profile.label}</span>
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px]",
                          active ? "bg-paper-50/15 text-paper-100" : "bg-paper-200 text-ink-600",
                        )}
                      >
                        {profile.badge}
                      </span>
                    </div>
                    <span
                      className={cn(
                        "mt-1 text-[11px] leading-snug",
                        active ? "text-paper-200" : "text-ink-500",
                      )}
                    >
                      {profile.summary}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-end gap-2.5">
              <div className="w-28">
                <label
                  htmlFor="simshop-seed"
                  className="block text-[11px] font-medium text-ink-500"
                >
                  随机种子 (seed)
                </label>
                <input
                  id="simshop-seed"
                  data-testid="simshop-seed-input"
                  type="number"
                  step={1}
                  value={seedInput}
                  onChange={(event) => setSeedInput(event.target.value)}
                  className="mt-1 h-10 w-full rounded-xl border border-paper-300 bg-paper-50 px-3 font-mono text-[13px] text-ink-900 tabular focus:ring-2 focus:ring-seal-500/40"
                />
              </div>

              <ActionButton
                data-testid="simshop-start-button"
                onClick={() => {
                  void handleStartSimulation();
                }}
                disabled={busy}
              >
                <Play className="h-4 w-4" />
                {busy ? "8 回合推演中…" : "一键启动 8 回合博弈"}
              </ActionButton>
            </div>
          </div>

          {runsHistory.length === 0 ? null : (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-paper-200 pt-2.5 text-[11px]">
              <span className="inline-flex items-center gap-1 font-medium text-ink-500">
                <History className="h-3.5 w-3.5" />
                本次会话已落账沙盘：
              </span>
              {runsHistory.map((item) => (
                <button
                  key={item.runId}
                  type="button"
                  onClick={() => {
                    void handleOpenHistoryRun(item.runId);
                  }}
                  className={cn(
                    "rounded-lg border px-2 py-1 font-mono text-[10.5px] transition-colors",
                    activeRun?.meta.runId === item.runId
                      ? "border-seal-500 bg-seal-100/50 text-seal-600"
                      : "border-paper-300 bg-paper-100/70 text-ink-700 hover:bg-paper-150",
                  )}
                >
                  {item.runId}
                </button>
              ))}
            </div>
          )}

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

      {activeRun === null ? (
        <Panel className="border-dashed bg-paper-50/70 p-6 text-center text-[13px] text-ink-500">
          先选择上方剧本（推荐先试「supplycut 断供」或「pricewar 价格战」）与策略画像，点击「一键启动 8 回合博弈」查看完整编排状态机、议价走势、边际仲裁与不可逆哈希账本。
        </Panel>
      ) : (
        <>
          {activeRun.sourceContextNote === null ? null : (
            <div className="rounded-xl border border-paper-300 bg-paper-50 px-3.5 py-2 text-[12px] text-ink-700">
              {activeRun.sourceContextNote}
            </div>
          )}

          <section className="rounded-2xl bg-ink-900 p-4 text-paper-50 shadow-card sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-paper-50/15 pb-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-[16px] font-semibold">
                    {activeRun.scenarioInfo.title}
                  </span>
                  <span className="rounded bg-paper-50/15 px-2 py-0.5 font-mono text-[11px] text-paper-100">
                    {activeRun.meta.runId}
                  </span>
                </div>
                <p className="mt-0.5 text-[11.5px] text-paper-300">
                  画像 {activeRun.meta.profile} · 种子 {activeRun.meta.seed} · 总调用 {activeRun.totals.totalCalls} 次 · 议价报价 {activeRun.totals.totalQuotes} 条（成交 {activeRun.totals.acceptedQuotes}）
                </p>
              </div>
              <div className="text-right font-mono text-[11px] text-paper-300">
                <div>最终链指纹：{shortHash(activeRun.ledger.finalHash, 14)}</div>
                <div>{activeRun.meta.replayVerified ? "SQLite 镜像重放校验通过" : "待核验"}</div>
              </div>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <div>
                <dt className="text-[11px] text-paper-300">8 回合累计净利</dt>
                <dd
                  data-testid="simshop-total-profit"
                  className={cn(
                    "mt-0.5 font-display text-[20px] font-semibold tabular",
                    activeRun.totals.totalProfit >= 0 ? "text-jade-100" : "text-seal-100",
                  )}
                >
                  {formatCentsSigned(activeRun.totals.totalProfit)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-paper-300">期末可用现金</dt>
                <dd className="mt-0.5 font-display text-[20px] font-semibold tabular">
                  {money(activeRun.totals.finalCash)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-paper-300">期末声誉 / 缺货</dt>
                <dd className="mt-0.5 font-display text-[20px] font-semibold tabular">
                  {activeRun.totals.finalReputation}{" "}
                  <span className="text-[12px] font-normal text-paper-300">
                    / 缺 {activeRun.totals.totalMissed} 件
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-paper-300">断供议价成交</dt>
                <dd className="mt-0.5 font-display text-[20px] font-semibold tabular">
                  {activeRun.totals.acceptedQuotes} / {activeRun.totals.totalQuotes}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-paper-300">价格战仲裁 / 兜底</dt>
                <dd className="mt-0.5 font-display text-[20px] font-semibold tabular">
                  {activeRun.totals.priceWarCount} 次{" "}
                  <span className="text-[12px] font-normal text-paper-300">
                    / 兜底 {activeRun.totals.fallbackRounds} 回合
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-paper-300">版本热升级</dt>
                <dd className="mt-0.5 font-display text-[20px] font-semibold tabular">
                  {activeRun.totals.versionUpgradeCount} 次
                </dd>
              </div>
            </dl>
          </section>

          <Panel data-testid="simshop-round-player">
            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 sm:px-5 sm:py-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  data-testid="simshop-round-all"
                  onClick={() => setSelectedRound("all")}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-[11.5px] font-semibold ring-1 ring-inset transition-colors",
                    selectedRound === "all"
                      ? "bg-ink-900 text-paper-50 ring-ink-900"
                      : "bg-paper-100 text-ink-700 ring-paper-300 hover:bg-paper-150",
                  )}
                >
                  全部展开 (8 回合)
                </button>
                <button
                  type="button"
                  data-testid="simshop-round-prev"
                  onClick={stepPrev}
                  disabled={selectedRound === 0}
                  aria-label="上一回合"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-paper-100 text-ink-700 ring-1 ring-inset ring-paper-300 hover:bg-paper-150 disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <div className="flex flex-wrap items-center gap-1">
                  {activeRun.rounds.map((r) => {
                    const isSelected = selectedRound === r.round;
                    const tag = r.supplyTriggered
                      ? "断供"
                      : r.priceWarTriggered
                        ? "价格战"
                        : r.usedFallback
                          ? "兜底"
                          : null;
                    return (
                      <button
                        key={r.round}
                        type="button"
                        data-testid={`simshop-round-tab-${String(r.round)}`}
                        onClick={() => setSelectedRound(r.round)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium ring-1 ring-inset transition-colors",
                          isSelected
                            ? "bg-seal-500 text-paper-50 ring-seal-500"
                            : "bg-paper-50 text-ink-700 ring-paper-300 hover:bg-paper-100",
                        )}
                      >
                        <span>第{r.round + 1}回合</span>
                        {tag === null ? null : (
                          <span
                            className={cn(
                              "rounded px-1 text-[9.5px]",
                              isSelected ? "bg-paper-50/20 text-paper-50" : "bg-ochre-100 text-ochre-500",
                            )}
                          >
                            {tag}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  data-testid="simshop-round-next"
                  onClick={stepNext}
                  disabled={selectedRound === activeRun.rounds.length - 1}
                  aria-label="下一回合"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-paper-100 text-ink-700 ring-1 ring-inset ring-paper-300 hover:bg-paper-150 disabled:opacity-40"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="text-[11px] text-ink-500">
                当前视图：{selectedRound === "all" ? "全 8 回合总览" : `第 ${String(selectedRound + 1)} 回合单步精查`}
              </div>
            </div>
          </Panel>

          <Panel data-testid="simshop-orchestration-panel">
            <PanelHead
              title="一、回合编排状态机与 Agent 动态版本热升级轨"
              desc={activeRun.meta.orchestrationNote}
              right={
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone="jade">
                    <Cpu className="h-3 w-3" />
                    热升级 {activeRun.versionUpgrades.length} 次
                  </Pill>
                </div>
              }
            />

            <div className="flex flex-col gap-3.5 p-3.5 sm:p-5">
              <div className="grid gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
                {WORKFLOW_PIPELINE_STEPS.map((step) => (
                  <div
                    key={step.id}
                    className="rounded-xl border border-paper-300/80 bg-paper-100/60 px-2.5 py-2"
                  >
                    <div className="text-[11px] font-semibold text-ink-900">{step.label}</div>
                    <div className="mt-0.5 text-[10px] leading-snug text-ink-500">{step.desc}</div>
                  </div>
                ))}
              </div>

              <div
                data-testid="simshop-version-upgrades"
                className="rounded-xl border border-paper-300 bg-paper-100/50 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-900">
                    <GitBranch className="h-4 w-4 text-jade-600" />
                    <span>Agent 动态版本热升级轨迹</span>
                  </div>
                  <Pill tone={activeRun.versionUpgrades.length > 0 ? "jade" : "ink"}>
                    {activeRun.versionUpgrades.length > 0
                      ? `已热升级 ${String(activeRun.versionUpgrades.length)} 项`
                      : "未触发版本变更"}
                  </Pill>
                </div>

                {activeRun.versionUpgrades.length === 0 ? (
                  <p className="mt-2 text-[12px] text-ink-500">
                    本次运行未记录到版本跃迁（可能因首轮即走规则兜底跳过复盘）。
                  </p>
                ) : (
                  <div className="mt-2.5 flex flex-col gap-2">
                    {activeRun.versionUpgrades.map((up) => (
                      <div
                        key={`${up.agentId}-${String(up.seq)}`}
                        className="flex flex-col gap-1 rounded-xl border border-jade-500/35 bg-jade-100/40 px-3 py-2.5 text-[12px]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2 font-semibold text-ink-900">
                            <span>{up.agentLabel}</span>
                            <span className="inline-flex items-center gap-1 rounded bg-paper-50 px-2 py-0.5 font-mono text-[11px] text-ink-700 ring-1 ring-inset ring-paper-300">
                              {up.agentId}@{up.fromVersion}
                              <ArrowRight className="h-3 w-3 text-jade-600" />
                              <strong className="text-jade-600">
                                {up.agentId}@{up.toVersion}
                              </strong>
                            </span>
                          </div>
                          <Pill tone="jade">{up.roundLabel} 生效</Pill>
                        </div>
                        <div className="text-[11.5px] text-ink-700">{up.reason}</div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10.5px] text-ink-500">
                          <span className="break-all">
                            fromPromptHash: <span className="text-ink-700">{up.fromPromptHash}</span>
                          </span>
                          <span className="break-all">
                            toPromptHash: <span className="text-jade-600">{up.toPromptHash}</span>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-2.5 md:grid-cols-2">
                {visibleRounds.map((round) => (
                  <div
                    key={round.round}
                    data-testid={`simshop-round-card-${String(round.round)}`}
                    className={cn(
                      "rounded-xl border p-3 text-[12px]",
                      round.usedFallback
                        ? "border-seal-500/40 bg-seal-100/20"
                        : round.supplyTriggered || round.priceWarTriggered
                          ? "border-ochre-500/40 bg-ochre-100/25"
                          : "border-paper-300 bg-paper-50",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-paper-200 pb-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-display text-[13.5px] font-semibold text-ink-900">
                          {round.roundLabel}
                        </span>
                        <Pill tone={round.usedFallback ? "seal" : "jade"}>{round.stopReasonLabel}</Pill>
                        {round.supplyTriggered ? <Pill tone="ochre">触发断供议价</Pill> : null}
                        {round.priceWarTriggered ? <Pill tone="seal">触发价格战仲裁</Pill> : null}
                      </div>
                      <span className="tabular font-mono text-[11px] text-ink-500">
                        调用 {round.calls} / 预算 {round.plannedCalls}
                      </span>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11.5px] tabular sm:grid-cols-4">
                      <div>
                        <span className="text-ink-400">主供产能：</span>
                        <span className="font-medium text-ink-900">{round.supplierCapacity.primary}</span>
                      </div>
                      <div>
                        <span className="text-ink-400">备供产能：</span>
                        <span className="font-medium text-ink-900">{round.supplierCapacity.backup}</span>
                      </div>
                      <div>
                        <span className="text-ink-400">回合净利：</span>
                        <span
                          className={cn(
                            "font-semibold",
                            (round.outcome?.profit ?? 0) >= 0 ? "text-jade-600" : "text-seal-600",
                          )}
                        >
                          {round.outcome ? formatCentsSigned(round.outcome.profit) : "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-ink-400">销量 / 缺货：</span>
                        <span className="font-medium text-ink-900">
                          {round.outcome ? `${round.outcome.sales} / ${round.outcome.missed}` : "—"}
                        </span>
                      </div>
                    </div>

                    {round.activatedSubflows.length > 0 ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
                        <span className="text-ink-500">激活子流：</span>
                        {round.activatedSubflows.map((sf) => (
                          <Pill key={sf} tone="ochre">
                            {sf}
                          </Pill>
                        ))}
                      </div>
                    ) : null}

                    {round.agentVersions.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {round.agentVersions.map((av) => (
                          <span
                            key={`${String(round.round)}-${av.agentId}`}
                            className="rounded bg-paper-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-700 ring-1 ring-inset ring-paper-200"
                          >
                            {av.agentId}@{av.version} ({shortHash(av.promptHash, 8)})
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {round.activatedNodes.length > 0 ? (
                      <details className="mt-2 border-t border-paper-200/80 pt-1.5">
                        <summary className="cursor-pointer text-[11px] text-ink-500 hover:text-ink-800">
                          查看本回合节点事件（{round.activatedNodes.length} 条）
                        </summary>
                        <ul className="mt-1.5 space-y-1 text-[10.5px] text-ink-600">
                          {round.activatedNodes.map((node) => (
                            <li
                              key={node.seq}
                              className="flex flex-wrap items-center justify-between gap-1 rounded bg-paper-100/70 px-2 py-1"
                            >
                              <span>
                                <strong>{node.nodeLabel}</strong> ({node.event}) · {node.reason}
                              </span>
                              {node.version === undefined ? null : (
                                <span className="font-mono text-[10px] text-ink-500">
                                  v{node.version}
                                  {node.score !== undefined ? ` · 分=${node.score}` : ""}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                ))}
              </div>

              {visibleLoops.length === 0 ? null : (
                <div className="rounded-xl border border-ochre-500/35 bg-ochre-100/40 p-3">
                  <div className="text-[12px] font-semibold text-ink-900">
                    Critic 修正循环（revisionLoop）记录（共 {visibleLoops.length} 次迭代）
                  </div>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[540px] border-collapse text-left text-[11.5px] tabular">
                      <thead>
                        <tr className="border-b border-paper-300 text-[10.5px] text-ink-500">
                          <th className="py-1.5 pr-3 font-medium">回合</th>
                          <th className="py-1.5 px-2 font-medium">迭代轮次</th>
                          <th className="py-1.5 px-2 font-medium">Critic 裁决</th>
                          <th className="py-1.5 px-2 font-medium">置信度</th>
                          <th className="py-1.5 px-2 font-medium">预测 p50</th>
                          <th className="py-1.5 px-2 font-medium">终止原因</th>
                          <th className="py-1.5 pl-2 font-medium">决策哈希</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-paper-200">
                        {visibleLoops.map((loop) => (
                          <tr key={loop.seq}>
                            <td className="py-1.5 pr-3 font-medium text-ink-900">{loop.roundLabel}</td>
                            <td className="py-1.5 px-2">第 {loop.iteration} 轮</td>
                            <td className="py-1.5 px-2">
                              <Pill tone={verdictTone(loop.verdict)}>{loop.verdictLabel}</Pill>
                            </td>
                            <td className="py-1.5 px-2">
                              {loop.confidence === null ? "—" : loop.confidence.toFixed(2)}
                            </td>
                            <td className="py-1.5 px-2">{money(loop.p50)}</td>
                            <td className="py-1.5 px-2 text-ink-600">{loop.stopReasonLabel}</td>
                            <td className="py-1.5 pl-2 font-mono text-[10.5px] text-ink-500">
                              {shortHash(loop.decisionHash, 10)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </Panel>

          <Panel data-testid="simshop-negotiation-panel">
            <PanelHead
              title="二、供应链断供三轮议价子工作流谈判走势表"
              desc="主供应商产能归零时由规划器按需唤醒 supply-negotiation 子流；经底价脱敏校验（screenTalk）与最多 3 轮让步报价（accept / counter / walk）完成备供切换。"
              right={
                <Pill tone={visibleQuotes.length > 0 ? "ochre" : "ink"}>
                  <Truck className="h-3 w-3" />
                  议价记录 {visibleQuotes.length} 条
                </Pill>
              }
            />

            <div className="p-3.5 sm:p-5">
              {visibleQuotes.length === 0 ? (
                <div className="rounded-xl border border-paper-300/80 bg-paper-100/50 px-4 py-3 text-[12px] text-ink-600">
                  当前视图回合未触发主供应商断供，动态规划器跳过 <code className="font-mono">supply-negotiation</code> 子工作流，节省供应商谈判与 LLM 调用预算。
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[740px] border-collapse text-left text-[11.5px] tabular">
                    <thead>
                      <tr className="border-b border-paper-300 text-[10.5px] text-ink-500">
                        <th className="py-2 pr-2 font-medium">回合</th>
                        <th className="py-2 px-2 font-medium">谈判轮次</th>
                        <th className="py-2 px-2 font-medium">供应商</th>
                        <th className="py-2 px-2 font-medium">商品 SKU</th>
                        <th className="py-2 px-2 font-medium">挂牌价</th>
                        <th className="py-2 px-2 font-medium">本轮报价/底价</th>
                        <th className="py-2 px-2 font-medium">规则底价脱敏话术</th>
                        <th className="py-2 px-2 font-medium">裁决</th>
                        <th className="py-2 px-2 font-medium">交期</th>
                        <th className="py-2 pl-2 font-medium">成交量 / 产能</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-paper-200">
                      {visibleQuotes.map((quote) => (
                        <tr key={quote.seq} className={quote.ruling === "accept" ? "bg-jade-100/25" : ""}>
                          <td className="py-2 pr-2 font-medium text-ink-900">{quote.roundLabel}</td>
                          <td className="py-2 px-2">第 {quote.quoteRound} / 3 轮</td>
                          <td className="py-2 px-2">{quote.supplierLabel}</td>
                          <td className="py-2 px-2">{quote.skuLabel}</td>
                          <td className="py-2 px-2 text-ink-500">{money(quote.offerUnitCost)}</td>
                          <td className="py-2 px-2 font-semibold text-ink-900">{money(quote.unitCost)}</td>
                          <td className="max-w-[230px] py-2 px-2">
                            <div className="text-[10.5px] font-medium text-jade-600">{quote.talkLabel}</div>
                            <div className="truncate text-[10.5px] text-ink-500" title={quote.talk}>
                              {quote.talk || "（底价数字已脱敏拦截）"}
                            </div>
                          </td>
                          <td className="py-2 px-2">
                            <Pill tone={rulingTone(quote.ruling)}>{quote.rulingLabel}</Pill>
                          </td>
                          <td className="py-2 px-2">{quote.leadTime} 回合</td>
                          <td className="py-2 pl-2 font-medium text-ink-900">
                            {quote.qty} / {quote.capacity}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Panel>

          <Panel data-testid="simshop-pricewar-panel">
            <PanelHead
              title="三、竞品价格战边际收益预算仲裁台"
              desc="当竞品突然恶性降价时，沙盘先测算「降价」与「加投流」两项动作的边际期望收益；若边际收益 ≤ 0，则强制分配 0 元以防越卖越亏。"
              right={
                <Pill tone={visiblePriceWars.length > 0 ? "seal" : "ink"}>
                  <TrendingDown className="h-3 w-3" />
                  仲裁触发 {visiblePriceWars.length} 次
                </Pill>
              }
            />

            <div className="p-3.5 sm:p-5">
              {visiblePriceWars.length === 0 ? (
                <div className="rounded-xl border border-paper-300/80 bg-paper-100/50 px-4 py-3 text-[12px] text-ink-600">
                  当前视图回合未检测到竞品剧烈降价冲击，编排分支走 <code className="font-mono">hold-budget</code>（维持日常预算）。若想观察负边际零分配拦截，可选择「pricewar 竞品恶性价格战」剧本。
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {visiblePriceWars.map((pw) => (
                    <div
                      key={pw.seq}
                      data-testid={`simshop-pricewar-item-${String(pw.round)}`}
                      className="rounded-xl border border-seal-500/35 bg-seal-100/20 p-3.5 text-[12px]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-display text-[14px] font-semibold text-ink-900">
                            {pw.roundLabel} · 价格战沙盘仲裁
                          </span>
                          <Pill tone={pw.allocation.ads === 0 && pw.allocation.priceCut === 0 ? "jade" : "ochre"}>
                            {pw.allocation.ads === 0 && pw.allocation.priceCut === 0
                              ? "负边际归零拦截（0 元分配）"
                              : "正边际按权重分配"}
                          </Pill>
                        </div>
                        <span className="tabular text-[11.5px] text-ink-600">
                          可用现金：{money(pw.cash)}
                        </span>
                      </div>

                      <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                        <div className="rounded-lg border border-paper-300 bg-paper-50 px-3 py-2 tabular">
                          <div className="text-[11px] text-ink-500">降价边际收益出价 (priceCut)</div>
                          <div className="mt-0.5 flex items-baseline justify-between gap-2">
                            <span
                              className={cn(
                                "font-display text-[16px] font-semibold",
                                pw.amounts.priceCut <= 0 ? "text-seal-600" : "text-jade-600",
                              )}
                            >
                              {formatCentsSigned(pw.amounts.priceCut)}
                            </span>
                            <span className="text-[11.5px] font-semibold text-ink-900">
                              → 实配 {money(pw.allocation.priceCut)}
                            </span>
                          </div>
                        </div>

                        <div className="rounded-lg border border-paper-300 bg-paper-50 px-3 py-2 tabular">
                          <div className="text-[11px] text-ink-500">投流边际收益出价 (ads)</div>
                          <div className="mt-0.5 flex items-baseline justify-between gap-2">
                            <span
                              className={cn(
                                "font-display text-[16px] font-semibold",
                                pw.amounts.ads <= 0 ? "text-seal-600" : "text-jade-600",
                              )}
                            >
                              {formatCentsSigned(pw.amounts.ads)}
                            </span>
                            <span className="text-[11.5px] font-semibold text-ink-900">
                              → 实配 {money(pw.allocation.ads)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-700">{pw.rationale}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHead
              title="8 回合现金、净利与声誉走势"
              desc="左轴：回合净利（金柱）与可用现金（墨绿线）；右轴：店铺声誉曲线。"
              right={<Scale className="h-4 w-4 text-ink-500" />}
            />
            <div className="p-3.5 sm:p-5">
              <div className="h-[220px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={roundChartData} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#eae1cf" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tickLine={false}
                      axisLine={{ stroke: "#d9cdb4" }}
                      tick={{ fontSize: 11, fill: "#554c40" }}
                    />
                    <YAxis
                      yAxisId="yuan"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 10.5, fill: "#2e6b52" }}
                      width={54}
                      tickFormatter={(v: number) => `¥${String(Math.round(v))}`}
                    />
                    <YAxis
                      yAxisId="rep"
                      orientation="right"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 10.5, fill: "#c4442b" }}
                      width={42}
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
                        if (String(name) === "profitYuan") return [`¥${numVal.toFixed(2)}`, "当回合净利"];
                        if (String(name) === "cashYuan") return [`¥${numVal.toFixed(2)}`, "期末现金"];
                        return [String(numVal), "店铺声誉"];
                      }}
                    />
                    <Bar yAxisId="yuan" dataKey="profitYuan" fill="#b07a2e" radius={[3, 3, 0, 0]} maxBarSize={22} />
                    <Line
                      yAxisId="yuan"
                      type="monotone"
                      dataKey="cashYuan"
                      stroke="#2e6b52"
                      strokeWidth={2.2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      yAxisId="rep"
                      type="monotone"
                      dataKey="reputation"
                      stroke="#c4442b"
                      strokeWidth={2}
                      strokeDasharray="4 3"
                      dot={{ r: 2.5 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Panel>

          <Panel data-testid="simshop-ledger-panel">
            <PanelHead
              title="四、8 回合不可逆 SHA-256 哈希账本与防篡改边界"
              desc="每回合结算均串联上一回合哈希（prevHash → hash）。点击任一回合「尝试重做/篡改」将真实请求 POST /api/simshop/runs/:runId/rounds/:round/commit，验证服务端 409 round-locked 拒绝边界。"
              right={
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone={activeRun.ledger.matchesRunHash ? "jade" : "seal"}>
                    <Lock className="h-3 w-3" />
                    {activeRun.ledger.matchesRunHash ? "哈希链完整封存" : "哈希链不一致"}
                  </Pill>
                </div>
              }
            />

            <div className="flex flex-col gap-3 p-3.5 sm:p-5">
              {tamperConflict === null ? null : (
                <div
                  data-testid="simshop-tamper-proof"
                  className="stamp-in rounded-xl border-2 border-seal-500/70 bg-seal-100/50 p-3.5 text-[12px]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-semibold text-seal-600">
                      <ShieldAlert className="h-4 w-4 shrink-0" />
                      <span>
                        不可逆边界拦截凭证 · HTTP 409 ({tamperConflict.code}) · {tamperConflict.roundLabel}
                      </span>
                    </div>
                    <Pill tone="seal">拒绝篡改</Pill>
                  </div>
                  <p className="mt-1.5 font-medium text-ink-900">{tamperConflict.detail}</p>
                  <div className="mt-2 grid gap-1 rounded-lg bg-paper-50/90 p-2.5 font-mono text-[10.5px] text-ink-600">
                    <div className="break-all">
                      <span className="text-ink-400">storedDecisionHash: </span>
                      <span className="select-all text-ink-900">{tamperConflict.storedDecisionHash}</span>
                    </div>
                    <div className="break-all">
                      <span className="text-ink-400">lockedRoundHash: </span>
                      <span className="select-all text-ink-900">{tamperConflict.hash}</span>
                    </div>
                    <div className="break-all">
                      <span className="text-ink-400">prevHash: </span>
                      <span className="select-all text-ink-700">{tamperConflict.prevHash}</span>
                    </div>
                  </div>
                </div>
              )}

              {tamperNotice === null ? null : (
                <div
                  role="alert"
                  className="rounded-xl border border-ochre-500/40 bg-ochre-100/60 px-3 py-2 text-[12px] text-ink-800"
                >
                  {tamperNotice}
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] border-collapse text-left text-[11.5px] tabular">
                  <thead>
                    <tr className="border-b border-paper-300 text-[10.5px] text-ink-500">
                      <th className="py-2 pr-2 font-medium">回合</th>
                      <th className="py-2 px-2 font-medium">核验来源</th>
                      <th className="py-2 px-2 font-medium">当回合净利</th>
                      <th className="py-2 px-2 font-medium">期末现金</th>
                      <th className="py-2 px-2 font-medium">销量 / 缺货</th>
                      <th className="py-2 px-2 font-medium">声誉</th>
                      <th className="py-2 px-2 font-medium">哈希链 (prevHash → hash)</th>
                      <th className="py-2 px-2 font-medium">状态</th>
                      <th className="py-2 pl-2 text-right font-medium">不可逆边界验证</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-paper-200">
                    {activeRun.ledger.rounds.map((row) => {
                      const highlighted = selectedRound === row.round;
                      return (
                        <tr
                          key={row.round}
                          className={cn(highlighted ? "bg-ochre-100/40" : "hover:bg-paper-100/40")}
                        >
                          <td className="py-2 pr-2 font-semibold text-ink-900">{row.roundLabel}</td>
                          <td className="py-2 px-2">
                            <Pill tone={row.source === "verified" ? "jade" : "seal"}>
                              {row.sourceLabel}
                            </Pill>
                          </td>
                          <td
                            className={cn(
                              "py-2 px-2 font-semibold",
                              row.outcome.profit >= 0 ? "text-jade-600" : "text-seal-600",
                            )}
                          >
                            {formatCentsSigned(row.outcome.profit)}
                          </td>
                          <td className="py-2 px-2">{money(row.outcome.cash)}</td>
                          <td className="py-2 px-2">
                            {row.outcome.sales} / {row.outcome.missed}
                          </td>
                          <td className="py-2 px-2">{row.outcome.reputation}</td>
                          <td className="py-2 px-2 font-mono text-[10.5px] text-ink-600">
                            <details>
                              <summary className="cursor-pointer select-none hover:text-ink-900">
                                {shortHash(row.prevHash, 8)} → {shortHash(row.hash, 10)}
                              </summary>
                              <div className="mt-1 max-w-[320px] space-y-0.5 rounded bg-paper-100 p-1.5 text-[9.5px] break-all">
                                <div>prev: {row.prevHash}</div>
                                <div>hash: {row.hash}</div>
                                <div>decision: {row.decisionHash}</div>
                              </div>
                            </details>
                          </td>
                          <td className="py-2 px-2">
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-jade-600">
                              <CheckCircle2 className="h-3 w-3" />
                              {row.locked ? "已锁定" : "未锁"}
                            </span>
                          </td>
                          <td className="py-2 pl-2 text-right">
                            <button
                              type="button"
                              data-testid={`simshop-tamper-round-${String(row.round)}`}
                              disabled={tamperBusyRound !== null}
                              onClick={() => {
                                void handleTamperAttempt(row.round);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-seal-500/45 bg-paper-50 px-2.5 py-1 text-[11px] font-medium text-seal-600 transition-colors hover:bg-seal-100/60 disabled:opacity-50"
                            >
                              <RefreshCw
                                className={cn(
                                  "h-3 w-3",
                                  tamperBusyRound === row.round ? "animate-spin" : "",
                                )}
                              />
                              尝试重做/篡改
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <details className="rounded-xl border border-paper-200 bg-paper-100/50 px-3 py-2 text-[11px] text-ink-600">
                <summary className="cursor-pointer font-medium text-ink-700">
                  查看最终账本全量 SHA-256 指纹
                </summary>
                <div className="mt-1.5 space-y-1 font-mono text-[10.5px] break-all">
                  <div>
                    finalHash: <span className="select-all text-ink-900">{activeRun.ledger.finalHash}</span>
                  </div>
                  <div>
                    ledgerHash: <span className="select-all text-ink-900">{activeRun.ledger.ledgerHash}</span>
                  </div>
                </div>
              </details>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
