import { ArrowRight, Info, Sparkles, TriangleAlert } from "lucide-react";
import { IntakePanel } from "../components/IntakePanel.js";

import {
  PLATFORM_PRESETS,
  SERVICE_TAGS,
  type PlatformId,
  type ServiceTag,
} from "../../../src/templates/pricing/platform.js";
import { SAMPLES } from "../../../src/templates/pricing/sample.js";
import { Chips, Field, Toggle } from "../components/Field.js";
import { PlatformPicker } from "../components/PlatformPicker.js";
import { ActionButton, Metric, Panel, PanelHead, Pill, SectionLabel, StickyAction } from "../components/Primitives.js";
import type { Draft } from "../lib/draft.js";
import { missingFields, toProductInput } from "../lib/draft.js";
import { money, pct } from "../lib/format.js";
import { unitCost } from "../../../src/templates/pricing/economics.js";

export function InputStep({
  draft,
  onChange,
  onPlatform,
  onSample,
  onSubmit,
  onIntakeApply,
  intakeCanUndo,
  onIntakeUndo,
  busy,
  error,
  breakEven,
}: {
  readonly draft: Draft;
  readonly onChange: (patch: Partial<Draft>) => void;
  readonly onPlatform: (platform: PlatformId) => void;
  readonly onSample: (sampleId: string) => void;
  readonly onSubmit: () => void;
  readonly onIntakeApply: (patch: Partial<Draft>) => void;
  readonly intakeCanUndo: boolean;
  readonly onIntakeUndo: () => void;
  readonly busy: boolean;
  readonly error: string | null;
  readonly breakEven: number | null;
}): React.JSX.Element {
  const preset = PLATFORM_PRESETS[draft.platform];
  const missing = missingFields(draft);
  const input = toProductInput(draft);
  const unit = unitCost(input, input.competitorCents);
  const gap = input.competitorCents - unit.totalCents;

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-3">
        <IntakePanel onApply={onIntakeApply} canUndo={intakeCanUndo} onUndo={onIntakeUndo} />

        <Panel className="rise">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <Sparkles className="h-4 w-4 text-seal-500" />
            <span className="text-[12.5px] font-medium text-ink-800">第一次用？点一个示例，数字全给你填好</span>
            <div className="ml-auto flex flex-wrap gap-1.5">
              {SAMPLES.map((sample) => (
                <button
                  key={sample.id}
                  type="button"
                  onClick={() => {
                    onSample(sample.id);
                  }}
                  className="rounded-lg bg-paper-100 px-2.5 py-1.5 text-[11.5px] text-ink-700 ring-1 ring-inset ring-paper-300 transition-colors hover:bg-paper-150"
                  title={sample.hint}
                >
                  {sample.label}
                </button>
              ))}
            </div>
          </div>
        </Panel>

        <Panel className="rise" style={{ "--i": 1 } as React.CSSProperties}>
          <PanelHead title={<SectionLabel index="1" title="这是什么货" />} desc="先告诉它卖的是什么、在哪个平台卖。" />
          <div className="flex flex-col gap-3 px-4 py-3.5">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Field
                label="商品名"
                hint="买家会搜的词"
                value={draft.name}
                onChange={(value) => {
                  onChange({ name: value });
                }}
                placeholder="例：便携折叠水壶"
                inputMode="text"
              />
              <Field
                label="类目"
                hint="选填"
                value={draft.category}
                onChange={(value) => {
                  onChange({ category: value });
                }}
                placeholder="例：户外水具"
                inputMode="text"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11.5px] text-ink-500">在哪个平台卖</span>
              <PlatformPicker
                platforms={Object.values(PLATFORM_PRESETS)}
                value={draft.platform}
                onChange={onPlatform}
              />
            </div>
            <Field
              label="核心关键词"
              hint="用逗号分开，会写进标题"
              value={draft.keywords}
              onChange={(value) => {
                onChange({ keywords: value });
              }}
              placeholder="例：户外,折叠,便携"
              inputMode="text"
            />
          </div>
        </Panel>

        <Panel className="rise" style={{ "--i": 2 } as React.CSSProperties}>
          <PanelHead
            title={<SectionLabel index="2" title="成本与费率" />}
            desc="这些数在你后台的「成本/结算」页都能查到。"
            right={<Pill tone="plain">{preset.short} 默认费率已填好</Pill>}
          />
          <div className="flex flex-col gap-3 px-4 py-3.5">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <Field
                label="采购价"
                hint="含税到仓"
                suffix="元"
                value={draft.buy}
                onChange={(value) => {
                  onChange({ buy: value });
                }}
              />
              <Field
                label="包材"
                hint="箱/袋/填充"
                suffix="元"
                value={draft.packaging}
                onChange={(value) => {
                  onChange({ packaging: value });
                }}
              />
              <Field
                label="快递"
                hint="单件均摊"
                suffix="元"
                value={draft.shipping}
                onChange={(value) => {
                  onChange({ shipping: value });
                }}
              />
              <Field
                label="平台佣金"
                hint="技术服务费"
                suffix="%"
                value={draft.commissionPct}
                onChange={(value) => {
                  onChange({ commissionPct: value });
                }}
              />
              <Field
                label="支付手续费"
                suffix="%"
                value={draft.payFeePct}
                onChange={(value) => {
                  onChange({ payFeePct: value });
                }}
              />
              <Field
                label="退货率"
                hint="近 30 天"
                suffix="%"
                value={draft.returnPct}
                onChange={(value) => {
                  onChange({ returnPct: value });
                }}
              />
            </div>
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-400">
              <Info className="mt-[1px] h-3 w-3 shrink-0" />
              退货摊销 = 退货率 ×（来回运费 + 包材 + 商品折损）。默认按退回来的货还能卖 6 成算。
            </p>
          </div>
        </Panel>

        <Panel className="rise" style={{ "--i": 3 } as React.CSSProperties}>
          <PanelHead
            title={<SectionLabel index="3" title="市场和目标" />}
            desc="竞品价和单量决定需求，目标毛利决定你愿意让多少。"
          />
          <div className="flex flex-col gap-3 px-4 py-3.5">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Field
                label="竞品主流价"
                suffix="元"
                value={draft.competitor}
                onChange={(value) => {
                  onChange({ competitor: value });
                }}
              />
              <Field
                label="竞品价下的日单量"
                hint="整个价格带"
                suffix="单"
                value={draft.marketOrders}
                onChange={(value) => {
                  onChange({ marketOrders: value });
                }}
                inputMode="numeric"
              />
              <Field
                label="目标毛利"
                suffix="%"
                value={draft.targetMarginPct}
                onChange={(value) => {
                  onChange({ targetMarginPct: value });
                }}
              />
              <Field
                label="可周转资金"
                hint="备货用"
                suffix="元"
                value={draft.cash}
                onChange={(value) => {
                  onChange({ cash: value });
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Field
                label="推广日预算"
                hint="不投就填 0"
                suffix="元"
                value={draft.adBudget}
                onChange={(value) => {
                  onChange({ adBudget: value });
                }}
              />
              <Field
                label="点击单价"
                suffix="元"
                value={draft.adCpc}
                onChange={(value) => {
                  onChange({ adCpc: value });
                }}
              />
              <Field
                label="转化率"
                suffix="%"
                value={draft.adCvrPct}
                onChange={(value) => {
                  onChange({ adCvrPct: value });
                }}
              />
              <Field
                label="平台账期"
                hint="确认收货后天数"
                suffix="天"
                value={draft.settleDays}
                onChange={(value) => {
                  onChange({ settleDays: value });
                }}
                inputMode="numeric"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[11.5px] text-ink-500">你能兑现的服务（会写进卖点，别乱勾）</span>
              <Chips
                options={SERVICE_TAGS}
                selected={draft.services}
                onToggle={(tag: ServiceTag) => {
                  const next = draft.services.includes(tag)
                    ? draft.services.filter((item) => item !== tag)
                    : [...draft.services, tag];
                  onChange({ services: next });
                }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Toggle
                label="算活动价"
                hint={preset.promoLabel}
                checked={draft.promoEnabled}
                onChange={(checked) => {
                  onChange({ promoEnabled: checked });
                }}
              />
              {draft.promoEnabled ? (
                <Field
                  label="活动折扣"
                  hint="按售价打折"
                  suffix="%"
                  value={draft.promoDiscountPct}
                  onChange={(value) => {
                    onChange({ promoDiscountPct: value });
                  }}
                  className="w-28"
                />
              ) : null}
            </div>

            <details className="rounded-xl bg-paper-100/70 px-3 py-2">
              <summary className="cursor-pointer text-[11.5px] text-ink-500">更多参数（不确定就用默认）</summary>
              <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                <Field
                  label="价格弹性"
                  hint="2.2 常用"
                  value={draft.elasticity}
                  onChange={(value) => {
                    onChange({ elasticity: value });
                  }}
                />
                <Field
                  label="退货可回收"
                  hint="二次销售比例"
                  suffix="%"
                  value={draft.salvagePct}
                  onChange={(value) => {
                    onChange({ salvagePct: value });
                  }}
                />
                <Field
                  label="随机种子"
                  hint="同样数字得同样结果"
                  value={draft.seed}
                  onChange={(value) => {
                    onChange({ seed: value });
                  }}
                  inputMode="numeric"
                />
              </div>
            </details>
          </div>
        </Panel>
      </div>

      <div className="flex flex-col gap-3 xl:sticky xl:top-3 xl:self-start">
        <Panel className="rise" style={{ "--i": 1 } as React.CSSProperties}>
          <PanelHead title="边填边算" desc="改数字，这里立刻跟着变" />
          <div className="grid grid-cols-2 gap-3 px-4 py-3.5">
            <Metric
              label="保本价"
              value={breakEven === null ? "—" : money(breakEven)}
              hint="低于它就亏"
              tone="seal"
              size="lg"
            />
            <Metric
              label="一件成本"
              value={money(unit.totalCents)}
              hint={`佣金 ${money(unit.commissionCents)}`}
              size="md"
            />
            <Metric
              label="竞品价"
              value={money(input.competitorCents)}
              hint={`比成本高 ${money(Math.max(0, gap))}`}
              size="md"
            />
            <Metric
              label="平台费率合计"
              value={pct(input.commissionRate + input.payFeeRate)}
              hint={preset.short}
              size="md"
            />
          </div>
          {gap < 0 ? (
            <div className="mx-4 mb-3 flex items-start gap-1.5 rounded-lg bg-seal-100/70 px-2.5 py-2 text-[11.5px] text-seal-600">
              <TriangleAlert className="mt-[1px] h-3.5 w-3.5 shrink-0" />
              按这个成本，竞品价卖出去是亏的。要么换更便宜的货源，要么别打这个价格带。
            </div>
          ) : null}
        </Panel>

        <Panel className="rise" style={{ "--i": 2 } as React.CSSProperties}>
          <div className="flex flex-col gap-2.5 px-4 py-3.5">
            <ActionButton
              size="lg"
              onClick={onSubmit}
              disabled={busy || missing.length > 0}
              className="w-full"
            >
              {busy ? "正在核算…" : "开始核算"}
              <ArrowRight className="h-4 w-4" />
            </ActionButton>
            {missing.length > 0 ? (
              <p className="text-[11px] text-ink-400">还差：{missing.join("、")}</p>
            ) : (
              <p className="text-[11px] leading-relaxed text-ink-400">
                在本机算，不上传你的成本。四个角色分工，大约 1 秒出结果。
              </p>
            )}
            {error === null ? null : (
              <p className="rounded-lg bg-seal-100/70 px-2.5 py-2 text-[11.5px] text-seal-600">{error}</p>
            )}
          </div>
        </Panel>
      </div>

      <StickyAction
        label="填完整了就点这里"
        hint={breakEven === null ? "保本价 —" : `保本价 ${money(breakEven)}`}
      >
        <ActionButton onClick={onSubmit} disabled={busy || missing.length > 0}>
          {busy ? "正在核算…" : "开始核算"}
        </ActionButton>
      </StickyAction>
    </div>
  );
}