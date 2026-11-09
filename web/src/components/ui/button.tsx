import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow-400/60 disabled:pointer-events-none disabled:opacity-45 whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-flow-400 text-ink-950 hover:bg-flow-400/85",
        outline: "border border-ink-600 text-mist-100 hover:border-flow-400/70 hover:bg-ink-800",
        ghost: "text-mist-300 hover:bg-ink-800 hover:text-mist-100",
        subtle: "bg-ink-700/60 text-mist-100 hover:bg-ink-700",
        danger: "bg-risk-400/15 text-risk-400 border border-risk-400/40 hover:bg-risk-400/25",
        lock: "bg-lock-400/15 text-lock-400 border border-lock-400/40 hover:bg-lock-400/25",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4",
        lg: "h-10 px-5",
        icon: "h-8 w-8",
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
