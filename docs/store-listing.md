# Store listing and submission

Everything needed to publish to the Chrome Web Store and Microsoft Edge Add-ons. Copy the text blocks below into the dashboards verbatim.

## Packages

Tagging `vX.Y.Z` (matching `package.json`) builds and attaches both zips to a GitHub release:

- `soundcloud-shortcuts-X.Y.Z-chrome.zip` → Chrome Web Store
- `soundcloud-shortcuts-X.Y.Z-edge.zip` → Edge Add-ons

Or locally: `pnpm zip && pnpm zip:edge` (output in `.output/`).

## Assets (in `docs/store-assets/`, regenerate with `pnpm assets`)

| File | Use |
|---|---|
| `icon-300.png` | Edge store logo (300×300) |
| `public/icon/128.png` | Chrome store icon (128×128) |
| `screenshot-1-shortcuts.png` … `screenshot-4-options.png` | Screenshots, 1280×800, both stores |
| `promo-tile-440x280.png` | Chrome small promo tile |
| `marquee-1400x560.jpg` / `.png` | Marquee promo tile (JPEG for Chrome, PNG for Edge) |

Screenshots use fictional track names and generated artwork, no third-party material.

## Listing text

### Name
Shortcuts for SoundCloud

### Short description (Chrome: 132 chars max; Edge: 250)
Keyboard shortcuts for SoundCloud from any tab, plus a now-playing panel with a seekable waveform that can pop up when the track changes.

### Description
Keyboard shortcuts for soundcloud.com that work no matter which tab you are on, plus a compact now-playing panel.

SHORTCUTS
Defaults: Alt+Shift+P play/pause, Alt+Shift+. next, Alt+Shift+, previous, Alt+Shift+L like. Seek, volume, mute, repost, shuffle, repeat and "switch to the SoundCloud tab" can be bound too. Change any shortcut at chrome://extensions/shortcuts (Edge: edge://extensions/shortcuts). On macOS use Option instead of Alt.

NOW PLAYING
Click the toolbar icon for a panel with artwork, title, artist, play/pause, previous/next, like, repost, mute, and a waveform you can click to seek. The icon shows play/pause state. Optionally, when a new track starts the same panel slides into the corner of the page you are viewing for a few seconds without taking focus (asks once for access to all sites).

When several SoundCloud tabs are open, the one that is playing gets the command.

PRIVACY
No data collection, no accounts, no analytics, no servers. The extension only talks to the soundcloud.com tab in your browser. Open source (MIT): https://github.com/jgentes/soundcloud-shortcuts

Independent project, not affiliated with or endorsed by SoundCloud.

### Category
Chrome: Productivity → Tools. Edge: Productivity.

### Language
English

### Links
- Homepage / support: https://github.com/jgentes/soundcloud-shortcuts
- Support (issues): https://github.com/jgentes/soundcloud-shortcuts/issues
- Privacy policy: https://github.com/jgentes/soundcloud-shortcuts/blob/main/PRIVACY.md

## Chrome Web Store: Privacy practices tab

**Single purpose**
Control and display the soundcloud.com player from the browser toolbar and keyboard.

**Permission justifications**
- `scripting`: inject the control script into a soundcloud.com tab that was already open when the extension was installed or updated, so shortcuts and the panel work without reloading the page.
- `storage`: save the user's settings (synced by the browser) and keep the currently playing track in session storage for the panel.
- Host permission `https://soundcloud.com/*`: find the SoundCloud tab, read the player bar (track, position, like state) and click the player's own controls.
- Optional host permission `<all_urls>`: only requested if the user turns on the now-playing card. When a track changes, a small card with the track's artwork, title, artist, play/next/like buttons and seekable waveform is drawn into the page the user is currently viewing, so they see what started without a focus-stealing window. Nothing is read from those pages.

**Remote code**: No, the extension does not use remote code.

**Data usage**: tick nothing under "What user data do you plan to collect?". Certify all three disclosures (not sold, not used for unrelated purposes, not used for creditworthiness).

## Edge Partner Center: Properties

- Privacy policy URL: https://github.com/jgentes/soundcloud-shortcuts/blob/main/PRIVACY.md
- Website: https://github.com/jgentes/soundcloud-shortcuts
- Support contact: https://github.com/jgentes/soundcloud-shortcuts/issues
- Mature content: No. Does the extension collect personal information: No.
- Notes for certification: "Keyboard shortcuts and a now-playing panel for soundcloud.com. To test: open https://soundcloud.com, play any public track, press Alt+Shift+P from another tab, then click the toolbar icon. No account required. Source: github.com/jgentes/soundcloud-shortcuts"

## Submission checklist

1. Accounts (one-time, one-time, personal jgentes account):
   - Chrome Web Store developer account: https://chrome.google.com/webstore/devconsole ($5, needs a Google account with 2-step verification; set publisher name "James Gentes", verify the contact email).
   - Microsoft Partner Center, Edge Add-ons program: https://partner.microsoft.com/dashboard/microsoftedge (free).
2. Download the zips from the GitHub release for the tag being published.
3. Chrome: New item → upload the chrome zip → fill Store listing (text, icon, screenshots, promo tile), Privacy practices (above), Distribution: public, all regions → Submit for review. Review usually takes 1–3 days.
4. Edge: Create new extension → upload the edge zip → Properties (above) → Store listings (English: text, 300×300 logo, screenshots) → Submit. Review up to 7 business days.
5. After approval, add the store links to `README.md` and the repo description. Edge: https://microsoftedge.microsoft.com/addons/detail/shortcuts-for-soundcloud/pfjipggmdmbfoekoddgefhpfppmchdoa

## Updates

Bump `version` in `package.json`, commit, tag `vX.Y.Z`, and push the tag. The release workflow builds the zips, attaches them to a GitHub release, and, once the secrets below exist, submits them to both stores. Both stores still run their normal review before the new version goes live. Listing text and images are not updated by the API; change those in the dashboards.

## Automated publishing (one-time setup)

Add these as repository secrets at https://github.com/jgentes/soundcloud-shortcuts/settings/secrets/actions. Each store's job is skipped with a notice until all of its secrets are present, so you can set up one store at a time.

### Chrome Web Store

Uses the official Chrome Web Store API through `chrome-webstore-upload-cli`.

1. `CHROME_EXTENSION_ID`: the 32-letter ID from the item's dashboard URL or store page (`goacpmblhegeekdjdobjmjahmegjcokm`; listing: https://chromewebstore.google.com/detail/shortcuts-for-soundcloud/goacpmblhegeekdjdobjmjahmegjcokm).
2. `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`: follow https://github.com/fregante/chrome-webstore-upload-keys. In short: create a Google Cloud project, enable the "Chrome Web Store API", configure the OAuth consent screen as External (Internal needs a Workspace account) and add your own Gmail address as a test user, then create an OAuth client of type **Desktop app** (a Web application client fails with `redirect_uri_mismatch`, because the helper listens on a localhost port). Run `npx chrome-webstore-upload-keys` locally, which walks you through sign-in and prints the refresh token. Use the same Google account as the developer dashboard. While the consent screen is in Testing status, refresh tokens expire after 7 days, so once the token works, click "Publish app" on the consent screen to move it to Production; no Google verification is needed because only your own account uses it.

### Microsoft Edge Add-ons

Uses the Edge Add-ons REST API v1.1 (API key).

1. `EDGE_PRODUCT_ID`: the GUID shown on the extension's overview page in Partner Center (also in its URL).
2. `EDGE_CLIENT_ID` and `EDGE_API_KEY`: in Partner Center go to Microsoft Edge → Publish API, click Enable for the new experience if offered, then Create API credentials. Copy the Client ID and the API key (keys expire; the page shows the date, and a new key just needs the secret updated).

The API can only update an extension that was first published through Partner Center, which is already done.

### Running it

- Automatic: push a `vX.Y.Z` tag.
- Manual: Actions → Release → Run workflow on `main` to resubmit the current source without creating a GitHub release (handy after a rejection that only needs listing changes, or to retry a failed upload).
- Neither store accepts a submission while an earlier one is still in review (Edge: `InProgressSubmission`; Chrome: `ITEM_NOT_UPDATABLE`). The build and GitHub release still succeed, so once the earlier version is live, open the failed run in Actions and click "Re-run failed jobs"; it reuses that run's zips.
- Both stores require the version to be higher than the one they serve. The Edge job checks the store first and skips with a notice when the version is already live; the Chrome job fails with Google's error in that case.
