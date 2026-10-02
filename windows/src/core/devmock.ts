// Development-only stand-ins for the Rust commands.
//
// Loaded by bridge.ts only when `import.meta.env.DEV` is true and the page runs
// in a plain browser, so none of this reaches the installer. The data is made up
// but shaped exactly like the real responses, which keeps every screen —
// island, settings and Hub — reviewable with `npm run dev` alone.

import type {
  BootInfo, DroppedFile, GitHubCatalog, GitHubWorkQueue, HookPreview, HookStatus,
  ProjectSearchHit, ProjectStatus, SearchProject,
} from "./bridge";
import { DEFAULT_SETTINGS, type Settings } from "./state";

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

let settings: Settings = { ...DEFAULT_SETTINGS, hooksInstalled: true };
const secrets = new Set(["github-token", "vercel-token", "resend-api-key"]);

const REPLIES = [
  "Here's the short version: the change moves the polling into Rust, so the island no longer wakes up while it's hidden. Nothing else in the behaviour changes.",
  "Looks good to me! One small thing — the error branch doesn't reset the badge, so a failed run keeps its red dot after the retry succeeds.",
  "Sure. Three steps: install the hooks from Settings, open a new Claude Code session, then watch me light up when it starts working. ✨",
  "I checked the diff: 4 files, mostly CSS. The only risky part is the new timer in island.ts — it needs clearing when the island hides.",
];

function projectStatus(cwd: string): ProjectStatus {
  const name = cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? "my-assistance";
  return {
    projectName: name,
    path: cwd,
    branch: "feature/polish-ui",
    changedFiles: 6,
    changedPaths: ["src/style.css", "src/mochi/engine.ts", "src/views/views.ts"],
    stagedFiles: 2,
    unstagedFiles: 3,
    untrackedFiles: 1,
    lastCommit: "feat: add project hub and Codex integration",
    lastCommitAt: Date.now() - 3 * 3_600_000,
    githubRepo: "NimaM048/my-assistance",
    issues: [
      { number: 12, title: "Mochi should celebrate when a long task finishes", url: "https://github.com", state: "open" },
      { number: 9, title: "Hub: remember the last opened page", url: "https://github.com", state: "open" },
    ],
    pullRequests: [
      { number: 14, title: "Polish the island and give Mochi more moods", url: "https://github.com", state: "open" },
    ],
    githubError: null,
    error: null,
  };
}

const CATALOG: GitHubCatalog = {
  login: "NimaM048",
  repositories: [
    ["my-assistance", "A cute companion that lives at the top of the screen.", "TypeScript", 42, 6, 2, false, "C:\\code\\my-assistance"],
    ["dotfiles", "Terminal, editor and shell setup.", "Shell", 8, 1, 30, false, null],
    ["shop-api", "Orders, payments and webhooks for the store.", "Python", 17, 3, 6, true, "C:\\code\\shop-api"],
    ["portfolio", "Personal site — fast, tiny and bilingual.", "HTML", 5, 0, 70, false, null],
    ["rust-playground", "Small experiments while learning Rust.", "Rust", 3, 0, 120, false, null],
    ["n8n-flows", "Automations for invoices and reminders.", "JavaScript", 11, 2, 18, true, null],
  ].map(([name, description, language, stars, forks, hours, isPrivate, localPath]) => ({
    fullName: `NimaM048/${name}`,
    name: String(name),
    description: String(description),
    htmlUrl: `https://github.com/NimaM048/${name}`,
    cloneUrl: `https://github.com/NimaM048/${name}.git`,
    private: Boolean(isPrivate),
    fork: false,
    archived: false,
    language: String(language),
    stars: Number(stars),
    forks: Number(forks),
    updatedAt: hoursAgo(Number(hours)),
    localPath: localPath as string | null,
  })),
};

const QUEUE: GitHubWorkQueue = {
  warning: null,
  items: [
    { id: "q1", number: 14, title: "Polish the island and give Mochi more moods", repository: "NimaM048/my-assistance", kind: "review", htmlUrl: "https://github.com", createdAt: hoursAgo(5), updatedAt: hoursAgo(1), labels: ["ui", "design"], comments: 3, draft: false },
    { id: "q2", number: 12, title: "Mochi should celebrate when a long task finishes", repository: "NimaM048/my-assistance", kind: "issue", htmlUrl: "https://github.com", createdAt: hoursAgo(26), updatedAt: hoursAgo(4), labels: ["enhancement"], comments: 1, draft: false },
    { id: "q3", number: 31, title: "Retry Stripe webhooks with backoff", repository: "NimaM048/shop-api", kind: "pullRequest", htmlUrl: "https://github.com", createdAt: hoursAgo(50), updatedAt: hoursAgo(9), labels: ["backend"], comments: 0, draft: true },
  ],
};

/** Answers one command the way the Rust side would. Unknown commands are no-ops. */
export async function mockCommand(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (cmd) {
    case "boot":
      return {
        settings,
        screen: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
        version: "0.1.1-dev",
        hookPath: "C:\\Users\\you\\AppData\\Local\\Coucou\\bin\\coucou-hook.exe",
      } satisfies BootInfo;
    case "save_settings":
      settings = { ...settings, ...(args.settings as Settings) };
      return null;
    case "hooks_status":
      return {
        installed: settings.hooksInstalled,
        settingsPath: "C:\\Users\\you\\.claude\\settings.json",
        hookPath: "C:\\Users\\you\\AppData\\Local\\Coucou\\bin\\coucou-hook.exe",
        hookReady: true,
      } satisfies HookStatus;
    case "hooks_preview":
      await wait(250);
      return {
        diff: ' {\n   "hooks": {\n+    "PreToolUse": [{ "hooks": [{ "command": "coucou-hook.exe" }] }],\n+    "Stop": [{ "hooks": [{ "command": "coucou-hook.exe" }] }]\n   }\n }',
        backup: "settings.json.coucou-backup-2026-10-02",
        settingsPath: "C:\\Users\\you\\.claude\\settings.json",
        fingerprint: "dev",
      } satisfies HookPreview;
    case "hooks_apply":
      await wait(400);
      settings.hooksInstalled = Boolean(args.install);
      return "settings.json.coucou-backup-2026-10-02";
    case "secret_present":
      return secrets.has(String(args.key));
    case "secret_set":
      await wait(200);
      if (String(args.value ?? "")) secrets.add(String(args.key));
      else secrets.delete(String(args.key));
      return null;
    case "secret_clear":
      secrets.delete(String(args.key));
      return null;
    case "chat_send":
      await wait(1400 + Math.random() * 900);
      return { text: REPLIES[Math.floor(Math.random() * REPLIES.length)] };
    case "ingest_file": {
      const path = String(args.path);
      await wait(120);
      return { name: path.split(/[\\/]/).pop() ?? "file", path, size: 48_213 } satisfies DroppedFile;
    }
    case "project_status":
    case "project_status_local":
      await wait(500);
      return projectStatus(String(args.cwd));
    case "hub_repositories":
      await wait(600);
      return CATALOG;
    case "hub_work_queue":
      await wait(500);
      return QUEUE;
    case "search_local_projects": {
      await wait(300);
      const query = String(args.query);
      const projects = (args.projects as SearchProject[]) ?? [];
      return projects.slice(0, 2).flatMap((p, i): ProjectSearchHit[] => [
        { project: p.name, path: `${p.path}\\src\\main.ts`, relativePath: "src/main.ts", line: 12 + i, preview: `const ${query} = await boot();`, kind: "content" },
        { project: p.name, path: `${p.path}\\README.md`, relativePath: "README.md", line: 1, preview: `# ${p.name}`, kind: "file" },
      ]);
    }
    case "show_plan_notification":
      return true;
    default:
      return null;
  }
}
