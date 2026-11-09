import { Pause, Play, RotateCcw, SkipForward } from "lucide-react";

import { Button } from "./ui/button.js";
import { Progress } from "./ui/progress.js";
import type { Replay, ReplayStatus } from "../state/useReplay.js";

const STATUS_TEXT: Record<ReplayStatus, string> = {
  idle: "待回放",
  playing: "回放中",
  paused: "已暂停",
  done: "回放完毕",
  error: "流错误",
};

const PACES = [
  { label: "慢", value: 240 },
  { label: "常速", value: 90 },
  { label: "快", value: 30 },
];

export function ReplayBar({
  replay,
  total,
}: {
  readonly replay: Replay;
  readonly total: number;
}): React.JSX.Element {
  const done = replay.state.lastSeq;
  const ratio = total === 0 ? 0 : done / total;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-700/70 bg-ink-900/70 px-3 py-2">
      <Button
        size="sm"
        variant={replay.status === "playing" ? "outline" : "default"}
        onClick={replay.status === "playing" ? replay.pause : replay.play}
        data-testid="replay-toggle"
      >
        {replay.status === "playing" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        {replay.status === "playing" ? "暂停" : replay.status === "done" ? "重新回放" : "开始回放"}
      </Button>
      <Button size="sm" variant="ghost" onClick={replay.restart} title="从头回放">
        <RotateCcw className="h-3.5 w-3.5" />
        重播
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          void replay.skipToEnd();
        }}
        data-testid="skip-to-end"
      >
        <SkipForward className="h-3.5 w-3.5" />
        跳到结算
      </Button>
      <div className="flex items-center gap-1 rounded-lg border border-ink-700 p-0.5">
        {PACES.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => {
              replay.setPace(item.value);
            }}
            className={`rounded px-2 py-1 text-[11px] ${
              replay.pace === item.value ? "bg-flow-400/20 text-flow-400" : "text-mist-500 hover:text-mist-100"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="min-w-[160px] flex-1">
        <Progress value={ratio} />
      </div>
      <div className="flex items-center gap-2 text-[11px] tabular-nums text-mist-500">
        <span data-testid="replay-seq">
          seq {done}/{total}
        </span>
        <span className="text-mist-300">{STATUS_TEXT[replay.status]}</span>
        {replay.state.outOfOrder === 0 ? null : <span className="text-warn-400">乱序 {replay.state.outOfOrder}</span>}
        {replay.state.duplicates === 0 ? null : <span className="text-mist-500">重复 {replay.state.duplicates}</span>}
      </div>
    </div>
  );
}
