import { Activity, ArrowDown, Bot, Check, CircleAlert, Clock3, GitBranch, Layers3, Play, RotateCcw, Settings2, ShieldCheck, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { AgentRun, RunSummary, VerificationStatus } from "../../../src/templates/agentops/types.js";
import { ActionButton, Metric, Panel, PanelHead, Pill } from "./Primitives.js";
import { fetchAgentCatalog, fetchAgentRuns, fetchAgentRun, fetchLlmSettings, runAgentTask, type AgentCatalog, type LlmSettingsView } from "../lib/agentops.js";
import { ModelSettingsPanel } from "./ModelSettings.js";

const STATUS: Record<VerificationStatus, { readonly label: string; readonly tone: "jade" | "ochre" | "seal" }> = {
  pass: { label: "通过", tone: "jade" },
  warn: { label: "待确认", tone: "ochre" },
  fail: { label: "需修正", tone: "seal" },
};

const EXAMPLES = [
  "分析这个拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。分享文案：纯棉短袖女夏季宽松，券后 ¥39.90，已拼 10 万+，包邮、七天无理由。采购 16 元，包材 1.5 元，快递 6.5 元，目标毛利 25%，可周转资金 300 元。",
  "评估护颈枕价格与现金流。京东价 ¥89，竞品日单量约 50，采购 18 元，包装 2 元，快递 7 元，平台费率按默认，目标毛利 30%，预算 500 元。",
];

function NodeStatus({ run, id }: { readonly run: AgentRun | null; readonly id: string }): React.JSX.Element {
  const active = run?.events.some((event) => event.nodeId === id) ?? false;
  const failed = run?.events.some((event) => event.nodeId === id && event.type === "verify.checked" && event.title.includes("失败")) ?? false;
  return <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${failed ? "bg-seal-100 text-seal-600" : active ? "bg-jade-100 text-jade-600" : "bg-paper-200 text-ink-400"}`}>{failed ? <CircleAlert className="h-3 w-3" /> : active ? <Check className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}</span>;
}

function WorkflowMap({ run }: { readonly run: AgentRun | null }): React.JSX.Element {
  const rows = [
    [{ id: "plan", title: "任务规划", agent: "Planner" }],
    [{ id: "research", title: "链接与证据研究", agent: "Link Researcher" }],
    [{ id: "account", title: "成本核算", agent: "Cost Accountant" }, { id: "market", title: "市场与模拟", agent: "Market Analyst" }],
    [{ id: "risk", title: "独立风控验证", agent: "Risk Auditor" }],
    [{ id: "adjust-loop", title: "失败反馈 / Self-Loop", agent: "最多 3 轮" }],
    [{ id: "copy", title: "上架文案", agent: "Copywriter" }],
    [{ id: "approval", title: "人工审核门", agent: "Human Gate" }],
    [{ id: "report", title: "报告与最终验证", agent: "Reporter + Verifier" }],
  ];
  return (
    <div className="flex flex-col items-center gap-1">
      {rows.map((row, index) => (
        <div key={row.map((item) => item.id).join("-")} className="flex w-full flex-col items-center">
          <div className="flex w-full flex-wrap justify-center gap-2">
            {row.map((node) => {
              const dispatch = run?.dispatches.find((item) => item.nodeId === node.id);
              return (
                <div key={node.id} className="min-w-[150px] flex-1 rounded-xl border border-paper-300 bg-paper-50 px-3 py-2">
                  <div className="flex items-center gap-2"><NodeStatus run={run} id={node.id} /><span className="text-[12px] font-semibold text-ink-800">{node.title}</span></div>
                  <div className="mt-0.5 pl-7 text-[10.5px] text-ink-400">{dispatch?.chosen ? run?.agents.find((agent) => agent.id === dispatch.chosen)?.name : node.agent}</div>
                </div>
              );
            })}
          </div>
          {index < rows.length - 1 ? <ArrowDown className="my-1 h-3 w-3 text-ink-300" /> : null}
        </div>
      ))}
    </div>
  );
}

function formatMoney(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

export function AgentOpsConsole(): React.JSX.Element {
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null);
  const [runs, setRuns] = useState<readonly RunSummary[]>([]);
  const [task, setTask] = useState(EXAMPLES[0] ?? "");
  const [run, setRun] = useState<AgentRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"trace" | "verify" | "team">("trace");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [llm, setLlm] = useState<LlmSettingsView | null>(null);

  useEffect(() => {
    void fetchAgentCatalog()
      .then(setCatalog)
      .catch((caught: unknown) => {
        const reason = caught instanceof Error ? caught.message : "平台连接失败";
        setError(`${reason}。如果服务端是旧进程，请重启 pnpm dev 后再试。`);
      });
    void fetchAgentRuns().then(setRuns).catch(() => setRuns([]));
    void fetchLlmSettings().then(setLlm).catch(() => setLlm(null));
  }, []);

  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await runAgentTask(task);
      setRun(next);
      setRuns(await fetchAgentRuns());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "任务运行失败");
    } finally {
      setBusy(false);
    }
  };

  const openRun = async (id: string): Promise<void> => {
    try {
      setRun(await fetchAgentRun(id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取运行记录失败");
    }
  };

  const activeAgentCount = useMemo(() => new Set(run?.dispatches.map((item) => item.chosen) ?? []).size, [run]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-3 bg-paper-100 px-3 py-4 text-ink-900 sm:px-5">
      <header className="flex flex-wrap items-center gap-3 rounded-2xl border border-paper-300 bg-paper-50 px-4 py-3 shadow-card">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink-900 text-paper-50"><Layers3 className="h-5 w-5" /></div>
        <div><div className="font-display text-[17px] font-semibold">AgentOps Harness</div><div className="text-[11px] text-ink-500">可信多智能体编排、调度与验证平台 · 行业工作流：商品上架评审</div></div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5"><Pill tone="jade">{catalog?.agents.length ?? 7} 个 Agent</Pill><Pill tone="plain">{catalog?.tools.length ?? 9} 个工具</Pill><Pill tone={llm?.active === true ? "jade" : "plain"}>{llm?.active === true ? `模型已启用 · ${llm.model}` : "规则模式"}</Pill><button type="button" onClick={() => setSettingsOpen(true)} className="flex items-center gap-1.5 rounded-lg bg-paper-100 px-2.5 py-1.5 text-[11px] text-ink-600 ring-1 ring-inset ring-paper-300 hover:bg-paper-150"><Settings2 className="h-3.5 w-3.5" />模型配置</button></div>
      </header>

      {settingsOpen ? <ModelSettingsPanel onClose={() => setSettingsOpen(false)} onChanged={setLlm} /> : null}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-3">
          <Panel>
            <PanelHead title="运行复杂任务" desc="输入自然语言任务。平台先规划，再动态分配 Agent，并行分析，验证失败时进入 Self-Loop。" right={<Pill tone="ochre">离线规则 Harness</Pill>} />
            <div className="flex flex-col gap-2.5 px-4 py-3.5">
              <textarea value={task} onChange={(event) => setTask(event.target.value)} rows={4} className="w-full resize-y rounded-xl bg-paper-100 px-3 py-2.5 text-[12.5px] leading-relaxed outline-none ring-1 ring-inset ring-paper-300 focus:ring-2 focus:ring-seal-500/40" placeholder="描述你要 Agent 团队完成的任务…" />
              <div className="flex flex-wrap items-center gap-2">
                {EXAMPLES.map((example, index) => <button key={example} type="button" onClick={() => setTask(example)} className="rounded-lg bg-paper-100 px-2.5 py-1.5 text-[11px] text-ink-600 ring-1 ring-inset ring-paper-300">载入场景 {index + 1}</button>)}
                <ActionButton className="ml-auto" onClick={() => { void start(); }} disabled={busy || task.trim().length < 8}><Play className="h-3.5 w-3.5" />{busy ? "执行中…" : "运行 Agent 工作流"}</ActionButton>
              </div>
              {error === null ? null : <p className="rounded-lg bg-seal-100 px-3 py-2 text-[12px] text-seal-600">{error}</p>}
            </div>
          </Panel>

          <div className="grid gap-3 sm:grid-cols-4">
            <Panel className="p-3"><Metric label="参与 Agent" value={run === null ? "—" : `${activeAgentCount} 个`} size="md" hint="由调度器动态挑选" /></Panel>
            <Panel className="p-3"><Metric label="调度决策" value={run?.dispatches.length ?? "—"} size="md" hint="记录候选分数与理由" /></Panel>
            <Panel className="p-3"><Metric label="反馈轮次" value={run?.loops.length ?? "—"} size="md" hint="验证结果驱动调整" /></Panel>
            <Panel className="p-3"><Metric label="事件链校验" value={run === null ? "—" : "SHA-256"} size="md" hint={run === null ? "等待运行" : `${run.fingerprint.slice(0, 12)}…`} /></Panel>
          </div>

          <Panel>
            <PanelHead title="可视化工作流" desc={catalog?.workflow.intent ?? "Agent 规划 → 研究 → 并行分析 → 验证 → 反馈 → 报告"} right={<Pill tone={run?.status === "completed" ? "jade" : "plain"}>{run?.status === "completed" ? "运行完成" : "待运行"}</Pill>} />
            <div className="px-4 py-4"><WorkflowMap run={run} /></div>
          </Panel>

          {run === null ? null : (
            <Panel>
              <PanelHead title="运行证据台" desc={`${run.id} · ${new Date(run.createdAt).toLocaleString()} · ${run.events.length} 个有序事件`} right={<Pill tone={run.llm.mode === "live" ? "jade" : "ochre"}>{run.llm.mode === "live" ? run.llm.model : run.llm.mode === "fallback" ? "模型回退" : "规则 / 回放"}</Pill>} />
              <div className="flex gap-1 border-b border-paper-200 px-3 py-2">
                {([ ["trace", "执行时间线"], ["verify", "验证与反馈"], ["team", "Agent 团队"] ] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setTab(value)} className={`rounded-lg px-3 py-1.5 text-[11.5px] ${tab === value ? "bg-ink-900 text-paper-50" : "text-ink-500 hover:bg-paper-100"}`}>{label}</button>)}
              </div>
              <div className="max-h-[520px] overflow-auto px-4 py-3">
                {tab === "trace" ? (
                  <ol className="flex flex-col gap-2">
                    {run.events.map((event) => <li key={event.seq} className="grid grid-cols-[36px_minmax(0,1fr)] gap-2"><span className="pt-0.5 font-mono text-[10px] text-ink-400">{String(event.seq).padStart(2, "0")}</span><div className="rounded-xl bg-paper-100/70 px-3 py-2"><div className="flex flex-wrap items-center gap-1.5"><span className="text-[12px] font-semibold text-ink-800">{event.title}</span><Pill tone="plain">{event.type}</Pill>{event.agentId === null ? null : <Pill tone="ink">{run.agents.find((agent) => agent.id === event.agentId)?.name ?? event.agentId}</Pill>}</div><p className="mt-1 text-[11px] leading-relaxed text-ink-500">{event.detail}</p><div className="mt-1 truncate font-mono text-[9px] text-ink-300">prev {event.prevHash.slice(0, 12)} → {event.hash.slice(0, 12)}</div></div></li>)}
                  </ol>
                ) : null}
                {tab === "verify" ? <div className="flex flex-col gap-3"><div className="grid gap-2 sm:grid-cols-3">{run.verifications.map((item) => <div key={`${item.stage}-${item.title}-${item.detail}`} className="rounded-xl border border-paper-300 bg-paper-50 p-3"><div className="flex items-center justify-between gap-2"><span className="text-[11px] font-semibold text-ink-800">{item.title}</span><Pill tone={STATUS[item.status].tone}>{STATUS[item.status].label}</Pill></div><p className="mt-1 text-[10.5px] leading-relaxed text-ink-500">{item.detail}</p><span className="mt-1 block font-mono text-[9px] text-ink-400">{item.verifier} / {item.stage}</span></div>)}</div>{run.loops.map((loop) => <div key={loop.iteration} className="rounded-xl bg-ochre-100/60 p-3"><div className="flex items-center gap-2 text-[12px] font-semibold"><RotateCcw className="h-3.5 w-3.5" />第 {loop.iteration} 轮反馈 · {loop.role}</div><p className="mt-1 text-[11px] text-ink-600">{loop.adjustment ?? "验证通过，交由人工确认"}</p></div>)}{run.dispatches.map((item) => <div key={`${item.nodeId}-${item.chosen}`} className="rounded-xl bg-paper-100/70 p-3"><div className="text-[11px] font-semibold">{item.nodeId} 调度为 {run.agents.find((agent) => agent.id === item.chosen)?.name}</div><p className="mt-1 text-[10px] text-ink-500">{item.rationale}</p><div className="mt-2 flex flex-wrap gap-1.5">{item.candidates.map((candidate) => <Pill key={candidate.agentId} tone={candidate.agentId === item.chosen ? "jade" : "plain"}>{candidate.agentId}: {candidate.score}</Pill>)}</div></div>)}</div> : null}
                {tab === "team" ? <div className="grid gap-2 sm:grid-cols-2">{run.agents.map((agent) => <div key={agent.id} className="rounded-xl border border-paper-300 bg-paper-50 p-3"><div className="flex items-center justify-between"><span className="text-[12px] font-semibold">{agent.name}</span><Pill tone="plain">v{agent.version}</Pill></div><p className="mt-1 text-[10.5px] leading-relaxed text-ink-500">{agent.role}</p><div className="mt-2 flex flex-wrap gap-1">{agent.tools.map((tool) => <Pill key={tool} tone="ink"><Wrench className="h-2.5 w-2.5" />{tool}</Pill>)}</div></div>)}</div> : null}
              </div>
            </Panel>
          )}

          {run === null ? null : <div className="grid gap-3 lg:grid-cols-2"><Panel><PanelHead title="价格策略" desc="定价引擎输出，来自同一份用户输入与显式假设" /><div className="grid gap-2 p-3 sm:grid-cols-3">{run.artifacts.prices.map((price) => <div key={price.id} className={`rounded-xl border p-3 ${price.id === run.artifacts.chosenId ? "border-seal-500 bg-seal-100/40" : "border-paper-300 bg-paper-50"}`}><div className="text-[11px] text-ink-500">{price.label}</div><div className="mt-1 font-display text-xl font-semibold">{formatMoney(price.priceCents)}</div><div className="mt-1 text-[10px] text-ink-500">毛利 {Math.round(price.margin * 100)}% · p10 {formatMoney(price.profitP10Cents)}</div></div>)}</div></Panel><Panel><PanelHead title="上架文案与结论" desc="仅在核算和风险审核后生成" /><div className="flex flex-col gap-2 p-3">{run.artifacts.copy?.titles.map((title) => <div key={title.label} className="rounded-lg bg-paper-100 px-3 py-2"><div className="text-[10px] text-ink-400">{title.label} · {title.length} 字</div><div className="text-[12px] text-ink-800">{title.text}</div></div>)}<div className="text-[11px] leading-relaxed text-ink-600">{run.artifacts.report.join(" · ")}</div></div></Panel></div>}
        </div>

        <aside className="flex flex-col gap-3 xl:sticky xl:top-3 xl:max-h-[calc(100vh-24px)] xl:overflow-auto">
          <Panel><PanelHead title="Agent 团队" desc="按任务能力匹配，而非写死角色顺序" right={<Bot className="h-4 w-4 text-seal-500" />} /><div className="flex flex-col gap-1 px-3 py-2">{catalog?.agents.map((agent) => <div key={agent.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5"><span className="h-2 w-2 rounded-full bg-jade-500" /><div className="min-w-0 flex-1"><div className="text-[11.5px] font-medium">{agent.name}</div><div className="truncate text-[10px] text-ink-400">{Object.keys(agent.capabilities).join(" · ")} · {agent.tools.length} 工具</div></div><Pill tone="plain">v{agent.version}</Pill></div>)}</div></Panel>
          <Panel><PanelHead title="工具注册表" desc="Agent 通过工具产生可核验结果" right={<Wrench className="h-4 w-4 text-seal-500" />} /><div className="grid grid-cols-2 gap-1.5 px-3 py-2">{catalog?.tools.map((tool) => <div key={tool.name} className="rounded-lg bg-paper-100/70 px-2 py-1.5"><div className="truncate font-mono text-[9.5px] text-ink-700">{tool.name}</div><div className="text-[9.5px] text-ink-400">{tool.title}</div></div>)}</div></Panel>
          <Panel><PanelHead title="近期运行" desc={`${runs.length} 条可回放记录`} right={<Activity className="h-4 w-4 text-seal-500" />} /><div className="flex flex-col gap-1 px-2 py-2">{runs.length === 0 ? <p className="px-2 py-3 text-[11px] text-ink-400">还没有任务记录</p> : runs.map((item) => <button key={item.id} type="button" onClick={() => { void openRun(item.id); }} className={`rounded-lg px-2.5 py-2 text-left hover:bg-paper-100 ${run?.id === item.id ? "bg-paper-100" : ""}`}><div className="line-clamp-2 text-[11px] font-medium">{item.taskText}</div><div className="mt-1 flex items-center gap-2 text-[9.5px] text-ink-400"><Clock3 className="h-3 w-3" />{new Date(item.createdAt).toLocaleTimeString()}<span>{item.loops} loops</span><span>{item.failures} fail</span></div></button>)}</div></Panel>
          <Panel className="border-jade-500/30 bg-jade-100/30"><div className="flex gap-2 p-3"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-jade-600" /><div><div className="text-[11.5px] font-semibold text-jade-600">证据优先的 Agent</div><p className="mt-1 text-[10.5px] leading-relaxed text-ink-600">Agent 不只“说结论”：每个节点记录调度理由、工具调用、验证结果与事件哈希。没有商品详情时明确留下待确认项。</p><div className="mt-2 flex items-center gap-1 text-[9.5px] text-ink-400"><GitBranch className="h-3 w-3" />并行执行 · Self-Loop · 可回放</div></div></div></Panel>
        </aside>
      </div>
      <footer className="px-1 text-[10px] leading-relaxed text-ink-400">未配置模型时，调度、工具调用、验证和反馈由本地确定性 Harness 执行，同一输入得到同一条事件链，便于复现。配置 AGENTOPS_LLM_* 后，文案节点交给模型生成，输出必须通过字数与风险词校验，否则回退规则并记下 llm.fallback —— 页面不会把规则结果伪装成模型推理。</footer>
    </div>
  );
}
