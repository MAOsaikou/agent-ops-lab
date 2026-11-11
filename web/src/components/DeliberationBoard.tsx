import type { DeliberationArtifact } from "../../../src/templates/agentops/deliberation.js";
import { Pill } from "./Primitives.js";
const roles: Readonly<Record<string, string>> = { "procurement-lead": "采购", "pricing-lead": "定价", "growth-operator": "运营", chair: "主持复核" };
const strategies: Readonly<Record<string, string>> = { profit: "稳价", match: "跟价", volume: "冲量" };
const stages: Readonly<Record<string, string>> = { proposing: "专业提案中", challenging: "交叉质询中", revising: "定向修订中", completed: "模型会审完成", partial: "部分意见缺失" };
export function DeliberationBoard({ report, running }: { readonly report: DeliberationArtifact | undefined; readonly running: boolean }): React.JSX.Element | null {
  if (report === undefined) return null;
  const calls = report.nodes.reduce((sum, node) => sum + node.attempts, 0);
  const failed = report.nodes.filter((node) => node.status === "failed").length;
  return <section data-testid="deliberation-board" aria-label="模型协作会审" className="min-w-0 rounded-2xl border border-jade-600/30 bg-paper-50 p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-display text-base font-semibold text-ink-900">模型协作会审</h2><p className="mt-1 text-[11px] text-ink-500">{report.model} · 真实调用 {calls} 次{failed > 0 ? ` · ${failed} 项失败` : ""}</p></div><Pill tone={failed > 0 ? "ochre" : report.stage === "completed" ? "jade" : "ink"}>{stages[report.stage] ?? report.stage}</Pill></div>
    <div className="mt-3 grid gap-3 lg:grid-cols-3">{([{ phase: "proposal", title: "专业提案" }, { phase: "challenge", title: "主持质询" }, { phase: "revision", title: "定向修订 · 最多两方" }] as const).map((stage) => {
      const nodes = report.nodes.filter((node) => node.phase === stage.phase);
      return <div key={stage.phase} className="min-w-0 border-l-2 border-paper-300 pl-3"><h3 className="text-xs font-semibold text-ink-800">{stage.title}</h3>{nodes.length === 0 ? <p className="mt-2 text-xs text-ink-400">尚无执行记录</p> : <ul className="mt-1 divide-y divide-paper-200">{nodes.map((node) => <li key={node.id} data-testid={`deliberation-node-${node.id}`} className="py-2">
        <div className="flex flex-wrap items-center justify-between gap-1 text-xs"><strong>{roles[node.role] ?? node.role}</strong><span className={node.status === "failed" ? "text-seal-600" : node.status === "completed" ? "text-jade-600" : "text-ink-600"}>{node.status === "completed" ? "已交付" : node.status === "failed" ? "失败" : running ? "执行中" : "未完成"}</span></div>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-700">{(node.proposal?.summary ?? node.response ?? node.challenge?.[0]?.question ?? node.error ?? "等待模型返回，暂未形成意见。").slice(0, 90)}</p>
        <p className="mt-1 text-[10px] tabular text-ink-500">{(node.elapsedMs / 1000).toFixed(1)} 秒 · {node.attempts} 次调用{node.proposal ? ` · 建议${strategies[node.proposal.candidateId]}` : ""}</p>
        <details className="mt-1"><summary className="cursor-pointer text-[10.5px] text-ink-500">完整意见与调用记录</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-paper-100 p-2 text-[10.5px] leading-relaxed text-ink-700">{JSON.stringify(node, null, 2)}</pre></details>
      </li>)}</ul>}</div>;
    })}</div>
    {report.decision === null ? null : <div data-testid="deliberation-decision" className="mt-3 border-t border-paper-300 pt-3 text-xs leading-relaxed text-ink-700"><strong className="text-jade-600">模型建议：{strategies[report.decision.recommendedId]}</strong><p className="mt-1">{report.decision.reason}</p><p className="mt-1 text-[10.5px] text-ink-500">模型意见接受本地数值与风控验证，最终采用方案以上方拍板区为准。</p></div>}
  </section>;
}
