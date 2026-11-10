import { AlertTriangle, Check, X } from "lucide-react";

import type { CheckRow } from "../../../src/templates/pricing/model.js";
import { cn } from "../lib/cn.js";

const STATUS_META = {
  pass: { icon: Check, className: "bg-jade-100 text-jade-600", label: "通过" },
  warn: { icon: AlertTriangle, className: "bg-ochre-100 text-ochre-500", label: "提醒" },
  fail: { icon: X, className: "bg-seal-100 text-seal-600", label: "不通过" },
} as const;

export function ChecksList({ rows }: { readonly rows: readonly CheckRow[] }): React.JSX.Element {
  return (
    <ul className="flex flex-col divide-y divide-paper-200/80">
      {rows.map((row, index) => {
        const meta = STATUS_META[row.status];
        const Icon = meta.icon;
        return (
          <li
            key={row.id}
            className="rise flex items-start gap-2.5 py-2 first:pt-0 last:pb-0"
            style={{ "--i": index } as React.CSSProperties}
          >
            <span className={cn("mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-md", meta.className)}>
              <Icon className="h-3 w-3" strokeWidth={3} />
            </span>
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium text-ink-800">{row.label}</div>
              <div className="text-[11.5px] leading-relaxed text-ink-500">{row.detail}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}