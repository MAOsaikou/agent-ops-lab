import { BudgetPanel } from "../components/BudgetPanel.js";
import { QuoteChart, QuoteTable } from "../components/QuoteChart.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.js";
import type { UiState } from "../state/reducer.js";

export function Negotiation({ state }: { readonly state: UiState }): React.JSX.Element {
  const rounds = new Set(state.quotes.map((quote) => quote.round));
  const accept = state.quotes.filter((quote) => quote.ruling === "accept").length;
  const counter = state.quotes.filter((quote) => quote.ruling === "counter").length;
  const walk = state.quotes.filter((quote) => quote.ruling === "walk").length;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,430px)]">
        <QuoteChart quotes={state.quotes} />
        <div className="flex flex-col gap-3">
          <Card>
            <CardHeader>
              <CardTitle>这次谈判的结果</CardTitle>
              <CardDescription>供应商没货时，店里最多来回谈三轮。谈不拢，这回合就不进货。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <Outcome label="谈成了" value={accept} tone="lock" note="按谈好的价进货" />
                <Outcome label="谈崩了" value={walk} tone="risk" note="这回合不下单" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Metric label="来回讲价" value={String(counter)} tone="warn" />
                <Metric label="报价次数" value={String(state.quotes.length)} />
                <Metric label="营销预算" value={String(state.budgets.length)} />
              </div>
              <div className="rounded-xl bg-white/[0.03] px-3 py-2 text-[11.5px] text-mist-400">
                发生在：{rounds.size === 0 ? "这一局还没遇到断供" : [...rounds].map((round) => `第 ${round + 1} 回合`).join("、")}
              </div>
            </CardContent>
          </Card>
          <BudgetPanel budgets={state.budgets} />
        </div>
      </div>
      <QuoteTable quotes={state.quotes} />
    </div>
  );
}

function Outcome({
  label,
  value,
  tone,
  note,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone: "lock" | "risk";
  readonly note: string;
}): React.JSX.Element {
  const accent = tone === "lock" ? "text-lock-400" : "text-risk-400";
  const bar = tone === "lock" ? "bg-lock-400" : "bg-risk-400";
  return (
    <div className="relative overflow-hidden rounded-xl bg-white/[0.03] px-3 py-2.5">
      <span className={`absolute left-0 top-0 h-full w-[3px] ${bar}`} />
      <div className="text-[11.5px] text-mist-400">{label}</div>
      <div className={`text-3xl font-semibold leading-tight tabular-nums tracking-tight ${accent}`}>{value}</div>
      <div className="text-[11px] text-mist-500">{note}</div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: "default" | "lock" | "warn" | "risk";
}): React.JSX.Element {
  const toneClass =
    tone === "lock" ? "text-lock-400" : tone === "warn" ? "text-warn-400" : tone === "risk" ? "text-risk-400" : "text-mist-100";
  return (
    <div className="rounded-xl bg-white/[0.03] px-3 py-2">
      <div className="text-[11.5px] text-mist-400">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold leading-tight tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
