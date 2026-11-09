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

const STATUS_TONE: Record<ReplayStatus, string> = {
  idle: "bg-white/[0.06] text-mist-300",
  playing: "bg-flow-400/12 text-flow-400",
  paused: "bg-warn-400/12 text-warn-400",
  done: "bg-lock-400/12 text-lock-400",
  error: "bg-risk-400/12 text-risk-400",
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
  const playing = replay.status === "playing";
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl bg-ink-900/60 px-4 py-3 shadow-panel ring-1 ring-inset ring-white/[0.06]">
      <div className="flex items-center gap-3">
        <Button
          size="icon"
          className="h-11 w-11 shrink-0 rounded-full"
          onClick={playing ? replay.pause : replay.play}
          aria-label={playing ? "暂停" : replay.status === "done" ? "重新回放" : "开始回放"}
          title={playing ? "暂停" : replay.status === "done" ? "重新回放" : "开始回放"}
          data-testid="replay-toggle"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
        </Button>

        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="text-[12px] text-mist-400">
              回合进度
              <span className="ml-2 text-[13px] font-medium text-mist-100">{Math.round(ratio * 100)}%</span>
            </span>
            <span className="text-[12px] tabular-nums text-mist-400" data-testid="replay-seq" title={`seq ${done}/${total}`}>
              第 {done} / {total} 步
            </span>
          </div>
          <Progress value={ratio} />
        </div>

        <span className={`shrink-0 rounded-md px-2.5 py-1 text-[12px] font-medium ${STATUS_TONE[replay.status]}`}>
          {STATUS_TEXT[replay.status]}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={replay.restart} title="从头回放">
          <RotateCcw className="h-3.5 w-3.5" />
          重播
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void replay.skipToEnd();
          }}
          data-testid="skip-to-end"
        >
          <SkipForward className="h-3.5 w-3.5" />
          跳到结算
        </Button>
        <div className="flex items-center gap-1 rounded-xl bg-white/[0.04] p-1 ring-1 ring-inset ring-white/[0.05]">
          <span className="pl-1.5 pr-0.5 text-[11px] text-mist-500">速率</span>
          {PACES.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                replay.setPace(item.value);
              }}
              className={`rounded-lg px-2.5 py-1 text-[12px] transition-colors ${
                replay.pace === item.value
                  ? "bg-flow-400/18 text-flow-400"
                  : "text-mist-400 hover:bg-white/[0.05] hover:text-mist-100"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-[11px] tabular-nums text-mist-500">
          {replay.state.outOfOrder === 0 ? null : <span className="text-warn-400">乱序 {replay.state.outOfOrder}</span>}
          {replay.state.duplicates === 0 ? null : <span>重复 {replay.state.duplicates}</span>}
        </div>
      </div>
    </div>
  );
}
