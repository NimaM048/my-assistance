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
import { SILENT } from "./ambience";
import type { BotStateName } from "../core/layout";
import { MusicEngine, type JingleKind, type MusicReason, type MusicState } from "./engine";
import { onMusicPrefs, readMusicPrefs, writeMusicPrefs, type MusicPrefs } from "./prefs";
import { WORK_PICKS, type StationId } from "./stations";

export type MusicCommand =
  | { action: "play"; station?: StationId; reason: MusicReason }
  | { action: "toggle"; station?: StationId; reason: MusicReason }
  /** With a reason, only stops music that was started for that reason. */
  | { action: "stop"; reason?: MusicReason }
  | { action: "jingle"; kind: JingleKind }
  | { action: "hello" };

/** A melody note, for windows where Mochi sings along. */
export interface MusicNote {
  midi: number;
  dur: number;
  low: number;
  high: number;
}

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
  /** When recent tool calls happened (audio energy follows their rate). */
  private toolTimes: number[] = [];
  private energyTimer: number | null = null;

  constructor() {
    this.engine.setVolume(this.prefs.volume);
    this.engine.wantNotes = this.prefs.singAlong;
    // The ambience never starts by itself when Coucou launches.
    if (this.prefs.ambienceOn) this.prefs = writeMusicPrefs({ ambienceOn: false });
    onMusicPrefs((p) => {
      const wasOn = this.prefs.workMusic;
      this.prefs = p;
      this.engine.setVolume(p.volume);
      this.engine.wantNotes = p.singAlong;
      this.engine.setAmbience(p.ambienceOn ? p.ambience : SILENT);
      if (wasOn && !p.workMusic && this.engine.reason === "work") this.engine.stop();
      if (!wasOn && p.workMusic && ACTIVE.has(this.agentState)) this.startWork();
      if (!p.adaptive) {
        this.engine.setEnergy(0.5);
        this.engine.setTension(false);
      }
    });
    this.engine.subscribe((e) => {
      if (e.type === "state") broadcast("music-state", e.state);
      if (e.type === "beat") {
        broadcast("music-beat", { ...e, bpm: this.engine.state.bpm } satisfies MusicBeat);
      }
      if (e.type === "note") broadcast("music-note", { midi: e.midi, dur: e.dur, low: e.low, high: e.high } satisfies MusicNote);
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
      this.engine.setTension(false);
      if (!this.engine.playing) this.startWork();
      this.watchEnergy();
      return;
    }
    if (WAITING.has(state)) {
      // Keep the groove, but turn it down so the question gets heard — and,
      // if the music follows your agent, let it hang on a suspended chord.
      if (this.engine.playing) {
        const adaptive = this.prefs.adaptive && this.engine.reason === "work";
        this.engine.setTension(adaptive);
        this.engine.duck(true, adaptive ? 0.42 : 0.18);
      }
      return;
    }
    this.engine.duck(false);
    this.engine.setTension(false);
    if (state === "finished" || state === "error") {
      // Keep the tempo it had: the ending should land at full speed.
      this.stopEnergy(false);
      const ours = this.engine.reason === "work";
      const wasActive = ACTIVE.has(prev) || WAITING.has(prev);
      if (ours && state === "finished" && this.prefs.adaptive) {
        // A proper ending: a cadence home, and the last chord is the celebration.
        if (!this.engine.finale()) this.engine.stop(0.6);
      } else {
        if (ours) this.engine.stop(0.6);
        if ((ours || this.prefs.workMusic) && this.prefs.jingles && wasActive) {
          window.setTimeout(() => this.engine.jingle(state === "finished" ? "finish" : "error"), ours ? 350 : 0);
        }
      }
      this.workMuted = false;
      return;
    }
    // Idle, sleeping…: a short grace period, because tool calls flicker the
    // state between events and the music shouldn't stutter with them.
    this.cancelIdle();
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      this.stopEnergy();
      if (this.engine.reason === "work") this.engine.stop(1.4);
      this.workMuted = false;
    }, 4000);
  }

  /** Called on every tool call: the more of them, the livelier the music. */
  tool() {
    const now = Date.now();
    this.toolTimes.push(now);
    while (this.toolTimes.length && now - this.toolTimes[0] > 20_000) this.toolTimes.shift();
    this.updateEnergy();
  }

  private updateEnergy() {
    if (!this.prefs.adaptive) return;
    const now = Date.now();
    while (this.toolTimes.length && now - this.toolTimes[0] > 20_000) this.toolTimes.shift();
    // No tool calls (thinking) → mellow 0.3; about one every few seconds → ~0.75; a storm → ~0.95.
    const rate = this.toolTimes.length;
    this.engine.setEnergy(0.3 + 0.68 * (1 - Math.exp(-rate / 6)));
  }

  /** While work music plays, let the energy settle back as tool calls stop. */
  private watchEnergy() {
    if (this.energyTimer != null) return;
    this.energyTimer = window.setInterval(() => {
      if (!this.engine.playing || this.engine.reason !== "work") return;
      this.updateEnergy();
    }, 2500);
    this.updateEnergy();
  }

  private stopEnergy(reset = true) {
    if (this.energyTimer != null) window.clearInterval(this.energyTimer);
    this.energyTimer = null;
    this.toolTimes = [];
    if (reset) this.engine.setEnergy(0.5);
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
