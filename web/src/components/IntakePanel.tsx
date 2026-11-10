import { ArrowRight, Check, Link2, ScanLine, Sparkles, TriangleAlert, Undo2 } from "lucide-react";
import { useState } from "react";

import type { Confidence, IntakeQuestion, IntakeResult } from "../../../src/templates/intake/types.js";
import { analyzeProduct } from "../lib/api.js";
import type { Draft } from "../lib/draft.js";
import { patchFieldCount, patchToDraft } from "../lib/intake.js";
import { money } from "../lib/format.js";
import { ActionButton, Panel, PanelHead, Pill, SectionLabel } from "./Primitives.js";

const CONFIDENCE: Record<Confidence, { label: string; tone: "jade" | "ochre" | "seal" }> = {
  high: { label: "有证据", tone: "jade" },
  medium: { label: "推断", tone: "ochre" },
  low: { label: "待确认", tone: "seal" },
};

const SAMPLES: readonly { readonly id: string; readonly label: string; readonly text: string }[] = [
  {
    id: "pdd",
    label: "拼多多分享文案",
    text: `【拼多多】纯棉短袖T恤女夏季新款宽松显瘦百搭上衣
https://mobile.yangkeduo.com/goods.html?goods_id=412345678901
¥39.90 券后 已拼10万+件
包邮 · 7天无理由退货 · 退货包运费`,
  },
  {
    id: "tb",
    label: "淘宝短链 + 口令",
    text: `【淘宝】https://m.tb.cn/h.gKJ8sQ2?tk=Cz0001 「便携折叠水壶户外运动大容量」
点击链接直接打开 或者 淘宝搜索直接打开`,
  },
  {
    id: "jd",
    label: "京东商品页文字",
    text: `记忆棉护颈枕 慢回弹颈椎枕 京东价 ¥89.00 已售 2.3万+ 件
https://item.jd.com/100012043978.html
支持开票 · 48小时内发货 · 现货`,
  },
  {
    id: "unknown",
    label: "没见过的独立站",
    text: `https://shop.example.com/products/foldable-bottle
Foldable Bottle 户外折叠水壶 USD 19.90`,
  },
];

export function IntakePanel({
  onApply,
  canUndo,
  onUndo,
}: {
  readonly onApply: (patch: Partial<Draft>) => void;
  readonly canUndo: boolean;
  readonly onUndo: () => void;
}): React.JSX.Element {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appliedFingerprint, setAppliedFingerprint] = useState<string | null>(null);
  const [answered, setAnswered] = useState<Readonly<Record<string, string>>>({});
  const [showPlan, setShowPlan] = useState(false);

  const run = (): void => {
    setBusy(true);
    setError(null);
    void analyzeProduct(text)
      .then((next) => {
        setResult(next);
        setAnswered({});
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "识别失败，检查服务是否在跑");
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const apply = (patch: IntakeResult["patch"] | IntakeQuestion["options"][number]["patch"], key: string): void => {
    onApply(patchToDraft(patch));
    setAppliedFingerprint(key);
  };

  const fieldCount = result === null ? 0 : patchFieldCount(result.patch);

  return (
    <Panel className="rise overflow-hidden">
      <PanelHead
        title={<SectionLabel index="0" title="先让子 agent 认链接" />}
        desc="粘商品链接或分享文案进来。它认平台、认商品号、抽价格和销量，认不出来的会问你，不替你编。"
        right={<Pill tone="plain">本机规则 · 不用密钥</Pill>}
      />
      <div className="flex flex-col gap-3 px-4 py-3.5">
        <textarea
          value={text}
          rows={3}
          spellCheck={false}
          onChange={(event) => {
            setText(event.target.value);
          }}
          placeholder={"例：\n【淘宝】https://m.tb.cn/h.gKJ8sQ2 「便携折叠水壶」\n¥39.90 已拼10万+件 包邮"}
          className="w-full resize-y rounded-xl bg-paper-100 px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink-900 outline-none ring-1 ring-inset ring-paper-300 placeholder:text-ink-300 focus:bg-paper-50 focus:ring-2 focus:ring-seal-500/45"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-ink-400">试试：</span>
          {SAMPLES.map((sample) => (
            <button
              key={sample.id}
              type="button"
              onClick={() => {
                setText(sample.text);
                setResult(null);
                setAppliedFingerprint(null);
              }}
              className="rounded-lg bg-paper-100 px-2.5 py-1.5 text-[11.5px] text-ink-700 ring-1 ring-inset ring-paper-300 transition-colors hover:bg-paper-150"
            >
              {sample.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {canUndo ? (
              <ActionButton variant="ghost" size="sm" onClick={onUndo}>
                <Undo2 className="h-3.5 w-3.5" />
                撤销上次填入
              </ActionButton>
            ) : null}
            <ActionButton
              size="sm"
              onClick={run}
              disabled={busy || text.trim().length === 0}
            >
              {busy ? "正在认…" : "让它认一下"}
              <ScanLine className="h-3.5 w-3.5" />
            </ActionButton>
          </div>
        </div>

        {error === null ? null : (
          <p className="rounded-lg bg-seal-100/70 px-2.5 py-2 text-[11.5px] text-seal-600">{error}</p>
        )}

        {result === null ? null : (
          <div className="flex flex-col gap-3 border-t border-paper-200 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-4 w-4 text-seal-500" />
              <span className="text-[13px] font-semibold text-ink-900">{result.headline}</span>
              <Pill tone="plain">指纹 {result.fingerprint.slice(0, 8)}</Pill>
              <span className="text-[11px] text-ink-400">
                {result.stats.chars} 字 / {result.stats.lines} 行 / {result.stats.links} 条链接
              </span>
              <button
                type="button"
                onClick={() => {
                  setShowPlan(!showPlan);
                }}
                className="ml-auto text-[11.5px] text-ink-500 hover:text-ink-900"
              >
                {showPlan ? "收起它的步骤" : "看它的步骤"}
              </button>
            </div>

            {showPlan ? (
              <div className="flex flex-col gap-2 rounded-xl bg-paper-100/70 px-3 py-2.5">
                <ol className="flex flex-col gap-1">
                  {result.plan.map((step) => (
                    <li key={step} className="text-[11.5px] text-ink-500">
                      {step}
                    </li>
                  ))}
                </ol>
                <ol className="flex flex-col gap-1.5 border-t border-paper-300/70 pt-2">
                  {result.trace.map((call) => (
                    <li key={call.index} className="grid grid-cols-[86px_minmax(0,1fr)] gap-2 text-[11.5px] leading-relaxed">
                      <span className="font-mono text-seal-600">{call.tool}</span>
                      <span className="min-w-0 text-ink-600">
                        <span className="text-ink-400">{call.args} → </span>
                        {call.observation}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              {result.links.length === 0 ? (
                <p className="flex items-start gap-1.5 rounded-lg bg-ochre-100/50 px-2.5 py-2 text-[11.5px] text-ochre-500">
                  <TriangleAlert className="mt-[1px] h-3.5 w-3.5 shrink-0" />
                  这条里面没找到商品链接。没关系，把商品页的文字整段贴进来也能解析。
                </p>
              ) : (
                result.links.map((link) => (
                  <div key={link.url} className="rounded-xl bg-paper-100/70 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link2 className="h-3.5 w-3.5 text-ink-400" />
                      <Pill tone={link.platform === null ? "ochre" : "jade"}>{link.platformLabel}</Pill>
                      <span className="font-mono text-[11px] text-ink-500">{link.host}</span>
                      <Pill tone="plain">
                        {link.kind === "item"
                          ? `${link.idLabel} ${link.itemId ?? ""}`
                          : link.kind === "short"
                            ? "短链"
                            : link.kind === "shop"
                              ? "店铺/搜索页"
                              : "普通页面"}
                      </Pill>
                      {link.slug === null ? null : <span className="text-[11px] text-ink-400">slug：{link.slug}</span>}
                    </div>
                    {link.notes.length === 0 ? null : (
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {link.notes.map((note) => (
                          <li key={note} className="text-[11px] leading-relaxed text-ink-500">
                            · {note}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="overflow-hidden rounded-xl ring-1 ring-inset ring-paper-300">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="bg-paper-100 text-left text-[11px] text-ink-500">
                    <th className="px-3 py-1.5 font-medium">字段</th>
                    <th className="px-3 py-1.5 font-medium">认出来的值</th>
                    <th className="px-3 py-1.5 font-medium">底气</th>
                    <th className="px-3 py-1.5 font-medium">证据</th>
                  </tr>
                </thead>
                <tbody>
                  {result.fields.map((field) => (
                    <tr key={field.id} className="border-t border-paper-200">
                      <td className="px-3 py-1.5 text-ink-500">{field.label}</td>
                      <td className="px-3 py-1.5">
                        <span className="flex items-center gap-1.5">
                          <span className="text-ink-900">
                            {field.id === "competitorCents" && field.needsConfirm === false && /^\d+$/.test(field.display.replace(/[^0-9]/g, ""))
                              ? field.display
                              : field.display}
                          </span>
                          {field.needsConfirm ? <Pill tone="ochre">要你确认</Pill> : null}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <Pill tone={CONFIDENCE[field.confidence].tone}>{CONFIDENCE[field.confidence].label}</Pill>
                      </td>
                      <td className="max-w-[240px] truncate px-3 py-1.5 font-mono text-[11px] text-ink-400">
                        {field.evidence.length === 0 ? "—" : field.evidence.map((item) => item.quote).join(" ｜ ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {result.questions.length === 0 ? null : (
              <div className="flex flex-col gap-2 rounded-xl bg-ochre-100/40 px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ochre-500">
                  <TriangleAlert className="h-3.5 w-3.5" />
                  它要先问你 {result.questions.length} 件事
                </div>
                {result.questions.map((question) => (
                  <div key={question.id} className="flex flex-col gap-1">
                    <span className="text-[12px] text-ink-800">{question.ask}</span>
                    <span className="text-[11px] text-ink-500">{question.why}</span>
                    {question.options.length === 0 ? null : (
                      <div className="flex flex-wrap gap-1.5">
                        {question.options.map((option) => (
                          <button
                            key={option.label}
                            type="button"
                            onClick={() => {
                              apply(option.patch, `${question.id}:${option.label}`);
                              setAnswered({ ...answered, [question.id]: option.label });
                            }}
                            className="rounded-lg bg-paper-50 px-2.5 py-1.5 text-[11.5px] text-ink-700 ring-1 ring-inset ring-paper-300 hover:bg-paper-100"
                          >
                            {answered[question.id] === option.label ? `已填：${option.label}` : option.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <ActionButton
                size="sm"
                onClick={() => {
                  apply(result.patch, result.fingerprint);
                }}
                disabled={fieldCount === 0}
              >
                填进表单
                <ArrowRight className="h-3.5 w-3.5" />
              </ActionButton>
              {appliedFingerprint === result.fingerprint ? (
                <span className="flex items-center gap-1 text-[11.5px] text-jade-600">
                  <Check className="h-3.5 w-3.5" />
                  已填 {fieldCount} 个字段，改数字会立刻重算保本价
                </span>
              ) : (
                <span className="text-[11px] text-ink-400">
                  只填有证据的字段，剩下的你自己补；填错了能撤销
                </span>
              )}
              <span className="ml-auto text-[11px] text-ink-400">
                参考价 {result.patch.competitorCents === undefined ? "—" : money(result.patch.competitorCents)}
              </span>
            </div>

            <ul className="flex flex-col gap-0.5 border-t border-paper-200 pt-2">
              {result.notes.map((note) => (
                <li key={note} className="text-[11px] leading-relaxed text-ink-400">
                  · {note}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}
