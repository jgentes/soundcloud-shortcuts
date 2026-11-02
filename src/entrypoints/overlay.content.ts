import { defineContentScript } from "wxt/utils/define-content-script";
import type { CommandResult, Message } from "@/lib/messages";
import { createOverlayCard, type OverlayCard } from "@/lib/overlay-card";

/**
 * Draws the now-playing card into whatever page the user is looking at when a
 * track changes. It is never listed in the manifest: the worker injects it on
 * demand, and only once the user has granted access to all sites.
 */

interface Instance {
  dispose(): void;
}
declare global {
  interface Window {
    __scShortcutsOverlay?: Instance;
  }
}

export default defineContentScript({
  matches: ["<all_urls>"],
  registration: "runtime",
  runAt: "document_idle",
  main() {
    try {
      window.__scShortcutsOverlay?.dispose();
    } catch {
      /* orphaned copy from a previous extension version */
    }

    let card: OverlayCard | null = null;
    let closeAfter = 0;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    const invoke = (message: Message) =>
      void chrome.runtime.sendMessage(message).catch(() => {
        /* worker restarting */
      });

    function armHide(): void {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = null;
      if (closeAfter > 0) hideTimer = setTimeout(() => card?.hide(), closeAfter * 1000);
    }

    function ensureCard(): OverlayCard {
      if (card && card.host.isConnected) return card;
      card = createOverlayCard({
        onCommand: (command) => invoke({ type: "sc-shortcuts/invoke", command }),
        onDismiss: () => card?.hide(),
        onOpen: (url) => window.open(url, "_blank", "noopener"),
      });
      // Hovering keeps the card; leaving starts the countdown again.
      card.host.addEventListener("mouseenter", () => {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = null;
      });
      card.host.addEventListener("mouseleave", armHide);
      (document.body ?? document.documentElement).append(card.host);
      return card;
    }

    const listener = (message: Message, _sender: unknown, sendResponse: (r: CommandResult) => void) => {
      switch (message.type) {
        case "sc-shortcuts/overlay-show": {
          const c = ensureCard();
          closeAfter = message.closeAfter;
          c.update(message.state);
          c.show();
          armHide();
          sendResponse({ ok: true });
          return;
        }
        case "sc-shortcuts/overlay-state":
          if (card?.visible) {
            if (message.state) card.update(message.state);
            else card.hide();
          }
          sendResponse({ ok: true });
          return;
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    window.__scShortcutsOverlay = {
      dispose() {
        try {
          chrome.runtime.onMessage.removeListener(listener);
        } catch {
          /* context gone */
        }
        if (hideTimer) clearTimeout(hideTimer);
        card?.host.remove();
        card = null;
      },
    };
  },
});
