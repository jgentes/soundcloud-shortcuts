import type { Command } from "./messages";
import { formatTime, type NowPlaying, type Waveform } from "./state";
import { downsample, drawWaveform, type WaveformColors } from "./waveform";

/**
 * The now-playing card drawn into an ordinary web page when a track changes.
 * It lives in a shadow root so the page's styles cannot leak in, and it never
 * takes keyboard focus on its own: the user keeps typing wherever they were.
 */

export interface OverlayHandlers {
  /** A transport or like button was pressed. */
  onCommand(command: Command): void;
  /** The waveform was clicked at this fraction of the track. */
  onSeek(fraction: number): void;
  /** The close button was pressed. */
  onDismiss(): void;
  /** Title or artwork was clicked; open the track. */
  onOpen(url: string): void;
}

export interface OverlayCard {
  host: HTMLElement;
  /** Refresh the text, button states and playhead. */
  update(state: NowPlaying): void;
  /** Supply (or replace) the waveform peaks for the current track. */
  setWaveform(waveform: Waveform | null): void;
  /** Slide the card in. */
  show(): void;
  /** Fade the card out. */
  hide(): void;
  readonly visible: boolean;
}

export const CARD_WIDTH = 340;
const WAVE_WIDTH = 268;
const WAVE_HEIGHT = 36;
const BAR_WIDTH = 2;
const GAP = 1;
const BARS = Math.floor((WAVE_WIDTH + GAP) / (BAR_WIDTH + GAP));

const ICONS = {
  previous: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h2v12H3V2zm10 0v12L6 8l7-6z"/></svg>',
  play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2l10 6-10 6V2z"/></svg>',
  pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h4v12H3V2zm6 0h4v12H9V2z"/></svg>',
  next: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11 2h2v12h-2V2zM3 2l7 6-7 6V2z"/></svg>',
  like: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 14S2 9.9 2 5.9A3.2 3.2 0 0 1 5.2 2.7c1.2 0 2.2.6 2.8 1.5.6-.9 1.6-1.5 2.8-1.5A3.2 3.2 0 0 1 14 5.9C14 9.9 8 14 8 14z"/></svg>',
  close: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.1L8 6.6l4.5-4.5 1.4 1.4L9.4 8l4.5 4.5-1.4 1.4L8 9.4l-4.5 4.5-1.4-1.4L6.6 8 2.1 3.5z"/></svg>',
};

const STYLE = `
:host {
  all: initial;
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483647;
  pointer-events: none;
  color-scheme: light dark;
}
.card {
  --bg: #ffffff;
  --fg: #111;
  --muted: #7a7a7a;
  --border: #e5e5e5;
  --accent: #ff5500;
  --chip: #f0f0f0;
  position: relative;
  box-sizing: border-box;
  width: ${CARD_WIDTH}px;
  max-width: calc(100vw - 32px);
  /* Set here, not on :host: page rules with !important still reach the host element. */
  font: 12px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 10px 8px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--fg);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
  pointer-events: auto;
  opacity: 0;
  transform: translateY(12px);
  transition: opacity 180ms ease, transform 180ms ease;
}
@media (prefers-color-scheme: dark) {
  .card {
    --bg: #1c1c1c;
    --fg: #f0f0f0;
    --muted: #9a9a9a;
    --border: #2d2d2d;
    --chip: #2a2a2a;
  }
}
.card.visible {
  opacity: 1;
  transform: none;
}
.card * {
  box-sizing: border-box;
}
.head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.artwork {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  border-radius: 4px;
  background: var(--chip);
  overflow: hidden;
  cursor: pointer;
  border: 0;
  padding: 0;
}
.artwork img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--accent);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.title,
.artist {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: none;
  border: 0;
  padding: 0;
  margin: 0;
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.title {
  font-weight: 600;
  font-size: 13px;
}
.artist {
  color: var(--muted);
}
.controls {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
}
.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--fg);
  cursor: pointer;
}
.icon:hover {
  background: var(--chip);
}
.icon svg {
  width: 14px;
  height: 14px;
  fill: currentColor;
}
.icon.play {
  background: var(--accent);
  color: #fff;
}
.icon.play:hover {
  filter: brightness(1.1);
}
.icon.active {
  color: var(--accent);
}
.timeline {
  display: flex;
  align-items: center;
  gap: 6px;
}
.time {
  flex: 0 0 30px;
  font-size: 10px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.time.total {
  text-align: right;
}
.wave {
  position: relative;
  flex: 1;
  cursor: pointer;
}
canvas {
  display: block;
  width: 100%;
  height: ${WAVE_HEIGHT}px;
}
.hover-time {
  position: absolute;
  top: -14px;
  transform: translateX(-50%);
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--fg);
  color: var(--bg);
  font-size: 10px;
  pointer-events: none;
  white-space: nowrap;
}
.close {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 20px;
  height: 20px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--muted);
  opacity: 0;
  transition: opacity 120ms ease;
}
.close svg {
  width: 10px;
  height: 10px;
}
.card:hover .close {
  opacity: 1;
}
[hidden] {
  display: none !important;
}
`;

function button(className: string, title: string, icon: string): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  el.title = title;
  el.setAttribute("aria-label", title);
  el.innerHTML = icon;
  // Mouse clicks must not pull keyboard focus away from where the user is typing.
  el.addEventListener("mousedown", (e) => e.preventDefault());
  return el;
}

function colors(): WaveformColors {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  return {
    played: ["#ff5500", "#ff2200"],
    hover: "#ff8c4b",
    unplayed: dark ? "#4a4a4a" : "#cfcfcf",
    reflection: dark ? 0.45 : 0.35,
  };
}

/** Position now, interpolated from the last report while playing. */
export function livePosition(np: NowPlaying, now = Date.now()): number {
  if (!np.playing) return np.position;
  const elapsed = (now - np.updatedAt) / 1000;
  return Math.min(np.duration, np.position + elapsed);
}

export function createOverlayCard(handlers: OverlayHandlers): OverlayCard {
  const host = document.createElement("div");
  host.id = "sc-shortcuts-now-playing";
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = STYLE;

  const card = document.createElement("div");
  card.className = "card";
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");

  const head = document.createElement("div");
  head.className = "head";

  const artwork = button("artwork", "Open track", "");
  const img = document.createElement("img");
  img.alt = "";
  img.addEventListener("error", () => (img.hidden = true));
  artwork.append(img);

  const meta = document.createElement("div");
  meta.className = "meta";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "Now playing";
  const title = button("title", "Open track", "");
  const artist = button("artist", "Open artist", "");
  meta.append(label, title, artist);

  const controls = document.createElement("div");
  controls.className = "controls";
  const previous = button("icon", "Previous", ICONS.previous);
  const play = button("icon play", "Pause", ICONS.pause);
  const next = button("icon", "Next", ICONS.next);
  const like = button("icon", "Like", ICONS.like);
  controls.append(previous, play, next, like);
  head.append(artwork, meta, controls);

  const timeline = document.createElement("div");
  timeline.className = "timeline";
  const timePassed = document.createElement("span");
  timePassed.className = "time";
  timePassed.textContent = "0:00";
  const wave = document.createElement("div");
  wave.className = "wave";
  const canvas = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(WAVE_WIDTH * dpr);
  canvas.height = Math.round(WAVE_HEIGHT * dpr);
  const ctx = canvas.getContext("2d");
  ctx?.scale(dpr, dpr);
  const hoverTip = document.createElement("div");
  hoverTip.className = "hover-time";
  hoverTip.hidden = true;
  wave.append(canvas, hoverTip);
  const timeTotal = document.createElement("span");
  timeTotal.className = "time total";
  timeTotal.textContent = "0:00";
  timeline.append(timePassed, wave, timeTotal);

  const close = button("icon close", "Dismiss", ICONS.close);

  card.append(head, timeline, close);
  root.append(style, card);

  let current: NowPlaying | null = null;
  let peaks: number[] = new Array<number>(BARS).fill(0.12);
  let hover: number | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let tickTimer: ReturnType<typeof setTimeout> | null = null;
  let visible = false;

  artwork.addEventListener("click", () => current && handlers.onOpen(current.trackUrl));
  title.addEventListener("click", () => current && handlers.onOpen(current.trackUrl));
  artist.addEventListener(
    "click",
    () => current && handlers.onOpen(current.artistUrl || current.trackUrl),
  );
  previous.addEventListener("click", () => handlers.onCommand("previous"));
  next.addEventListener("click", () => handlers.onCommand("next"));
  like.addEventListener("click", () => {
    if (current) update({ ...current, liked: !current.liked });
    handlers.onCommand("like");
  });
  play.addEventListener("click", () => {
    if (current) {
      update({ ...current, position: livePosition(current), playing: !current.playing, updatedAt: Date.now() });
    }
    handlers.onCommand("play-pause");
  });
  close.addEventListener("click", () => handlers.onDismiss());

  const fractionAt = (e: MouseEvent): number => {
    const rect = canvas.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  };
  wave.addEventListener("mousedown", (e) => e.preventDefault());
  wave.addEventListener("mousemove", (e) => {
    hover = fractionAt(e);
    if (current) {
      hoverTip.hidden = false;
      hoverTip.textContent = formatTime(hover * current.duration);
      hoverTip.style.left = `${e.clientX - wave.getBoundingClientRect().left}px`;
    }
    tick();
  });
  wave.addEventListener("mouseleave", () => {
    hover = null;
    hoverTip.hidden = true;
    tick();
  });
  wave.addEventListener("click", (e) => {
    if (!current) return;
    const fraction = fractionAt(e);
    current = { ...current, position: fraction * current.duration, updatedAt: Date.now() };
    tick();
    handlers.onSeek(fraction);
  });

  function tick(): void {
    if (tickTimer) clearTimeout(tickTimer);
    tickTimer = null;
    if (!current) return;
    const pos = livePosition(current);
    timePassed.textContent = formatTime(pos);
    const progress = current.duration > 0 ? pos / current.duration : 0;
    if (ctx) {
      drawWaveform(ctx, peaks, WAVE_WIDTH, WAVE_HEIGHT, {
        progress,
        hover,
        barWidth: BAR_WIDTH,
        gap: GAP,
        colors: colors(),
      });
    }
    if (current.playing && visible) tickTimer = setTimeout(tick, 250);
  }

  function update(state: NowPlaying): void {
    if (current && current.trackKey !== state.trackKey) setWaveform(null);
    current = state;
    const src = state.artworkData ?? state.artworkUrl ?? "";
    img.hidden = !src;
    if (src && img.getAttribute("src") !== src) img.src = src;
    title.textContent = state.title;
    title.title = state.title;
    artist.textContent = state.artist;
    artist.title = state.artist;
    play.innerHTML = state.playing ? ICONS.pause : ICONS.play;
    play.title = state.playing ? "Pause" : "Play";
    play.setAttribute("aria-label", play.title);
    like.classList.toggle("active", state.liked);
    like.title = state.liked ? "Unlike" : "Like";
    like.setAttribute("aria-label", like.title);
    timeTotal.textContent = formatTime(state.duration);
    tick();
  }

  function setWaveform(waveform: Waveform | null): void {
    // No peaks yet: a flat bar still shows the playhead position.
    peaks = waveform
      ? downsample(waveform.samples, waveform.height, BARS)
      : new Array<number>(BARS).fill(0.12);
    tick();
  }

  function show(): void {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
    host.hidden = false;
    visible = true;
    tick();
    // Next frame, so the transition runs from the hidden state.
    requestAnimationFrame(() => card.classList.add("visible"));
  }

  function hide(): void {
    if (!visible) return;
    visible = false;
    card.classList.remove("visible");
    if (tickTimer) clearTimeout(tickTimer);
    tickTimer = null;
    hideTimer = setTimeout(() => {
      if (!visible) host.hidden = true;
    }, 220);
  }

  host.hidden = true;
  return {
    host,
    update,
    setWaveform,
    show,
    hide,
    get visible() {
      return visible;
    },
  };
}
