// Thin wrapper over the Tauri commands/events. Every call is a no-op when the
// page is opened in a plain browser, so the island can be iterated on with
// `npm run dev` alone.

import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { Settings } from "./state";

export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Browser-only stand-in for the Rust commands, so `npm run dev` shows the real
 * UI with believable data. `import.meta.env.DEV` is false in a production build,
 * which drops this branch and the mock module from the bundle entirely.
 * Add `?mock=0` to the URL to see the bare "not running inside Coucou" states.
 */
const USE_DEV_MOCK =
  import.meta.env.DEV && !IS_TAURI &&
  typeof location !== "undefined" && new URLSearchParams(location.search).get("mock") !== "0";

async function devMock<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { mockCommand } = await import("./devmock");
  return mockCommand(cmd, args) as Promise<T>;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (USE_DEV_MOCK) {
    try {
      return await devMock<T>(cmd, args);
    } catch {
      return null;
    }
  }
  if (!IS_TAURI) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    console.error(`[coucou] ${cmd} failed`, err);
    return null;
  }
}

export interface BootInfo {
  settings: Settings;
  /** Logical screen rect of the monitor the island lives on. */
  screen: { x: number; y: number; width: number; height: number; scale: number };
  version: string;
  hookPath: string;
}

export const Bridge = {
  boot: () => call<BootInfo>("boot"),

  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),

  /** Shrink the window down to the invisible wake strip (hidden) or back to full. */
  setCollapsed: (collapsed: boolean) => call<void>("set_collapsed", { collapsed }),

  /**
   * Pushes the island shape in window coordinates. Rust flips click-through from
   * its own cursor poll, so the flag is never a frame behind a click.
   */
  setIslandRect: (x: number, y: number, width: number, height: number) =>
    call<void>("set_island_rect", { x, y, width, height }),

  /** Give the window keyboard focus (chat field) and take it away again. */
  focusWindow: (focused: boolean) => call<void>("focus_window", { focused }),

  reposition: () => call<void>("reposition"),

  openUrl: (url: string) => call<void>("open_url", { url }),

  /** "Open terminal" → opens the folder in VS Code when `code` is on PATH. */
  openInVSCode: (path: string | null) => call<boolean>("open_in_vscode", { path }),

  quit: () => call<void>("quit_app"),

  openSettingsWindow: () => call<void>("open_settings_window"),
  openHubWindow: () => call<void>("open_hub_window"),
  planNotification: (title: string, body: string) => call<boolean>("show_plan_notification", { title, body }),
  hubRepositories: () => callOrThrow<GitHubCatalog>("hub_repositories"),
  hubWorkQueue: () => callOrThrow<GitHubWorkQueue>("hub_work_queue"),
  projectStatusLocal: (cwd: string) => callOrThrow<ProjectStatus>("project_status_local", { cwd }),
  searchLocalProjects: (projects: SearchProject[], query: string) => callOrThrow<ProjectSearchHit[]>("search_local_projects", { projects, query }),
  openProjectFile: (path: string, line: number) => call<boolean>("open_project_file", { path, line }),

  /** Writes to %LOCALAPPDATA%\Coucou\coucou.log, next to the Rust lines. */
  log: (message: string) => call<void>("log_line", { message }),

  // ── Claude Code hooks ─────────────────────────────────────────────────────
  hooksStatus: () => call<HookStatus>("hooks_status"),
  /** Diff to show before anything is written. `install: false` previews removal. */
  hooksPreview: (install: boolean) => callOrThrow<HookPreview>("hooks_preview", { install }),
  /**
   * Writes ~/.claude/settings.json — only ever after an explicit click, and only
   * when the file still matches the preview the user looked at.
   */
  hooksApply: (install: boolean, fingerprint: string) =>
    callOrThrow<string>("hooks_apply", { install, fingerprint }),

  approvalDecision: (requestId: string, decision: "allow" | "deny") =>
    call<void>("approval_decision", { requestId, decision }),
  /** "The card is up" — until this lands the relay only waits a moment. */
  approvalAck: (requestId: string) => call<void>("approval_ack", { requestId }),
  /** "Nobody can act on this" — Claude Code asks in the terminal right away. */
  approvalDecline: (requestId: string) => call<void>("approval_decline", { requestId }),

  // ── Chat, files, secrets ──────────────────────────────────────────────────
  /** One chat turn. The API key and any file bytes never leave Rust. */
  chatSend: (query: string, context: ChatContext | null, cwd: string | null) =>
    callOrThrow<{ text: string }>("chat_send", { query, context, cwd }),
  chatReset: () => call<void>("chat_reset"),
  /** Copies a dropped file into the inbox. */
  ingestFile: (path: string) => callOrThrow<DroppedFile>("ingest_file", { path }),
  /** Only ever tells you whether a key exists — never its value. */
  secretPresent: (key: string) => call<boolean>("secret_present", { key }),
  secretSet: (key: string, value: string) => callOrThrow<void>("secret_set", { key, value }),
  secretClear: (key: string) => callOrThrow<void>("secret_clear", { key }),

  // ── Integrations ──────────────────────────────────────────────────────────
  refreshIntegration: (id: string) => call<void>("refresh_integration", { id }),
  projectStatus: (cwd: string) => callOrThrow<ProjectStatus>("project_status", { cwd }),
  /** Opens the configured n8n instance in the browser. */
  openN8n: () => call<void>("open_n8n"),

  /** Tray → Pause. Stops the integration pollers, not just the island. */
  setPaused: (paused: boolean) => call<void>("set_paused", { paused }),
};

export interface IntegrationUpdate {
  id: string;
  data: Record<string, unknown>;
  error: string | null;
  event: { success: boolean; label: string; detail: string | null } | null;
}

export type ChatContext =
  | { kind: "file"; name: string; path: string }
  | { kind: "window"; appName: string; title: string; url?: string };

export interface DroppedFile {
  name: string;
  path: string;
  size: number;
}

export interface ProjectStatus {
  projectName: string;
  path: string;
  branch: string | null;
  changedFiles: number;
  changedPaths: string[];
  stagedFiles: number;
  unstagedFiles: number;
  untrackedFiles: number;
  lastCommit: string | null;
  lastCommitAt: number | null;
  /** Commits since midnight (older app versions don't send it). */
  commitsToday?: number;
  githubRepo: string | null;
  issues: ProjectItem[];
  pullRequests: ProjectItem[];
  githubError: string | null;
  error: string | null;
}

export interface SearchProject { name: string; path: string }
export interface ProjectSearchHit { project: string; path: string; relativePath: string; line: number; preview: string; kind: "file" | "content" }

export interface ProjectItem {
  number: number;
  title: string;
  url: string;
  state: string;
}

export interface GitHubCatalog {
  login: string;
  repositories: GitHubRepository[];
}

export interface GitHubRepository {
  fullName: string;
  name: string;
  description: string | null;
  htmlUrl: string;
  cloneUrl: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  language: string | null;
  stars: number;
  forks: number;
  updatedAt: string;
  localPath: string | null;
}

export interface GitHubWorkQueue {
  items: GitHubWorkItem[];
  warning: string | null;
}

export interface GitHubWorkItem {
  id: string;
  number: number;
  title: string;
  repository: string;
  kind: "issue" | "pullRequest" | "review";
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  labels: string[];
  comments: number;
  draft: boolean;
}

export interface HookStatus {
  installed: boolean;
  settingsPath: string;
  hookPath: string;
  hookReady: boolean;
}

export interface HookPreview {
  diff: string;
  backup: string;
  settingsPath: string;
  /** Hand back to hooksApply so only the reviewed diff is ever written. */
  fingerprint: string;
}

/** Same as `call`, but surfaces the error so the UI can show what went wrong. */
async function callOrThrow<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (USE_DEV_MOCK) return devMock<T>(cmd, args);
  if (!IS_TAURI) throw new Error("not running inside Coucou");
  return invoke<T>(cmd, args);
}

export type BridgeEvent =
  | { name: "cursor"; payload: { x: number; y: number } }
  | { name: "tray"; payload: string }
  | { name: "hook"; payload: Record<string, unknown> }
  | { name: "screen-changed"; payload: null };

export interface DragDropPayload {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
}

/** Files dragged onto the island. Only reaches us when the window takes the mouse. */
export async function onDragDrop(handler: (e: DragDropPayload) => void) {
  if (!IS_TAURI) return () => {};
  return getCurrentWebview().onDragDropEvent((event) => {
    handler(event.payload as DragDropPayload);
  });
}

/**
 * In a plain browser there is no Rust side to emit events, so handlers are kept
 * here and `emitLocal` can play the part — the dev playground uses it to drive
 * the island through exactly the code paths a real hook event takes.
 */
const localHandlers = new Map<string, Set<(payload: unknown) => void>>();

export function emitLocal(name: string, payload: unknown) {
  for (const fn of localHandlers.get(name) ?? []) fn(payload);
}

/**
 * Sends an event to every Coucou window (island, Hub, settings) — used for the
 * music player, which lives in the island and is driven from the Hub. In a
 * plain browser it stays inside the page.
 */
export function broadcast(name: string, payload: unknown) {
  if (!IS_TAURI) {
    emitLocal(name, payload);
    return;
  }
  void emit(name, payload).catch((err) => console.error(`[coucou] broadcast ${name} failed`, err));
}

export async function onEvent<T>(name: string, handler: (payload: T) => void) {
  if (!IS_TAURI) {
    const set = localHandlers.get(name) ?? new Set();
    const fn = handler as (payload: unknown) => void;
    set.add(fn);
    localHandlers.set(name, set);
    return () => void set.delete(fn);
  }
  return listen<T>(name, (e) => handler(e.payload));
}
