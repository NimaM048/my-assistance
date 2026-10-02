// "Is someone at the keyboard?" — a rough, private guess shared by every
// Coucou window, so health reminders only count time you're actually here.
//
// Windows call `markActive()` when something happens (a Claude Code hook, a
// click in the Hub, a focus session ticking). Nothing is recorded but the time
// of the last sign of life, and it never leaves this PC.

const KEY = "coucou.activity.last";
let lastWrite = 0;

export function markActive() {
  const now = Date.now();
  // Writing localStorage on every mouse move would be wasteful: once every 20 s is plenty.
  if (now - lastWrite < 20_000) return;
  lastWrite = now;
  try {
    localStorage.setItem(KEY, String(now));
  } catch {
    /* storage unavailable: reminders just assume you're around */
  }
}

/** Milliseconds since the last sign of life in any window (Infinity if none yet). */
export function idleFor(): number {
  try {
    const at = Number(localStorage.getItem(KEY) ?? 0);
    return at ? Date.now() - at : Number.POSITIVE_INFINITY;
  } catch {
    return 0;
  }
}

/** Mark activity on input in this window (throttled). Returns a function that stops it. */
export function trackInput(target: Window = window): () => void {
  const on = () => markActive();
  const events = ["pointerdown", "keydown", "wheel"] as const;
  for (const e of events) target.addEventListener(e, on, { passive: true });
  return () => { for (const e of events) target.removeEventListener(e, on); };
}
