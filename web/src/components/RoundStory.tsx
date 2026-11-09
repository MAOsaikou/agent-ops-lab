import { BadgeDollarSign, Megaphone, PackageSearch, Sparkles, Tag } from "lucide-react";

import { Badge } from "./ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.js";
import { SCENARIO_TEXT, SUPPLIER_TEXT } from "../lib/nodes.js";
import type { RunMeta, ScenarioCatalog } from "../lib/contract.js";
import { yuan } from "../lib/utils.js";
import type { RoundUiState, UiState } from "../state/reducer.js";

function latestSettled(state: UiState): RoundUiState | undefined {
  return state.rounds.filter((row) => row.outcome !== undefined).at(-1);
}

export function ShopStats({
  state,
  meta,
  catalog,
}: {
  readonly state: UiState;
  readonly meta: RunMeta | null;
  readonly catalog: ScenarioCatalog | undefined;
}): React.JSX.Element {
  const settled = latestSettled(state);
  const cash = settled?.outcome?.cash ?? catalog?.initial.cash;
  const inventory = settled?.outcome?.inventory ?? catalog?.initial.inventory;
  const reputation = settled?.outcome?.reputation ?? catalog?.initial.reputation;
  const locked = state.rounds.filter((row) => row.locked).length;
  const total = meta?.rounds ?? 8;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Tile label="手上的现金" value={cash === undefined ? "—" : yuan(cash)} hint={settled === undefined ? "开局" : `第 ${settled.round + 1} 回合结算后`} />
      <Tile
        label="库存"
        value={inventory === undefined ? "—" : `茶 ${inventory.tea} · 零食 ${inventory.snack}`}
        hint="件"
        small
      />
      <Tile label="口碑" value={reputation === undefined ? "—" : String(reputation)} hint="越高越有人来" />
      <Tile label="已结算回合" value={`${locked} / ${total}`} hint={locked === total ? "这一局走完了" : "还在营业"} />
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  small = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint: string;
  readonly small?: boolean;
}): React.JSX.Element {
  return (
    <div className="rounded-xl bg-white/[0.035] px-3 py-2.5 ring-1 ring-inset ring-white/[0.05]">
      <div className="text-[11.5px] text-mist-400">{label}</div>
      <div
        className={`mt-0.5 font-semibold tabular-nums tracking-tight text-mist-100 ${
          small ? "text-[15px]" : "text-[22px] leading-tight"
        }`}
      >
        {value}
      </div>
      <div className="text-[11px] text-mist-500">{hint}</div>
    </div>
  );
}

function Step({
  icon,
  label,
  value,
  note,
  pending,
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly value: string;
  readonly note: string;
  readonly pending: boolean;
}): React.JSX.Element {
  return (
    <div className={`rounded-xl px-3 py-2.5 ring-1 ring-inset ${pending ? "bg-white/[0.015] ring-white/[0.04]" : "bg-white/[0.04] ring-white/[0.06]"}`}>
      <div className="flex items-center gap-1.5 text-[11.5px] text-mist-400">
        <span className={pending ? "text-mist-500" : "text-flow-400"}>{icon}</span>
        {label}
      </div>
      <div className={`mt-1 text-[15px] font-semibold tracking-tight ${pending ? "text-mist-500" : "text-mist-100"}`}>{value}</div>
      <div className="mt-0.5 text-[11.5px] leading-relaxed text-mist-400">{note}</div>
    </div>
  );
}

export function RoundStory({
  state,
  catalog,
}: {
  readonly state: UiState;
  readonly catalog: ScenarioCatalog | undefined;
}): React.JSX.Element {
  const round = state.rounds.at(-1)?.round ?? null;
  const row = round === null ? undefined : state.rounds.find((item) => item.round === round);
  const outcome = row?.outcome;
  const quotes = round === null ? [] : state.quotes.filter((quote) => quote.round === round);
  const budgets = round === null ? [] : state.budgets.filter((item) => item.round === round);
  const index = round ?? 0;
  const primaryCut = catalog?.primaryCapacity[index] === 0;
  const backupCut = catalog?.backupCapacity[index] === 0;
  const tea = catalog?.competitorPrice.tea[index];
  const prevTea = index > 0 ? catalog?.competitorPrice.tea[index - 1] : undefined;
  const priceDrop = tea !== undefined && prevTea !== undefined && tea < prevTea;
  const crisis = primaryCut ? "老供应商断供" : backupCut ? "备选供应商断供" : priceDrop ? "隔壁降价了" : "今天没出事";
  const crisisNote = primaryCut
    ? "老供应商这回合交不出货，采购只能转向备选供应商，价格要重新谈"
    : backupCut
      ? "备选供应商断供，反而要靠老供应商兜住这一回合"
      : priceDrop
        ? `隔壁把茶饮价压到 ${tea === undefined ? "—" : yuan(tea)}，店里要决定跟不跟`
        : "今天没有外部冲击，重点是把货备足、价定准";

  const orders = row?.orders;
  const budget = budgets.at(-1);
  const accepted = quotes.filter((quote) => quote.ruling === "accept");
  const previous =
    round === null
      ? undefined
      : state.rounds.find((item) => item.round === round - 1)?.outcome;
  const profitDelta =
    outcome === undefined || previous === undefined ? undefined : outcome.profit - previous.profit;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-2">
            {round === null ? "还没开始营业" : `第 ${round + 1} 回合`}
            <Badge tone={primaryCut || backupCut || priceDrop ? "warn" : "muted"}>{crisis}</Badge>
            {catalog === undefined ? null : (
              <span className="text-[11.5px] font-normal text-mist-400">剧本 · {SCENARIO_TEXT[catalog.name]}</span>
            )}
          </CardTitle>
          <CardDescription>
            {round === null
              ? "点开张后，这一栏会一回合一句话地讲清楚店里发生了什么"
              : `${crisisNote}。进货、定价、营销三件事由店里的角色商量着定，定完这一回合就不能改。`}
          </CardDescription>
        </div>
        {row === undefined ? null : (
          <Badge tone={row.source === "fallback" ? "warn" : row.settled ? "lock" : "muted"}>
            {row.source === "fallback" ? "这次是兜底方案" : row.settled ? "已结算" : "还在算"}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <Step
            icon={<PackageSearch className="h-3.5 w-3.5" />}
            label="进货"
            pending={orders === undefined}
            value={
              orders === undefined
                ? "还在挑供应商"
                : `茶 ${orders.tea.qty} 份 · 零食 ${orders.snack.qty} 份`
            }
            note={
              orders === undefined
                ? "采购角色正在比对报价与产能"
                : `茶饮找${SUPPLIER_TEXT[orders.tea.supplier] ?? orders.tea.supplier}，零食找${
                    SUPPLIER_TEXT[orders.snack.supplier] ?? orders.snack.supplier
                  }${quotes.length === 0 ? "" : `，谈了 ${String(quotes.length)} 轮，${String(accepted.length)} 次成交`}`
            }
          />
          <Step
            icon={<Tag className="h-3.5 w-3.5" />}
            label="定价"
            pending={orders === undefined}
            value={
              orders === undefined
                ? "还没定价"
                : `茶 ${yuan(orders.tea.price)} · 零食 ${yuan(orders.snack.price)}`
            }
            note={
              outcome === undefined
                ? "按成本与隔壁价格定，卖完才知道准不准"
                : `实际卖出茶 ${String(outcome.skus.tea.sales)} 份、零食 ${String(outcome.skus.snack.sales)} 份`
            }
          />
          <Step
            icon={<Megaphone className="h-3.5 w-3.5" />}
            label="营销"
            pending={row?.adSpendCents === undefined}
            value={row?.adSpendCents === undefined ? "还没决定投多少" : `投放 ${yuan(row.adSpendCents)}`}
            note={
              budget === undefined
                ? "没触发预算分配时，广告按原计划走"
                : budget.allocation.ads === 0 && budget.allocation.priceCut === 0
                  ? "预算算下来是亏的，一分没花"
                  : `广告 ${yuan(budget.allocation.ads)} · 降价让利 ${yuan(budget.allocation.priceCut)}`
            }
          />
          <div
            className={`rounded-xl px-3 py-2.5 ring-1 ring-inset ${
              outcome === undefined ? "bg-white/[0.015] ring-white/[0.04]" : "bg-lock-400/[0.06] ring-lock-400/20"
            }`}
          >
            <div className="flex items-center gap-1.5 text-[11.5px] text-mist-400">
              <span className={outcome === undefined ? "text-mist-500" : "text-lock-400"}>
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              这一回合的结果
            </div>
            {outcome === undefined ? (
              <>
                <div className="mt-1 text-[15px] font-semibold text-mist-500">还没结算</div>
                <div className="mt-0.5 text-[11.5px] text-mist-400">拍板之后才出账，出账即锁定</div>
              </>
            ) : (
              <>
                <div className={`mt-1 text-[22px] font-semibold leading-tight tabular-nums tracking-tight ${outcome.profit >= 0 ? "text-lock-400" : "text-risk-400"}`}>
                  {outcome.profit >= 0 ? "+" : ""}
                  {yuan(outcome.profit)}
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11.5px] tabular-nums text-mist-300">
                  <span>卖出 {outcome.sales} 件</span>
                  <span className="text-right">营收 {yuan(outcome.revenue)}</span>
                      <span className="text-right">现金 {yuan(outcome.cash)}</span>
                      <span className="text-right">口碑 {outcome.reputation}</span>
                  <span className={outcome.missed > 0 ? "text-warn-400" : ""}>缺货 {outcome.missed} 件</span>
                  <span className="text-right">投放 {yuan(outcome.adSpend)}</span>
                </div>
                {profitDelta === undefined ? null : (
                  <div className={`mt-1 text-[11px] ${profitDelta > 0 ? "text-lock-400" : profitDelta < 0 ? "text-risk-400" : "text-mist-400"}`}>
                    {profitDelta > 0
                      ? `比上一回合多赚 ${yuan(profitDelta)}`
                      : profitDelta < 0
                        ? `比上一回合少赚 ${yuan(-profitDelta)}`
                        : "和上一回合赚得一样多"}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11.5px] text-mist-500">
          <BadgeDollarSign className="h-3 w-3" />
          金额单位是元。利润 = 营收 − 进货成本 − 投放 − 库存保管费。
        </div>
      </CardContent>
    </Card>
  );
}
