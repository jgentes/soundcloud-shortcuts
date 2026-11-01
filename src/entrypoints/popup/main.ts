import type { Command, InvokeMessage } from "@/lib/messages";
import {
  AUTO_OPEN_KEY,
  STATE_KEY,
  formatTime,
  loadState,
  type AutoOpen,
  type NowPlaying,
  type StoredState,
} from "@/lib/state";
import { downsample, drawWaveform, type WaveformColors } from "@/lib/waveform";

const BAR_WIDTH = 2;
const GAP = 1;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("waveform");
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
const dpr = window.devicePixelRatio || 1;
const cssWidth = canvas.getBoundingClientRect().width || canvas.width;
const cssHeight = canvas.getBoundingClientRect().height || canvas.height;
canvas.width = Math.round(cssWidth * dpr);
canvas.height = Math.round(cssHeight * dpr);
ctx.scale(dpr, dpr);
const bars = Math.floor((cssWidth + GAP) / (BAR_WIDTH + GAP));

let state: StoredState = { nowPlaying: null, tabId: null, waveforms: {} };
let peaks: number[] = [];
let hover: number | null = null;
let raf = 0;

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
function livePosition(np: NowPlaying): number {
  if (!np.playing) return np.position;
  const elapsed = (Date.now() - np.updatedAt) / 1000;
  return Math.min(np.duration, np.position + elapsed);
}

function render(): void {
  const np = state.nowPlaying;
  $("empty").hidden = !!np;
  $("player").hidden = !np;
  if (!np) return;

  const artwork = $<HTMLImageElement>("artwork");
  const src = np.artworkData ?? np.artworkUrl ?? "/icon/48.png";
  if (artwork.src !== src) artwork.src = src;
  $<HTMLAnchorElement>("artwork-link").href = np.trackUrl;
  const title = $<HTMLAnchorElement>("title");
  title.textContent = np.title;
  title.title = np.title;
  title.href = np.trackUrl;
  const artist = $<HTMLAnchorElement>("artist");
  artist.textContent = np.artist;
  artist.href = np.artistUrl || np.trackUrl;

  const play = $("play");
  play.title = np.playing ? "Pause" : "Play";
  play.setAttribute("aria-label", play.title);
  // SVG elements have no `hidden` property, so toggle the attribute.
  $("icon-play").toggleAttribute("hidden", np.playing);
  $("icon-pause").toggleAttribute("hidden", !np.playing);

  $("shuffle").classList.toggle("active", np.shuffle);
  $("repeat").classList.toggle("active", np.repeat !== "none");
  $("repeat-one").hidden = np.repeat !== "one";
  setToggle("like", np.liked, np.liked ? "Unlike" : "Like");
  setToggle("repost", np.reposted, np.reposted ? "Remove repost" : "Repost");
  const volume = np.volume === null ? "" : ` (${np.volume * 10}%)`;
  setToggle("mute", np.muted, np.muted ? "Unmute" : `Mute${volume}`);
  $("icon-vol").toggleAttribute("hidden", np.muted);
  $("icon-muted").toggleAttribute("hidden", !np.muted);

  $("time-total").textContent = formatTime(np.duration);
  tick();
}

function setToggle(id: string, active: boolean, label: string): void {
  const el = $(id);
  el.classList.toggle("active", active);
  el.title = label;
  el.setAttribute("aria-label", label);
}

function tick(): void {
  cancelAnimationFrame(raf);
  const np = state.nowPlaying;
  if (!np) return;
  const pos = livePosition(np);
  $("time-passed").textContent = formatTime(pos);
  const progress = np.duration > 0 ? pos / np.duration : 0;
  drawWaveform(ctx, peaks, cssWidth, cssHeight, {
    progress,
    hover,
    barWidth: BAR_WIDTH,
    gap: GAP,
    colors: colors(),
  });
  if (np.playing) raf = requestAnimationFrame(() => setTimeout(tick, 250));
}

function applyState(next: StoredState): void {
  state = next;
  const waveform = next.nowPlaying ? next.waveforms?.[next.nowPlaying.trackKey] : undefined;
  if (waveform) {
    peaks = downsample(waveform.samples, waveform.height, bars);
  } else {
    // No peaks yet: draw a flat bar so the progress position is still visible.
    peaks = new Array<number>(bars).fill(0.12);
  }
  render();
}

function invoke(message: InvokeMessage): void {
  void chrome.runtime.sendMessage(message).catch(() => {
    /* worker restarting; the next state update will reflect reality */
  });
}

function wireControls(): void {
  for (const el of document.querySelectorAll<HTMLElement>("[data-command]")) {
    el.addEventListener("click", () => {
      const command = el.dataset.command as Command;
      // Optimistic update so the play button flips immediately.
      if (command === "play-pause" && state.nowPlaying) {
        const np = state.nowPlaying;
        state.nowPlaying = { ...np, position: livePosition(np), playing: !np.playing, updatedAt: Date.now() };
        render();
      }
      invoke({ type: "sc-shortcuts/invoke", command });
    });
  }

  $("focus").addEventListener("click", () => invoke({ type: "sc-shortcuts/invoke", command: "focus-tab" }));
  $("settings").addEventListener("click", () => void chrome.runtime.openOptionsPage());
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[target=_blank]")) {
    link.addEventListener("click", (e) => {
      // Open as a real tab rather than the popup's own navigation.
      e.preventDefault();
      if (link.href) void chrome.tabs.create({ url: link.href });
    });
  }

  const wave = $("wave");
  const fractionAt = (e: MouseEvent): number => {
    const rect = canvas.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  };
  wave.addEventListener("mousemove", (e) => {
    hover = fractionAt(e);
    const np = state.nowPlaying;
    const tip = $("hover-time");
    if (np) {
      tip.hidden = false;
      tip.textContent = formatTime(hover * np.duration);
      tip.style.left = `${e.clientX - wave.getBoundingClientRect().left}px`;
    }
    tick();
  });
  wave.addEventListener("mouseleave", () => {
    hover = null;
    $("hover-time").hidden = true;
    tick();
  });
  wave.addEventListener("click", (e) => {
    const np = state.nowPlaying;
    if (!np) return;
    const fraction = fractionAt(e);
    state.nowPlaying = { ...np, position: fraction * np.duration, updatedAt: Date.now() };
    tick();
    invoke({ type: "sc-shortcuts/invoke", seekTo: fraction });
  });
}

/** True when this page runs in the floating window the worker opens on track change. */
const isToast = new URLSearchParams(location.search).has("toast");

async function closeSelf(): Promise<void> {
  if (!isToast) {
    window.close();
    return;
  }
  // A window the extension created is closed through the windows API.
  const win = await chrome.windows.getCurrent();
  if (win.id !== undefined) await chrome.windows.remove(win.id);
}

let autoCloseTimer: ReturnType<typeof setTimeout> | null = null;
let autoCloseCancelled = false;

/**
 * When the worker opened this panel automatically, close it again after the
 * configured delay unless the user moves the mouse into it. In the floating
 * window the worker re-arms the timer for each new track by rewriting the
 * auto-open record, which arrives here as a storage change.
 */
function armAutoClose(auto: AutoOpen | undefined): void {
  if (!auto || autoCloseCancelled) return;
  void chrome.storage.session.remove(AUTO_OPEN_KEY);
  if (autoCloseTimer) clearTimeout(autoCloseTimer);
  autoCloseTimer = null;
  if (Date.now() - auto.at > 5000 || auto.closeAfter <= 0) return;
  autoCloseTimer = setTimeout(() => void closeSelf(), auto.closeAfter * 1000);
}

function cancelAutoClose(): void {
  autoCloseCancelled = true;
  if (autoCloseTimer) clearTimeout(autoCloseTimer);
  autoCloseTimer = null;
}

async function init(): Promise<void> {
  if (isToast) document.documentElement.classList.add("toast");
  wireControls();
  document.addEventListener("mouseenter", cancelAutoClose, { once: true });
  document.addEventListener("mousemove", cancelAutoClose, { once: true });
  document.addEventListener("keydown", cancelAutoClose, { once: true });
  const stored = await chrome.storage.session.get(AUTO_OPEN_KEY);
  armAutoClose(stored[AUTO_OPEN_KEY] as AutoOpen | undefined);
  applyState(await loadState());
  chrome.storage.session.onChanged.addListener((changes) => {
    const auto = changes[AUTO_OPEN_KEY];
    if (isToast && auto?.newValue) armAutoClose(auto.newValue as AutoOpen);
    const change = changes[STATE_KEY];
    if (change) {
      applyState({
        nowPlaying: null,
        tabId: null,
        waveforms: {},
        ...(change.newValue as Partial<StoredState> | undefined),
      });
    }
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", tick);
}

void init();
