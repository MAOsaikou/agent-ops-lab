/**
 * Live orchestration pacing helpers for judge/demo visualization.
 * Automated WebDriver sessions (Playwright E2E) default to instant mode so
 * regression suites stay deterministic and fast; real browsers default to
 * paced playback so every agent step, loop, and negotiation round is visible.
 */
export function defaultPacingEnabled(): boolean {
  if (typeof navigator !== "undefined" && navigator.webdriver === true) {
    return false;
  }
  return true;
}

export function eventStepIntervalMs(eventCount: number, targetTotalMs = 4600): number {
  if (eventCount <= 1) return 120;
  return Math.min(180, Math.max(85, Math.floor(targetTotalMs / eventCount)));
}
