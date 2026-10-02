// Dev playground — a control panel under the island for `npm run dev`.
//
// Loaded only when `import.meta.env.DEV` is true and the page is a plain browser
// (see main.ts), so it never ships. Every button drives the island through the
// same entry points the app uses: hook events go through `emitLocal("hook")`,
// integration updates through `emitLocal("integration")`, so what you see here
// is what a real Claude Code session would produce.
//
//   ?play=0   hides the panel (the island alone, centred like before)
//   ?mock=0   turns the mock bridge off

import { emitLocal } from "../core/bridge";
import type { BotEmoteName, BotStateName, IslandViewName } from "../core/layout";
import { State } from "../core/state";
import { awardXp, growthStore, randomOutfit } from "../mochi/growth";
import { readMusicPrefs, writeMusicPrefs } from "../music/prefs";
import { OCCASIONS, occasionOverride, type OccasionId } from "../mochi/occasions";
import type { Island } from "../island/island";
import { mockUsage } from "../core/devmock";

const CWD = "C:\\code\\my-assistance";

const EMOTES: BotEmoteName[] = [
  "love", "giggle", "shy", "purr", "excited", "celebrate", "dance", "whistle", "curious",
  "sneeze", "spin", "stretch", "hop", "lookAround", "wink", "proud", "surprised", "pout",
  "annoyed", "yawn", "sleepy", "happy",
  "faint", "nod", "headShake", "flip", "juggle", "bubbleGum", "hiccup", "kiss", "jelly",
  "peekaboo", "shiver",
];

const STATES: BotStateName[] = [
  "idle", "working", "thinking", "searching", "approval", "question", "error",
  "finished", "ratelimit", "sleeping", "dizzy",
];

const VIEWS: IslandViewName[] = [
  "overview", "empty", "project", "prompt", "settings", "approval", "question",
  "finished", "error", "confused", "note", "choose",
];

const CSS = `
  html, body { background:
    radial-gradient(1200px 600px at 20% 10%, #3b4a7a 0%, transparent 60%),
    radial-gradient(900px 500px at 90% 30%, #6b3d6e 0%, transparent 55%),
    linear-gradient(160deg, #1d2440, #2b2140) !important; }
  #root { right: auto !important; bottom: auto !important; width: 720px; height: 320px; }
  #dev-play { position: fixed; left: 0; top: 330px; width: 720px; max-height: calc(100vh - 340px);
    overflow: auto; padding: 0 16px 24px; font: 12px/1.4 system-ui, sans-serif; color: #dfe3ec;
    display: grid; gap: 10px; user-select: none; }
  #dev-play h3 { font: 600 10.5px system-ui; letter-spacing: .12em; text-transform: uppercase;
    color: #9aa3b8; margin: 4px 0 6px; }
  #dev-play .grp { display: flex; flex-wrap: wrap; gap: 5px; }
  #dev-play button { font: 500 11.5px system-ui; color: #eef1f7; cursor: pointer;
    background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.1);
    border-radius: 999px; padding: 4px 10px; transition: background .15s, transform .1s; }
  #dev-play button:hover { background: rgba(255,255,255,.16); }
  #dev-play button:active { transform: scale(.95); }
  #dev-play .hint { color: #8d96aa; }
`;

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
const hook = (payload: Record<string, unknown>) => emitLocal("hook", { cwd: CWD, session_id: "dev", ...payload });

let running = 0;

const playStation = (station: string) => emitLocal("music-command", { action: "play", station, reason: "manual" });

async function session() {
  const token = ++running;
  const steps: Record<string, unknown>[] = [
    { hook_event_name: "SessionStart" },
    { hook_event_name: "UserPromptSubmit", prompt: "Polish the island and give Mochi more moods" },
    { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "src/style.css" } },
    { hook_event_name: "PreToolUse", tool_name: "Grep", tool_input: { pattern: "card", path: "src/views" } },
    { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "src/mochi/engine.ts" } },
    { hook_event_name: "SubagentStart", agent_id: "a1", agent_type: "Explore" },
    { hook_event_name: "SubagentStart", agent_id: "a2", agent_type: "Plan" },
    { hook_event_name: "PreToolUse", tool_name: "WebFetch", tool_input: { url: "https://code.claude.com/docs" } },
    { hook_event_name: "SubagentStop", agent_id: "a1" },
    { hook_event_name: "PreToolUse", tool_name: "TodoWrite", tool_input: {} },
    { hook_event_name: "SubagentStop", agent_id: "a2" },
    { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test" } },
    { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "npm test" }, test_outcome: "pass", test_summary: "24 passed" },
    { hook_event_name: "Stop", message: "Done — 6 files polished and the build is green ✨" },
  ];
  for (const step of steps) {
    if (token !== running) return;
    hook(step);
    await sleep(1500);
  }
}

function integration(id: string, success: boolean) {
  const now = new Date().toISOString();
  const data: Record<string, Record<string, unknown>> = {
    integration_vercel: {
      deployments: [
        { projectName: "my-assistance", state: success ? "READY" : "ERROR", createdAt: now, branch: "main", commitMessage: "Polish the island", url: "my-assistance.vercel.app" },
        { projectName: "portfolio", state: "READY", createdAt: new Date(Date.now() - 7_200_000).toISOString() },
      ],
    },
    integration_github: {
      login: "NimaM048", totalStars: 86, totalRepos: 14,
      repositories: [{ name: "my-assistance", stars: 42 }, { name: "shop-api", stars: 17 }],
    },
    integration_resend: {
      total: 128,
      emails: [
        { to: ["sara@example.com"], subject: "Your invoice for October", lastEvent: "delivered", createdAt: now },
        { to: ["team@example.com"], subject: "Weekly digest", lastEvent: success ? "delivered" : "bounced", createdAt: now },
      ],
    },
  };
  emitLocal("integration", {
    id,
    data: data[id] ?? {},
    error: null,
    event: { success, label: success ? "Deployed to production" : "Build failed", detail: success ? "my-assistance · 42 s" : "Type error in src/main.ts" },
  });
}

export function mountPlayground(island: Island) {
  const params = new URLSearchParams(location.search);
  // Handy from the console as well: coucou.react("dance"), coucou.view("prompt")…
  const api = {
    island,
    State,
    react: (e: BotEmoteName) => island.react(e),
    view: (v: IslandViewName) => island.setView(v),
    hook,
    integration,
  };
  (window as unknown as { coucou: typeof api }).coucou = api;
  if (params.get("play") === "0") return;

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);

  const panel = document.createElement("div");
  panel.id = "dev-play";
  const group = (title: string, buttons: [string, () => void][], hint?: string) => {
    const box = document.createElement("div");
    const h = document.createElement("h3");
    h.textContent = title;
    const row = document.createElement("div");
    row.className = "grp";
    for (const [label, fn] of buttons) {
      const b = document.createElement("button");
      b.textContent = label;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        fn();
      });
      row.append(b);
    }
    box.append(h, row);
    if (hint) {
      const p = document.createElement("div");
      p.className = "hint";
      p.textContent = hint;
      box.append(p);
    }
    return box;
  };

  const setState = (s: BotStateName) => {
    State.stateOverride = s === "idle" ? null : s;
    State.notify();
  };

  panel.append(
    group("Island", [
      ["Greeting", () => location.reload()],
      ["Peek", () => { island.fsm.forceHidden(); window.setTimeout(() => island.reveal(), 500); }],
      ["Open", () => island.alert(State.defaultView())],
      ["Collapse", () => island.collapse()],
      ["Hide", () => island.fsm.forceHidden()],
    ], "Move the mouse over the island to keep it open; rub Mochi back and forth to pet it."),
    group("Mochi at work", [
      ["📖 Read", () => hook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "src/main.ts" } })],
      ["🔍 Grep", () => hook({ hook_event_name: "PreToolUse", tool_name: "Grep", tool_input: { pattern: "Mochi" } })],
      ["🔨 Edit", () => hook({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "src/style.css" } })],
      ["💻 Bash", () => hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm run build" } })],
      ["🌍 Web", () => hook({ hook_event_name: "PreToolUse", tool_name: "WebSearch", tool_input: { query: "tauri tray" } })],
      ["📋 Todo", () => hook({ hook_event_name: "PreToolUse", tool_name: "TodoWrite", tool_input: {} })],
      ["Tool done", () => hook({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: {} })],
      ["🧪 Tests ✓", () => hook({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "npm test" }, test_outcome: "pass", test_summary: "24 passed" })],
      ["🧪 Tests ✗", () => hook({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "npm test" }, test_outcome: "fail", test_summary: "2 failed, 22 passed" })],
      ["+ Subagent", () => hook({ hook_event_name: "SubagentStart", agent_id: `s${Date.now()}`, agent_type: "Explore" })],
      ["✓ Subagent", () => hook({ hook_event_name: "SubagentStop" })],
      ["AskUserQuestion", () => hook({ hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "Which database should we use?" }] } })],
      ["API error", () => hook({ hook_event_name: "StopFailure", error: "server_error", error_details: "Overloaded" })],
    ], "Props show while the Claude Code pill is focused and working."),
    group("Usage & limits", [
      ["Usage 66%", () => { mockUsage.level = 0.66; mockUsage.limit = false; island.refreshUsage(); }],
      ["Tired 95%", () => { mockUsage.level = 0.95; mockUsage.limit = false; island.refreshUsage(); }],
      ["💤 Hit limit", () => { mockUsage.limit = true; island.refreshUsage(); }],
      ["Notification limit", () => hook({ hook_event_name: "Notification", message: "Claude usage limit reached · resets 11pm" })],
      ["Usage view", () => island.setView("usage")],
    ]),
    group("Weather", [
      ["🌧 Rain", () => emitLocal("weather", { code: 63, temperature: 12, feelsLike: 10, isDay: true, wind: 12, city: "Tehran" })],
      ["❄️ Snow", () => emitLocal("weather", { code: 73, temperature: -2, feelsLike: -6, isDay: true, wind: 8, city: "Tabriz" })],
      ["🥶 Cold", () => emitLocal("weather", { code: 2, temperature: 3, feelsLike: 0, isDay: true, wind: 20, city: "Toronto" })],
      ["😎 Hot", () => emitLocal("weather", { code: 0, temperature: 33, feelsLike: 35, isDay: true, wind: 5, city: "Ahvaz" })],
      ["⛈ Storm", () => emitLocal("weather", { code: 95, temperature: 18, feelsLike: 18, isDay: true, wind: 40, city: "Rasht" })],
      ["Off", () => emitLocal("weather", null)],
    ], "Rust sends this every half hour when Settings → Weather is on."),
    group("While you were away", [
      ["Lock 25 min (busy)", () => {
        const since = Date.now() - 25 * 60_000;
        hook({ hook_event_name: "Stop", message: "Refactored the poller" });
        hook({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "npm test" }, test_outcome: "fail", test_summary: "1 failed" });
        integration("integration_vercel", false);
        window.setTimeout(() => emitLocal("presence", { kind: "back", since, awayMs: 25 * 60_000 }), 600);
      }],
      ["Lock 40 min (quiet)", () => emitLocal("presence", { kind: "back", since: Date.now(), awayMs: 40 * 60_000 })],
    ], "Windows reports the lock and unlock; Mochi sums up what happened in between."),
    group("Claude Code session", [
      ["▶ Run a session", () => void session()],
      ["Permission request", () => hook({ hook_event_name: "PermissionRequest", request_id: `dev-${Date.now()}`, tool_name: "Bash", tool_input: { command: "npm install --save-dev vitest" } })],
      ["Question", () => hook({ hook_event_name: "Notification", message: "Should I also update the README?" })],
      ["Finished", () => hook({ hook_event_name: "Stop", message: "All done — tests pass 🎉" })],
      ["Error", () => hook({ hook_event_name: "StopFailure" })],
      ["Rate limit", () => hook({ hook_event_name: "Notification", message: "Rate limit reached" })],
      ["End session", () => { running++; hook({ hook_event_name: "SessionEnd" }); }],
    ]),
    group("Music", [
      ["🫧 Bounce", () => playStation("bounce")],
      ["🌙 Lo-fi", () => playStation("lofi")],
      ["🎮 Chiptune", () => playStation("chiptune")],
      ["🎠 Music box", () => playStation("musicbox")],
      ["🌧 Rain", () => playStation("rain")],
      ["🏮 Tehran", () => playStation("tehran")],
      ["🏝️ Island", () => playStation("island")],
      ["🌆 Neon", () => playStation("neon")],
      ["🌸 Sakura", () => playStation("sakura")],
      ["🎷 Jazz", () => playStation("jazz")],
      ["🪐 Space", () => playStation("space")],
      ["💃 Bandari", () => playStation("bandari")],
      ["■ Stop", () => emitLocal("music-command", { action: "stop" })],
      ["⚡ Tool storm", () => { for (let i = 0; i < 14; i++) island.toolActivity(); }],
      ["🎵 Finale", () => island["music"]?.engine.finale()],
      ["🌧☕ Ambience", () => writeMusicPrefs({ ambienceOn: !readMusicPrefs().ambienceOn })],
      ["Jingle ✓", () => emitLocal("music-command", { action: "jingle", kind: "finish" })],
      ["Jingle ✗", () => emitLocal("music-command", { action: "jingle", kind: "error" })],
    ], "A running session plays work music on its own (Settings → Music in the Hub to change it)."),
    group("Mochi grows", [
      ["+50 XP", () => awardXp(50, "task")],
      ["+400 XP", () => awardXp(400, "focus")],
      ["Random outfit", () => growthStore.write({ equipped: randomOutfit() })],
      ["Reset growth", () => growthStore.write({ xp: 0, equipped: { hat: "sprout" }, rewarded: [], log: [], celebratedLevel: 1 })],
    ], "Outfits and level-ups are shared with the Hub (open hub.html in another tab)."),
    group("Care", [
      ["👀 Eyes", () => island.care?.show("eyes")],
      ["💧 Water", () => island.care?.show("water")],
      ["🙆 Stretch", () => island.care?.show("stretch")],
      ["🌙 Review", () => island.care?.show("review")],
    ], "Health reminders normally come on their own, only while you're active."),
    group("Occasions", [
      ...(Object.keys(OCCASIONS) as OccasionId[]).map((id): [string, () => void] => [`${OCCASIONS[id].emoji} ${id}`, () => occasionOverride.write({ id })]),
      ["Normal day", () => occasionOverride.write({ id: null })],
    ], "Pretend today is an occasion — the island, the Hub and Settings all follow."),
    group("Integrations", [
      ["Vercel ✓", () => integration("integration_vercel", true)],
      ["Vercel ✗", () => integration("integration_vercel", false)],
      ["GitHub", () => integration("integration_github", true)],
      ["Resend", () => integration("integration_resend", true)],
    ]),
    group("Views", VIEWS.map((v) => [v, () => {
      if (v === "choose") State.droppedFile = { name: "quarterly-report.pdf", path: "C:\\Users\\you\\Downloads\\quarterly-report.pdf" };
      if (v === "note") State.noteMessage = "Couldn't reach Codex — check your connection.";
      island.setView(v);
    }])),
    group("Mochi moods", EMOTES.map((e) => [e, () => island.react(e)])),
    group("Mochi states", STATES.map((s) => [s, () => setState(s)])),
  );
  document.body.append(panel);
}
