# kimi-web-files

[中文](README_CN.md)

A **Files sidebar for the [Kimi Code](https://github.com/MoonshotAI/kimi-code) web portal** (`kimi web` / `/web`): browse the current workspace's file tree right inside the chat page, and preview any file (markdown, code, images, PDFs…) in the same panel, without leaving the browser.

![Files panel](docs/files-panel.png)

Click a file and it opens in-place, with a back bar to return to the tree:

![File preview](docs/file-preview.png)

Unlike a full-UI replacement, this project **injects the panel into the stock UI**: Settings, the Plugins panel, multi-skill activation, and every other official feature stay exactly at your installed Kimi Code version.

## Why

Kimi Code's web UI is great for long sessions, but it has no way to look at the working directory: checking a file means switching to a terminal, an editor, or Finder. The server already ships full filesystem APIs (`fs:list` / `fs:read`, with git status), so the missing piece is only a frontend. kimi-web-files adds that piece as a small self-contained panel, without touching the official UI code.

## How it works

What ships inside the `kimi` binary is the compiled web UI (minified static bundles), embedded into the single-file binary. At every `kimi web` launch the binary extracts those embedded assets to a cache directory, verifying each file's sha256:

```
~/Library/Caches/kimi-code/web/<version>/<platform>/<manifest-hash>/dist-web
```

The running server simply serves static files from that directory and provides the REST/WS APIs the UI calls.

`apply.sh` adds the Files panel **on top of the stock assets**:

```
dist-web/
├── assets/
│   ├── index-XXX.js …        ← official bundles, untouched
│   ├── kimi-files-panel.js   ← copied in (the panel, one self-contained script)
│   └── kimi-files-panel.css  ← copied in
└── index.html                ← +1 <link> and +1 <script defer> line
```

- **Nothing official is modified or replaced.** The two panel files are additive; `index.html` gains two lines. The portal you get is the 100% official UI of your installed version, plus a Files tab at the right edge of the window. New Kimi Code features (the Plugins panel in Settings, activating multiple skills in one message, and whatever ships next) keep working while the panel is injected, because the app code is byte-for-byte stock.
- **No build step, no source clone.** The panel is a hand-written, dependency-free vanilla JS app (~1000 lines) that talks to the server's stable, session-scoped fs REST APIs (`POST /api/v1/sessions/{id}/fs:list` etc.) with the same Bearer credential the official UI uses. Installing is just cloning this repo.
- **Same launch timing rule as any cache patch.** The binary re-extracts (and thus restores) stock `index.html` at **every launch**, but a running server reads assets from disk per request. So the injection must be applied **after** the server has started. All `kimi web` processes of the same version share one cache directory: the injection takes effect for every same-version portal at once, and any single new `kimi web` launch reverts all of them (the watchdog in `start-patched-web.sh` detects this and re-injects automatically).

### Where the safety comes from

- **Nothing permanent is modified.** The `kimi` binary, `~/.kimi-code`, and the official assets inside the binary are never touched. The only thing changed is the contents of a cache directory that the binary considers disposable.
- **Rollback is automatic.** The sha256-verified re-extraction on every launch means a plain `kimi web` restart always brings back the 100% stock entry page. You can't break your installation with this project; a restart undoes it.
- **The blast radius is one browser page.** The panel only changes which static files the local server hands to your browser. It adds no server routes, no elevated permissions, no network calls beyond the existing same-origin APIs.

## Features

- File tree of the session's workspace root, directories loaded lazily on expand
- `Find` box to filter loaded files by name; git-change marker on modified entries
- Hidden-files toggle (eye button in the panel header): dotfiles are hidden by default, one click lists them, via the server's `show_hidden` fs-list option
- In-panel preview: rendered markdown (with a source toggle), code and text with line numbers, images, PDF, CSV tables; with download / open-in-editor / reveal-in-Finder actions
- Follows the portal's language (Chinese/English) and light/dark theme
- Floating tab on the right edge; overlay panel with a draggable width; `Esc` closes the preview first, then the panel; state resets on session switch
- Works over **Remote Control** (`kimi rc` / `kimi web --remote-control`): the panel mirrors the relay's server-origin override (`?kimi_origin=` / `sessionStorage['kimi-desktop-server-origin']`), so API calls tunnel to your machine correctly

Known limitations compared to deeply integrated UI: code preview has no syntax highlighting (plain monospace with line numbers), and relative-path images inside markdown documents are not rendered.

## Install

Requirements: macOS, Linux, or Windows (Git Bash; use the `*-win.sh` scripts). No Node.js, no pnpm, no source checkout.

```bash
git clone https://github.com/<your-fork>/kimi-web-files.git
cd kimi-web-files
```

## Usage

```bash
# Option A (recommended): start the portal, auto-inject once it's up, and only
# then open the browser
./start-patched-web.sh

# Option B: the portal is already running (`kimi web` or `/web` in the TUI) —
# just inject into the live server
./apply.sh
```

Then click the new Files tab on the right edge of the window. `start-patched-web.sh` opens the browser only *after* the injection has landed, and adds a timestamp query to the URL so the browser re-fetches the entry HTML (the kimi server sends no cache headers, so browsers can heuristically cache the old entry page). If you ever hit a stale page, one hard refresh (Cmd+Shift+R) fixes it.

**Remote Control (kimi ≥ 0.39, experimental):** start through the wrapper so the injection lands after the server (and its tunnel) is up:

```bash
KIMI_CODE_EXPERIMENTAL_REMOTE_CONTROL=1 ./start-patched-web.sh --remote-control
```

If a plain `kimi rc` is already running, `./apply.sh` once is enough (the tunnel serves whatever is in the shared cache directory). Then open the `code-rc.kimi.com` link, or scan the QR code, and log in with your Kimi account.

**Prefer the stock portal? Just use it; nothing to undo.** Nothing in this project runs by itself: `apply.sh` only executes when you invoke it (or via the watchdog inside `start-patched-web.sh`). Whenever you want the plain official portal, start it the usual way: `kimi web`, or `/web` in the TUI. At every launch the `kimi` binary re-extracts its embedded, sha256-verified stock `index.html`, which removes the injection. There is nothing to uninstall and no residue.

**Running several portals at once:** all `kimi web` processes of the same version share one dist-web cache directory. Two direct consequences:

- Once injected, **every** running same-version portal immediately has the Files panel (including one opened via `/web`), with no need to inject each one.
- Any new `kimi web` launch re-extracts the stock assets and removes the injection for **all** of them. `start-patched-web.sh` has a built-in watchdog: while it runs, it checks every 3 seconds and re-injects if the injection got wiped. Without it, just run `apply.sh` once more after such a launch.

**After a Kimi Code upgrade:** the new version extracts a fresh cache directory, so the portal returns to stock automatically. Run `apply.sh` / `start-patched-web.sh` again; no rebuild or re-download is needed. The panel depends only on the stable session-scoped fs REST APIs, so it tracks upstream releases closely. If a future release ever breaks those APIs, the panel shows an error and the rest of the portal is unaffected.

## Legacy: source-patch mode

Before 0.40.1 this project worked differently: it rebuilt the whole web UI from the last public source (0.31-era) with the panel integrated, and replaced the server's entire asset set. That gave deeper integration (the stock FilePreview component, the right-side detail layer) but froze the whole UI at 0.31: newer official features such as the Plugins panel in Settings (0.40.0) were missing while the patch was active, and upstream stopped publishing the web UI source in 0.33.0.

The old `kimi-web-files.patch` is kept in the repo for reference. The injection mode above replaces it for everyday use; the source-patch workflow (`kimi-code-src` clone + pnpm build + `KIMI_WEB_DIST=...`) is no longer needed.

## Files

| file | what it is |
|---|---|
| `panel/kimi-files-panel.js` | the panel itself: one self-contained vanilla-JS script (tree, preview, markdown renderer, i18n, theming), injected into the stock portal |
| `panel/kimi-files-panel.css` | panel styles, scoped under the `.kfp-` prefix, light/dark |
| `apply.sh` | copy the two panel files into the running server's asset cache and add the `<link>` / `<script>` tags to `index.html` |
| `apply-win.sh` | Windows (Git Bash) port of `apply.sh`: cache under `%LOCALAPPDATA%`, GNU sed/stat |
| `start-patched-web.sh` | `kimi web` wrapper: waits for the server to listen, runs `apply.sh`, then watchdogs it, re-injecting automatically if another `kimi web` launch wipes the injection |
| `start-patched-web-win.sh` | Windows (Git Bash) port of `start-patched-web.sh` |
| `kimi-web-files.patch` | legacy: the old full-UI source patch against `apps/kimi-web` (kept for reference; not needed for injection mode) |
| `cdp-shot.mjs` | dev tool: drives headless Chrome over CDP to screenshot the panel end-to-end |
| `docs/` | screenshots |

## Changelog

- **v0.40.1** — **rewritten as an injection into the stock UI** instead of a full-UI replacement. The portal's own code is no longer touched, so current and future official features (the Plugins panel in Settings, activating multiple skills in one message, both added in 0.40.0) keep working while the Files panel is active, and the UI-drift caveat is gone for good. The panel is now a self-contained vanilla-JS app (`panel/kimi-files-panel.js` + `.css`) with its own preview renderers; install no longer needs Node/pnpm or the kimi-code source clone. Verified on Kimi Code 0.40.1: file tree, lazy expand, markdown/code/image preview, hidden-files toggle, git markers, and the stock Plugins panel side by side. Note: the Settings dialog variant depends on the session backend; the full variant (with the Plugins tab) shows on the default v2 backend.
- **v0.39.1** — verified on Kimi Code 0.39.1. One wire change broke the login gate: 0.39.1 renamed the `GET /auth` readiness flag from `ready` to `models_ready`, so the patched UI read `ready: undefined` as "not signed in" and stayed on the login page after a successful OAuth authorization. `getAuth()` now accepts both shapes.
- **v0.39.0** — verified on Kimi Code 0.39.0, including **Remote Control** end-to-end (`kimi rc`, remote browser connects, Files panel usable over the tunnel). The patch backported the relay's server-origin override (`?kimi_origin=` / `sessionStorage['kimi-desktop-server-origin']`) into the frontend's API config. Script fixes: `apply.sh` / `apply-win.sh` now `touch` the entry HTML after syncing (rsync/cp preserved the source mtime, which made the patched `index.html` look older than the browser-cached stock one and got it a 304); `start-patched-web*.sh` append the cache-busting timestamp with `&` when the URL already has a query string (RC redirect links do), fixing the double `?` that broke them.
- **v0.37.2** — verified on Kimi Code 0.37.2 (panel, tree expand, preview, hidden-files toggle via `show_hidden` all confirmed end-to-end); no patch changes needed. Upstream still had no native file tree / files panel (0.37.0's sidebar Open/Done/Workspaces tabs are session management, not a file explorer).
- **v0.36.0** — verified on Kimi Code 0.36.0; no patch changes needed. Documented the visible UI-drift caveat (stale account-menu entries) that came with serving the 0.31-era UI build.
- **v0.35.0** — verified on Kimi Code 0.35.0; no patch changes needed.
- **v0.34.1** — hidden-files toggle (eye button in the panel header): dotfiles are hidden by default, one click lists them via the server's `show_hidden` option. Verified on Kimi Code 0.34.0.
- **v0.34.0** — verified on Kimi Code 0.34.0; Windows (Git Bash) scripts added (thanks [@chulongYang](https://github.com/chulongYang)).
- **v0.32.0** — first tracked release: the Files panel, verified on 0.31.x / 0.32.0.

## Development

The panel has no build step: edit `panel/kimi-files-panel.js` / `.css`, then re-run `./apply.sh` (it version-busts the script URL by content hash) and hard-refresh the portal tab. Keep everything dependency-free and scoped under the `kfp-` prefix.

The legacy source patch can still be regenerated against its base commit if ever needed:

```bash
cd kimi-code-src
git diff 21185447fe0f04dbe342bebb6c6d0b364fd43daa -- apps/kimi-web > /path/to/kimi-web-files/kimi-web-files.patch
```

## License

MIT. Not affiliated with Moonshot AI.
