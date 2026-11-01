import { defineContentScript } from "wxt/utils/define-content-script";
import type { CommandResult, Message, StateMessage, WaveformMessage } from "@/lib/messages";
import {
  artworkAtSize,
  find,
  readNowPlaying,
  runCommand,
  seekToFraction,
} from "@/lib/player-adapter";
import type { NowPlaying, Waveform } from "@/lib/state";
import { extractWaveformUrl, isWaveformJson } from "@/lib/waveform";

/** Handle left on the (isolated-world) window so a later copy can replace this one. */
interface Instance {
  dispose(): void;
}
declare global {
  interface Window {
    __scShortcutsInstance?: Instance;
  }
}

export default defineContentScript({
  matches: ["https://soundcloud.com/*"],
  runAt: "document_idle",
  main() {
    // Exactly one live copy per tab. A second copy can arrive when on-demand
    // injection races the page's own script during load, or when the worker
    // re-injects after an update; two copies would answer every command and
    // click the player twice, so play/pause toggled back and forth.
    try {
      window.__scShortcutsInstance?.dispose();
    } catch {
      /* an orphaned copy from a previous extension version; nothing to do */
    }

    const listener = (message: Message, _sender: unknown, sendResponse: (r: CommandResult) => void) => {
      switch (message.type) {
        case "sc-shortcuts/ping":
          sendResponse({ ok: true });
          return;
        case "sc-shortcuts/command":
          sendResponse(safely(() => runCommand(message.command, message.seekStep)));
          return;
        case "sc-shortcuts/seek-to":
          sendResponse(safely(() => seekToFraction(message.fraction)));
          return;
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    watchPlayer();

    window.__scShortcutsInstance = {
      dispose() {
        try {
          chrome.runtime.onMessage.removeListener(listener);
        } catch {
          /* context already invalidated */
        }
        shutdown();
      },
    };
  },
});

function safely(fn: () => CommandResult): CommandResult {
  try {
    return fn();
  } catch (error) {
    return { ok: false, detail: String(error) };
  }
}

/* ---------------- now-playing reporting ---------------- */

let observer: MutationObserver | null = null;
let poll: ReturnType<typeof setInterval> | null = null;

/** After an extension reload this copy is orphaned; stop it so it goes quiet. */
function isOrphaned(): boolean {
  try {
    return !chrome.runtime?.id;
  } catch {
    return true;
  }
}

function shutdown(): void {
  observer?.disconnect();
  observer = null;
  if (poll) clearInterval(poll);
  poll = null;
}

let lastSent: string | null = null;
let lastTrackKey: string | null = null;
const artworkCache = new Map<string, string>();
const waveformCache = new Map<string, Waveform>();

function watchPlayer(): void {
  const controls = find("playControls");
  if (!controls) {
    // SoundCloud renders the player bar after hydration; try again shortly.
    setTimeout(watchPlayer, 1000);
    return;
  }
  observer = new MutationObserver(scheduleReport);
  observer.observe(controls, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  // Some updates (e.g. after a page navigation inside the SPA) arrive without
  // a mutation we can see, so poll slowly as a safety net.
  poll = setInterval(scheduleReport, 2000);
  scheduleReport();
}

let timer: ReturnType<typeof setTimeout> | null = null;
function scheduleReport(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    report();
  }, 150);
}

function report(): void {
  if (isOrphaned()) {
    shutdown();
    return;
  }
  const state = readNowPlaying();
  if (state) {
    const cached = artworkCache.get(state.trackKey);
    if (cached) state.artworkData = cached;
  }
  const key = state ? fingerprint(state) : "none";
  if (key === lastSent) return;
  lastSent = key;
  send({ type: "sc-shortcuts/state", state });

  if (state && state.trackKey !== lastTrackKey) {
    lastTrackKey = state.trackKey;
    void enrich(state);
  }
}

/** Only the fields whose change is worth a message. */
function fingerprint(s: NowPlaying): string {
  return [
    s.trackKey,
    s.playing,
    Math.floor(s.position),
    Math.floor(s.duration),
    s.liked,
    s.reposted,
    s.shuffle,
    s.repeat,
    s.volume,
    s.muted,
    s.artworkData ? 1 : 0,
  ].join("|");
}

function send(message: StateMessage | WaveformMessage): void {
  try {
    void chrome.runtime.sendMessage(message).catch(() => {
      /* worker asleep or extension reloading; next report will retry */
    });
  } catch {
    /* extension context invalidated */
  }
}

/** Fetch artwork (as a data URL) and waveform peaks for a newly started track. */
async function enrich(state: NowPlaying): Promise<void> {
  await Promise.all([loadArtwork(state), loadWaveform(state)]);
}

async function loadArtwork(state: NowPlaying): Promise<void> {
  if (!state.artworkUrl || artworkCache.has(state.trackKey)) return;
  try {
    const response = await fetch(artworkAtSize(state.artworkUrl, 200));
    if (!response.ok) return;
    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    artworkCache.set(state.trackKey, dataUrl);
    lastSent = null; // force a resend with the artwork attached
    scheduleReport();
  } catch {
    /* artwork is optional */
  }
}

async function loadWaveform(state: NowPlaying): Promise<void> {
  const cached = waveformCache.get(state.trackKey);
  if (cached) {
    // The worker may have evicted it (or restarted); resend every time the track comes back.
    send({ type: "sc-shortcuts/waveform", waveform: cached });
    return;
  }
  try {
    const page = await fetch(state.trackUrl, { credentials: "omit" });
    if (!page.ok) return;
    const url = extractWaveformUrl(await page.text());
    if (!url) return;
    const response = await fetch(url);
    if (!response.ok) return;
    const json: unknown = await response.json();
    if (!isWaveformJson(json)) return;
    const waveform: Waveform = { trackKey: state.trackKey, samples: json.samples, height: json.height };
    waveformCache.set(state.trackKey, waveform);
    send({ type: "sc-shortcuts/waveform", waveform });
  } catch {
    /* the popup falls back to a plain progress bar */
  }
}
