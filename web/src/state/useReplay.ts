import { useCallback, useEffect, useRef, useState } from "react";

import type { WireFrame } from "../../../src/server/frames.js";
import { fetchEventsSince, streamUrl } from "../lib/api.js";
import { markFrameLatency } from "./latency.js";
import { enqueue, initialUiState, type UiState } from "./reducer.js";

export type ReplayStatus = "idle" | "playing" | "paused" | "done" | "error";

export type Replay = {
  readonly state: UiState;
  readonly status: ReplayStatus;
  readonly pace: number;
  readonly total: number;
  readonly play: () => void;
  readonly pause: () => void;
  readonly restart: () => void;
  readonly skipToEnd: () => Promise<void>;
  readonly setPace: (pace: number) => void;
  readonly setTotal: (total: number) => void;
};

export function useReplay(runId: string | null, initialPace = 90): Replay {
  const [state, setState] = useState<UiState>(initialUiState);
  const [status, setStatus] = useState<ReplayStatus>("idle");
  const [pace, setPaceState] = useState(initialPace);
  const [total, setTotal] = useState(0);
  const lastSeq = useRef(0);
  const source = useRef<EventSource | null>(null);
  const paceRef = useRef(initialPace);

  const close = useCallback(() => {
    if (source.current !== null) {
      source.current.close();
      source.current = null;
    }
  }, []);

  const open = useCallback(
    (id: string, fromSeq: number) => {
      close();
      const events = new EventSource(streamUrl(id, fromSeq, paceRef.current));
      source.current = events;
      setStatus("playing");
      events.onmessage = (message: MessageEvent<string>) => {
        const frame = JSON.parse(message.data) as WireFrame;
        lastSeq.current = frame.seq;
        setState((previous) => enqueue(previous, frame));
        markFrameLatency(frame.emittedAt);
      };
      events.addEventListener("done", () => {
        setStatus("done");
        close();
      });
      events.onerror = () => {
        if (source.current !== null) {
          setStatus("error");
          close();
        }
      };
    },
    [close],
  );

  useEffect(() => {
    close();
    setState(initialUiState());
    lastSeq.current = 0;
    setStatus("idle");
    if (runId !== null) {
      open(runId, 0);
    }
    return close;
  }, [runId, close, open]);

  const play = useCallback(() => {
    if (runId === null) {
      return;
    }
    if (status === "done") {
      setState(initialUiState());
      lastSeq.current = 0;
      open(runId, 0);
      return;
    }
    open(runId, lastSeq.current);
  }, [open, runId, status]);

  const pause = useCallback(() => {
    close();
    setStatus("paused");
  }, [close]);

  const restart = useCallback(() => {
    if (runId === null) {
      return;
    }
    close();
    setState(initialUiState());
    lastSeq.current = 0;
    open(runId, 0);
  }, [close, open, runId]);

  const skipToEnd = useCallback(async () => {
    if (runId === null) {
      return;
    }
    close();
    const rest = await fetchEventsSince(runId, lastSeq.current);
    setState((previous) => applyRest(previous, rest.frames));
    lastSeq.current = rest.lastSeq;
    setStatus("done");
  }, [close, runId]);

  const setPace = useCallback(
    (next: number) => {
      paceRef.current = next;
      setPaceState(next);
      if (runId !== null && status === "playing") {
        open(runId, lastSeq.current);
      }
    },
    [open, runId, status],
  );

  return { state, status, pace, total, play, pause, restart, skipToEnd, setPace, setTotal };
}

function applyRest(state: UiState, frames: readonly WireFrame[]): UiState {
  let next = state;
  for (const frame of frames) {
    next = enqueue(next, frame);
  }
  return next;
}
