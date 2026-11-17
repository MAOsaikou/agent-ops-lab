import { BookOpen, HelpCircle } from "lucide-react";

import { cn } from "../lib/cn.js";
import { MODE_PLAIN_GUIDES, type ConsoleGuideMode } from "../lib/plain-glossary.js";

export function PlainGuideBanner({
  mode,
  compactOnMobile = false,
}: {
  readonly mode: ConsoleGuideMode;
  readonly compactOnMobile?: boolean;
}): React.JSX.Element {
  const guide = MODE_PLAIN_GUIDES[mode];

  return (
    <section
      aria-label="白话导览与术语速查"
      data-testid="plain-guide-banner"
      className={cn(
        "min-w-0 rounded-2xl border border-jade-500/30 bg-jade-100/30 px-3 py-2.5 text-ink-800 sm:px-4 sm:py-3",
        compactOnMobile ? "hidden sm:block" : "",
      )}
    >
      <div className="flex flex-wrap items-start gap-2">
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-jade-500 px-2 py-0.5 text-[10.5px] font-semibold text-paper-50">
          <BookOpen className="h-3 w-3 shrink-0" aria-hidden="true" />
          {guide.badge}
        </span>
        <p className="min-w-0 flex-1 text-[12px] font-medium leading-relaxed text-ink-900 sm:text-[12.5px]">
          {guide.headline}
        </p>
      </div>

      <details data-testid="plain-glossary-details" className="mt-2 min-w-0 border-t border-jade-500/20 pt-2">
        <summary className="cursor-pointer select-none text-[11.5px] font-semibold text-jade-600 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jade-600">
          <span className="inline-flex items-center gap-1">
            <HelpCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            看不懂专业词？点此展开「3步玩法 &amp; 大白话术语词典」（p10 / 会签 / 边际仲裁 / 拓扑…）
          </span>
        </summary>

        <div className="mt-2.5 grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <div className="min-w-0 rounded-xl border border-paper-300/80 bg-paper-50/90 p-3">
            <h3 className="text-[12px] font-semibold text-ink-900">这页怎么玩（3 步上手）</h3>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-600">{guide.whatItDoes}</p>
            <ol className="mt-2 space-y-1.5 text-[11.5px] leading-snug text-ink-800">
              {guide.howToUse.map((step, index) => (
                <li key={step} className="flex items-start gap-2">
                  <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-jade-500 text-[10px] font-semibold text-paper-50">
                    {index + 1}
                  </span>
                  <span className="min-w-0">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="min-w-0 rounded-xl border border-paper-300/80 bg-paper-50/90 p-3">
            <h3 className="text-[12px] font-semibold text-ink-900">本页专业词 → 大白话翻译</h3>
            <dl className="mt-2 grid gap-2 sm:grid-cols-2">
              {guide.keyTerms.map((item) => (
                <div
                  key={item.term}
                  className="min-w-0 rounded-lg border border-paper-200 bg-paper-100/50 px-2.5 py-1.5"
                >
                  <dt className="text-[11px] font-semibold text-ink-900">{item.term}</dt>
                  <dd className="mt-0.5 text-[11px] leading-relaxed text-ink-600">{item.plain}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </details>
    </section>
  );
}
