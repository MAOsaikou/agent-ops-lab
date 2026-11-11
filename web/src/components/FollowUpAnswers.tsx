import type { AnswerKind } from "../../../src/templates/agentops/compose.js";
import { Pill } from "./Primitives.js";

export type FollowUpItem = {
  readonly id: string;
  readonly kind: AnswerKind;
  readonly ask: string;
  /** Human-readable stand-in value actually used in the numbers (never an invented real figure). */
  readonly demo: string;
};

/**
 * First-screen follow-up: the merchant skipped a required fact, so the numbers above use a labelled
 * demo value. The answer box lives here (not inside the audit fold) so it can be answered in place.
 */
export function FollowUpAnswers({ items, values, disabled, onChange, onSubmit }: {
  readonly items: readonly FollowUpItem[];
  readonly values: Readonly<Record<string, string>>;
  readonly disabled: boolean;
  readonly onChange: (id: string, value: string) => void;
  readonly onSubmit: (item: FollowUpItem) => void;
}): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <section data-testid="followup-questions" aria-label="待补充资料" className="rounded-xl border border-ochre-500/30 bg-ochre-100/50 px-2.5 py-2">
      <div className="text-[11.5px] font-semibold text-ochre-500">还差 {String(items.length)} 项资料，上面的数字暂按演示值试算</div>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1 text-[11.5px] leading-snug text-ink-800">
              <span className="font-medium">{item.ask}</span>{" "}
              <Pill tone="ochre">未提供，演示值 {item.demo}</Pill>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <input
                type="text"
                inputMode="decimal"
                data-testid={`answer-input-${item.id}`}
                aria-label={item.ask}
                value={values[item.id] ?? ""}
                onChange={(event) => { onChange(item.id, event.target.value); }}
                placeholder={item.kind === "orders" ? "输入单量" : "输入金额"}
                className="w-24 min-w-0 flex-1 rounded border border-paper-300 bg-paper-50 px-2 py-1 text-[12px] text-ink-900 focus:outline-none focus:ring-1 focus:ring-ochre-500 sm:flex-none"
              />
              <button
                type="button"
                data-testid={`answer-submit-${item.id}`}
                disabled={disabled}
                onClick={() => { onSubmit(item); }}
                className="shrink-0 rounded bg-ink-900 px-2.5 py-1 text-[11px] font-medium text-paper-50 shadow-sm transition hover:bg-ink-800 active:scale-[0.98] disabled:opacity-50"
              >
                补充并重评
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
