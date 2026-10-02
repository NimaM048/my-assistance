import { Bridge, type ProjectStatus } from "./bridge";

const STORAGE_KEY = "coucou.project-handoffs.v1";
const MAX_HANDOFFS = 80;

export interface ProjectHandoff {
  id: string;
  path: string;
  projectName: string;
  createdAt: number;
  branch: string | null;
  changedFiles: number;
  changedPaths: string[];
  lastCommit: string | null;
  prompt: string;
  response: string;
  nextStep: string;
}

function readAll(): ProjectHandoff[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is ProjectHandoff =>
      item && typeof item.id === "string" && typeof item.path === "string" && typeof item.createdAt === "number"
      && Array.isArray(item.changedPaths) && typeof item.changedFiles === "number" && typeof item.nextStep === "string",
    ) : [];
  } catch {
    return [];
  }
}

function pathKey(path: string): string {
  return path.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
}

export function latestHandoff(path: string): ProjectHandoff | null {
  const key = pathKey(path);
  return readAll().find((item) => pathKey(item.path) === key) ?? null;
}

export async function captureHandoff(path: string, prompt = "", response = ""): Promise<ProjectHandoff | null> {
  if (!path.trim()) return null;
  let status: ProjectStatus | null = null;
  try {
    status = await Bridge.projectStatusLocal(path);
  } catch {
    // Keep the handoff useful even if the folder or Git executable is unavailable.
  }

  const changedPaths = status?.changedPaths ?? [];
  const projectPath = status?.path || path;
  const firstAction = response.match(/(?:next step|next action|to continue)\s*[:—-]\s*([^\n.]+)/i)?.[1]?.trim();
  const nextStep = firstAction
    ? firstAction.slice(0, 220)
    : changedPaths.length
      ? `Review the ${changedPaths.length} saved change${changedPaths.length === 1 ? "" : "s"}, then continue.`
      : "Continue from the last response and choose the next concrete step.";
  const handoff: ProjectHandoff = {
    id: crypto.randomUUID(),
    path: projectPath,
    projectName: status?.projectName || path.split(/[\\/]/).filter(Boolean).at(-1) || "Project",
    createdAt: Date.now(),
    branch: status?.branch ?? null,
    changedFiles: status?.changedFiles ?? 0,
    changedPaths: changedPaths.slice(0, 50),
    lastCommit: status?.lastCommit ?? null,
    prompt: prompt.trim().slice(0, 3000),
    response: response.trim().slice(0, 4000),
    nextStep,
  };
  const handoffs = readAll();
  handoffs.unshift(handoff);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(handoffs.slice(0, MAX_HANDOFFS)));
  return handoff;
}

export function saveNextStep(id: string, nextStep: string): boolean {
  const handoffs = readAll();
  const handoff = handoffs.find((item) => item.id === id);
  if (!handoff) return false;
  handoff.nextStep = nextStep.trim().slice(0, 300);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(handoffs));
  return true;
}

export function handoffPrompt(handoff: ProjectHandoff): string {
  const changes = handoff.changedPaths.length
    ? `${handoff.changedPaths.map((file) => `- ${file}`).join("\n")}${handoff.changedFiles > handoff.changedPaths.length ? `\n- … ${handoff.changedFiles - handoff.changedPaths.length} more file(s)` : ""}`
    : `${handoff.changedFiles} changed file(s)`;
  return [
    `Continue the previous work in ${handoff.projectName}. Inspect the current project state before editing.`,
    handoff.branch ? `Branch: ${handoff.branch}` : "",
    handoff.lastCommit ? `Last commit: ${handoff.lastCommit}` : "",
    "",
    "Previous request:", handoff.prompt || "(No prompt was captured.)",
    "",
    "Last response:", handoff.response || "(No final response was captured.)",
    "",
    "Files that were changed at handoff:", changes,
    "",
    `Next step: ${handoff.nextStep}`,
  ].filter((line) => line !== "").join("\n");
}
