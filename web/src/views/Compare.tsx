import { useEffect, useMemo, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.js";
import { Badge } from "../components/ui/badge.js";
import { fetchLedger } from "../lib/api.js";
import { PROFILE_TEXT, SCENARIO_TEXT } from "../lib/nodes.js";
import type { LedgerResponse, RunMeta } from "../lib/contract.js";
import { yuan } from "../lib/utils.js";

function fallbackRounds(meta: RunMeta): number {
  return meta.summary.filter((row) => row.usedFallback).length;
}

type Tally = { readonly cash?: number; readonly profit?: number; readonly reputation?: number };

export function Compare({
  runs,
  currentRunId,
  onSelectRun,
}: {
  readonly runs: readonly RunMeta[];
  readonly currentRunId: string | null;
  readonly onSelectRun: (runId: string) => void;
}): React.JSX.Element {
  const currentSeed = runs.find((item) => item.runId === currentRunId)?.seed;
  const sameSeed = useMemo(
    () => (currentSeed === undefined ? runs : runs.filter((run) => run.seed === currentSeed)),
    [runs, currentSeed],
  );
  const [tallies, setTallies] = useState<Readonly<Record<string, Tally>>>({});
  const key = sameSeed.map((run) => run.runId).join(",");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        sameSeed.map(async (run): Promise<readonly [string, Tally]> => {
          try {
            const ledger: LedgerResponse = await fetchLedger(run.runId);
            const last = ledger.rounds.at(-1)?.outcome;
            return [
              run.runId,
              {
                ...(last === undefined ? {} : { cash: last.cash, reputation: last.reputation }),
                profit: ledger.rounds.reduce((sum, row) => sum + row.outcome.profit, 0),
              },
            ];
          } catch {
            return [run.runId, {}];
          }
        }),
      );
      if (!cancelled) {
        setTallies(Object.fromEntries(entries));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle>同一开局，不同经营结果</CardTitle>
          <CardDescription>相同剧本与随机起点下，每局最后剩多少现金、赚了多少、口碑如何。</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="text-left text-[11px] font-medium text-mist-400">
                <tr>
                  <th className="px-5 py-2.5 font-medium">这局怎么经营</th>
                  <th className="px-2 py-2.5 text-right font-medium">最后现金</th>
                  <th className="px-2 py-2.5 text-right font-medium">一共赚了</th>
                  <th className="px-2 py-2.5 text-right font-medium">最后口碑</th>
                  <th className="px-2 py-2.5 text-right font-medium">断供谈判</th>
                  <th className="px-5 py-2.5 text-right font-medium">稳妥兜底</th>
                </tr>
              </thead>
              <tbody>
                {sameSeed.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-[12.5px] text-mist-400">
                      还没有开过店。先开一局，经营结果会留在这里。
                    </td>
                  </tr>
                ) : (
                  sameSeed.map((run) => {
                    const tally = tallies[run.runId];
                    const current = run.runId === currentRunId;
                    const fallback = fallbackRounds(run);
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
                          <div className="flex flex-wrap items-center gap-2">
                            <span>{SCENARIO_TEXT[run.scenario]}</span>
                            <Badge tone={run.profile === "stressed" ? "warn" : "flow"}>
                              {run.profile === "stressed" ? "激进经营" : "稳妥经营"}
                            </Badge>
                            {current ? (
                              <span className="rounded bg-flow-400/15 px-1.5 py-0.5 text-[11px] text-flow-400">正在看</span>
                            ) : null}
                          </div>
                          <span className="mt-0.5 block text-[11.5px] text-mist-400">
                            {run.rounds} 回合 · 起点 {run.seed} · 店里出手 {run.calls} 次
                          </span>
                        </td>
                        <td className="px-2 py-3.5 text-right text-[14px] font-semibold tabular-nums text-mist-100">
                          {tally?.cash === undefined ? "—" : yuan(tally.cash)}
                        </td>
                        <td
                          className={`px-2 py-3.5 text-right text-[14px] font-semibold tabular-nums ${
                            tally?.profit === undefined ? "text-mist-400" : tally.profit >= 0 ? "text-lock-400" : "text-risk-400"
                          }`}
                        >
                          {tally?.profit === undefined ? "—" : yuan(tally.profit)}
                        </td>
                        <td className="px-2 py-3.5 text-right tabular-nums text-mist-300">{tally?.reputation ?? "—"}</td>
                        <td className="px-2 py-3.5 text-right tabular-nums text-mist-300">
                          {run.quotes === 0 ? "没遇到断供" : `谈了 ${run.quotes} 轮`}
                        </td>
                        <td className="px-5 py-3.5 text-right tabular-nums text-mist-300">
                          {fallback === 0 ? "没用上" : `${fallback} 回合`}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>这张表怎么看</CardTitle>
          <CardDescription>同样的天气和起点，经营选择不同，最后结果也不同。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-[12.5px] leading-relaxed text-mist-300 sm:grid-cols-3">
          <div className="rounded-xl bg-white/[0.03] p-3">
            <div className="font-semibold text-mist-100">现金与利润</div>
            <p className="mt-1 text-mist-400">现金是最后手里剩的钱；一共赚了，是把每回合的赚亏加起来。</p>
          </div>
          <div className="rounded-xl bg-white/[0.03] p-3">
            <div className="font-semibold text-mist-100">口碑</div>
            <p className="mt-1 text-mist-400">缺货会让顾客失望。货备得合适，回头客会更多。</p>
          </div>
          <div className="rounded-xl bg-white/[0.03] p-3">
            <div className="font-semibold text-mist-100">断供与兜底</div>
            <p className="mt-1 text-mist-400">供应商没货时要重新谈价；主意过不了检查时，店里会换成稳妥方案。</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>两种经营风格</CardTitle>
          <CardDescription>两种风格面对的规则完全一样，只是敢不敢冒险不同。</CardDescription>
        </CardHeader>
        <CardContent className="text-[12.5px] leading-relaxed text-mist-300">
          <p>
            {PROFILE_TEXT["steady"]} 按稳妥的方式进货定价，宁可少赚也不压货。激进经营更愿意赌一把，主意过不了检查时会被打回重算，最后还是过不了就换稳妥方案。
          </p>
          <p className="mt-2 text-mist-400">不同剧本或不同随机起点的两局，面对的麻烦不一样，不能直接比谁赚得多。</p>
          <p className="mt-1 text-[11.5px] text-mist-500">技术记录：跨剧本、跨起点的对比要等实验台（U6）那一版；这一页只比同一开局。</p>
        </CardContent>
      </Card>
    </div>
  );
}
