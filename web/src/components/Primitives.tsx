import { cn } from "../lib/cn.js";

export function Panel({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn(
        "rounded-2xl border border-paper-300/80 bg-paper-50 shadow-card",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function PanelHead({
  title,
  desc,
  right,
}: {
  readonly title: React.ReactNode;
  readonly desc?: React.ReactNode;
  readonly right?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-paper-200/90 px-3.5 py-2.5 sm:items-start sm:gap-3 sm:px-5 sm:py-3.5">
      <div className="min-w-0">
        <div className="text-[14.5px] font-semibold tracking-tight text-ink-900 sm:text-[15px]">{title}</div>
        {desc === undefined ? null : (
          <div className="mt-0.5 text-[12px] leading-snug text-ink-500 sm:text-[12.5px] sm:leading-relaxed">{desc}</div>
        )}
      </div>
      {right === undefined ? null : <div className="shrink-0">{right}</div>}
    </div>
  );
}

const PILL_TONES = {
  seal: "bg-seal-100 text-seal-600 ring-seal-500/25",
  jade: "bg-jade-100 text-jade-600 ring-jade-500/25",
  ochre: "bg-ochre-100 text-ochre-500 ring-ochre-500/25",
  ink: "bg-paper-150 text-ink-600 ring-ink-900/10",
  plain: "bg-transparent text-ink-500 ring-ink-900/10",
} as const;

export type PillTone = keyof typeof PILL_TONES;

export function Pill({
  tone = "ink",
  className,
  children,
}: {
  readonly tone?: PillTone;
  readonly className?: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-[3px] text-[11px] font-medium leading-none ring-1 ring-inset whitespace-nowrap",
        PILL_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const BUTTON_VARIANTS = {
  primary:
    "bg-seal-500 text-paper-50 shadow-[0_10px_24px_-14px_rgba(196,68,43,0.9)] hover:bg-seal-600 active:translate-y-px",
  jade: "bg-jade-500 text-paper-50 shadow-[0_10px_24px_-14px_rgba(46,107,82,0.9)] hover:bg-jade-600 active:translate-y-px disabled:bg-paper-200 disabled:text-ink-400 disabled:shadow-none disabled:ring-1 disabled:ring-inset disabled:ring-paper-300 disabled:opacity-75",
  ghost:
    "bg-paper-50 text-ink-800 ring-1 ring-inset ring-paper-300 hover:bg-paper-100 active:translate-y-px",
  quiet: "bg-transparent text-ink-500 hover:bg-paper-150 hover:text-ink-800",
} as const;

export function ActionButton({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: keyof typeof BUTTON_VARIANTS;
  readonly size?: "sm" | "md" | "lg";
}): React.JSX.Element {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-40",
        size === "lg" ? "h-12 px-6 text-[15px]" : size === "sm" ? "h-8 px-3 text-[12.5px]" : "h-10 px-4 text-[13.5px]",
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Metric({
  label,
  value,
  hint,
  tone = "ink",
  size = "md",
}: {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly hint?: string;
  readonly tone?: "ink" | "seal" | "jade" | "ochre";
  readonly size?: "sm" | "md" | "lg";
}): React.JSX.Element {
  const toneClass =
    tone === "seal" ? "text-seal-600" : tone === "jade" ? "text-jade-600" : tone === "ochre" ? "text-ochre-500" : "text-ink-900";
  return (
    <div>
      <div className="text-[11.5px] text-ink-500">{label}</div>
      <div
        className={cn(
          "tabular font-display font-semibold tracking-tight",
          size === "lg" ? "text-[30px] leading-tight" : size === "sm" ? "text-[15px]" : "text-[21px] leading-tight",
          toneClass,
        )}
      >
        {value}
      </div>
      {hint === undefined ? null : <div className="text-[11px] text-ink-400">{hint}</div>}
    </div>
  );
}

export function SectionLabel({
  index,
  title,
  hint,
}: {
  readonly index: string;
  readonly title: string;
  readonly hint?: string;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-900 text-[12px] font-semibold text-paper-50">
        {index}
      </span>
      <span className="text-[13.5px] font-semibold text-ink-900">{title}</span>
      {hint === undefined ? null : <span className="text-[11.5px] text-ink-400">{hint}</span>}
    </div>
  );
}
export function StickyAction({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-paper-300 bg-paper-50/95 px-3 py-2.5 shadow-[0_-12px_28px_-24px_rgba(32,28,22,0.6)] backdrop-blur xl:hidden">
      <div className="min-w-0">
        <div className="text-[11px] text-ink-400">{label}</div>
        {hint === undefined ? null : (
          <div className="truncate text-[12px] font-medium text-ink-800">{hint}</div>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
