import type { UiFrame } from "./frames.js";

export const SSE_HEADERS: Record<string, string> = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

export function formatFrame(frame: UiFrame, emittedAt: number = Date.now()): string {
  return `id: ${String(frame.seq)}\ndata: ${JSON.stringify({ ...frame, emittedAt })}\n\n`;
}

export function formatComment(text: string): string {
  return `: ${text}\n\n`;
}

export function formatDone(lastSeq: number): string {
  return `event: done\ndata: ${JSON.stringify({ lastSeq })}\n\n`;
}

export function parseLastEventId(value: string | null | undefined): number {
  if (value === null || value === undefined || value.trim() === "") {
    return 0;
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return 0;
  }
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const finish = (): void => {
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        finish();
      },
      { once: true },
    );
  });
}

export function frameStream(input: {
  readonly frames: readonly UiFrame[];
  readonly since: number;
  readonly paceMs: number;
  readonly signal: AbortSignal;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const pending = input.frames.filter((frame) => frame.seq > input.since);
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(formatComment(`u7 console stream from seq ${String(input.since)}`)));
      let last = input.since;
      for (const frame of pending) {
        if (input.signal.aborted) {
          break;
        }
        controller.enqueue(encoder.encode(formatFrame(frame)));
        last = frame.seq;
        await sleep(input.paceMs, input.signal);
      }
      if (!input.signal.aborted) {
        controller.enqueue(encoder.encode(formatDone(last)));
      }
      controller.close();
    },
  });
}
