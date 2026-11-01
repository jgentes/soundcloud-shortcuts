export type TabTargeting = "audible-first" | "active-first" | "first";

export interface Settings {
  /** How to pick the SoundCloud tab that receives a command. */
  tabTargeting: TabTargeting;
  /** Open soundcloud.com when a command fires and no SoundCloud tab exists. */
  openTabIfNone: boolean;
  /** Seconds moved by seek-forward / seek-backward. */
  seekStep: number;
  /** Show a system notification when a new track starts. */
  notifyOnTrackChange: boolean;
  /** Only notify when the SoundCloud tab is not the one being looked at. */
  notifyOnlyWhenHidden: boolean;
  /** Show play/pause state on the toolbar icon badge. */
  showStateBadge: boolean;
  /** Open the now-playing panel itself when a new track starts. */
  openPanelOnTrackChange: boolean;
  /** Seconds before an automatically opened panel closes itself; 0 keeps it open. */
  panelAutoCloseSeconds: number;
}

export const DEFAULT_SETTINGS: Settings = {
  tabTargeting: "audible-first",
  openTabIfNone: false,
  seekStep: 10,
  notifyOnTrackChange: true,
  notifyOnlyWhenHidden: false,
  showStateBadge: true,
  openPanelOnTrackChange: true,
  panelAutoCloseSeconds: 5,
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
  "notifyOnTrackChange",
  "notifyOnlyWhenHidden",
  "showStateBadge",
  "openPanelOnTrackChange",
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
