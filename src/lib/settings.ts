export type TabTargeting = "audible-first" | "active-first" | "first";

export interface Settings {
  /** How to pick the SoundCloud tab that receives a command. */
  tabTargeting: TabTargeting;
  /** Open soundcloud.com when a command fires and no SoundCloud tab exists. */
  openTabIfNone: boolean;
  /** Seconds moved by seek-forward / seek-backward. */
  seekStep: number;
  /** Show play/pause state on the toolbar icon badge. */
  showStateBadge: boolean;
  /** Draw a now-playing card into the page being viewed when a new track starts. */
  openPanelOnTrackChange: boolean;
  /** Seconds before the card fades out again; 0 keeps it until dismissed. */
  panelAutoCloseSeconds: number;
  /** The user has answered the one-time prompt about the in-page card. */
  overlayPrompted: boolean;
}

/** Host access the in-page card needs: it is drawn into any page. */
export const OVERLAY_PERMISSION: chrome.permissions.Permissions = { origins: ["<all_urls>"] };

export function hasOverlayPermission(): Promise<boolean> {
  return chrome.permissions.contains(OVERLAY_PERMISSION);
}

export const DEFAULT_SETTINGS: Settings = {
  tabTargeting: "audible-first",
  openTabIfNone: false,
  seekStep: 10,
  showStateBadge: true,
  openPanelOnTrackChange: false,
  panelAutoCloseSeconds: 5,
  overlayPrompted: false,
};

const KEY = "settings";

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(KEY);
  return normalizeSettings(stored[KEY]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ [KEY]: normalizeSettings(settings) });
}

const BOOLEAN_KEYS = [
  "openTabIfNone",
  "showStateBadge",
  "openPanelOnTrackChange",
  "overlayPrompted",
] as const;

/** Merge stored values over defaults and reject out-of-range values. */
export function normalizeSettings(raw: unknown): Settings {
  const input = (raw ?? {}) as Partial<Record<keyof Settings, unknown>>;
  const out: Settings = { ...DEFAULT_SETTINGS };

  if (
    input.tabTargeting === "audible-first" ||
    input.tabTargeting === "active-first" ||
    input.tabTargeting === "first"
  ) {
    out.tabTargeting = input.tabTargeting;
  }
  for (const key of BOOLEAN_KEYS) {
    if (typeof input[key] === "boolean") out[key] = input[key] as boolean;
  }
  if (typeof input.seekStep === "number" && Number.isFinite(input.seekStep)) {
    out.seekStep = Math.min(120, Math.max(1, Math.round(input.seekStep)));
  }
  if (
    typeof input.panelAutoCloseSeconds === "number" &&
    Number.isFinite(input.panelAutoCloseSeconds)
  ) {
    out.panelAutoCloseSeconds = Math.min(60, Math.max(0, Math.round(input.panelAutoCloseSeconds)));
  }
  return out;
}
