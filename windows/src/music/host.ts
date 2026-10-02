// The music host: the one place music actually plays.
//
// It runs in the island window, which is always alive and never throttled (a
// hidden Hub window would get its timers slowed down and the music would
// stutter). The Hub and Settings drive it with `music-command` events and
// follow it through `music-state` / `music-beat`.
//
// It also listens to Claude Code / Codex: music while an agent works, quieter
// while it waits for you, a jingle when it finishes or fails.

import { broadcast, onEvent } from "../core/bridge";
import type { BotStateName } from "../core/layout";
import { MusicEngine, type JingleKind, type MusicReason, type MusicState } from "./engine";
import { onMusicPrefs, readMusicPrefs, type MusicPrefs } from "./prefs";
import { WORK_PICKS, type StationId } from "./stations";

export type MusicCommand =
  | { action: "play"; station?: StationId; reason: MusicReason }
  | { action: "toggle"; station?: StationId; reason: MusicReason }
  /** With a reason, only stops music that was started for that reason. */
  | { action: "stop"; reason?: MusicReason }
  | { action: "jingle"; kind: JingleKind }
  | { action: "hello" };

export interface MusicBeat {
  beat: number;
  bar: number;
  downbeat: boolean;
  bpm: number;
}

const ACTIVE: ReadonlySet<BotStateName> = new Set(["working", "thinking", "searching"]);
const WAITING: ReadonlySet<BotStateName> = new Set(["approval", "question"]);

export class MusicHost {
  readonly engine = new MusicEngine();
  private prefs: MusicPrefs = readMusicPrefs();
  private agentState: BotStateName = "idle";
  private idleTimer: number | null = null;
  /** You turned work music off mid-session: stay quiet until the session ends. */
  private workMuted = false;
  private lastWorkStation: StationId | null = null;

  constructor() {
    this.engine.setVolume(this.prefs.volume);
    onMusicPrefs((p) => {
      const wasOn = this.prefs.workMusic;
      this.prefs = p;
      this.engine.setVolume(p.volume);
      if (wasOn && !p.workMusic && this.engine.reason === "work") this.engine.stop();
      if (!wasOn && p.workMusic && ACTIVE.has(this.agentState)) this.startWork();
    });
    this.engine.subscribe((e) => {
      if (e.type === "state") broadcast("music-state", e.state);
      if (e.type === "beat") {
        broadcast("music-beat", { ...e, bpm: this.engine.state.bpm } satisfies MusicBeat);
      }
    });
    void onEvent<MusicCommand>("music-command", (cmd) => this.command(cmd));
    // Windows that open later ask what's playing.
    broadcast("music-state", this.engine.state);
  }

  command(cmd: MusicCommand) {
    switch (cmd.action) {
      case "play":
        this.engine.play(cmd.station ?? this.engine.station, cmd.reason);
        break;
      case "toggle":
        if (this.engine.playing && (!cmd.station || cmd.station === this.engine.station)) {
          if (this.engine.reason === "work") this.workMuted = true;
          this.engine.stop();
        } else {
          this.engine.play(cmd.station ?? this.engine.station, cmd.reason);
        }
        break;
      case "stop":
        if (!cmd.reason || cmd.reason === this.engine.reason) this.engine.stop();
        break;
      case "jingle":
        // A birthday song is asked for on purpose, so it plays even with jingles off.
        if (this.prefs.jingles || cmd.kind === "birthday") this.engine.jingle(cmd.kind);
        break;
      case "hello":
        broadcast("music-state", this.engine.state);
        break;
    }
  }

  /** Called by the island whenever the Claude Code / Codex task changes state. */
  agent(state: BotStateName) {
    const prev = this.agentState;
    if (state === prev) return;
    this.agentState = state;

    if (ACTIVE.has(state)) {
      this.cancelIdle();
      this.engine.duck(false);
      if (!this.engine.playing) this.startWork();
      return;
    }
    if (WAITING.has(state)) {
      // Keep the groove, but turn it down so the question gets heard.
      if (this.engine.playing) this.engine.duck(true);
      return;
    }
    this.engine.duck(false);
    if (state === "finished" || state === "error") {
      const ours = this.engine.reason === "work";
      if (ours) this.engine.stop(0.6);
      if ((ours || this.prefs.workMusic) && this.prefs.jingles && ACTIVE.has(prev)) {
        window.setTimeout(() => this.engine.jingle(state === "finished" ? "finish" : "error"), ours ? 350 : 0);
      }
      this.workMuted = false;
      return;
    }
    // Idle, sleeping…: a short grace period, because tool calls flicker the
    // state between events and the music shouldn't stutter with them.
    this.cancelIdle();
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      if (this.engine.reason === "work") this.engine.stop(1.4);
      this.workMuted = false;
    }, 4000);
  }

  private startWork() {
    if (!this.prefs.workMusic || this.workMuted) return;
    // Never talk over music you chose yourself.
    if (this.engine.playing && this.engine.reason !== "work") return;
    let station = this.prefs.workStation;
    if (station === "auto") {
      const picks = WORK_PICKS.filter((s) => s !== this.lastWorkStation);
      station = picks[Math.floor(Math.random() * picks.length)];
    }
    this.lastWorkStation = station;
    this.engine.play(station, "work");
  }

  private cancelIdle() {
    if (this.idleTimer != null) window.clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  get state(): MusicState {
    return this.engine.state;
  }
}

let host: MusicHost | null = null;

/** Starts the host once per window. */
export function startMusicHost(): MusicHost {
  host ??= new MusicHost();
  return host;
}
