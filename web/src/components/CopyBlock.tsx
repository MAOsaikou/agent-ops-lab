import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "../lib/cn.js";
import { Pill } from "./Primitives.js";

async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    document.body.removeChild(area);
  }
}

export function CopyBlock({
  label,
  text,
  meta,
  needsReview = false,
  className,
}: {
  readonly label: string;
  readonly text: string;
  readonly meta?: string;
  readonly needsReview?: boolean;
  readonly className?: string;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    },
    [],
  );

  return (
    <div
      className={cn(
        "group flex items-start gap-3 rounded-xl border border-paper-300/80 bg-paper-100/60 px-3 py-2.5 transition-colors hover:bg-paper-100",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-ink-500">{label}</span>
          {meta === undefined ? null : <span className="text-[10.5px] text-ink-400">{meta}</span>}
          {needsReview ? <Pill tone="ochre">需你确认</Pill> : null}
        </div>
        <div className="mt-0.5 break-words text-[13px] leading-relaxed text-ink-900">{text}</div>
      </div>
      <button
        type="button"
        onClick={() => {
          void writeClipboard(text).then(() => {
            setCopied(true);
            if (timer.current !== null) {
              window.clearTimeout(timer.current);
            }
            timer.current = window.setTimeout(() => {
              setCopied(false);
            }, 1400);
          });
        }}
        className={cn(
          "flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[11.5px] font-medium transition-all",
          copied ? "bg-jade-500 text-paper-50" : "bg-paper-50 text-ink-600 ring-1 ring-inset ring-paper-300 hover:bg-paper-150",
        )}
      >
        {copied ? <Check className="h-3.5 w-3.5 pop" strokeWidth={3} /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  );
}