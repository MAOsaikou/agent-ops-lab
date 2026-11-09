import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils.js";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium leading-none whitespace-nowrap",
  {
    variants: {
      tone: {
        muted: "bg-white/[0.06] text-mist-300",
        flow: "bg-flow-400/12 text-flow-400 ring-1 ring-inset ring-flow-400/25",
        lock: "bg-lock-400/12 text-lock-400 ring-1 ring-inset ring-lock-400/25",
        warn: "bg-warn-400/12 text-warn-400 ring-1 ring-inset ring-warn-400/25",
        risk: "bg-risk-400/12 text-risk-400 ring-1 ring-inset ring-risk-400/25",
      },
    },
    defaultVariants: { tone: "muted" },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, ...props }: BadgeProps): React.JSX.Element {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
