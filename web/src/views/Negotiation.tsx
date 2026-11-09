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
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <QuoteChart quotes={state.quotes} />
        <div className="flex flex-col gap-3">
          <Card>
            <CardHeader>
              <CardTitle>协商概览</CardTitle>
              <CardDescription>子工作流是带 maxIterations=3 的循环节点，破裂时输出「本回合不下单」</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 text-[11px]">
              <Metric label="报价事件" value={String(state.quotes.length)} />
              <Metric label="涉及回合" value={rounds.size === 0 ? "—" : [...rounds].map((round) => round + 1).join("、")} />
              <Metric label="接受" value={String(accept)} tone="lock" />
              <Metric label="还价" value={String(counter)} tone="warn" />
              <Metric label="破裂" value={String(walk)} tone="risk" />
              <Metric label="预算仲裁" value={String(state.budgets.length)} />
            </CardContent>
          </Card>
          <BudgetPanel budgets={state.budgets} />
        </div>
      </div>
      <QuoteTable quotes={state.quotes} />
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
    <div className="rounded-lg border border-ink-700/60 bg-ink-900/50 px-2.5 py-2">
      <div className="text-[10px] text-mist-500">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
