import { defineBackground } from "wxt/utils/define-background";
import {
  WORKER_ONLY_COMMANDS,
  isCommand,
  type Command,
  type CommandMessage,
  type CommandResult,
  type Message,
  type OverlayShowMessage,
  type SeekToMessage,
} from "@/lib/messages";
import { hasOverlayPermission, loadSettings, type Settings } from "@/lib/settings";
import {
  OVERLAY_TAB_KEY,
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
const OVERLAY_SCRIPT = "content-scripts/overlay.js";
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

  chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      const overlay = await chrome.storage.session.get(OVERLAY_TAB_KEY);
      if (overlay[OVERLAY_TAB_KEY] === tabId) await chrome.storage.session.remove(OVERLAY_TAB_KEY);
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
    // Existing users get the one-time prompt for the in-page card too.
    if (details.reason === "update") void promptForOverlayOnce();
    // Tabs that were already open keep an orphaned copy of the old content
    // script, so inject the new one to resume now-playing reports. Not on a
    // browser update: restored tabs load their own copy then.
    if (details.reason === "install" || details.reason === "update") void injectIntoOpenTabs();
  });
});

async function promptForOverlayOnce(): Promise<void> {
  const settings = await loadSettings();
  if (settings.overlayPrompted) return;
  await chrome.runtime.openOptionsPage();
}

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
    if (settings.openPanelOnTrackChange) await showOverlay(settings, incoming);
  } else {
    if (incoming?.artworkData && incoming.trackKey === next.notifiedKey) {
      // Artwork arrived after the notification was shown; refresh its icon.
      await updateNotificationIcon(incoming);
    }
    if (settings.openPanelOnTrackChange && overlayRelevantChange(current.nowPlaying, incoming)) {
      await updateOverlay(incoming);
    }
  }
}

/**
 * Draw the now-playing card into the page the user is looking at. A window of
 * its own would either steal focus or sit behind the active window, so the
 * card goes into the page instead, which needs the optional all-sites access.
 */
async function showOverlay(settings: Settings, state: NowPlaying): Promise<void> {
  try {
    if (!(await hasOverlayPermission())) return;
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined || !tab.url || !overlayAllowedOn(tab.url)) return;
    await chrome.storage.session.set({ [OVERLAY_TAB_KEY]: tab.id });
    await sendToOverlay(tab.id, {
      type: "sc-shortcuts/overlay-show",
      state,
      closeAfter: settings.panelAutoCloseSeconds,
    });
  } catch (error) {
    console.warn("[sc-shortcuts] could not show the now-playing card:", error);
  }
}

/** Ordinary web pages only: browser pages cannot be scripted, and SoundCloud shows the track itself. */
function overlayAllowedOn(url: string): boolean {
  return /^(https?|file):/.test(url) && !/^https:\/\/(www\.)?soundcloud\.com\//.test(url);
}

/** Keep a visible card in step with play/pause and like changes. */
async function updateOverlay(state: NowPlaying | null): Promise<void> {
  const stored = await chrome.storage.session.get(OVERLAY_TAB_KEY);
  const tabId = stored[OVERLAY_TAB_KEY] as number | undefined;
  if (tabId === undefined) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: "sc-shortcuts/overlay-state", state });
  } catch {
    // Tab navigated or closed; stop sending to it.
    await chrome.storage.session.remove(OVERLAY_TAB_KEY);
  }
}

/** Deliver to the overlay script, injecting it first when the page has none yet. */
async function sendToOverlay(tabId: number, message: OverlayShowMessage): Promise<void> {
  const delivered = async () => {
    try {
      const result = (await chrome.tabs.sendMessage(tabId, message)) as CommandResult | undefined;
      return result?.ok === true;
    } catch {
      return false;
    }
  };
  if (await delivered()) return;
  await chrome.scripting.executeScript({ target: { tabId }, files: [OVERLAY_SCRIPT] });
  if (!(await delivered())) throw new Error("overlay script did not answer");
}

/** The card shows play state, artwork, title and like state; ignore position ticks. */
function overlayRelevantChange(prev: NowPlaying | null, next: NowPlaying | null): boolean {
  if (!prev || !next) return prev !== next;
  return (
    prev.trackKey !== next.trackKey ||
    prev.playing !== next.playing ||
    prev.liked !== next.liked ||
    (prev.artworkData ?? null) !== (next.artworkData ?? null)
  );
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
