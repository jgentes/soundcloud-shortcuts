import { loadSettings, saveSettings, type Settings } from "@/lib/settings";

const isEdge = /\bEdg\//.test(navigator.userAgent);
const SHORTCUTS_URL = isEdge ? "edge://extensions/shortcuts" : "chrome://extensions/shortcuts";

const BOOLEAN_KEYS = [
  "openTabIfNone",
  "showStateBadge",
  "notifyOnTrackChange",
  "notifyOnlyWhenHidden",
  "openPanelOnTrackChange",
] as const;

async function renderCommands(): Promise<void> {
  const tbody = document.querySelector<HTMLTableSectionElement>("#commands tbody");
  if (!tbody) return;
  const commands = await chrome.commands.getAll();
  tbody.replaceChildren(
    ...commands
      .filter((c) => c.name && c.name !== "_execute_action")
      .map((c) => {
        const tr = document.createElement("tr");
        const action = document.createElement("td");
        action.textContent = c.description ?? c.name ?? "";
        const key = document.createElement("td");
        if (c.shortcut) {
          const kbd = document.createElement("kbd");
          kbd.textContent = c.shortcut;
          key.append(kbd);
        } else {
          key.textContent = "not set";
          key.className = "unbound";
        }
        tr.append(action, key);
        return tr;
      }),
  );
}

function input(form: HTMLFormElement, name: string): HTMLInputElement {
  return form.elements.namedItem(name) as HTMLInputElement;
}

/** Read every control directly (FormData skips disabled inputs). */
function readForm(form: HTMLFormElement): Settings {
  const flags = Object.fromEntries(BOOLEAN_KEYS.map((k) => [k, input(form, k).checked])) as Pick<
    Settings,
    (typeof BOOLEAN_KEYS)[number]
  >;
  return {
    ...flags,
    tabTargeting: (form.elements.namedItem("tabTargeting") as HTMLSelectElement)
      .value as Settings["tabTargeting"],
    seekStep: Number(input(form, "seekStep").value),
    panelAutoCloseSeconds: Number(input(form, "panelAutoCloseSeconds").value),
  };
}

function writeForm(form: HTMLFormElement, settings: Settings): void {
  (form.elements.namedItem("tabTargeting") as HTMLSelectElement).value = settings.tabTargeting;
  input(form, "seekStep").value = String(settings.seekStep);
  input(form, "panelAutoCloseSeconds").value = String(settings.panelAutoCloseSeconds);
  for (const key of BOOLEAN_KEYS) input(form, key).checked = settings[key];
  syncDependents(form);
}

/** Grey out sub-settings whose parent checkbox (data-depends) is unchecked. */
function syncDependents(form: HTMLFormElement): void {
  for (const sub of form.querySelectorAll<HTMLElement>("[data-depends]")) {
    const enabled = input(form, sub.dataset.depends ?? "").checked;
    sub.classList.toggle("disabled", !enabled);
    for (const el of sub.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")) {
      el.disabled = !enabled;
    }
  }
}

/**
 * Fire a notification on demand and report what the browser said, so a user
 * who never sees one can tell whether Windows or the browser is blocking them.
 */
async function testNotification(status: HTMLElement): Promise<void> {
  status.textContent = "Sending…";
  const level = await new Promise<string>((resolve) =>
    chrome.notifications.getPermissionLevel((l) => resolve(l)),
  );
  if (level === "denied") {
    status.textContent =
      "Notifications are blocked for this extension in the browser's settings.";
    return;
  }
  const id = "sc-shortcuts/test";
  const error = await new Promise<string | undefined>((resolve) =>
    chrome.notifications.create(
      id,
      {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icon/128.png"),
        title: "Shortcuts for SoundCloud",
        message: "Notifications are working.",
        contextMessage: "Test notification",
      },
      () => resolve(chrome.runtime.lastError?.message),
    ),
  );
  status.textContent = error
    ? `The browser refused it: ${error}`
    : "Sent. If nothing appeared, Windows is hiding notifications from the browser (check Settings > System > Notifications, and Do not disturb).";
}

async function init(): Promise<void> {
  const notificationStatus = document.querySelector<HTMLElement>("#notification-status");
  document.querySelector("#test-notification")?.addEventListener("click", () => {
    if (notificationStatus) void testNotification(notificationStatus);
  });

  document.querySelector("#open-shortcuts")?.addEventListener("click", () => {
    void chrome.tabs.create({ url: SHORTCUTS_URL });
  });

  const form = document.querySelector<HTMLFormElement>("#settings");
  const status = document.querySelector<HTMLElement>("#status");
  if (form) {
    writeForm(form, await loadSettings());
    form.addEventListener("change", async () => {
      await saveSettings(readForm(form));
      writeForm(form, await loadSettings());
      if (status) {
        status.textContent = "Saved";
        setTimeout(() => (status.textContent = ""), 1200);
      }
    });
  }

  await renderCommands();
  // Refresh bindings when the user comes back from the shortcut settings page.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void renderCommands();
  });
}

void init();
