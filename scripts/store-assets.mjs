// Renders store listing images into docs/store-assets/ using the built
// extension UI (run `pnpm build` first). Scenes use fictional track names and
// generated artwork so no third-party material ends up in the listing.
//
//   node scripts/store-assets.mjs
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const build = join(root, ".output", "chrome-mv3");
const outDir = join(root, "docs", "store-assets");
if (!existsSync(join(build, "popup.html"))) {
  console.error("Run `pnpm build` first.");
  process.exit(1);
}
await mkdir(outDir, { recursive: true });

/* ---------- fake runtime so the real popup/options pages render ---------- */

const samples = Array.from({ length: 1800 }, (_, i) =>
  Math.round(140 * (0.3 + 0.7 * Math.abs(Math.sin(i / 41) * Math.cos(i / 173)) * (0.7 + 0.3 * ((i * 7919) % 97) / 97))),
);
const art = (hue) =>
  `data:image/svg+xml;utf8,` +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},80%,55%)"/><stop offset="1" stop-color="hsl(${hue + 40},70%,30%)"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><circle cx="140" cy="70" r="38" fill="white" fill-opacity=".25"/><circle cx="60" cy="150" r="22" fill="white" fill-opacity=".2"/></svg>`,
  );

const track = {
  trackKey: "/forged-audio/night-drive",
  trackUrl: "https://soundcloud.com/forged-audio/night-drive",
  title: "Night Drive (Extended Mix)",
  artist: "Forged Audio",
  artistUrl: "https://soundcloud.com/forged-audio",
  artworkUrl: art(20),
  playing: true,
  position: 83,
  duration: 254,
  liked: true,
  reposted: false,
  shuffle: false,
  repeat: "none",
  volume: 8,
  muted: false,
  updatedAt: Date.now(),
};

const stub = (settings = {}) => `<script>
const state = ${JSON.stringify({ nowPlaying: track, tabId: 1, waveforms: { [track.trackKey]: { trackKey: track.trackKey, samples, height: 140 } } })};
state.nowPlaying.updatedAt = Date.now();
window.chrome = {
  storage: {
    session: { get: async () => ({ state }), remove: async () => {}, onChanged: { addListener() {} } },
    sync: { get: async () => ({ settings: ${JSON.stringify(settings)} }), set: async () => {} },
  },
  runtime: { sendMessage: async () => ({ ok: true }), openOptionsPage() {}, getURL: (p) => p, getManifest: () => ({ version: "1.1.0" }) },
  tabs: { create() {} },
  permissions: { contains: async () => true, request: async () => true },
  commands: { getAll: async () => [
    { name: "play-pause", description: "Play / pause", shortcut: "Alt+Shift+P" },
    { name: "next", description: "Next track", shortcut: "Alt+Shift+Period" },
    { name: "previous", description: "Previous track", shortcut: "Alt+Shift+Comma" },
    { name: "like", description: "Like / unlike current track", shortcut: "Alt+Shift+L" },
    { name: "repost", description: "Repost / un-repost current track", shortcut: "" },
    { name: "seek-forward", description: "Seek forward", shortcut: "Alt+Shift+Right" },
    { name: "seek-backward", description: "Seek backward", shortcut: "Alt+Shift+Left" },
    { name: "mute", description: "Mute / unmute", shortcut: "Alt+Shift+M" },
  ] },
};
</script>
`;

async function previewOf(file, settings) {
  const html = await readFile(join(build, file), "utf8");
  return html.replace('<script type="module"', stub(settings) + '<script type="module"', 1).replace(/src="\/icon\//g, 'src="icon/');
}
await writeFile(join(build, "popup-preview.html"), await previewOf("popup.html"));
await writeFile(join(build, "options-preview.html"), await previewOf("options.html", { openPanelOnTrackChange: true, overlayPrompted: true }));

/* ---------- static server over the build dir + scenes ---------- */

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
const scenes = new Map();
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (scenes.has(url.pathname)) {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(scenes.get(url.pathname));
  }
  try {
    const body = await readFile(join(build, url.pathname));
    res.writeHead(200, { "content-type": types[extname(url.pathname)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

/* ---------- scenes ---------- */

const shell = (body, extra = "") => `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1280px;height:800px;overflow:hidden;font-family:"Segoe UI",system-ui,sans-serif;color:#fff;
    background:radial-gradient(1200px 700px at 20% 10%,#2b1a12 0%,#141414 55%,#0d0d0d 100%)}
  .wrap{position:relative;width:1280px;height:800px}
  h1{position:absolute;left:80px;top:120px;margin:0;font-size:52px;font-weight:700;line-height:1.1;max-width:520px;letter-spacing:-.5px}
  h1 b{color:#ff5500}
  p.sub{position:absolute;left:80px;top:300px;margin:0;font-size:22px;line-height:1.45;max-width:480px;color:#c9c9c9}
  .brand{position:absolute;left:80px;bottom:60px;display:flex;align-items:center;gap:12px;font-size:16px;color:#9a9a9a}
  .brand img{width:28px;height:28px;border-radius:7px}
  iframe{border:0;background:transparent}
  .card{position:absolute;border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.08);overflow:hidden;background:#1c1c1c}
  ${extra}
</style></head><body><div class="wrap">${body}
<div class="brand"><img src="/icon/128.png">Shortcuts for SoundCloud · by James Gentes · not affiliated with SoundCloud</div>
</div></body></html>`;

const kbd = (k) => `<kbd>${k}</kbd>`;
const row = (label, keys) => `<div class="row"><span>${label}</span><span class="keys">${keys.map(kbd).join("")}</span></div>`;

scenes.set(
  "/scene-panel.html",
  shell(
    `<h1>See what's playing, <b>seek with the waveform</b></h1>
     <p class="sub">Click the toolbar icon for a compact now-playing panel: artwork, controls, like and repost, and a waveform you can click to jump anywhere in the track.</p>
     <div class="card" style="left:720px;top:250px;width:340px;height:126px;transform:scale(1.5);transform-origin:top left">
       <iframe src="/popup-preview.html" width="340" height="126"></iframe>
     </div>`,
  ),
);

scenes.set(
  "/scene-shortcuts.html",
  shell(
    `<h1>Control SoundCloud <b>from any tab</b></h1>
     <p class="sub">Play, pause, skip, seek, like and more with keyboard shortcuts that work while you're in another tab. Remap every key in your browser's shortcut settings.</p>
     <div class="card list" style="left:700px;top:150px;width:480px;padding:28px 32px">
       ${row("Play / pause", ["Alt", "Shift", "P"])}
       ${row("Next track", ["Alt", "Shift", "."])}
       ${row("Previous track", ["Alt", "Shift", ","])}
       ${row("Like / unlike", ["Alt", "Shift", "L"])}
       <div class="row"><span>Seek forward / backward</span><span class="assign">assign your own</span></div>
       <div class="row"><span>Mute, volume up / down</span><span class="assign">assign your own</span></div>
       <div class="row"><span>Repost, shuffle, repeat, switch to tab</span><span class="assign">assign your own</span></div>
     </div>`,
    `.list .row{display:flex;justify-content:space-between;align-items:center;padding:14px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:20px}
     .list .row:last-child{border:0}.assign{color:#8a8a8a;font-size:15px;font-style:italic}
     .keys{display:flex;gap:6px}kbd{font:600 15px/1 "Segoe UI",system-ui;padding:8px 10px;border-radius:7px;background:#2c2c2c;border:1px solid #444;border-bottom:3px solid #444;color:#eee;min-width:30px;text-align:center}`,
  ),
);

scenes.set(
  "/scene-notify.html",
  shell(
    `<h1>Know when the <b>next track</b> starts</h1>
     <p class="sub">A notification with artwork, title and artist appears when a new track begins, with Next and Like right on it. Or let the panel open itself for a few seconds.</p>
     <div class="card toast" style="left:740px;top:290px;width:420px;padding:18px 20px">
       <img src="${track.artworkUrl}">
       <div class="t">
         <div class="title">${track.title}</div>
         <div class="artist">${track.artist}</div>
         <div class="ctx">Now playing on SoundCloud</div>
         <div class="btns"><span>Next</span><span>Like</span></div>
       </div>
     </div>`,
    `.toast{display:flex;gap:16px;background:#232323}.toast img{width:84px;height:84px;border-radius:8px}
     .toast .title{font-size:19px;font-weight:600}.toast .artist{font-size:16px;color:#cfcfcf;margin-top:2px}.toast .ctx{font-size:13px;color:#8a8a8a;margin-top:6px}
     .btns{display:flex;gap:10px;margin-top:14px}.btns span{padding:7px 18px;border-radius:6px;background:#3a3a3a;font-size:14px}`,
  ),
);

scenes.set(
  "/scene-options.html",
  shell(
    `<h1>Tune it to <b>how you listen</b></h1>
     <p class="sub">Choose which tab gets your commands, the seek step, notifications, and whether the panel pops up on its own and closes after a few seconds.</p>
     <div class="card" style="left:620px;top:130px;width:620px;height:540px">
       <iframe src="/options-preview.html#settings" width="620" height="1400" style="transform:translateY(-560px)"></iframe>
     </div>`,
  ),
);

scenes.set(
  "/promo-tile.html",
  `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:440px;height:280px;overflow:hidden;font-family:"Segoe UI",system-ui,sans-serif;color:#fff;
    background:radial-gradient(500px 300px at 30% 20%,#3a2114 0%,#161616 60%,#0d0d0d 100%)}
  .w{display:flex;flex-direction:column;align-items:center;justify-content:center;height:280px;gap:14px}
  img{width:96px;height:96px;border-radius:22px;box-shadow:0 14px 40px rgba(0,0,0,.6)}
  h1{margin:0;font-size:26px;font-weight:700}p{margin:0;color:#bdbdbd;font-size:15px}
  </style></head><body><div class="w"><img src="/icon/128.png"><h1>Shortcuts for SoundCloud</h1><p>Keyboard control · now-playing panel · waveform seeking</p></div></body></html>`,
);

scenes.set(
  "/marquee.html",
  `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1400px;height:560px;overflow:hidden;font-family:"Segoe UI",system-ui,sans-serif;color:#fff;
    background:radial-gradient(1100px 600px at 15% 20%,#3a2114 0%,#161616 55%,#0d0d0d 100%)}
  .w{position:relative;width:1400px;height:560px}
  .text{position:absolute;left:90px;top:120px;max-width:560px}
  .text img{width:72px;height:72px;border-radius:16px;box-shadow:0 12px 30px rgba(0,0,0,.5)}
  h1{margin:22px 0 0;font-size:54px;font-weight:700;line-height:1.08;letter-spacing:-.5px}
  h1 b{color:#ff5500}
  p{margin:18px 0 0;font-size:21px;line-height:1.45;color:#c9c9c9}
  .card{position:absolute;left:760px;top:140px;width:340px;height:126px;transform:scale(1.6);transform-origin:top left;
    border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.08);overflow:hidden;background:#1c1c1c}
  iframe{border:0;display:block}
  .keys{position:absolute;left:780px;top:395px;display:flex;gap:8px;align-items:center;color:#9a9a9a;font-size:16px}
  kbd{font:600 15px/1 "Segoe UI",system-ui;padding:8px 10px;border-radius:7px;background:#2c2c2c;border:1px solid #444;border-bottom:3px solid #444;color:#eee}
  </style></head><body><div class="w">
    <div class="text">
      <img src="/icon/128.png">
      <h1>SoundCloud, <b>from any tab</b></h1>
      <p>Keyboard shortcuts, a now-playing panel with a seekable waveform, and a heads-up when the next track starts.</p>
    </div>
    <div class="card"><iframe src="/popup-preview.html" width="340" height="126"></iframe></div>
    <div class="keys"><kbd>Alt</kbd><kbd>Shift</kbd><kbd>P</kbd> play / pause &nbsp;·&nbsp; <kbd>Alt</kbd><kbd>Shift</kbd><kbd>.</kbd> next</div>
  </div></body></html>`,
);

/* ---------- render ---------- */

const browser = await chromium.launch();
const shots = [
  ["scene-shortcuts", "screenshot-1-shortcuts.png", 1280, 800],
  ["scene-panel", "screenshot-2-now-playing.png", 1280, 800],
  ["scene-notify", "screenshot-3-notification.png", 1280, 800],
  ["scene-options", "screenshot-4-options.png", 1280, 800],
  ["promo-tile", "promo-tile-440x280.png", 440, 280],
  ["marquee", "marquee-1400x560.jpg", 1400, 560], // Chrome accepts JPEG or PNG
  ["marquee", "marquee-1400x560.png", 1400, 560], // Edge accepts PNG only
];
for (const [scene, file, width, height] of shots) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: "dark" });
  await page.goto(`${base}/${scene}.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const jpeg = file.endsWith(".jpg");
  await page.screenshot({ path: join(outDir, file), type: jpeg ? "jpeg" : "png", ...(jpeg ? { quality: 92 } : {}) });
  console.log(`docs/store-assets/${file}`);
  await page.close();
}
await browser.close();
server.close();
