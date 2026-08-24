# Developer Guide — LSGit Code Manager

> **Audience:** Contributors who will read, run, modify, and extend the codebase.
> **Stack:** Node.js 18+ · Express 4.21 · isomorphic-git 1.41 · adm-zip 0.5 · vanilla SPA (`public/app.js:1-1301`).
> **Repo root:** `C:\Users\Girish Lade\OneDrive\Desktop\owngit` · Entrypoint `server.js:1-604`.

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Project Layout](#2-project-layout)
3. [Architecture at a Glance](#3-architecture-at-a-glance)
4. [Data Model & Persistence](#4-data-model--persistence)
5. [Backend Guide (`server.js` + `lib/`)](#5-backend-guide-serverjs--lib)
6. [Frontend Guide (`public/`)](#6-frontend-guide-public)
7. [API Reference (all routes)](#7-api-reference-all-routes)
8. [Git Subsystem (`lib/git.js`)](#8-git-subsystem-libgitjs)
9. [Diff Engine (`lib/diff.js`)](#9-diff-engine-libdiffjs)
10. [Security Model](#10-security-model)
11. [Local Development Workflow](#11-local-development-workflow)
12. [Testing Strategy](#12-testing-strategy)
13. [Debugging & Troubleshooting](#13-debugging--troubleshooting)
14. [Extending the Project](#14-extending-the-project)
15. [Deployment](#15-deployment)
16. [Conventions & Style](#16-conventions--style)
17. [FAQ](#17-faq)

---

## 1. Quick Start

**Prerequisites:** Node.js 18+ (for `--watch` and `crypto.randomUUID`), npm 9+.

```powershell
# PowerShell
git clone <repo>
Set-Location owngit
npm install          # installs express, multer, adm-zip, isomorphic-git  package.json:12-17
Copy-Item .env.example .env  # then edit PORT if needed
npm run dev          # node --watch server.js  package.json:9  → http://localhost:3000
```

```bash
# bash
cp .env.example .env
npm install
npm run dev
# or production
npm start   # package.json:8
```

No database. Data lands in `data/` (git-ignored `.gitignore:1`). Open http://localhost:3000 and upload a `.zip` or loose files.

**Verify:**

```powershell
Invoke-RestMethod http://localhost:3000/api/projects | ConvertTo-Json
Invoke-RestMethod http://localhost:3000/api/audit | ConvertTo-Json
```

---

## 2. Project Layout

```
owngit/
├── server.js              # 604-line Express app — all HTTP routes  server.js:1-604
├── lib/
│   ├── storage.js         # paths, limits, helpers, zip logic     lib/storage.js:1-148
│   ├── git.js             # isomorphic-git wrapper                lib/git.js:1-264
│   └── diff.js            # LCS diff + stats                      lib/diff.js:1-72
├── public/
│   ├── index.html         # SPA shell — sidebar + topbar + views  public/index.html:1-197
│   ├── app.js             # 1301-line SPA controller              public/app.js:1-1301
│   ├── style.css          # quiet dark-mode design system         public/style.css:1-625
│   └── vendor/
│       ├── highlight.min.js / atom-one-dark.min.css
│       ├── marked.min.js
│       └── purify.min.js
├── data/                  # runtime — repos, metadata.json, audit.log  .gitignore:1
│   ├── metadata.json      # [{ id, name, description, ... }]
│   ├── audit.log          # JSON-lines
│   └── repos/<uuid>/      # each project + .git
├── docs/
│   ├── ENV_VARIABLES.md
│   ├── CONFIGURATION.md
│   ├── THIRD_PARTY_INTEGRATIONS.md
│   └── DEVELOPER_GUIDE.md  # this file
├── .env.example           # env template
├── ARCHITECTURE.md        # future vision (Rust/Go, Postgres, Redis, etc.)
├── package.json           # scripts + deps  package.json:1-18
└── .gitignore             # data/, node_modules/, .scratch/  .gitignore:1-3
```

Conventions: `lib/*.js` are pure Node modules exporting POJOs/functions; `public/*` is static and served verbatim `server.js:17`.

---

## 3. Architecture at a Glance

```
Browser (SPA)  ──────────────HTTP JSON / multipart──────────────▶  Express (server.js)
 public/index.html + app.js                                    ┌─────────────────────┐
   ├─ Projects table  public/app.js:156-191                      │  REST API 48-589  │
   ├─ Tree + file viewer  309-718                                 │  Multer 21-30      │
   ├─ Search 734-773      audit 1290-1299                         │  Error handler 591 │
   └─ Commits/branch/diff 776-1158                                └────────┬──────────┘
                                                                     ┌─────┴──────┐
                                                               lib/storage.js  lib/git.js
                                                               paths, zip, walk  isomorphic-git
                                                                     │            │
                                                                     ▼            ▼
                                                               data/metadata.json  data/repos/<id>/.git
                                                               data/audit.log    lib/diff.js (LCS)
```

Future target in `ARCHITECTURE.md:19-57` is a modular monolith with API Gateway, Gitaly-like Git service, workers, Postgres, Redis, S3 — today it is a single process with local disk (`ARCHITECTURE.md:176-180`).

---

## 4. Data Model & Persistence

### 4.1 `data/metadata.json` — Project Index

```json
{
  "projects": [
    {
      "id": "5309e80b-3cf8-4509-8295-04344bb68a71",
      "name": "ls-notes",
      "description": "",
      "createdAt": "2026-08-23T19:47:10.409Z",
      "updatedAt": "2026-08-23T22:15:45.365Z",
      "fileCount": 100,
      "totalBytes": 476004,
      "source": "zip:ls-notes.zip"
    }
  ]
}
```

| Field | Type | Written at | Notes |
|-------|------|------------|-------|
| `id` | UUID v4 `server.js:70` | `POST /upload` | Directory name under `REPOS_DIR` |
| `name` | string | `POST /upload` or `PATCH /:id` | From `nameInput` or zip basename `server.js:76-80`, sanitized `lib/storage.js:72-75` on export |
| `description` | string trimmed | same | Optional `server.js:59,87-88` |
| `createdAt` / `updatedAt` | ISO string `server.js:96-97` | create + every `touchProject` `server.js:360-363` | `touchProject` called on file add/save/delete, branch switch `server.js:171,258,273,291,339` |
| `fileCount` / `totalBytes` | int | after each mutation `server.js:104-105,131-133` | Recomputed via `countFiles`/`dirSize` `server.js:129-135` |
| `source` | string | upload | `zip:<name>` or `files:<n> items` `lib/storage.js:127`, `server.js:92` |

I/O helpers: `readMetadata()`/`writeMetadata()` `lib/storage.js:21-31` — no locking; concurrent writes race-last-wins (acceptable for single-user local app).

### 4.2 `data/repos/<uuid>/` — File Store

One folder per project. Files are stored verbatim (no DB). `.git` subdir is hidden from `walk()` `lib/storage.js:58`. `safeResolve()` `lib/storage.js:38-46` prevents `..` escapes.

### 4.3 `data/audit.log` — JSON Lines

Appended via `storage.audit(event)` `lib/storage.js:33-36` from ~12 call sites:

| Action | Example line | At |
|--------|--------------|----|
| `project.create` | `{ ts, action, projectId, name, actor: req.ip }` | `server.js:111` |
| `project.upload` | `{ action, projectId, count, actor }` | `server.js:172` |
| `file.save/delete` | `{ action, projectId, path, actor }` | `server.js:259,274` |
| `project.update/delete/export/search` | `{ action, projectId, ...}` | `server.js:292,309,413,427` |
| `git.commit/branch/checkout/restore/discard` | `{ action, projectId, oid/name/path }` | `lib/git.js` via `server.js:466,524,536,560,570` |

Read via `GET /api/audit` — last 100 reversed `server.js:434-442`.

### 4.4 Browser Persistence (not on disk)

`IndexedDB lsgit-prefs` with `localStorage` fallback `public/app.js:52-103`:

| Key | Value |
|-----|-------|
| `expanded:<id>` | `string[]` open folders |
| `last:<id>` | `{ cwd, file }` last location |
| `ui:wrap` | `boolean` soft wrap |
| `ui:md` | `boolean` rendered vs source |

---

## 5. Backend Guide (`server.js` + `lib/`)

### 5.1 Boot

```js
storage.ensureDataDirs();              // server.js:12 → lib/storage.js:17-19
app.disable('x-powered-by');           // server.js:15
app.use(express.json({ limit: '1mb' })); // server.js:16
app.use(express.static('public'));     // server.js:17
```

Add new middleware **above** route definitions. Order matters.

### 5.2 Multer

See `docs/CONFIGURATION.md:6.2`. Temp files `data/upload-<hex>` are removed on success or full cleanup on failure `server.js:81,117-120`.

### 5.3 Route Groups

| Group | Prefix in file | Lines |
|-------|---------------|-------|
| Projects CRUD | `app.get/post/patch/delete /api/projects` | `48-132,282-432` |
| File ops | `app.get/put/delete /api/projects/:id/file` + raw/archive | `210-315` |
| Tree/stats/search | `app.get /tree|/stats|/search` | `198-418` |
| Audit | `app.get /api/audit` | `434-442` |
| Git | `app.get/post/delete /git/...` | `450-585` |
| Errors | `app.use('/api',404)` + `app.use(err)` | `589-599` |

**Helper `getProjectOr404`** `server.js:32-40` — always use it at top of `/:id` handlers; returns `{ meta, project }` or sends `404`.

**Helper `touchProject(ctx, extra)`** `server.js:360-363` — must be called after any repo mutation so `updatedAt/fileCount/totalBytes` stays fresh.

### 5.4 Adding a New Route — Template

```js
app.get('/api/projects/:id/my-feature', (req, res, next) => {
  const ctx = getProjectOr404(req, res);
  if (!ctx) return;
  try {
    const repoPath = path.join(storage.REPOS_DIR, ctx.project.id);
    // ... use storage.safeResolve(repoPath, rel), storage.walk, etc.
    storage.audit({ action: 'my.feature', projectId: ctx.project.id, actor: req.ip });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
```

Return `err.status = 400` for user errors so the error handler `server.js:592` sends `400` not `500`.

### 5.5 Storage Module deep dive

Covered in `docs/CONFIGURATION.md:3` and `docs/THIRD_PARTY_INTEGRATIONS.md:2.3`. Key nuance: `extractZip` flattens a single top-level folder `lib/storage.js:115-122` — GitHub archives `repo-main/` become `repo/` contents directly.

### 5.6 Error Handling

```js
app.use('/api', (_req,res)=>res.status(404).json({error:'Not found'})); // server.js:589
app.use((err,_req,res)=>{ // server.js:591-599
  const status = err.status || (err.code==='LIMIT_FILE_SIZE'?413:500);
  const msg = err.code==='LIMIT_FILE_SIZE' ? 'Upload exceeds the 200 MB size limit' : err.message;
  if (status===500) console.error(err);
  res.status(status).json({ error: msg });
});
```

Throw `err.status = 400/404/409` for expected failures; otherwise they become `500` with server log.

---

## 6. Frontend Guide (`public/`)

### 6.1 Shell

`public/index.html:14-42` — fixed 260px sidebar `public/style.css:51-83`, slim 52px topbar `public/style.css:87-110`, `main#app` with three views:

| View id | Shown by | Purpose |
|---------|----------|---------|
| `view-projects` | `showView('projects')` `public/app.js:142-150` | Table of projects `public/app.js:156-191` |
| `view-upload` | `showView('upload')` | Create repo form `public/app.js:1160-1286` |
| `view-browser` | `openProject(id)` `public/app.js:223-256` | Source / Commits / Insights tabs `public/app.js:258-291` |
| `view-audit` | `showView('audit')` | Audit table `public/app.js:1290-1299` |

Global search filters projects by `name` substring `public/app.js:188-191`. Topbar badge `Local` `public/index.html:50`.

### 6.2 State Object

```js
const state = { projects, current, tree, cwd, currentFile, currentContent, editing, mdRender, expanded, wrap };
// public/app.js:7-18
```

All UI is derived from `state`. No framework — direct DOM updates.

### 6.3 File Tree

- `childrenOf(dir)` + `hasChildren` `public/app.js:195-208` — derived from `state.tree` (flat list from `GET /:id/tree`).
- `renderSidebar(filter)` `public/app.js:309-350` — either filtered flat hits (highlighted `public/app.js:313-325`) or hierarchical `walkSidebar` `public/app.js:337-350` with `expanded` set.
- Click: dir toggles `expanded` + `navigate(dir)` `public/app.js:352-364`; file → `openFile(path)` `public/app.js:481-518`.

### 6.4 Code Viewer

- `openFile(path)` `public/app.js:481-518` — sets `cwd` to dirname, fetches `GET /:id/file?path=`, branches to `renderMarkdownFile` or `renderCode`.
- `renderCode` `public/app.js:552-572` — `highlightToLines` `public/app.js:587-623` splits highlighted HTML per line to keep line numbers aligned (preserves open `<span>` tags).
- `renderMarkdownFile` `public/app.js:574-583` — `DOMPurify.sanitize(marked.parse(...))` if `ui:md` true, else source view.
- Header `renderFileHeader` `public/app.js:520-550` — Copy/Raw/Download/History/Edit/Delete, wrap toggle for code, Rendered/Source toggle for Markdown.
- Editor `startEdit/saveFile/cancelEdit` `public/app.js:656-698` — textarea `#editor` `public/style.css:379-385`, `PUT /:id/file`.

### 6.5 Search, Stats, Git

| Feature | Trigger | Code |
|---------|---------|------|
| Search | Enter in `#search-input` | `public/app.js:737-773` → `GET /:id/search?q=&regex=&case=` |
| Insights | Stats tab | `public/app.js:271-291` `loadStats()` → `GET /:id/stats` `server.js:318-358` |
| Branch dropdown | `#branch-btn` | `public/app.js:802-895` → `GET/POST /git/branches` |
| Commits tab | Commits tab | `public/app.js:902-1076` → `GET /git/status` + `log` → detail/diff/restore/commit/discard |
| File history | History button | `public/app.js:1097-1158` → `GET /git/log?filepath=` → `GET /git/file?oid=&path=` |

### 6.6 Adding a Frontend Page

1. Add `<section id="view-my" class="view hidden">` in `public/index.html:52-192`.
2. Add a `.sidebtn[data-view="my"]` in `public/index.html:22-34`.
3. Add `if (name==='my') loadMy()` in `showView` `public/app.js:142-150`.
4. Implement `loadMy()` to `api('/api/...')` and render into the section.
5. Style with `public/style.css` tokens `public/style.css:7-21`.

---

## 7. API Reference (all routes)

Base: `http://localhost:3000`. All `/:id` routes return `404 { error: 'Project not found' }` if unknown `server.js:32-40`. JSON errors are `{ error: string }` `server.js:598`.

### 7.1 `GET /api/projects` `server.js:48-55`

List projects (public view). Sorted by `createdAt` desc.

```json
{ "projects": [{ "id","name","description","createdAt","updatedAt","fileCount","totalBytes","source" }] }
```

### 7.2 `POST /api/projects/upload` `server.js:57-123` — multipart

Fields: `name` (text), `description` (text), `archive` (single `.zip`), `files` (multiple). One of `archive` or `files` required `server.js:63-68`; for loose uploads `name` required `server.js:66`.

Success `201`:

```json
{ "project": { "id","name","description","createdAt","updatedAt","fileCount","totalBytes","source" }, "skippedFiles": ["path/to.exe"] }
```

Errors: `400 No files uploaded`, `400 Project name is required`, `400 Zip contains unsafe path` `lib/storage.js:92`, `400 Archive is empty` `lib/storage.js:105`, `413` for zip >200 MB.

Side effect: `git.commitAll(destDir, 'Upload: ...')` `server.js:112-114` (best-effort).

### 7.3 `POST /api/projects/:id/files` `server.js:139-180` — multipart

Add to existing project via drag & drop `public/app.js:1232`. Archive is expanded to temp `merge-*` then `mergeTree` copied `server.js:151-158`; loose files `safeResolve`+`rename` with blocked-ext skip `server.js:163-169`. Updates `fileCount/totalBytes` `server.js:171`.

```json
{ "ok": true, "added": 3, "project": { ...public } }
```

### 7.4 `GET /api/projects/:id/tree` `server.js:198-208`

```json
{ "project": { ... }, "entries": [{ "path":"src/app.js","type":"file","size":1234,"mtime": 171... }, ...] }
```

`.git` excluded `lib/storage.js:58`.

### 7.5 `GET /api/projects/:id/file?path=` `server.js:210-229`

```json
{ "path":"README.md","binary": false, "size": 1234, "content":"# ..." }
// or binary
{ "path":"logo.png","binary": true, "size": 45678 }
```

Errors: `400 Not a file`, `413 File too large to preview` `server.js:218-219`.

### 7.6 `GET /api/projects/:id/raw?path=` `server.js:231-241`

Streams raw bytes with `Content-Disposition` attachment (`res.download`).

### 7.7 `PUT /api/projects/:id/file` `server.js:244-264` — JSON `{ path, content }`

Creates or overwrites `content` as utf8. Rejects blocked extensions `server.js:253-254`. Creates dirs `server.js:256`.

```json
{ "ok": true, "path":"src/new.js" }
```

### 7.8 `DELETE /api/projects/:id/file?path=` `server.js:266-279`

```json
{ "ok": true }
```

Uses `fs.rmSync(filePath)` without `force` — errors if missing; catch → next(err).

### 7.9 `PATCH /api/projects/:id` `server.js:282-294` — JSON `{ name?, description? }`

Renames; empty `name` keeps old `server.js:285`. Updates `updatedAt` `server.js:291`.

```json
{ "project": { ...public } }
```

### 7.10 `GET /api/projects/:id/archive` `server.js:297-315`

Returns `application/zip` (`adm-zip` buffer `server.js:311`) with `Content-Disposition: attachment; filename="<sanitized>.zip"` `server.js:310`.

### 7.11 `GET /api/projects/:id/stats` `server.js:318-358`

Language map `LANGS` `server.js:323-332`:

```json
{ "project": { ... }, "totalFiles": 42, "totalLines": 1234, "languages": [{ "language":"JavaScript","files":10,"lines":900,"bytes": 12345 }, ...] }
```

`Other (<ext>)` for unknown ext `server.js:345`, `No extension` for dotless `server.js:345`. Binary/too-large files count as 1 line `server.js:341-344`.

### 7.12 `GET /api/projects/:id/search?q=&regex=&case=` `server.js:384-418`

Linear scan; skips `>MAX_FILE_VIEW_BYTES` and binary `server.js:395-398`. Caps at 200 hits `server.js:402,411`.

```json
{ "query":"TODO","truncated": false, "results": [{ "path":"src/app.js","line":42,"column":5,"text":"// TODO: fix" }] }
```

`regex=1` uses `RegExp(q, case?'' : 'i')` `server.js:372-378`; invalid regex → `-1` (no match) not error.

### 7.13 `DELETE /api/projects/:id` `server.js:420-432`

Removes `REPOS_DIR/id` recursively `server.js:424` + filters `metadata.json` `server.js:425`.

### 7.14 `GET /api/audit` `server.js:434-442`

```json
{ "events": [{ "ts":"2026-08-23T...Z","action":"project.create","projectId":"...","name":"...","actor":"::1" }, ...] }
```

Last 100, newest first `server.js:437`.

### 7.15 Git — `GET /:id/git/status` `server.js:450-456`

```json
{ "branch":"main","files": [{ "path":"src/app.js","status":"modified" }] }
```

Status values: `added` (`head==0`), `deleted` (`workdir==0`), `modified` (`workdir==2`) `lib/git.js:52-55`.

### 7.16 Git — `POST /:id/git/commit` `server.js:458-470` — JSON `{ message }`

```json
{ "oid":"abc...","short":"abc1234","status": { "branch","files" } }
```

`400 Nothing to commit` if clean `server.js:465` (from `commitAll` returning `null` `lib/git.js:66`).

### 7.17 Git — `GET /:id/git/log?filepath=` `server.js:472-479`

```json
{ "commits": [{ "oid","short","message","author","timestamp","parents": [] }] }
```

`filepath` scopes to file history (analogous to `git log -- <path>`) `lib/git.js:75`.

### 7.18 Git — `GET /:id/git/commit/:oid` `server.js:481-487`

```json
{ "oid","short","parent","parentShort","message","author","timestamp","files": [{ "path","status":"added|deleted|modified" }] }
```

### 7.19 Git — `GET /:id/git/commit/:oid/diff?path=` `server.js:489-497`

```json
{ "path":"src/app.js","rows": [{ "t":"ctx|add|del","a":1|null,"b":2|null,"s":"..." }], "stats": { "add":3,"del":1 }, "empty": false }
```

### 7.20 Git — `GET /:id/git/diff?path=` `server.js:499-507`

Same shape as above but `HEAD` vs working copy `lib/git.js:166-172`.

### 7.21 Git — `GET /:id/git/branches` `server.js:509-515`

```json
{ "current":"main","branches":["feat/x","main"] }
```

### 7.22 Git — `POST /:id/git/branches` `server.js:517-527` — JSON `{ name, checkout? }`

Creates branch; `checkout` defaults to `true` `lib/git.js:198`. Validates name `lib/git.js:193`.

```json
{ "current":"feat/x","branches":["feat/x","main"] }
```

### 7.23 Git — `POST /:id/git/branches/switch` `server.js:529-540` — JSON `{ name }`

Switches via `checkout` `lib/git.js:210`; `409` if conflicting changes `lib/git.js:213`; also calls `touchProject` to refresh `fileCount` `server.js:538`.

### 7.24 Git — `DELETE /:id/git/branches?name=` `server.js:542-551`

Refuses to delete `current` `lib/git.js:221`.

### 7.25 Git — `POST /:id/git/restore` `server.js:553-563` — JSON `{ path }`

Restore single file to `HEAD` `lib/git.js:232-235`.

### 7.26 Git — `POST /:id/git/discard` `server.js:565-573`

`checkout <branch> --force` `lib/git.js:237-241` — discards all.

### 7.27 Git — `GET /:id/git/file?oid=&path=` `server.js:575-585`

Raw content at commit `lib/git.js:243-246`:

```json
{ "path":"src/app.js","oid":"abc...","content":"..." }
```

---

## 8. Git Subsystem (`lib/git.js`)

See `docs/CONFIGURATION.md:4` for constants and function table. Key invariants to preserve:

- Every project dir is a valid `isomorphic-git` repo after first write `lib/git.js:21-27` — `ensureRepo` is idempotent, called by `status`/`commitAll`/`log`/`listBranches`.
- `statusMatrix` `lib/git.js:30,48` head values: `0=absent, 1=present`; workdir `0=absent, 1=identical, 2=modified` — mapping at `lib/git.js:52-55`.
- `commitAll` returns `null` on clean → caller should send `400` `server.js:465`.
- `switchBranch` may throw `409` `lib/git.js:213` — surface as is.
- `diffWorkingFile` vs `diffCommitFile` differ only in old/new line source `lib/git.js:134-181`; both cap at `MAX_DIFF_BYTES`.

---

## 9. Diff Engine (`lib/diff.js`)

See `docs/CONFIGURATION.md:5` for algorithm steps and `MAX_CELLS` `lib/diff.js:6`. Row shape `lib/diff.js:4` is consumed by `public/app.js:1088-1092` (`diff-*` classes) and `diffStats` `lib/diff.js:63-70` for `+N -M` badge `public/app.js:1085-1086`.

To support word-level diffs later, keep row shape stable and add a new `t: 'inline'` variant rather than breaking `t`.

---

## 10. Security Model

| Concern | How handled | Where |
|---------|-------------|-------|
| Path traversal (zip & API) | `entryName.includes('..')` reject `lib/storage.js:91-96`; `safeResolve` prefix check `lib/storage.js:38-46` | Both layers |
| Executable uploads | `BLOCKED_EXTENSIONS` skip `lib/storage.js:97-103`, loose loop `server.js:165`, `PUT` guard `server.js:253` | Return `skippedFiles` |
| Large file DoS | `MAX_UPLOAD_BYTES` 200 MB `server.js:26`; `MAX_FILE_VIEW_BYTES` 2 MB `server.js:218`; `MAX_DIFF_BYTES` 1 MB `lib/git.js:12`; `MAX_CELLS` 4M `lib/diff.js:6` | Multiple caps |
| Binary vs text | `isBinary` `0x00` sniff 8KB `lib/storage.js:48-54`, `server.js:222,341,398` | Prevents decoding binary as utf8 |
| XSS via Markdown | `DOMPurify.sanitize(marked.parse(...))` before `innerHTML` `public/app.js:460,579` | Always sanitized |
| Audit trail | `storage.audit` JSON-lines `lib/storage.js:33-36` → `GET /api/audit` `server.js:434-442` | Non-deletable by normal API |
| `X-Powered-By` | Disabled `server.js:15` | Fingerprinting reduction |

Remaining gaps (add before public internet exposure): auth, CORS, rate limiting, proxy body-size alignment, `data/audit.log` rotation.

---

## 11. Local Development Workflow

### 11.1 Install & Run

```powershell
npm install
npm run dev   # restarts on file change
# in another terminal
Invoke-RestMethod http://localhost:3000/api/projects
```

### 11.2 Recommended Editor Setup

- Node 20+, ESLint optional — no lint config yet; keep `'use strict'` in `lib/*.js` and `server.js`.
- Prettier optional — repo has no formatter config; match existing 2-space indent.

### 11.3 Making Changes

1. Branch: `git checkout -b feat/my-feature`.
2. Edit `server.js` / `lib/*.js` / `public/*`.
3. Restart or let `--watch` reload.
4. Manual hit: upload zip, search, edit file, commit, branch, diff, audit.
5. `npm audit` periodically.

### 11.4 Reset Local Data

```powershell
Remove-Item -Recurse -Force data\repos\*  # or whole data\
Remove-Item data\metadata.json, data\audit.log -ErrorAction SilentlyContinue
# data/ is git-ignored — safe to delete
```

### 11.5 Ports

Default `3000` `server.js:601`. If occupied: `PORT=3001 npm start` (PowerShell: `$env:PORT=3001; npm start`).

---

## 12. Testing Strategy

No test suite ships yet. Recommended layers when you add one:

| Layer | Tool | What to cover |
|-------|------|---------------|
| Unit — storage | Vitest/Jest | `safeResolve` traversal, `isBinary`, `sanitizeName`, `extractZip` blocklist & flattening |
| Unit — diff | Vitest | `diffLines` prefix/suffix, empty, `MAX_CELLS` block replace, `diffStats` |
| Unit — git | Vitest + `memfs` | `ensureRepo`, `commitAll` null-on-clean, branch regex, `status` mapping |
| API | Supertest | All routes in Section 7 — happy + 400/404/413/409 paths |
| E2E | Playwright | Upload → browse → edit → commit → branch → diff → audit |

Example API test (Supertest):

```js
import request from 'supertest';
import app from '../server.js'; // export app for testing (refactor listen to separate file)
test('rejects traversal zip', async () => {
  const res = await request(app).post('/api/projects/upload')
    .attach('archive', Buffer.from('...zip with ../evil'), 'evil.zip');
  expect(res.status).toBe(400);
});
```

> Tip: Refactor `app.listen` out of `server.js` into `bin/www.js` so `server.js` can `module.exports = app` for tests without binding a port.

---

## 13. Debugging & Troubleshooting

| Symptom | Likely cause | Where to look |
|---------|--------------|---------------|
| `EADDRINUSE :3000` | Port taken | `PORT=3001 npm start` |
| `Upload exceeds 200 MB` | `MAX_UPLOAD_BYTES` | `server.js:595`, raise limit or split zip |
| `File too large to preview` | `MAX_FILE_VIEW_BYTES` | `server.js:218`, use Raw/Download |
| `Blocked file type: .exe` | `BLOCKED_EXTENSIONS` | `server.js:253`, adjust `lib/storage.js:13` |
| `Path traversal rejected` | `..` in `rel` | `lib/storage.js:41`, check `req.query.path` encoding |
| `Nothing to commit` | Working copy clean | `server.js:465`, check `GET /:id/git/status` |
| `Branch not found` | Typo | `lib/git.js:205`, list via `GET /:id/git/branches` |
| `Cannot switch branch with uncommitted...` | Conflicting changes | `lib/git.js:213` → commit or discard first |
| `Cannot delete current branch` | Deleting checked-out | `lib/git.js:221` → switch first |
| Empty diff for large file | `MAX_DIFF_BYTES` | `lib/git.js:137,145` → view Raw at commit |
| Markdown XSS | Missing sanitize | `public/app.js:460,579` must keep `DOMPurify.sanitize` |

Server logs: `console.error` on `500` `server.js:597` and `git snapshot failed` `server.js:114,175`.

---

## 14. Extending the Project

### 14.1 Add a New File Type to Stats

Edit `LANGS` `server.js:323-332`:

```js
'.rs': 'Rust', // already there; add:
// '.sol': 'Solidity',
```

Unknown ext becomes `Other (.sol)` `server.js:345`; no breakage.

### 14.2 Add a New Route (full example)

See template in Section 5.4. Remember `audit()` and `touchProject()`.

### 14.3 Change Blocked Extensions

Edit `lib/storage.js:13` or wire to `process.env.BLOCKED_EXTENSIONS` per `docs/ENV_VARIABLES.md:10`. Return to client via `skippedFiles`.

### 14.4 Replace `adm-zip` with Streaming

Swap `extractZip` to `yauzl` streaming to handle >200 MB zips without buffering `adm-zip`'s `toBuffer()`. Keep traversal + blocklist checks.

### 14.5 Add Authentication

Insert middleware **before** routes `server.js:48`:

```js
app.use('/api', authMiddleware); // verify JWT/PAT, set req.user
// then audit actor becomes req.user.id not req.ip
```

Update `audit()` calls to use `req.user`.

### 14.6 Toward `ARCHITECTURE.md` Vision

Follow `ARCHITECTURE.md:59-57` — extract `lib/git.js` into a gRPC service, move `metadata.json` to Postgres, add Redis for queues, S3 for object storage. Keep `server.js` as API gateway during migration.

---

## 15. Deployment

### 15.1 Dockerfile

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server.js"]
```

### 15.2 Compose

```yaml
services:
  lsgit:
    build: .
    ports: ["3000:3000"]
    env_file: .env
    volumes: [lsgit_data:/app/data]
volumes: { lsgit_data: {} }
```

### 15.3 Reverse Proxy

Nginx `client_max_body_size 210M;` to match `MAX_UPLOAD_BYTES` + overhead. Forward `X-Forwarded-For` and set `app.set('trust proxy', 1)` `server.js` for correct `req.ip`.

### 15.4 Backup

`data/` is the entire state: `metadata.json` + `audit.log` + `repos/` (each with `.git`). Tar it on schedule.

---

## 16. Conventions & Style

- `'use strict'` at top of every `lib/*.js` and `server.js` (`server.js:1`, `lib/storage.js:1`, `lib/git.js:1`, `lib/diff.js:1`).
- CommonJS `require` / `module.exports` (`package.json:6` `"type":"commonjs"`).
- `path.resolve` + prefix check for any user path (`lib/storage.js:38-46`).
- Errors carry `.status` for HTTP mapping (`lib/storage.js:42-43,92-93`, `lib/git.js:194-195,205-206,213`).
- Frontend: vanilla JS, no build step — `public/app.js` is one file; keep helpers small and co-located.

---

## 17. FAQ

**Q: Do I need Postgres/Redis?**
No. Current persistence is `data/*.json` + `data/repos/` + `data/audit.log`. `ARCHITECTURE.md:176-180` shows production topology *for later* — run single-node today.

**Q: Why does the ZIP flatten one top-level folder?**
GitHub-style zips ship as `repo-main/...`. Flattening `lib/storage.js:115-122` makes the tree match the repo root users expect.

**Q: Where do uploads go if I use loose files?**
Each `originalname` is `safeResolve`'d into `REPOS_DIR/<id>/` `server.js:84-87` with dirs created `server.js:86`. Backslashes and `../` prefixes are stripped `server.js:84`.

**Q: How is the audit log protected?**
It is only appended to `lib/storage.js:35` and read (last 100) `server.js:437`. No API deletes it — manage rotation out-of-band.

**Q: How to change the theme?**
Swap `public/index.html:8` to `atom-one-light.min.css` and tweak tokens in `public/style.css:7-21`.

---

*Last verified against `server.js:1-604`, `lib/storage.js:1-148`, `lib/git.js:1-264`, `lib/diff.js:1-72`, `public/app.js:1-1301`, `public/index.html:1-197`, `package.json:1-18` on 2026-08-23.*
