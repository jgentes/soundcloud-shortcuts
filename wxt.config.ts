import { defineConfig } from "wxt";

// Browser-level shortcut defaults. Users remap these at
// chrome://extensions/shortcuts or edge://extensions/shortcuts.
// Browsers accept at most four suggested keys per extension; the remaining
// commands ship unbound and can be bound by the user.
export default defineConfig({
  srcDir: "src",
  hooks: {
    "build:manifestGenerated": (_wxt, manifest) => {
      // WXT copies the overlay script's matches into host_permissions even
      // though it is injected at runtime. Keep <all_urls> optional only, so
      // installing does not warn about access to all sites.
      manifest.host_permissions = manifest.host_permissions?.filter((p: string) => p !== "<all_urls>");
    },
  },
  manifest: {
    name: "Shortcuts for SoundCloud",
    short_name: "SC Shortcuts",
    description:
      "Keyboard shortcuts for SoundCloud from any tab, plus a now-playing panel with a seekable waveform that can pop up when the track changes.",
    homepage_url: "https://github.com/jgentes/soundcloud-shortcuts",
    permissions: ["scripting", "storage"],
    host_permissions: ["https://soundcloud.com/*"],
    // Granted only if the user turns on the in-page now-playing card, which
    // is drawn into whatever page they are looking at when a track changes.
    optional_host_permissions: ["<all_urls>"],
    minimum_chrome_version: "116",
    action: {
      default_title: "Shortcuts for SoundCloud",
    },
    commands: {
      "play-pause": {
        description: "Play / pause",
        suggested_key: { default: "Alt+Shift+P" },
      },
      next: {
        description: "Next track",
        suggested_key: { default: "Alt+Shift+Period" },
      },
      previous: {
        description: "Previous track",
        suggested_key: { default: "Alt+Shift+Comma" },
      },
      like: {
        description: "Like / unlike current track",
        suggested_key: { default: "Alt+Shift+L" },
      },
      repost: { description: "Repost / un-repost current track" },
      "seek-forward": { description: "Seek forward" },
      "seek-backward": { description: "Seek backward" },
      "volume-up": { description: "Volume up" },
      "volume-down": { description: "Volume down" },
      mute: { description: "Mute / unmute" },
      shuffle: { description: "Toggle shuffle" },
      repeat: { description: "Cycle repeat mode" },
      "focus-tab": { description: "Switch to the SoundCloud tab" },
    },
  },
});
