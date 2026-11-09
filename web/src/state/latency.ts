let counter = 0;

// Two per-frame measures land on the performance timeline, so the U7 perf lane can
// read full distributions without any global. "wire" is the acceptance metric
// (server write -> browser render); "client" is the same span minus the network hop.
export function markFrameLatency(emittedAt?: number): void {
  counter += 1;
  const id = String(counter);
  performance.mark(`u7-recv-${id}`);
  requestAnimationFrame(() => {
    performance.mark(`u7-shown-${id}`);
    performance.measure("u7-frame-client", `u7-recv-${id}`, `u7-shown-${id}`);
    if (emittedAt !== undefined) {
      // Chrome requires start or end here; synthesise the span so the entry duration
      // equals the server-write-to-render time.
      const end = performance.now();
      const start = Math.max(0, end - Math.max(0, Date.now() - emittedAt));
      performance.measure("u7-frame-wire", { start, end });
    }
  });
}
