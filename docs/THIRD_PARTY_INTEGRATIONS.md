# Third-Party Integrations

LSGit is deliberately **minimal**: four runtime dependencies, three vendored browser
libraries, zero telemetry, and **no network calls at runtime** — everything works
fully offline.

---

## Table of contents

- [Integration philosophy](#integration-philosophy)
- [Runtime dependencies (server)](#runtime-dependencies-server)
- [Vendored frontend libraries](#vendored-frontend-libraries)
- [Browser platform APIs used](#browser-platform-apis-used)
- [What is intentionally NOT integrated](#what-is-intentionally-not-integrated)
- [Adding a new dependency](#adding-a-new-dependency)
- [Updating & auditing dependencies](#updating--auditing-dependencies)

---

## Integration philosophy

1. **Local-only.** No library may make network calls at runtime. `isomorphic-git` is
   used purely for its on-disk git implementation — remotes are never configured.
2. **Boring and standard.** Prefer well-known, permissively licensed (MIT/BSD),
   widely deployed packages.
3. **Vendor the frontend.** Browser libraries are committed under `public/vendor/`
   so the app works with **no internet connection at all** — no CDN requests.
4. **No build step.** Libraries are consumed as plain `<script>` tags / `require()`.

---

## Runtime dependencies (server)

Managed by `package.json`, installed with `npm install` into `node_modules/`.

| Package | Version | License | Purpose | Used in |
|---------|---------|---------|---------|---------|
| **express** | ^4.21.2 | MIT | HTTP server, static file serving, JSON body parsing, routing | `server.js` |
| **multer** | ^1.4.5-lts.1 | MIT | Multipart (`multipart/form-data`) upload handling with disk streaming — writes uploads to `data/` before processing | `server.js` |
| **adm-zip** | ^0.5.16 | MIT | Reading/extracting uploaded zip archives and building zip exports for download | `lib/storage.js`, `server.js` |
| **isomorphic-git** | ^1.41.9 | MIT | Pure-JavaScript git implementation — init, add, commit, log, branches, checkout, blob reads. Creates **standard `.git` repositories** on disk with no git binary and no network | `lib/git.js` |

### Integration notes

#### express
- Static frontend served from `public/` with default caching (ETag).
- `express.json({ limit: '1mb' })` for JSON API routes.
- A terminal `/api` 404 handler and a central error middleware normalize all
  errors to `{ error: string }` JSON.

#### multer
- Two multer instances (both disk storage into `DATA_DIR`):
  - `upload.fields([{ name: 'files' }, { name: 'archive' }])` — used by
    `POST /api/projects/upload` and `POST /api/projects/:id/files`.
- Limits: `fileSize` = `MAX_UPLOAD_MB`, `files` = 5000.
- Temp files (`upload-<hex>`) are deleted after successful extraction **and** on
  failure paths (see the cleanup in the upload route's `catch`).

#### adm-zip
- **Extraction** (`storage.extractZip`): per-entry extraction (`extractEntryTo`) so
  blocked file types (`.exe`, `.bat`, `.sh`, …) can be **skipped individually**
  without rejecting the whole archive; zip-slip paths (`..`) are rejected; a single
  top-level folder (GitHub-style zips) is flattened.
- **Export** (`GET /api/projects/:id/archive`): builds an in-memory zip of the repo.

#### isomorphic-git
- Wrapped by [`lib/git.js`](../lib/git.js) — see [GIT_VERSIONING.md](GIT_VERSIONING.md)
  for the full integration design.
- **Critical gotcha discovered during integration:** `git.readBlob()` returns a plain
  `Uint8Array` (not a Node `Buffer`). Calling `.toString('utf8')` on a `Uint8Array`
  silently produces comma-joined byte numbers (`"104,101,108,108,111"`) instead of
  text. All blob reads must use `Buffer.from(blob).toString('utf8')`.

---

## Vendored frontend libraries

Committed under [`public/vendor/`](../public/vendor/) and loaded with plain
`<script>`/`<link>` tags from `public/index.html`.

| Library | File | Upstream | License | Purpose |
|---------|------|----------|---------|---------|
| **highlight.js** 11.9.0 | `highlight.min.js` | cdn-release build | BSD-3-Clause | Syntax highlighting for 30+ languages in the code viewer and diffs |
| highlight.js theme | `atom-one-dark.min.css` | same | BSD-3-Clause | Dark token colors matching the golden dark UI |
| **marked** 12.0.2 | `marked.min.js` | markedjs/marked | MIT | Markdown → HTML for README rendering |
| **DOMPurify** 3.1.6 | `purify.min.js` | cure53/DOMPurify | Apache-2.0 / MPL-2.0 | Sanitizes rendered markdown (READMEs are user-supplied content) |

### Why vendored instead of CDN?

The app is offline-first. Early builds loaded highlight.js from jsDelivr; on
machines without internet (or with proxy/firewall interference) the page's `load`
event never fired and the UI appeared frozen. Vendoring removed the last network
dependency — the app now works from a plane, a hotspot-blocked laptop, or an
air-gapped machine.

### How to update a vendored library

1. Download the new distribution file (browser/global build, **not** ESM):
   ```
   https://cdn.jsdelivr.net/npm/marked@<version>/marked.min.js
   https://cdn.jsdelivr.net/npm/dompurify@<version>/dist/purify.min.js
   https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@<version>/build/highlight.min.js
   https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@<version>/build/styles/atom-one-dark.min.css
   ```
2. Replace the file in `public/vendor/` (keep the same filename).
3. Smoke-test: code viewer highlighting, README rendering, and the markdown
   Rendered/Source toggle.

---

## Browser platform APIs used

No library needed — the frontend is vanilla JavaScript and relies on standard
browser platform features:

| API | Where | Purpose |
|-----|-------|---------|
| **IndexedDB** | `prefs` store (`lsgit-prefs` database, `kv` object store) | All client-side user data: collapsed-sidebar state, per-repo expanded folders, last-visited file/folder, soft-wrap and markdown-render preferences. localStorage fallback if IDB is unavailable. |
| **Fetch + FormData** | `api()`, uploads | All REST calls, multipart uploads with `AbortController` timeout (10 min) |
| **Drag & Drop API** | upload zone, repo drop-target | Zip/loose-file ingestion, add-files-to-repo overlay |
| **Clipboard API** | file header *Copy* button | Copy file contents |
| **Web Storage (localStorage)** | `prefs` fallback | Only when IndexedDB is unavailable |
| **Template elements / DOMParser** | `highlightToLines()` | Splitting highlighted HTML into per-line rows without breaking spans |

---

## What is intentionally NOT integrated

- **No authentication / identity providers** — the app has no users by design.
- **No analytics, telemetry, or crash reporting** — nothing phones home, ever.
- **No cloud storage** — data lives in `DATA_DIR` on your disk; browser state in
  IndexedDB on your machine.
- **No git remotes / push / pull** — versioning is local-only by design
  (see [GIT_VERSIONING.md](GIT_VERSIONING.md#remote-operations)).
- **No CSS/JS framework, no build step, no bundler** — plain ES2020+ and CSS.

---

## Adding a new dependency

Before adding anything, ask:

1. Can the platform API do this natively? (Prefer it — see how `lib/config.js`
   replaced `dotenv`, and `lib/diff.js` replaced a diff library.)
2. Is it pure JS with no postinstall scripts and no transitive network calls?
3. Is it MIT/BSD/Apache licensed?
4. Does it work fully offline?

If all four are yes: `npm install <pkg>`, require it in the relevant `lib/*` module,
and document it in the table above with purpose and integration notes.

---

## Updating & auditing dependencies

```bash
npm audit            # known-vulnerability report
npm outdated         # newer versions available
npm install pkg@ver  # targeted upgrade
```

Known notes:

- **multer 1.4.5-lts.1** carries a known high-severity advisory. `npm audit fix
  --force` would jump to multer 2.x, which changes the API (ESM, different error
  shapes). Plan the migration deliberately: bump to `multer@2`, verify both
  multipart routes, then re-run the upload tests.
- After any upgrade, re-run the manual test pass: upload zip → browse → edit →
  commit → diff → branch → file history (see [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md#testing)).
