// Claude Code hook events → island state.
// Port of HookServer.processEvent / processPermissionRequest from the macOS app.
// Difference from macOS: no terminal filter. On Windows the hook fires from any
// terminal (Windows Terminal, VS Code, PowerShell…) and all of them are handled.

import { Bridge, onEvent } from "../core/bridge";
import { captureHandoff } from "../core/handoff";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import type { Island } from "./island";
import { XP, awardXp } from "../mochi/growth";
import { markActive } from "../core/activity";
import { countAgentSession } from "../core/review";
import { record } from "../core/journal";

/** A finished agent session earns Mochi a little XP (capped per day). */
const rewardAgent = () => {
  countAgentSession();
  return awardXp(XP.agentSession, "agent", { capGroup: "agent", dailyCap: XP.agentDailyCap });
};

const CLAUDE_ID = "integration_claude";

/** Clears the approval card if no decision was made before the hook gave up. */
let pendingTimeout: number | null = null;
const completedCodexTurns = new Set<string>();
const promptsBySession = new Map<string, string>();

interface HookPayload {
  hook_event_name?: string;
  agent_source?: "codex";
  request_id?: string;
  session_id?: string;
  turn_id?: string;
  cwd?: string;
  message?: string;
  last_assistant_message?: string | null;
  /** UserPromptSubmit carries `prompt`; `message` belongs to Notification/Stop. */
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  /** Notification: "permission_prompt", "idle_prompt", "elicitation_dialog"… */
  notification_type?: string;
  /** StopFailure: what went wrong ("rate_limit", "server_error"…) and how. */
  error?: string;
  error_details?: string;
  /** Added by coucou-hook to a finished test run: its verdict and a short count. */
  test_outcome?: "pass" | "fail";
  test_summary?: string;
  /** SubagentStart / SubagentStop. */
  agent_id?: string;
  agent_type?: string;
}

const PROJECT_ALIASES: Record<string, string> = {
  "notch-buddy": "Notch Buddy",
  notchbuddy: "Notch Buddy",
  notch_buddy: "Notch Buddy",
};

function aliasProjectName(name: string): string {
  return PROJECT_ALIASES[name.toLowerCase()] ?? name;
}

function lastPathComponent(p: string): string {
  const cleaned = p.replace(/[\\/]+$/, "");
  const idx = Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/"));
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

/** frenchStep() — same labels as the macOS app. */
const TOOL_LABELS: Record<string, string> = {
  Bash: "Exécute",
  Read: "Lit",
  Write: "Écrit",
  Edit: "Modifie",
  Glob: "Cherche",
  Grep: "Recherche",
  WebSearch: "Recherche web",
  WebFetch: "Récupère",
  TodoWrite: "Tâches",
  Task: "Agent",
  LS: "Liste",
  MultiEdit: "Modifie",
  NotebookEdit: "Notebook",
  PowerShell: "Exécute",
};

function stepLabel(tool: string, input: Record<string, unknown>): string {
  const label = TOOL_LABELS[tool] ?? tool;
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : null);
  const cmd = str("command");
  if (cmd) return `${label} · ${cmd.slice(0, 40)}`;
  const path = str("path");
  if (path) return `${label} · ${lastPathComponent(path)}`;
  const file = str("file_path");
  if (file) return `${label} · ${lastPathComponent(file)}`;
  const query = str("query");
  if (query) return `${label} · ${query.slice(0, 40)}`;
  return label;
}

/**
 * What the Allow button actually authorises. Approving "Write" tells you nothing
 * — approving `Write · C:\…\.env` tells you everything, and the difference is
 * the whole point of approving from the island rather than blind.
 *
 * Ordered by how specific the field is, so an unfamiliar tool still shows
 * whatever identifying string it carries instead of falling back to its name.
 */
const APPROVAL_FIELDS = [
  "command", // Bash, PowerShell
  "file_path", // Write, Edit, MultiEdit, NotebookEdit
  "path", // Read, LS
  "url", // WebFetch
  "query", // WebSearch
  "pattern", // Glob, Grep
  "prompt", // Task
] as const;

function approvalTarget(tool: string, input: Record<string, unknown>): string {
  for (const field of APPROVAL_FIELDS) {
    const value = input[field];
    if (typeof value === "string" && value.trim()) {
      return `${tool} · ${value.trim()}`;
    }
  }
  return tool;
}

function upsert(projectName: string, cwd: string, source: "claudeCode" | "codex") {
  const t = State.tasks.find((x) => x.id === CLAUDE_ID);
  if (!t) return;
  t.name = projectName;
  t.source = source;
  if (cwd) {
    t.sessionCwd = cwd;
    State.activeProjectCwd = cwd;
  }
}

function clearSession() {
  const t = State.tasks.find((x) => x.id === CLAUDE_ID);
  if (!t) return;
  t.steps = [];
  t.stepIndex = 0;
  t.name = "VS Code";
  t.source = "claudeCode";
  t.pillBadge = null;
}

function sessionKey(payload: HookPayload, cwd: string): string {
  return payload.session_id || cwd.replace(/\\/g, "/").toLowerCase();
}

function saveCompletedHandoff(payload: HookPayload, cwd: string, response: string) {
  const projectPath = cwd || State.activeProjectCwd || "";
  const prompt = promptsBySession.get(sessionKey(payload, projectPath)) ?? payload.prompt ?? "";
  promptsBySession.delete(sessionKey(payload, projectPath));
  void captureHandoff(projectPath, prompt, response).then((handoff) => {
    if (handoff) State.notify();
  }).catch((error) => console.error("[coucou] could not save project handoff", error));
}

/** "rate_limit" + details → one readable line for the error card. */
const STOP_FAILURES: Record<string, string> = {
  rate_limit: "Usage limit reached.",
  authentication_failed: "Claude Code couldn't sign in.",
  billing_error: "There's a billing problem with the account.",
  invalid_request: "Claude Code sent a request the API refused.",
  server_error: "Anthropic's servers had a problem.",
  max_output_tokens: "The reply hit its length limit.",
};

function stopFailureDetail(payload: HookPayload): string {
  const kind = payload.error ?? "";
  const known = STOP_FAILURES[kind] ?? (kind ? kind.replace(/_/g, " ") : "");
  const extra = (payload.error_details ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const line = [known, extra].filter(Boolean).join(" — ");
  return `⚠ ${line || "Claude Code stopped on an API error."}`;
}

/** AskUserQuestion carries its questions in `questions[].question`. */
function firstQuestion(input: Record<string, unknown>): string | null {
  const list = input.questions;
  if (Array.isArray(list)) {
    for (const q of list) {
      const text = q && typeof q === "object" ? (q as Record<string, unknown>).question : null;
      if (typeof text === "string" && text.trim()) return text.trim();
    }
  }
  return typeof input.question === "string" ? input.question : null;
}

export function registerHookHandlers(island: Island) {
  void onEvent<HookPayload>("hook", (payload) => handleHook(island, payload));
}

function handleHook(island: Island, payload: HookPayload) {
  // You're driving an agent: you're here.
  markActive();
  if (State.paused) {
    // Silence here used to cost Claude Code nearly two minutes: the relay waited
    // for a decision from an island that had already decided not to look. Say so,
    // and the terminal takes the question immediately.
    if (payload.request_id) void Bridge.approvalDecline(payload.request_id);
    return;
  }

  const name = payload.hook_event_name ?? "";
  const cwd = payload.cwd ?? "";
  const raw = lastPathComponent(cwd);
  const projectName = aliasProjectName(raw || "Session");
  const focused = State.focusId === CLAUDE_ID;

  /** Alerts force the island open; work events only reveal the compact island. */
  const surface = (view: Parameters<Island["alert"]>[0], isAlert: boolean) => {
    if (State.mode === "expanded") {
      if (isAlert) island.setView(view);
    } else if (isAlert) {
      island.alert(view);
    } else if (State.mode === "hidden") {
      island.reveal();
    }
  };

  /** Claude is waiting on you: the question card, or a badge-free reveal if another pill has the view. */
  const askQuestion = (text: string) => {
    island.stopTools();
    record("question", projectName, text.slice(0, 90));
    State.updateTask(CLAUDE_ID, "question");
    State.appendStep(CLAUDE_ID, text.replace(/\s+/g, " ").slice(0, 160));
    Sound.play("question");
    if (focused) surface("question", true);
    else island.reveal();
  };

  switch (name) {
    case "CodexProjectDetected":
      if (cwd) {
        State.activeProjectCwd = cwd;
        State.notify();
      }
      break;

    case "SessionStart":
      upsert(projectName, cwd, payload.agent_source === "codex" ? "codex" : "claudeCode");
      surface("overview", false);
      Sound.play("work");
      break;

    case "UserPromptSubmit": {
      upsert(projectName, cwd, payload.agent_source === "codex" ? "codex" : "claudeCode");
      State.updateTask(CLAUDE_ID, "thinking");
      // The field is `prompt`; reading `message` meant this step was always blank.
      const asked = payload.prompt ?? payload.message;
      if (asked) {
        promptsBySession.set(sessionKey(payload, cwd), asked);
        if (promptsBySession.size > 100) {
          const oldest = promptsBySession.keys().next().value;
          if (oldest) promptsBySession.delete(oldest);
        }
      }
      if (asked) State.appendStep(CLAUDE_ID, asked.slice(0, 60));
      surface("overview", false);
      break;
    }

    case "PreToolUse": {
      upsert(projectName, cwd, payload.agent_source === "codex" ? "codex" : "claudeCode");
      const tool = payload.tool_name ?? "Tool";
      if (tool === "AskUserQuestion") {
        askQuestion(firstQuestion(payload.tool_input ?? {}) ?? "Claude has a question for you.");
        break;
      }
      State.updateTask(CLAUDE_ID, "working");
      State.appendStep(CLAUDE_ID, stepLabel(tool, payload.tool_input ?? {}));
      island.toolActivity();
      island.toolStarted(tool);
      surface("overview", false);
      break;
    }

    case "PostToolUse":
    case "PostToolUseFailure": {
      State.updateTask(CLAUDE_ID, "working");
      island.toolEnded();
      // coucou-hook spotted a test run and kept only its verdict.
      if (payload.test_outcome) {
        const pass = payload.test_outcome === "pass";
        const summary = payload.test_summary ?? "";
        State.appendStep(CLAUDE_ID, `${pass ? "✓ Tests passed" : "✗ Tests failed"}${summary ? ` · ${summary}` : ""}`);
        record(pass ? "testPass" : "testFail", projectName, summary);
        island.testResult(pass);
        surface("overview", false);
      } else if (name === "PostToolUseFailure") {
        State.appendStep(CLAUDE_ID, "⚠ failed");
      }
      break;
    }

    case "Notification": {
      const message = payload.message ?? "";
      const lower = message.toLowerCase();
      const kind = payload.notification_type ?? "";
      if (lower.includes("rate limit") || lower.includes("usage limit") || lower.includes("limite d")) {
        State.updateTask(CLAUDE_ID, "ratelimit");
        Sound.play("rate");
        island.noteLimit(payload.agent_source === "codex" ? "codex" : "claude", message);
      } else if (kind === "elicitation_dialog" || (kind === "" && message.trim().endsWith("?"))) {
        // A real question for you. Claude Code's own notifications ("Claude is
        // waiting for your input") never end in "?", so the type decides, and
        // the old "?" check only remains for builds that send no type.
        askQuestion(message || "Claude needs an answer.");
      }
      break;
    }

    case "Stop": {
      State.updateTask(CLAUDE_ID, "finished");
      rewardAgent();
      island.stopTools();
      island.subagentsClear();
      const finalMessage = payload.message ?? payload.last_assistant_message;
      record("finished", projectName, (finalMessage ?? "").slice(0, 80));
      saveCompletedHandoff(payload, cwd, finalMessage ?? "");
      if (finalMessage) State.appendStep(CLAUDE_ID, finalMessage.slice(0, 60));
      Sound.play("finish");
      if (focused) surface("finished", true);
      else State.setPillBadge(CLAUDE_ID, "finished");
      window.setTimeout(() => {
        State.updateTask(CLAUDE_ID, "idle");
        State.setPillBadge(CLAUDE_ID, null);
      }, 5200);
      break;
    }

    case "CodexTurnComplete": {
      if (payload.turn_id) {
        const completionKey = `${payload.session_id ?? ""}:${payload.turn_id}`;
        if (completedCodexTurns.has(completionKey)) break;
        completedCodexTurns.add(completionKey);
        if (completedCodexTurns.size > 128) {
          const oldest = completedCodexTurns.values().next().value;
          if (oldest) completedCodexTurns.delete(oldest);
        }
      }
      upsert(projectName, cwd, "codex");
      State.updateTask(CLAUDE_ID, "finished");
      rewardAgent();
      island.stopTools();
      const finalMessage = payload.last_assistant_message;
      record("finished", projectName, (finalMessage ?? "").slice(0, 80));
      saveCompletedHandoff(payload, cwd, finalMessage ?? "");
      if (finalMessage) State.appendStep(CLAUDE_ID, finalMessage.slice(0, 60));
      Sound.play("finish");
      island.alert("finished");
      window.setTimeout(() => {
        State.updateTask(CLAUDE_ID, "idle");
        State.setPillBadge(CLAUDE_ID, null);
      }, 5200);
      break;
    }

    case "CodexSessionStarted":
      upsert(projectName, cwd, "codex");
      State.updateTask(CLAUDE_ID, "thinking");
      surface("overview", false);
      break;

    case "StopFailure": {
      // Say what actually failed. Without this the card showed the last step —
      // often the previous turn's cheerful "All done" — as the error.
      const detail = stopFailureDetail(payload);
      State.appendStep(CLAUDE_ID, detail);
      State.updateTask(CLAUDE_ID, "error");
      island.stopTools();
      island.subagentsClear();
      record("error", projectName, detail.replace(/^⚠\s*/, ""));
      if (payload.error === "rate_limit") island.noteLimit("claude", payload.error_details ?? "");
      Sound.play("error");
      if (focused) surface("error", true);
      else State.setPillBadge(CLAUDE_ID, "error");
      break;
    }

    case "SessionEnd":
      State.updateTask(CLAUDE_ID, "idle");
      island.stopTools();
      island.subagentsClear();
      clearSession();
      break;

    // A little Mochi per subagent, instead of a "+ subagent" line in the ticker.
    case "SubagentStart":
      island.subagentStart(payload.agent_id, payload.agent_type || "Subagent");
      break;

    case "SubagentStop":
      island.subagentStop(payload.agent_id);
      break;

    case "PermissionRequest": {
      const requestId = payload.request_id ?? "";
      // One card, one request. A second one must never quietly replace the first
      // — that would leave a human staring at request B while request A waits for
      // a decision nobody can give. Hand it straight back to the terminal.
      if (State.pendingApproval && State.pendingApproval.requestId !== requestId) {
        if (requestId) void Bridge.approvalDecline(requestId);
        break;
      }
      upsert(projectName, cwd, payload.agent_source === "codex" ? "codex" : "claudeCode");
      if (pendingTimeout != null) window.clearTimeout(pendingTimeout);
      const tool = payload.tool_name ?? "Tool";
      const input = payload.tool_input ?? {};
      State.pendingApproval = {
        requestId,
        sessionId: payload.session_id ?? "",
        tool,
        command: approvalTarget(tool, input),
      };
      // The relay's short ack window closes in 800 ms; everything below this
      // line is synchronous, so the card really is up by the time it lands.
      if (requestId) void Bridge.approvalAck(requestId);
      State.updateTask(CLAUDE_ID, "approval");
      State.isPinned = true;
      island.stopTools();
      record("approval", projectName, State.pendingApproval.command);
      Sound.play("approval");
      if (focused) {
        island.alert("approval");
      } else {
        // Another agent holds the view, so the card would yank it away. The badge
        // is the signal instead — but it has to be on screen for that to mean
        // anything, hence the reveal. We just told the relay a human can act.
        State.setPillBadge(CLAUDE_ID, "approval");
        island.reveal();
      }
      // Coucou answers within 108 s or not at all; after that the terminal has
      // taken over and the card would be lying.
      pendingTimeout = window.setTimeout(() => {
        pendingTimeout = null;
        if (!State.pendingApproval) return;
        record("approvalMissed", projectName, State.pendingApproval.command);
        State.pendingApproval = null;
        State.isPinned = false;
        island.dropPin();
        State.updateTask(CLAUDE_ID, "working");
        State.setPillBadge(CLAUDE_ID, null);
        if (State.view === "approval") island.setView(State.defaultView());
        State.notify();
      }, 110_000);
      break;
    }

    default:
      break;
  }
  State.notify();
}
