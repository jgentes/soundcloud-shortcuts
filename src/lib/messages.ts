import type { NowPlaying, Waveform } from "./state";

/** Commands declared in wxt.config.ts `manifest.commands`. Keep in sync. */
export const COMMANDS = [
  "play-pause",
  "next",
  "previous",
  "like",
  "repost",
  "seek-forward",
  "seek-backward",
  "volume-up",
  "volume-down",
  "mute",
  "shuffle",
  "repeat",
  "focus-tab",
] as const;

export type Command = (typeof COMMANDS)[number];

export function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

/** Commands handled by the service worker alone; everything else goes to the page. */
export const WORKER_ONLY_COMMANDS: ReadonlySet<Command> = new Set<Command>(["focus-tab"]);

/** Worker → content script: run a command on the player. */
export interface CommandMessage {
  type: "sc-shortcuts/command";
  command: Command;
  /** Seconds to seek per press. */
  seekStep: number;
}

/** Worker → content script: jump to a point in the track. */
export interface SeekToMessage {
  type: "sc-shortcuts/seek-to";
  /** 0..1 of the track duration. */
  fraction: number;
}

/** Worker → content script: liveness check. */
export interface PingMessage {
  type: "sc-shortcuts/ping";
}

/** Content script → worker: the player bar changed. `null` means no track loaded. */
export interface StateMessage {
  type: "sc-shortcuts/state";
  state: NowPlaying | null;
}

/** Content script → worker: waveform samples for a track. */
export interface WaveformMessage {
  type: "sc-shortcuts/waveform";
  waveform: Waveform;
}

/** Worker → overlay script: show the card for a track that just started. */
export interface OverlayShowMessage {
  type: "sc-shortcuts/overlay-show";
  state: NowPlaying;
  waveform?: Waveform;
  /** Seconds until the card hides itself; 0 keeps it until dismissed. */
  closeAfter: number;
}

/** Worker → overlay script: the track state changed while the card may be visible. */
export interface OverlayStateMessage {
  type: "sc-shortcuts/overlay-state";
  state: NowPlaying | null;
  /** Sent when the waveform for the current track arrives. */
  waveform?: Waveform;
}

/** Popup / overlay → worker: user pressed a control. */
export type InvokeMessage =
  | { type: "sc-shortcuts/invoke"; command: Command }
  | { type: "sc-shortcuts/invoke"; seekTo: number };

export type Message =
  | CommandMessage
  | SeekToMessage
  | PingMessage
  | StateMessage
  | WaveformMessage
  | OverlayShowMessage
  | OverlayStateMessage
  | InvokeMessage;

export interface CommandResult {
  ok: boolean;
  /** Human-readable detail, e.g. which control was missing. */
  detail?: string;
}
