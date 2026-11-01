import { defineBackground } from "wxt/utils/define-background";
import {
  WORKER_ONLY_COMMANDS,
  isCommand,
  type Command,
  type CommandMessage,
  type CommandResult,
  type Message,
  type SeekToMessage,
} from "@/lib/messages";
import { loadSettings, type Settings } from "@/lib/settings";
import {
  AUTO_OPEN_KEY,
  TOAST_WINDOW_KEY,
  loadState,
  rememberWaveform,
  saveState,
  type NowPlaying,
  type StoredState,
  type Waveform,
} from "@/lib/state";
import { SOUNDCLOUD_URL_PATTERN, pickTargetTab } from "@/lib/tab-picker";

const SOUNDCLOUD_HOME = "https://soundcloud.com/";
const CONTENT_SCRIPT = "content-scripts/soundcloud.js";
const NOTIFICATION_ID = "sc-shortcuts/now-playing";

export default defineBackground(() => {
  chrome.commands.onCommand.addListener((command) => {
    if (!isCommand(command)) return;
    void handleCommand(command).catch((error) => {
      console.error("[sc-shortcuts] command failed", command, error);
    });
  });

  chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
    switch (message.type) {
      case "sc-shortcuts/state":
        if (sender.tab?.id !== undefined) void onStateReport(sender.tab.id, message.state);
        return;
      case "sc-shortcuts/waveform":
        if (sender.tab?.id !== undefined) void onWaveform(sender.tab.id, message.waveform);
        return;
      case "sc-shortcuts/invoke":
        void ("command" in message ? handleCommand(message.command) : seekTo(message.seekTo))
          .then(() => sendResponse({ ok: true }))
          .catch((error) => sendResponse({ ok: false, detail: String(error) }));
        return true; // async response
    }
  });

  chrome.windows.onRemoved.addListener((windowId) => {
    void chrome.storage.session.get(TOAST_WINDOW_KEY).then((stored) => {
      if (stored[TOAST_WINDOW_KEY] === windowId) return chrome.storage.session.remove(TOAST_WINDOW_KEY);
    });
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      const state = await loadState();
      if (state.tabId === tabId) {
        await saveState({ ...state, nowPlaying: null, tabId: null });
        await setStateBadge(null);
      }
    })();
  });

  chrome.notifications.onClicked.addListener((id) => {
    if (id !== NOTIFICATION_ID) return;
    chrome.notifications.clear(id);
    void handleCommand("focus-tab");
  });

  chrome.notifications.onButtonClicked.addListener((id, index) => {
    if (id !== NOTIFICATION_ID) return;
    void handleCommand(index === 0 ? "next" : "like");
  });

  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") void chrome.runtime.openOptionsPage();
    // Tabs that were already open keep an orphaned copy of the old content
    // script, so inject the new one to resume now-playing reports. Not on a
    // browser update: restored tabs load their own copy then.
    if (details.reason === "install" || details.reason === "update") void injectIntoOpenTabs();
  });
});

/* ---------------- commands ---------------- */

async function handleCommand(command: Command): Promise<void> {
  const settings = await loadSettings();
  const tab = await findTargetTab(settings);

  if (!tab?.id) {
    if (settings.openTabIfNone) await chrome.tabs.create({ url: SOUNDCLOUD_HOME });
    return;
  }

  if (WORKER_ONLY_COMMANDS.has(command)) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
    return;
  }

  const result = await sendToTab(tab.id, {
    type: "sc-shortcuts/command",
    command,
    seekStep: settings.seekStep,
  });
  if (!result?.ok) console.warn("[sc-shortcuts]", command, result?.detail);
}

async function injectIntoOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: SOUNDCLOUD_URL_PATTERN });
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) return;
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [CONTENT_SCRIPT] });
      } catch (error) {
        console.warn("[sc-shortcuts] could not inject into tab", tab.id, error);
      }
    }),
  );
}

async function seekTo(fraction: number): Promise<void> {
  const state = await loadState();
  const tabId = state.tabId ?? (await findTargetTab(await loadSettings()))?.id;
  if (tabId === undefined) return;
  await sendToTab(tabId, { type: "sc-shortcuts/seek-to", fraction });
}

async function findTargetTab(settings: Settings): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ url: SOUNDCLOUD_URL_PATTERN });
  // Prefer the tab we know is showing a track.
  const known = (await loadState()).tabId;
  const knownTab = tabs.find((t) => t.id === known);
  if (knownTab && (knownTab.audible || settings.tabTargeting !== "active-first")) return knownTab;

  let focusedWindowId: number | undefined;
  try {
    focusedWindowId = (await chrome.windows.getLastFocused()).id;
  } catch {
    focusedWindowId = undefined;
  }
  return pickTargetTab(tabs, settings.tabTargeting, focusedWindowId);
}

/**
 * Deliver a message to the content script. A tab that was open before the
 * extension was installed or updated has no content script yet, so inject it
 * on demand and retry once.
 */
async function sendToTab(
  tabId: number,
  message: CommandMessage | SeekToMessage,
): Promise<CommandResult> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as CommandResult;
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] });
    return (await chrome.tabs.sendMessage(tabId, message)) as CommandResult;
  }
}

/* ---------------- now-playing state ---------------- */

async function onStateReport(tabId: number, incoming: NowPlaying | null): Promise<void> {
  const current = await loadState();

  // Several SoundCloud tabs may report. Keep following the tab we have unless
  // another one starts playing, and ignore "nothing loaded" from bystanders.
  if (current.tabId !== null && current.tabId !== tabId) {
    const currentIsPlaying = current.nowPlaying?.playing ?? false;
    if (!incoming || (currentIsPlaying && !incoming.playing)) return;
  }

  const next: StoredState = {
    nowPlaying: incoming,
    tabId: incoming ? tabId : null,
    waveforms: current.waveforms ?? {},
    notifiedKey: current.notifiedKey ?? null,
  };

  const settings = await loadSettings();
  // A new track is announced once it is actually playing. SoundCloud often
  // reports the new track in a paused/loading state first, so compare against
  // the last announced track rather than the previous report.
  const isNewTrack = !!incoming && incoming.playing && incoming.trackKey !== next.notifiedKey;
  if (isNewTrack && settings.notifyOnTrackChange) {
    next.notifiedKey = incoming.trackKey;
  }
  await saveState(next);

  if (settings.showStateBadge) await setStateBadge(incoming);
  if (isNewTrack && incoming) {
    if (settings.notifyOnTrackChange) {
      const result = await notifyTrack(tabId, incoming, settings);
      if (!result.ok) console.warn("[sc-shortcuts] notification failed:", result.detail);
    }
    if (settings.openPanelOnTrackChange) await openPanel(settings);
  } else if (incoming?.artworkData && incoming.trackKey === next.notifiedKey) {
    // Artwork arrived after the notification was shown; refresh its icon.
    await updateNotificationIcon(incoming);
  }
}

/** Outer size of the floating panel window: the 340x126 panel plus the frame. */
const TOAST_WIDTH = 356;
const TOAST_HEIGHT = 168;
const TOAST_MARGIN = 16;

/**
 * Show the now-playing panel in a small window of its own, without focus.
 * The toolbar popup would steal focus (and close as soon as it lost it), so
 * an unfocused popup-type window is used instead; it closes itself after the
 * configured delay. If one is already open it is reused and its timer reset.
 */
async function openPanel(settings: Settings): Promise<void> {
  try {
    // Tell the panel it was opened automatically so it can close itself.
    await chrome.storage.session.set({
      [AUTO_OPEN_KEY]: { at: Date.now(), closeAfter: settings.panelAutoCloseSeconds },
    });
    if (await toastWindowExists()) return;

    let left: number | undefined;
    let top: number | undefined;
    try {
      const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
      if (win.left !== undefined && win.width !== undefined) {
        left = win.left + win.width - TOAST_WIDTH - TOAST_MARGIN;
      }
      if (win.top !== undefined && win.height !== undefined) {
        top = win.top + win.height - TOAST_HEIGHT - TOAST_MARGIN;
      }
    } catch {
      /* no normal window; the browser picks a position */
    }
    const created = await chrome.windows.create({
      url: chrome.runtime.getURL("popup.html?toast=1"),
      type: "popup",
      focused: false,
      width: TOAST_WIDTH,
      height: TOAST_HEIGHT,
      left,
      top,
    });
    if (created?.id !== undefined) {
      await chrome.storage.session.set({ [TOAST_WINDOW_KEY]: created.id });
    }
  } catch (error) {
    console.warn("[sc-shortcuts] could not open panel:", error);
  }
}

async function toastWindowExists(): Promise<boolean> {
  const stored = await chrome.storage.session.get(TOAST_WINDOW_KEY);
  const id = stored[TOAST_WINDOW_KEY] as number | undefined;
  if (id === undefined) return false;
  try {
    await chrome.windows.get(id);
    return true;
  } catch {
    await chrome.storage.session.remove(TOAST_WINDOW_KEY);
    return false;
  }
}

async function onWaveform(_tabId: number, waveform: Waveform): Promise<void> {
  // Keyed by track, so ordering against state reports does not matter.
  const current = await loadState();
  await saveState({ ...current, waveforms: rememberWaveform(current.waveforms ?? {}, waveform) });
}

/** Swap the toolbar icon for a variant with a small play/pause mark in the corner. */
async function setStateBadge(state: NowPlaying | null): Promise<void> {
  const variant = state ? (state.playing ? "playing" : "paused") : "";
  const suffix = variant ? `-${variant}` : "";
  await chrome.action.setIcon({
    path: { 16: `icon/16${suffix}.png`, 32: `icon/32${suffix}.png`, 48: `icon/48${suffix}.png` },
  });
  await chrome.action.setBadgeText({ text: "" });
  await chrome.action.setTitle({
    title: state ? `${state.title} — ${state.artist}` : "Shortcuts for SoundCloud",
  });
}

async function notifyTrack(
  tabId: number,
  state: NowPlaying,
  settings: Settings,
): Promise<CommandResult> {
  if (settings.notifyOnlyWhenHidden && (await tabIsBeingViewed(tabId))) {
    return { ok: true, detail: "skipped: SoundCloud tab is being viewed" };
  }
  const result = await createNotification({
    type: "basic",
    iconUrl: state.artworkData ?? chrome.runtime.getURL("icon/128.png"),
    title: state.title,
    message: state.artist,
    contextMessage: "Now playing on SoundCloud",
    buttons: [{ title: "Next" }, { title: state.liked ? "Unlike" : "Like" }],
    silent: true,
  });
  return result;
}

async function updateNotificationIcon(state: NowPlaying): Promise<void> {
  if (!state.artworkData) return;
  await new Promise<void>((resolve) => {
    chrome.notifications.update(NOTIFICATION_ID, { iconUrl: state.artworkData }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

/** Create (replacing any previous) and report errors instead of swallowing them. */
function createNotification(
  options: chrome.notifications.NotificationCreateOptions,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    chrome.notifications.clear(NOTIFICATION_ID, () => {
      void chrome.runtime.lastError;
      chrome.notifications.create(NOTIFICATION_ID, options, (id) => {
        const error = chrome.runtime.lastError?.message;
        if (error) resolve({ ok: false, detail: error });
        else if (!id) resolve({ ok: false, detail: "browser returned no notification id" });
        else resolve({ ok: true });
      });
    });
  });
}

async function tabIsBeingViewed(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active || tab.windowId === undefined) return false;
    const win = await chrome.windows.get(tab.windowId);
    return !!win.focused;
  } catch {
    return false;
  }
}
