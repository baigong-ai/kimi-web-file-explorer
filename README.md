# kimi-web-files

[中文](README_CN.md)

A **Files sidebar for the [Kimi Code](https://github.com/MoonshotAI/kimi-code) web portal** (`kimi web` / `/web`): browse the current workspace's file tree right inside the chat page, and preview any file (markdown, code, images, PDFs…) in the same panel — no more leaving the browser to look at your files.

![Files panel](docs/files-panel.png)

Click a file and it opens in-place, with a back bar to return to the tree:

![File preview](docs/file-preview.png)

## Why

Kimi Code's web UI is great for long sessions, but it has no way to look at the working directory — checking a file means switching to a terminal, an editor, or Finder. The missing piece turns out to be small: the server already ships full filesystem APIs (`fs:list` / `fs:read`, with git status), and the web app already has a polished file-preview component and a right-side detail-panel system. kimi-web-files wires them together into the file tree the portal was missing (upstream even left an empty `fileTree` i18n placeholder).

## How it works

### The official web UI: source vs. product

Kimi Code's web UI is open source — the code lives in [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code) under `apps/kimi-web` (Vue 3 + TypeScript + Vite). What ships inside the `kimi` binary is **not** this source, but its build output: minified, hashed static bundles (`index-XXX.js` etc.), embedded into the single-file binary (Node SEA). At every `kimi web` launch the binary extracts those embedded assets to a cache directory, verifying each file's sha256:

```
~/Library/Caches/kimi-code/web/<version>/<platform>/<manifest-hash>/dist-web
```

The running server simply serves static files from that directory, and provides the REST/WS APIs the UI calls.

So the relationship is: **binary-embedded web code = official source, compiled**. You can't add a feature to the extracted bundles (minified machine-ish output, and the sha256 check would revert it anyway) — the source is the only sane place to work.

### What this project does

```
MoonshotAI/kimi-code (apps/kimi-web source)
        │
        ├─ official build ──► embedded in kimi binary ──► extracted to dist-web ──► served (stock UI)
        │
        └─ git apply kimi-web-files.patch
                │
                pnpm build (same Vite toolchain)
                │
                dist/  =  stock web UI + Files panel   (≈99% identical, +665 lines)
                │
                apply.sh: rsync dist/ → dist-web of the RUNNING server
                │
                ► server now serves the patched UI until it stops
```

1. Clone the official source and apply `kimi-web-files.patch` — the whole feature as a clean diff (2 new files, 8 small wiring edits).
2. Build with the same toolchain upstream uses. The resulting `dist/` is the **complete** web UI — stock plus the Files panel.
3. `apply.sh` replaces the running server's asset cache with this build. Timing matters: the binary re-extracts (and thus restores) stock assets at **every launch**, but a running server reads assets from disk per request. So the patch must be applied **after** the server has started. Note that all `kimi web` processes of the same version share one cache directory — the patch takes effect for every same-version portal at once, and any single new `kimi web` launch reverts all of them (the watchdog in `start-patched-web.sh` detects this and re-applies automatically).

The server can't tell the difference — it serves whatever static files sit in the cache directory and answers the same stable, session-scoped fs APIs either way.

### Where the safety comes from

- **Nothing permanent is modified.** The `kimi` binary, `~/.kimi-code`, and the official assets inside the binary are never touched. The only thing changed is the contents of a cache directory that the binary considers disposable.
- **Rollback is automatic and unavoidable — in a good way.** The sha256-verified re-extraction on every launch means a plain `kimi web` restart always brings back the 100% stock UI. You can't "break" your installation with this patch; a restart undoes it.
- **The blast radius is one browser page.** The patch only changes which static files the local server hands to your browser. It adds no server routes, no elevated permissions, no network calls beyond the existing same-origin APIs.

## Features

- File tree of the session's workspace root, directories loaded lazily on expand
- `Find` box to filter loaded files by name; git-change marker on modified entries
- In-panel preview via the stock FilePreview component: rendered markdown, syntax-highlighted code, images, PDF, CSV… with download / open-in-editor / reveal-in-Finder actions
- Chinese & English UI (follows the portal's language setting)
- Follows the portal's own conventions: right-side detail layer, `Esc` to close, resets on session switch

## Optional patches

- `kimi-web-plan-usage.patch` — a managed-plan quota pill in the composer toolbar center: 5-hour window and weekly usage as `43% (5h) / 78% (1w)` with mini progress bars, warning color at ≥80% and danger at ≥95%, exact numbers and reset countdowns in the tooltip, click to refresh. Data comes from the server's `GET /api/v1/oauth/usage` endpoint; the pill hides itself on non-managed accounts and on phones. Applies cleanly on top of (or independently from) `kimi-web-files.patch`; Chinese & English UI included. Use it the same way — `git apply /path/to/kimi-web-plan-usage.patch` before building.

## Install

Requirements: Node.js ≥ 24.15, pnpm 10 (the same toolchain as kimi-code itself), macOS or Linux.

```bash
# 1. Clone the official source and check out the web UI code.
#    NOTE: upstream removed apps/kimi-web from main in 0.32.0, so a plain
#    clone of main no longer contains the web UI source. Pin the last
#    commit that still has it:
git clone --depth 1 --filter=blob:none --no-checkout https://github.com/MoonshotAI/kimi-code.git kimi-code-src
cd kimi-code-src
git fetch --depth 1 origin 21185447fe0f04dbe342bebb6c6d0b364fd43daa
git checkout FETCH_HEAD

# 2. Apply the feature patch
git apply /path/to/kimi-web-files/kimi-web-files.patch

# 3. Build the web app (takes ~2 min for install, ~20s for build)
pnpm install
pnpm --filter @moonshot-ai/kimi-web build
```

**Compatibility:** the build is from the last public web-UI source (0.31-era), and is verified working against Kimi Code servers **0.31.x, 0.32.0, and 0.34.0** — the session-scoped fs APIs it uses (`fs:list` / `fs:read`) are stable across these versions. One trade-off to know: while the patch is in effect the portal serves the 0.31-era UI build, so web-UI features added in newer releases (e.g. the sidebar flat view and the one-click failure-resume card from 0.34) are not visible until you revert with a plain `kimi web` restart. If a future server release breaks it, this project is blocked until upstream publishes the web UI source again.

The scripts expect this layout (sibling directories under one parent folder):

```
some-folder/
├── kimi-code-src/     # official source clone, patched + built
└── kimi-web-files/    # this repo
```

"Next to each other" matters because `apply.sh` looks for the build output at `<this-repo>/../kimi-code-src/apps/kimi-web/dist` by default. Any other layout works too — just point the scripts at it explicitly: `KIMI_WEB_DIST=/path/to/kimi-web/dist ./apply.sh`.

## Usage

```bash
# Option A (recommended): start the portal, auto-patch once it's up, and only
# then open the browser
./start-patched-web.sh

# Option B: the portal is already running (`kimi web` or `/web` in the TUI) —
# just patch the live server
./apply.sh
```

Then click the new folder icon in the chat header. `start-patched-web.sh` opens the browser only *after* the patch has fully landed, and adds a timestamp query to the URL so the browser re-fetches the entry HTML — the kimi server sends no cache headers, so Safari heuristically caches the old entry page, which can point at a bundle that has since been replaced and render a blank page. If you ever do hit a blank page, one hard refresh (Cmd+Shift+R) fixes it.

**Running several portals at once:** all `kimi web` processes of the same version share one dist-web cache directory — whether started via `kimi web`, `start-patched-web.sh`, or `/web` in the TUI. Two direct consequences:

- Once patched, **every** running same-version portal immediately has the Files panel (including one opened via `/web`) — no need to patch each one.
- Any new `kimi web` launch re-extracts the stock assets and wipes the patch for **all** of them. `start-patched-web.sh` has a built-in watchdog: while it runs, it checks every 3 seconds and re-applies the patch if it got wiped. Without it, just run `apply.sh` once more after such a launch.

**Patch lifetime:** the patch lasts until some `kimi web` launch reverts it. Opening a portal with plain `/web` alone never shows the Files panel (that launch is itself a revert) — but as long as the patch is in effect, a `/web`-opened portal has the panel too.

**After a Kimi Code upgrade:** the new version extracts a fresh cache directory, so the portal returns to stock automatically. Rebuild (if upstream changed the web app, re-clone and re-apply first), then run `apply.sh` / `start-patched-web.sh` again.

## Files

| file | what it is |
|---|---|
| `kimi-web-files.patch` | the feature itself: a git patch against `apps/kimi-web` in MoonshotAI/kimi-code (2 new files, 8 touched, ~80 insertions of wiring + the new tree/panel) |
| `kimi-web-plan-usage.patch` | optional add-on: managed-plan quota pill (5h / weekly) in the composer toolbar — see [Optional patches](#optional-patches) |
| `apply.sh` | sync the built web app into the running server's asset cache |
| `start-patched-web.sh` | `kimi web` wrapper: waits for the server to listen, runs `apply.sh`, then watchdogs it — re-applies automatically if another `kimi web` launch wipes the patch |
| `cdp-shot.mjs` | dev tool: drives headless Chrome over CDP to screenshot the panel end-to-end |
| `docs/` | screenshots |

## Development

```bash
cd kimi-code-src
pnpm --filter @moonshot-ai/kimi-web run typecheck   # vue-tsc
pnpm --filter @moonshot-ai/kimi-web build           # rebuild after changes
# regenerate the distributable patch:
git add -N apps/kimi-web/src/components/FileTreePanel.vue apps/kimi-web/src/composables/useFileTree.ts
git diff -- apps/kimi-web > /path/to/kimi-web-files/kimi-web-files.patch
```

Verified on macOS (arm64) with Kimi Code 0.31.x through 0.34.0. The feature is self-contained in the web app and talks only to stable, session-scoped server APIs, so it should track upstream releases closely; if a future kimi-code release breaks `git apply`, the conflicts will be small and localized.

## License

MIT. The patch targets [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code), which is MIT-licensed as well. Not affiliated with Moonshot AI.
