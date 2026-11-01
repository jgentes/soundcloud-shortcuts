# Shortcuts for SoundCloud

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/goacpmblhegeekdjdobjmjahmegjcokm?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white&color=4285f4)](https://chromewebstore.google.com/detail/shortcuts-for-soundcloud/goacpmblhegeekdjdobjmjahmegjcokm)
[![Edge Add-ons](https://img.shields.io/badge/dynamic/json?label=Edge%20Add-ons&prefix=v&query=%24.version&url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fpfjipggmdmbfoekoddgefhpfppmchdoa&logo=microsoftedge&color=0078d4)](https://microsoftedge.microsoft.com/addons/detail/shortcuts-for-soundcloud/pfjipggmdmbfoekoddgefhpfppmchdoa)
[![Edge users](https://img.shields.io/badge/dynamic/json?label=users&query=%24.activeInstallCount&url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fpfjipggmdmbfoekoddgefhpfppmchdoa&color=0078d4)](https://microsoftedge.microsoft.com/addons/detail/shortcuts-for-soundcloud/pfjipggmdmbfoekoddgefhpfppmchdoa)
[![CI](https://github.com/jgentes/soundcloud-shortcuts/actions/workflows/ci.yml/badge.svg)](https://github.com/jgentes/soundcloud-shortcuts/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Keyboard shortcuts for [soundcloud.com](https://soundcloud.com) that work from any tab, built as a Manifest V3 extension for Chrome and Microsoft Edge.

An independent project by [James Gentes](https://github.com/jgentes). Not affiliated with or endorsed by SoundCloud.

## Install

- **Chrome:** [Shortcuts for SoundCloud on the Chrome Web Store](https://chromewebstore.google.com/detail/shortcuts-for-soundcloud/goacpmblhegeekdjdobjmjahmegjcokm)
- **Microsoft Edge:** [Shortcuts for SoundCloud on Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/shortcuts-for-soundcloud/pfjipggmdmbfoekoddgefhpfppmchdoa)
- **Manual:** download a zip from the [latest release](https://github.com/jgentes/soundcloud-shortcuts/releases/latest), unzip it, and load it unpacked from `chrome://extensions` or `edge://extensions`

## Shortcuts

| Action | Default |
|---|---|
| Play / pause | `Alt+Shift+P` |
| Next track | `Alt+Shift+.` |
| Previous track | `Alt+Shift+,` |
| Like / unlike | `Alt+Shift+L` |
| Repost, seek forward/back, volume up/down, mute, shuffle, repeat, switch to the SoundCloud tab | unbound |

Remap or bind any of them at `chrome://extensions/shortcuts` or `edge://extensions/shortcuts`. Browsers allow four default bindings per extension, so the rest start unbound. On macOS use `Option` in place of `Alt`.

## Now playing

- The toolbar icon shows a small play/pause mark and opens a panel with artwork, title, artist, transport controls, like, repost, mute, and a SoundCloud-style waveform. Hover it for the time at the cursor; click to seek.
- When a new track starts, the panel appears in a small floating window for a few seconds without taking focus from what you are doing, and a system notification shows the artwork, title and artist with Next and Like buttons. Both can be turned off, and the notification can be limited to when you are not looking at the SoundCloud tab.

SoundCloud's player bar no longer shows whether the current track is reposted, so the panel reads that from the track's own page when it is open, and otherwise remembers your own repost toggles. A track you reposted before installing shows as not reposted until you open its page.

Settings (gear in the panel): which SoundCloud tab receives commands when several are open, seek step, open soundcloud.com if no tab exists, notification and badge toggles.

## Privacy

No data is collected or sent anywhere. The extension only talks to the soundcloud.com tab in your browser. Waveform peaks and artwork for the current track are fetched from SoundCloud's own CDN by the page, exactly as the site does. Permissions: `scripting` (to reach the player if the page loaded before the extension), `storage` (your settings and the current track), `notifications` (new-track alerts), and access to `https://soundcloud.com/*`.

## Development

```bash
pnpm install
pnpm dev          # Chrome with hot reload
pnpm dev:edge
pnpm test
pnpm build && pnpm build:edge
pnpm zip && pnpm zip:edge   # store-ready zips in .output/
```

Load unpacked from `.output/chrome-mv3` or `.output/edge-mv3`.

All SoundCloud DOM selectors live in [`src/lib/player-adapter.ts`](src/lib/player-adapter.ts). Each control tries the player's buttons first and falls back to the keyboard shortcut soundcloud.com handles itself.

Icons are generated from `scripts/icon.svg` with `node scripts/make-icons.mjs`.

## How it works

The content script watches SoundCloud's player bar with a `MutationObserver` and reports changes to the service worker, which keeps the current track in session storage, updates the badge, and raises notifications. The popup reads that state and interpolates the playhead between reports. Waveform peaks come from the JSON file SoundCloud itself loads for each track; the URL is read from the track page's embedded metadata.

## Roadmap

See [PLAN.md](PLAN.md).

## License

MIT © James Gentes
