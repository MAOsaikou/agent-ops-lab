import { useEffect, useState } from "react";

import type { PriceEvaluation } from "../../../src/templates/pricing/model.js";
import { money, pct } from "../lib/format.js";

type Segment = {
  readonly key: string;
  readonly label: string;
  readonly cents: number;
  readonly color: string;
};

export function CostBreakdown({
  evaluation,
}: {
  readonly evaluation: PriceEvaluation;
}): React.JSX.Element {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setGrown(true);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, []);

  const price = evaluation.priceCents;
  const net = Math.max(0, Math.round(evaluation.daily.netPerOrderCents));
  const ad = Math.round(evaluation.daily.adPerOrderCents);
  const segments: Segment[] = [
    { key: "buy", label: "采购", cents: evaluation.unit.buyCents, color: "#3d362c" },
    { key: "packaging", label: "包材", cents: evaluation.unit.packagingCents, color: "#8c8172" },
    { key: "shipping", label: "快递", cents: evaluation.unit.shippingCents, color: "#b07a2e" },
    { key: "commission", label: "平台佣金", cents: evaluation.unit.commissionCents, color: "#c4442b" },
    { key: "payFee", label: "支付费", cents: evaluation.unit.payFeeCents, color: "#d97455" },
    { key: "returns", label: "退货摊销", cents: evaluation.unit.returnLossCents, color: "#a99e8d" },
    { key: "ad", label: "推广摊销", cents: ad, color: "#d8a95c" },
    { key: "net", label: "你的净利", cents: net, color: "#2e6b52" },
  ].filter((segment) => segment.cents > 0);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex h-6 w-full overflow-hidden rounded-lg ring-1 ring-inset ring-ink-900/10">
        {segments.map((segment) => (
          <div
            key={segment.key}
            title={`${segment.label} ${money(segment.cents)}`}
            className="h-full transition-[width] duration-700 ease-out"
            style={{
              width: grown ? `${(segment.cents / price) * 100}%` : "0%",
              backgroundColor: segment.color,
            }}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {segments.map((segment) => (
          <div key={segment.key} className="flex items-baseline gap-1.5 text-[11.5px]">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: segment.color }} />
            <span className="text-ink-500">{segment.label}</span>
            <span className="tabular ml-auto text-ink-800">{money(segment.cents)}</span>
            <span className="tabular w-10 text-right text-ink-400">{pct(segment.cents / price, 0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}