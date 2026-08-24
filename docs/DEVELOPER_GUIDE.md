# Developer Guide

Everything you need to understand, modify, and extend LSGit.

---

## Table of contents

- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Architecture overview](#architecture-overview)
- [Codebase tour](#codebase-tour)
- [Backend patterns](#backend-patterns)
- [Frontend architecture](#frontend-architecture)
- [Design system](#design-system)
- [Git integration internals](#git-integration-internals)
- [Testing](#testing)
- [Walkthrough: adding a feature](#walkthrough-adding-a-feature)
- [Coding conventions](#coding-conventions)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 18 (tested on 26) | Only for the server; the frontend has no build step |
| npm | ≥ 8 | Ships with Node |
| A browser | Chromium/Firefox/Safari current | No build tooling required |

You do **not** need: git CLI, Docker, Python, or internet access (after `npm install`).

---

## Getting started

```bash
npm install          # once
npm run dev          # development: node --watch server.js (auto-restart on change)
npm start            # production-style: plain node server.js
```

- App: <http://localhost:3000>
- Configure via `.env` — see [CONFIGURATION.md](CONFIGURATION.md).
- `node --watch` restarts the server when **server-side** files change; frontend
  files (`public/*`) are served statically — just refresh the browser.

---

## Architecture overview

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (public/, vanilla JS, no build)                     │
│  ├── index.html      single page: 4 views (projects/upload/  │
│  │                   browser/audit) + repo tabs              │
│  ├── app.js          all client logic + IndexedDB prefs      │
│  ├── style.css       design tokens & components              │
│  └── vendor/         highlight.js, marked, DOMPurify (local) │
└───────────────▲──────────────────────────────────────────────┘
                │ fetch / JSON  +  multipart uploads
┌───────────────┴──────────────────────────────────────────────┐
│  Node server (server.js — Express)                           │
│  ├── /api/config, /api/projects, /api/projects/:id/*         │
│  ├── /api/projects/:id/git/*  (versioning)                   │
│  └── static: public/                                         │
└───────┬──────────────────────┬───────────────────────────────┘
        │                      │
┌───────▼─────────┐   ┌────────▼────────────────────────────────┐
│ lib/storage.js  │   │ lib/git.js  (isomorphic-git)            │
│ walk/zip/paths  │   │ init/commit/log/branch/diff/restore     │
│ metadata/audit  │   │ real .git per repo                      │
└───────┬─────────┘   └────────┬────────────────────────────────┘
        │                      │
┌───────▼──────────────────────▼───────────────────────────────┐
│  DATA_DIR/  (default: ./data)                                │
│  ├── repos/<uuid>/.git + worktree                            │
│  ├── metadata.json                                           │
│  └── audit.log                                               │
└──────────────────────────────────────────────────────────────┘
```

There is no database. The filesystem is the database; `metadata.json` is the only
index, and it is rebuilt-safe (projects are re-discoverable from `repos/` if needed
by re-adding them).

---

## Codebase tour

```
owngit/
├── server.js               # Express app: all REST routes, multer uploads, errors
├── lib/
│   ├── config.js           # .env loader + typed settings (PORT, MAX_UPLOAD_MB…)
│   ├── storage.js          # DATA_DIR mgmt, walk(), zip extract/export, path safety
│   ├── git.js              # isomorphic-git wrapper (versioning feature)
│   └── diff.js             # LCS line-diff engine (no deps)
├── public/
│   ├── index.html          # markup for all views
│   ├── app.js              # all frontend logic (~1000 lines, vanilla)
│   ├── style.css           # design tokens + components
│   ├── logo.svg            # brand mark (master)
│   ├── favicon.*           # generated icons (ico/svg/png) + manifest
│   └── vendor/             # vendored third-party JS/CSS (offline)
├── scripts/
│   └── build-ico.js        # regenerates favicon.ico from PNGs
├── docs/                   # you are here
├── .env.example            # configuration template
└── data/                   # runtime data (gitignored) — created on first run
```

### server.js — route map

| Area | Routes |
|------|--------|
| Meta | `GET /api/config` |
| Projects | `GET/POST /api/projects*`, `PATCH/DELETE /api/projects/:id` |
| Files | `GET/PUT/DELETE /api/projects/:id/file`, `GET .../tree`, `GET .../raw`, `GET .../archive`, `GET .../stats`, `GET .../search` |
| Git | `GET .../git/status`, `POST .../git/commit`, `GET .../git/log`, `GET .../git/commit/:oid[/diff]`, `GET .../git/diff`, `GET/POST/DELETE .../git/branches`, `POST .../git/branches/switch`, `POST .../git/restore`, `POST .../git/discard`, `GET .../git/file` |
| Audit | `GET /api/audit` |

Full request/response shapes: [API_REFERENCE.md](API_REFERENCE.md).

---

## Backend patterns

### Route shape

Every project-scoped route follows the same skeleton:

```js
app.get('/api/projects/:id/thing', async (req, res, next) => {
  const ctx = getProjectOr404(req, res);   // 404 JSON if project missing
  if (!ctx) return;                        // ctx = { meta, project }
  try {
    /* work — throw on error */
    res.json({ ... });
  } catch (err) { next(err); }             // central error handler
});
```

- `ctx.meta` is the whole metadata document; mutate `ctx.project` then
  `touchProject(ctx, { … })` to persist + bump `updatedAt`.
- **Errors:** throw anything; the terminal middleware maps `err.status` (or
  `LIMIT_FILE_SIZE` → 413) to `{ error: message }`. 500s are `console.error`-ed.

### Path safety

`storage.safeResolve(root, relative)` rejects any path escaping the repo root
(`..` traversal) with a 400. Use it for **every** user-supplied path.
`storage.walk()` additionally skips `.git` so versioning internals never leak into
browsing/search/stats.

### Blocked extensions

`storage.BLOCKED_EXTENSIONS` (.exe/.dll/.bat/.sh/…) are skipped during zip
extraction (per-entry, not whole-archive rejection) and on PUT file saves.
Add/remove extensions in `lib/storage.js`.

### Audit log

`storage.audit({ action, … })` appends a JSONL line to `data/audit.log`.
Call it for every state-changing operation (see existing routes for the shape).

---

## Frontend architecture

`public/app.js` is organized in labeled sections. Key concepts:

### State

```js
const state = {
  projects: [], current: null,     // repo list + open repo
  tree: [],                        // flat entries [{path,type,size,mtime}]
  cwd: '', currentFile: null,      // browser location
  expanded: new Set(),             // expanded sidebar folders (persisted)
  wrap: false, mdRender: true,     // viewer prefs (persisted)
  editing: false,                  // editor mode
  branches: null, gitStatus: null, // git UI state
};
```

### Persistence (`prefs`)

Tiny IndexedDB wrapper (`lsgit-prefs` db, `kv` store) with localStorage fallback —
`prefs.get/set/del`. Keys used: `ui:sidebarCollapsed`, `ui:wrap`, `ui:md`,
`expanded:<repoId>`, `last:<repoId>` (`{cwd, file}` — restores your place).

**Rule:** any user preference must go through `prefs`, never localStorage directly.

### Rendering

- Views are `<section id="view-*">`; `showView(name)` toggles `.hidden`.
- The repo browser renders into `#bb-content` (dir table / file view / search
  results / history) via template literals + `esc()` for all interpolation.
- Events are **delegated**: one listener on `#bb-content` / `#file-tree` /
  `#repo-commits` reading `data-*` attributes. Prefer this over inline `onclick`
  for dynamic content (the only inline handlers left are static HTML ones).
- **Stale-response guards:** async renders use monotonic `seq` counters
  (`fileSeq`, `dirSeq`, `commitsSeq`); discard results when the counter moved on.

### Syntax highlighting

`highlightToLines(code, lang)` highlights the whole file with hljs, then walks the
resulting DOM to split it into per-line HTML — reopening open spans on each line —
so multi-line strings/comments highlight correctly while line numbers stay aligned
(soft-wrap safe). Do **not** replace this with per-line `hljs.highlight()`.

---

## Design system

Tokens live in `:root` in `public/style.css`. The look is a **quiet golden dark**:

```
--bg #0e0c09   --panel #171410   --panel-2/3 #1f1b14/#292217   --border #322a1c
--text #ede6d4 --text-2 #9b9182  --text-3 #675e4c
--accent #d9a441 (gold)  --ok #4fbf67  --danger #e5484d
```

Hard rules:

- No pure black/white, no gradients in UI chrome, **no shadows** — depth = border +
  background contrast only.
- Type: system-ui stack, 13–14px base, weights 400/500/600 only, **no uppercase or
  letter-spacing tricks** on labels.
- Components: 1px-bordered cards (radius 8px), hairline-divided rows, quiet buttons
  (`panel-2` bg) that darken on hover, gold reserved for links/active/primary.
- Collapsible sidebar: `.sidebar.collapsed` (60px icon rail, tooltips via
  `data-tip` + `::after`), state persisted in `prefs`.

When adding UI, reuse tokens — never hardcode hex values outside `:root`.

---

## Git integration internals

`lib/git.js` wraps isomorphic-git. Design decisions:

- **Real repos.** Each project dir gets a standard `.git` (default branch `main`),
  so `git` CLI works on `data/repos/<id>` too.
- **Lazy init.** `ensureRepo()` runs on first git API touch: init → stage all →
  commit `"Initial import"`. Existing pre-git projects migrate transparently.
- **Auto-commits.** Project create and file uploads call `commitAll()` with a
  descriptive message (no-op when the worktree is clean). Manual edits stay
  uncommitted so the Working Copy view has content.
- **Status** = `statusMatrix()` mapped to `added|modified|deleted`
  (`head===0`→added, `workdir===0`→deleted, `workdir===2`→modified).
- **Commit diffs** = flatten both trees (`readTree` recursion) to `path→oid` maps
  and compare; per-file blobs read with `readBlob` on commit/parent.
- **Working-copy diffs** = HEAD blob vs `fs.readFileSync`.
- **Diffs** come from `lib/diff.js`: common prefix/suffix trim + LCS DP
  (`Int32Array`, capped at 4M cells → falls back to block-replace for huge files).
- **Safety:** `switchBranch` uses non-forced checkout (409 on conflict);
  `discardAll`/`restoreFile` are explicit, user-confirmed actions.
- **The Uint8Array trap:** `readBlob()` returns `Uint8Array` — always
  `Buffer.from(blob).toString('utf8')`. A bare `.toString()` yields
  comma-joined byte numbers and silently corrupts content.

---

## Testing

No unit-test framework is configured (by design, keeping zero-devDeps). The
project is verified with **Playwright end-to-end scripts** (Python) driving a real
Chromium against `localhost:3000`:

Typical coverage (see scripts used during development):

1. Upload a real zip → repo created, skipped-file notice
2. Browse: breadcrumbs, dir table, sidebar expand, README render
3. Code viewer: line numbers, wrap toggle, markdown Rendered/Source
4. Edit → save round-trip
5. Git: working copy → diff → commit → commit detail → branch create/switch →
   file history → view at revision
6. Persistence: reload restores location/prefs (IndexedDB)

Run your own:

```bash
pip install playwright && python -m playwright install chromium
```

```python
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    page = b.new_page()
    page.goto("http://localhost:3000")
    ...
```

**Manual regression checklist** (2 minutes): upload zip → open repo → open file →
edit/save → Commits tab shows working copy → commit → create/switch branch →
History → reload page (location restored).

---

## Walkthrough: adding a feature

Example: add a "download single folder as zip" button.

1. **API** — in `server.js`, clone the archive route pattern:
   ```js
   app.get('/api/projects/:id/archive', ...)  // existing
   ```
   Add `GET /api/projects/:id/archive?prefix=lib/` — filter
   `storage.walk()` entries by `entry.path.startsWith(prefix)` before zipping.
2. **Frontend** — in `public/app.js`, add a button to the dir header in
   `renderDir()` with `data-act="dl-folder"`, and handle it in the delegated
   click handler on `#bb-content`:
   ```js
   else if (act === 'dl-folder') {
     location.href = `/api/projects/${state.current.id}/archive?prefix=${encodeURIComponent(state.cwd)}`;
   }
   ```
3. **Style** — reuse `.btn.small`; add nothing to CSS unless a new component.
4. **Verify** — manual pass + a Playwright click-through; check the audit log got
   an entry if the route mutates state.

---

## Coding conventions

- **CommonJS** (`require`) on the server; plain **ES2020+** script (no modules) in
  the browser.
- `'use strict';` at top of every server/lib file.
- No comments unless explaining a non-obvious invariant (the codebase documents
  gotchas, not mechanics).
- All user input rendered with `esc()`; all paths through `safeResolve()`.
- Errors: `err.status` for HTTP-mapped errors; never leak stack traces to responses.
- Frontend state mutations flow through the named functions — avoid ad-hoc DOM
  state outside `state` + `prefs`.

---

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| Port 3000 in use | `PORT=xxxx` in `.env`, or kill the old node: `Get-Process node \| Stop-Process` |
| Server didn't pick up a lib/ change | `node --watch` watches the module graph; if it didn't, restart `npm run dev` |
| Upload hangs at "Creating…" | Check DevTools Network — the request has a 10-min client timeout; large archives over slow disks take time |
| Extraction fails on deep paths (Windows) | Enable Windows long paths; see [CONFIGURATION.md](CONFIGURATION.md#platform-notes) |
| Icons/old colors still showing | Hard refresh (Ctrl+Shift+R) — static assets are ETag-cached |
| Git tab shows "Initial import" only | Normal for fresh repos; make an edit and commit |
| `EPERM` during branch switch (OneDrive) | Move `DATA_DIR` out of synced folders |
