// "While you were away…" — a short memory of what happened, so that coming back
// to your desk after locking the screen starts with a summary from Mochi rather
// than a hunt through terminals and dashboards.
//
// Only kept in this window's memory, for a few hours. Nothing is written to
// disk and nothing leaves this PC.

export type JournalKind =
  | "finished" | "error" | "question" | "approval" | "approvalMissed"
  | "testPass" | "testFail" | "limit" | "integrationOk" | "integrationFail";

export interface JournalEntry {
  at: number;
  kind: JournalKind;
  /** Project or integration it's about ("my-assistance", "Vercel"). */
  who: string;
  /** What happened, short ("Build failed", "12 passed"). */
  text: string;
}

const KEEP_MS = 12 * 60 * 60 * 1000;
const MAX = 300;
const entries: JournalEntry[] = [];

export function record(kind: JournalKind, who: string, text = "") {
  const now = Date.now();
  entries.push({ at: now, kind, who, text: text.replace(/\s+/g, " ").trim() });
  while (entries.length > MAX || (entries.length && now - entries[0].at > KEEP_MS)) entries.shift();
}

export interface RecapLine {
  emoji: string;
  text: string;
  tone: "good" | "bad" | "info";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const names = (list: string[]) => {
  const unique = [...new Set(list.filter(Boolean))];
  if (unique.length <= 2) return unique.join(" & ");
  return `${unique.slice(0, 2).join(", ")} +${unique.length - 2}`;
};

/** Everything since `since`, folded into a few friendly lines (most important first). */
export function recap(since: number, waitingApproval: boolean): RecapLine[] {
  const got = entries.filter((e) => e.at >= since);
  const of = (k: JournalKind) => got.filter((e) => e.kind === k);
  const lines: RecapLine[] = [];

  if (waitingApproval) {
    lines.push({ emoji: "⏳", text: "Claude is waiting for your permission", tone: "bad" });
  }
  const missed = of("approvalMissed");
  if (missed.length) {
    lines.push({ emoji: "🖥️", text: `${plural(missed.length, "permission request", "permission requests")} went to the terminal`, tone: "info" });
  }
  const questions = of("question");
  if (questions.length) {
    const q = questions[questions.length - 1];
    lines.push({ emoji: "❓", text: questions.length === 1 ? `Asked: ${q.text}` : `${questions.length} questions are waiting in the terminal`, tone: "bad" });
  }
  const errors = of("error");
  if (errors.length) {
    lines.push({ emoji: "⚠️", text: `${plural(errors.length, "session", "sessions")} stopped on an error · ${names(errors.map((e) => e.who))}`, tone: "bad" });
  }
  const finished = of("finished");
  if (finished.length) {
    lines.push({ emoji: "✅", text: `${plural(finished.length, "session", "sessions")} finished · ${names(finished.map((e) => e.who))}`, tone: "good" });
  }
  const fails = of("testFail");
  const passes = of("testPass");
  if (fails.length || passes.length) {
    const last = [...fails, ...passes].sort((a, b) => b.at - a.at)[0];
    const green = last.kind === "testPass";
    lines.push({
      emoji: green ? "🧪" : "🔴",
      text: green
        ? `Tests are green${last.text ? ` · ${last.text}` : ""}${fails.length ? ` (after ${plural(fails.length, "red run", "red runs")})` : ""}`
        : `Tests are failing${last.text ? ` · ${last.text}` : ""}`,
      tone: green ? "good" : "bad",
    });
  }
  // Integrations: the latest word from each.
  const byService = new Map<string, JournalEntry>();
  for (const e of got) if (e.kind === "integrationOk" || e.kind === "integrationFail") byService.set(e.who, e);
  for (const e of byService.values()) {
    const count = got.filter((x) => x.who === e.who && (x.kind === "integrationOk" || x.kind === "integrationFail")).length;
    lines.push({
      emoji: e.kind === "integrationFail" ? "🔻" : "🔔",
      text: `${e.who}: ${e.text}${count > 1 ? ` (+${count - 1} more)` : ""}`,
      tone: e.kind === "integrationFail" ? "bad" : "info",
    });
  }
  const limit = of("limit").at(-1);
  if (limit) lines.push({ emoji: "💤", text: limit.text || "Hit the usage limit", tone: "info" });

  return lines;
}

/** "42 min", "1 h 05", "3 h". */
export function awayLabel(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}
