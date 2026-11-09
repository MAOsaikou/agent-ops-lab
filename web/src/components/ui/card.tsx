import { cn } from "../../lib/utils.js";

type Props = React.HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: Props): React.JSX.Element {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/[0.055] bg-ink-850/75 shadow-panel ring-1 ring-inset ring-white/[0.02] backdrop-blur",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: Props): React.JSX.Element {
  return <div className={cn("flex flex-col gap-1.5 px-5 pb-3 pt-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: Props): React.JSX.Element {
  return <div className={cn("text-[15px] font-semibold tracking-tight text-mist-100", className)} {...props} />;
}

export function CardDescription({ className, ...props }: Props): React.JSX.Element {
  return <div className={cn("text-[12.5px] leading-relaxed text-mist-400", className)} {...props} />;
}

export function CardContent({ className, ...props }: Props): React.JSX.Element {
  return <div className={cn("px-5 pb-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: Props): React.JSX.Element {
  return <div className={cn("border-t border-white/[0.05] px-5 py-3", className)} {...props} />;
}
