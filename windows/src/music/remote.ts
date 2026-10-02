// Remote control for the music host, used by the Hub and Settings.
//
// In the app, commands travel to the island as `music-command` events and the
// island answers with `music-state` / `music-beat`. In a plain browser (`npm
// run dev`) there is no island behind the page, so this window hosts its own
// player instead and everything works the same way.

import { IS_TAURI, broadcast, onEvent } from "../core/bridge";
import type { JingleKind, MusicReason, MusicState } from "./engine";
import { startMusicHost, type MusicBeat, type MusicCommand } from "./host";
import type { StationId } from "./stations";

type StateFn = (s: MusicState) => void;
type BeatFn = (b: MusicBeat) => void;

class MusicRemote {
  state: MusicState = { playing: false, station: "lofi", reason: null, bpm: 76, ducked: false, beatEpoch: 0 };
  private stateFns = new Set<StateFn>();
  private beatFns = new Set<BeatFn>();
  private wired = false;

  private wire() {
    if (this.wired) return;
    this.wired = true;
    if (!IS_TAURI) startMusicHost();
    void onEvent<MusicState>("music-state", (s) => {
      this.state = s;
      for (const fn of this.stateFns) fn(s);
    });
    void onEvent<MusicBeat>("music-beat", (b) => {
      for (const fn of this.beatFns) fn(b);
    });
    this.send({ action: "hello" });
  }

  send(cmd: MusicCommand) {
    this.wire();
    broadcast("music-command", cmd);
  }

  play(station: StationId, reason: MusicReason = "manual") {
    this.send({ action: "play", station, reason });
  }

  toggle(station: StationId, reason: MusicReason = "manual") {
    this.send({ action: "toggle", station, reason });
  }

  stop(reason?: MusicReason) {
    this.send({ action: "stop", reason });
  }

  jingle(kind: JingleKind) {
    this.send({ action: "jingle", kind });
  }

  onState(fn: StateFn): () => void {
    this.wire();
    this.stateFns.add(fn);
    return () => this.stateFns.delete(fn);
  }

  onBeat(fn: BeatFn): () => void {
    this.wire();
    this.beatFns.add(fn);
    return () => this.beatFns.delete(fn);
  }

  /** Beats since the music started, estimated from the shared beat epoch. */
  beatPos(): number | null {
    if (!this.state.playing) return null;
    return Math.max(0, ((Date.now() - this.state.beatEpoch) / 1000) * (this.state.bpm / 60));
  }
}

export const music = new MusicRemote();
