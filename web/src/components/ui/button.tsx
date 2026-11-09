import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow-400/60 disabled:pointer-events-none disabled:opacity-40 whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-flow-400 text-ink-950 shadow-[0_8px_20px_-12px_rgba(96,165,250,0.9)] hover:bg-flow-400/90",
        outline: "bg-white/[0.03] text-mist-100 ring-1 ring-inset ring-white/10 hover:bg-white/[0.07]",
        ghost: "text-mist-300 hover:bg-white/[0.06] hover:text-mist-100",
        subtle: "bg-ink-700/60 text-mist-100 hover:bg-ink-700",
        danger: "bg-risk-400/12 text-risk-400 ring-1 ring-inset ring-risk-400/30 hover:bg-risk-400/20",
        lock: "bg-lock-400/12 text-lock-400 ring-1 ring-inset ring-lock-400/30 hover:bg-lock-400/20",
      },
      size: {
        sm: "h-9 px-3.5 text-[13px]",
        md: "h-10 px-4 text-sm",
        lg: "h-11 px-5 text-[15px]",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps): React.JSX.Element {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
