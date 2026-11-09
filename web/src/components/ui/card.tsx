import { cn } from "../../lib/utils.js";

type Props = React.HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: Props): React.JSX.Element {
  return (
    <div
      className={cn(
        "rounded-xl border border-ink-700/80 bg-ink-850/70 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_18px_40px_-32px_rgba(0,0,0,0.9)] backdrop-blur",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: Props): React.JSX.Element {
  return <div className={cn("flex flex-col gap-1 border-b border-ink-700/60 px-4 py-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: Props): React.JSX.Element {
  return <div className={cn("text-sm font-semibold tracking-wide text-mist-100", className)} {...props} />;
}

export function CardDescription({ className, ...props }: Props): React.JSX.Element {
  return <div className={cn("text-xs leading-relaxed text-mist-500", className)} {...props} />;
}

export function CardContent({ className, ...props }: Props): React.JSX.Element {
  return <div className={cn("px-4 py-3", className)} {...props} />;
}

export function CardFooter({ className, ...props }: Props): React.JSX.Element {
  return <div className={cn("border-t border-ink-700/60 px-4 py-3", className)} {...props} />;
}
