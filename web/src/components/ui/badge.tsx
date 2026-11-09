import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils.js";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none",
  {
    variants: {
      tone: {
        muted: "border-ink-600/80 bg-ink-800/70 text-mist-300",
        flow: "border-flow-400/40 bg-flow-400/10 text-flow-400",
        lock: "border-lock-400/40 bg-lock-400/10 text-lock-400",
        warn: "border-warn-400/40 bg-warn-400/10 text-warn-400",
        risk: "border-risk-400/40 bg-risk-400/10 text-risk-400",
      },
    },
    defaultVariants: { tone: "muted" },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, ...props }: BadgeProps): React.JSX.Element {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
