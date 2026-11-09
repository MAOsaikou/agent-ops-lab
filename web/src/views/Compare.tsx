import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.js";
import { Badge } from "../components/ui/badge.js";
import { PROFILE_TEXT, SCENARIO_TEXT } from "../lib/nodes.js";
import type { RunMeta } from "../lib/contract.js";
import { shortHash } from "../lib/utils.js";

function fallbackRounds(meta: RunMeta): number {
  return meta.summary.filter((row) => row.usedFallback).length;
}

export function Compare({
  runs,
  currentRunId,
  onSelectRun,
}: {
  readonly runs: readonly RunMeta[];
  readonly currentRunId: string | null;
  readonly onSelectRun: (runId: string) => void;
}): React.JSX.Element {
  const sameSeed = runs.filter((run) => run.seed === (runs.find((item) => item.runId === currentRunId)?.seed ?? run.seed));
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle>同种子运行对比</CardTitle>
          <CardDescription>
            只列本控制台已录制的运行。跨策略矩阵对比属于 U6 实验台，本单元不伪造那份数据。
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full border-collapse text-[12.5px]">
            <thead className="text-left text-[11px] font-medium text-mist-400">
              <tr>
                <th className="px-5 py-2.5 font-medium">场景</th>
                <th className="px-2 py-2.5 text-right font-medium">种子</th>
                <th className="px-2 py-2.5 font-medium">画像</th>
                <th className="px-2 py-2.5 text-right font-medium">回合</th>
                <th className="px-2 py-2.5 text-right font-medium">Mock 调用</th>
                <th className="px-2 py-2.5 text-right font-medium">Fallback 回合</th>
                <th className="px-2 py-2.5 text-right font-medium">报价事件</th>
                <th className="px-2 py-2.5 text-right font-medium">预算仲裁</th>
                <th className="px-5 py-2.5 font-medium">最终哈希</th>
              </tr>
            </thead>
            <tbody>
              {sameSeed.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-[12.5px] text-mist-400">
                    还没有运行。先开局一局再回来对比。
                  </td>
                </tr>
              ) : (
                sameSeed.map((run) => {
                  const current = run.runId === currentRunId;
                  return (
                    <tr
                      key={run.runId}
                      onClick={() => {
                        onSelectRun(run.runId);
                      }}
                      className={`cursor-pointer border-t border-white/[0.045] transition-colors hover:bg-white/[0.04] ${
                        current ? "bg-flow-400/[0.06]" : ""
                      }`}
                    >
                      <td className="px-5 py-3.5 text-mist-100">
                        <span className="flex items-center gap-2">
                          {SCENARIO_TEXT[run.scenario]}
                          {current ? <span className="rounded bg-flow-400/15 px-1.5 py-0.5 text-[11px] text-flow-400">当前</span> : null}
                        </span>
                      </td>
                      <td className="px-2 py-3.5 text-right tabular-nums text-mist-300">{run.seed}</td>
                      <td className="px-2 py-3.5">
                        <Badge tone={run.profile === "stressed" ? "warn" : "flow"}>
                          {run.profile === "stressed" ? "压力" : "稳健"}
                        </Badge>
                      </td>
                      <td className="px-2 py-3.5 text-right tabular-nums text-mist-300">{run.rounds}</td>
                      <td className="px-2 py-3.5 text-right tabular-nums text-mist-300">{run.calls}</td>
                      <td className="px-2 py-3.5 text-right tabular-nums text-mist-300">{fallbackRounds(run)}</td>
                      <td className="px-2 py-3.5 text-right tabular-nums text-mist-300">{run.quotes}</td>
                      <td className="px-2 py-3.5 text-right tabular-nums text-mist-300">{run.priceWars}</td>
                      <td className="px-5 py-3.5 font-mono text-[11px] text-mist-400">{shortHash(run.finalHash, 12)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>对比页的边界</CardTitle>
          <CardDescription>如实标注，不用假数据凑齐计划里的对比图</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-[12.5px] leading-relaxed text-mist-300">
          <p>
            {PROFILE_TEXT["steady"]} 与压力画像都是同一条 U5 回合工作流，差别只在 Mock 的决策取值；压力画像会被硬约束打回，走到迭代上限后用安全兜底。
          </p>
          <p className="text-mist-400">
            计划里 Lane 10 要求「其他策略用本局危机卡日志重跑」，那需要 U6 实验台的策略矩阵。U6 未合入，本页只对比已经真实录制过的运行，并显示种子、调用量与 Fallback 回合数。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
