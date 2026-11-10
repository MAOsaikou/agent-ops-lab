import { Download, RotateCcw } from "lucide-react";

import type { PlanResult } from "../../../src/templates/pricing/model.js";
import { PLATFORM_PRESETS } from "../../../src/templates/pricing/platform.js";
import { CopyBlock } from "../components/CopyBlock.js";
import { ActionButton, Panel, PanelHead, Pill } from "../components/Primitives.js";
import { SealStamp } from "../components/SealStamp.js";
import { csvUrl } from "../lib/api.js";
import { money, moneyInt, pct } from "../lib/format.js";

export function ShipStep({
  plan,
  onRestart,
}: {
  readonly plan: PlanResult;
  readonly onRestart: () => void;
}): React.JSX.Element {
  const preset = PLATFORM_PRESETS[plan.input.platform];
  const chosenId = plan.locked?.candidateId ?? plan.recommendedId;
  const chosen = plan.candidates.find((candidate) => candidate.id === chosenId) ?? plan.candidates[0];
  if (chosen === undefined) {
    return <Panel>方案数据缺失。</Panel>;
  }
  const bulletsText = chosen.bullets
    .map((bullet, index) => `${String(index + 1)}. ${bullet.text}`)
    .join("\n");
  const titlesText = plan.copy.titles.map((title) => title.text).join("\n");

  return (
    <div className="flex flex-col gap-3">
      <Panel className="rise overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold text-ink-900">
                照这个抄：{plan.input.name} · {money(chosen.priceCents)}
              </span>
              <Pill tone="jade">毛利率 {pct(chosen.evaluation.daily.margin)}</Pill>
              <Pill tone="plain">30 天约 {moneyInt(chosen.sim.p50Cents)}</Pill>
            </div>
            <div className="mt-0.5 text-[11.5px] text-ink-500">
              {preset.label} · {preset.titleNote} · 标题、卖点、价格表都能直接复制到后台
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <a
              href={csvUrl(plan.id)}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-paper-50 px-4 text-[13.5px] font-medium text-ink-800 ring-1 ring-inset ring-paper-300 transition-colors hover:bg-paper-150"
            >
              <Download className="h-4 w-4" />
              下载价格表 CSV
            </a>
            <ActionButton variant="ghost" onClick={onRestart}>
              <RotateCcw className="h-4 w-4" />
              算下一件
            </ActionButton>
          </div>
        </div>
        {plan.locked === null ? null : (
          <div className="border-t border-paper-200 px-4 py-3">
            <SealStamp hash={plan.locked.hash} at={plan.locked.at} label={`${chosen.label} · ${money(chosen.priceCents)}`} />
          </div>
        )}
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel className="rise" style={{ "--i": 1 } as React.CSSProperties}>
          <PanelHead
            title="商品标题"
            desc="三个版本挑一个，字数已按平台上限截好。"
            right={<Pill tone="plain">上限 {preset.titleMax} 字</Pill>}
          />
          <div className="flex flex-col gap-1.5 px-4 py-3.5">
            {plan.copy.titles.map((title) => (
              <CopyBlock
                key={title.label}
                label={title.label}
                text={title.text}
                meta={`${String(title.length)}/${String(preset.titleMax)} 字`}
              />
            ))}
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(titlesText);
              }}
              className="mt-1 self-start text-[11.5px] text-seal-600 hover:underline"
            >
              复制全部标题
            </button>
          </div>
        </Panel>

        <Panel className="rise" style={{ "--i": 2 } as React.CSSProperties}>
          <PanelHead
            title="五条卖点"
            desc="「需你确认」的先对一遍，做得到再发，别写做不到的承诺。"
            right={
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(bulletsText);
                }}
                className="text-[11.5px] text-seal-600 hover:underline"
              >
                复制全部卖点
              </button>
            }
          />
          <div className="flex flex-col gap-1.5 px-4 py-3.5">
            {chosen.bullets.map((bullet, index) => (
              <CopyBlock
                key={`${String(index)}-${bullet.text}`}
                label={`第 ${String(index + 1)} 条`}
                text={bullet.text}
                meta={bullet.basis}
                needsReview={bullet.needsReview}
              />
            ))}
          </div>
        </Panel>

        <Panel className="rise" style={{ "--i": 3 } as React.CSSProperties}>
          <PanelHead title="价格表" desc="三套价一起看，抄进后台或发给供货商都行。" />
          <div className="overflow-x-auto px-4 py-3">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="text-left text-[11px] text-ink-400">
                  <th className="pb-1.5 font-normal">方案</th>
                  <th className="pb-1.5 text-right font-normal">售价</th>
                  <th className="pb-1.5 text-right font-normal">活动价</th>
                  <th className="pb-1.5 text-right font-normal">保本价</th>
                  <th className="pb-1.5 text-right font-normal">毛利</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {plan.candidates.map((candidate) => (
                  <tr
                    key={candidate.id}
                    className={candidate.id === chosen.id ? "bg-jade-100/40 text-ink-900" : "text-ink-600"}
                  >
                    <td className="py-1.5 pr-2">{candidate.label}</td>
                    <td className="py-1.5 text-right font-medium">{money(candidate.priceCents)}</td>
                    <td className="py-1.5 text-right">{money(candidate.promoPriceCents)}</td>
                    <td className="py-1.5 text-right text-ink-400">{money(candidate.evaluation.breakEvenCents)}</td>
                    <td className="py-1.5 text-right">{pct(candidate.evaluation.daily.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel className="rise" style={{ "--i": 4 } as React.CSSProperties}>
          <PanelHead title="上架前再看一眼" desc="这些是这套方案的前提条件，别跳过。" />
          <ul className="flex flex-col gap-1.5 px-4 py-3.5">
            {plan.notes.map((note) => (
              <li key={note} className="flex gap-1.5 text-[11.5px] leading-relaxed text-ink-600">
                <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-seal-500" />
                {note}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel className="rise">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[11px] text-ink-400">方案指纹（同样数字永远算出同一份）</div>
            <div className="truncate font-mono text-[11px] text-ink-600">{plan.hash}</div>
          </div>
          <div className="ml-auto text-[11px] text-ink-400">
            方案编号 {plan.id} · 生成于 {plan.createdAt.slice(0, 16).replace("T", " ")}
          </div>
        </div>
      </Panel>
    </div>
  );
}