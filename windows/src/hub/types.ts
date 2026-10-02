// Data shared by the Hub's pages. Everything here lives in localStorage on this
// PC; nothing is synced anywhere.

export type FocusMode = "focus" | "short" | "long";
export type Priority = 0 | 1 | 2 | 3; // none · low · medium · high

export interface FocusTask {
  id: string;
  title: string;
  repo: string;
  createdAt: number;
  doneAt: number | null;
  kind?: "task" | "note";
  note?: string;
  scheduledFor?: string | null;
  priority?: Priority;
  /** Manual position in the list (lower first). */
  order?: number;
  /** Minutes of focus sessions spent on this task. */
  focusMinutes?: number;
}

export interface FocusSession {
  at: number;
  minutes: number;
  taskId?: string | null;
}

export interface FocusData {
  tasks: FocusTask[];
  mode: FocusMode;
  focusMinutes: number;
  remaining: number;
  running: boolean;
  endAt: number | null;
  sessions: FocusSession[];
  /** Daily focus goal, minutes. */
  goalMinutes?: number;
  /** The task the current focus session is for. */
  activeTaskId?: string | null;
}
