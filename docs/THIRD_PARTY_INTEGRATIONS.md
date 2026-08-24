# Third-Party Integrations — Complete Reference

> Every external package, CDN asset, and protocol touched by LSGit. Versions pinned in `package.json:12-17` and `package-lock.json:1-56792`. Frontend vendors live in `public/vendor/` (`public/index.html:8-11`, `public/app.js:113-123`).

---

## Table of Contents

1. [Dependency Map](#1-dependency-map)
2. [Backend Dependencies](#2-backend-dependencies)
   - [2.1 express](#21-express-4212)
   - [2.2 multer](#22-multer-145-lts1)
   - [2.3 adm-zip](#23-adm-zip-0516)
   - [2.4 isomorphic-git](#24-isomorphic-git-1419)
3. [Frontend Vendor Assets](#3-frontend-vendor-assets)
   - [3.1 highlight.js](#31-highlightjs)
   - [3.2 marked](#32-marked)
   - [3.3 DOMPurify](#33-dompurify)
   - [3.4 atom-one-dark theme](#34-atom-one-dark-theme)
4. [Implicit / Platform Integrations](#4-implicit--platform-integrations)
5. [Data Flow Per Integration](#5-data-flow-per-integration)
6. [Configuration & Tuning](#6-configuration--tuning)
7. [Security & Supply-Chain Notes](#7-security--supply-chain-notes)
8. [Upgrade Playbook](#8-upgrade-playbook)
9. [Future Integrations (from ARCHITECTURE.md)](#9-future-integrations-from-architecturemd)
10. [Appendix — License & Links](#10-appendix--license--links)

---

## 1. Dependency Map

```
package.json              public/index.html + public/vendor/
─────────────             ──────────────────────────────────
express ────────────────▶ HTTP server, static, JSON  server.js:3,14-17
multer ─────────────────▶ multipart uploads             server.js:4,21-30
adm-zip ────────────────▶ zip extract + archive export lib/storage.js:85, server.js:301
isomorphic-git ─────────▶ pure-JS git                 lib/git.js:6-8

highlight.min.js ───────▶ code syntax coloring        public/index.html:9, public/app.js:586-593,552-623
marked.min.js ──────────▶ markdown → HTML             public/index.html:10, public/app.js:460,579
purify.min.js ──────────▶ HTML sanitization           public/index.html:11, public/app.js:460,579
atom-one-dark.min.css ──▶ highlight theme             public/index.html:8

Node builtins: fs, path, crypto  server.js:5-7, lib/storage.js:3-4, lib/git.js:3-4
```

No database, no queue, no cloud SDK today — all state is local disk (`data/`).

---

## 2. Backend Dependencies

### 2.1 `express` `^4.21.2` (`package.json:14`)

**Purpose:** HTTP framework. Owns routing, middleware, static serving.

**Where used:**

| Location | Usage |
|----------|-------|
| `server.js:3` | `require('express')` |
| `server.js:14` | `express()` app |
| `server.js:15` | `app.disable('x-powered-by')` |
| `server.js:16` | `express.json({ limit: '1mb' })` |
| `server.js:17` | `express.static('public')` |
| `server.js:48-586` | All `app.get/post/put/patch/delete/use` routes |
| `server.js:602` | `app.listen(PORT)` |

**Configuration in repo:**

- JSON body limit `1mb` (`server.js:16`) — protects `PUT /file` (`server.js:244`) from huge payloads.
- Static dir `public` (`server.js:17`) — serves `index.html`, `app.js`, `style.css`, `vendor/*`.
- 404 handler for `/api` (`server.js:589`) must stay before error handler (`server.js:591`).

**Tuning:**

- Add `cors`, `helmet`, `compression`, `morgan` as middleware *before* routes if needed.
- Behind a proxy, set `app.set('trust proxy', 1)` to get correct `req.ip` for `audit()` (`server.js:111` etc.).

**Alternatives considered in `ARCHITECTURE.md:143-144`:** `Axum` (Rust) / `Chi` (Go) for a future rewrite; `express` stays for current Node implementation.

---

### 2.2 `multer` `^1.4.5-lts.1` (`package.json:16`)

**Purpose:** `multipart/form-data` parser for file uploads. Only integration that touches raw user bytes before validation.

**Where used:**

| Location | Usage |
|----------|-------|
| `server.js:4` | `require('multer')` |
| `server.js:21-30` | `multer({ storage: diskStorage, limits, fileFilter })` |
| `server.js:57` | `upload.fields([{name:'files'},{name:'archive'}])` for `POST /upload` |
| `server.js:139` | Same fields for `POST /:id/files` |

**Configuration in repo:**

```js
// server.js:22-25
storage: multer.diskStorage({
  destination: (_req,_file,cb)=>cb(null, storage.DATA_DIR), // data/
  filename: (_req,file,cb)=>cb(null, 'upload-'+crypto.randomBytes(8).toString('hex')),
}),
limits: { fileSize: storage.MAX_UPLOAD_BYTES, files: 5000 }, // server.js:26
fileFilter: (_req,file,cb)=>cb(null,true),                    // server.js:27-29
```

- Files land as `data/upload-<hex>` (no extension) — cleaned on success (`server.js:81,155`) or on failure (`server.js:118-120`).
- `files: 5000` caps multipart file count per request; `fileSize` is `MAX_UPLOAD_BYTES` from `lib/storage.js:12`.

**Security:**

- `fileFilter` allows all; real filtering happens in `lib/storage.js:98-101` (blocked extensions) and `server.js:165`.
- Multer error `LIMIT_FILE_SIZE` mapped to `413` (`server.js:592-596`).

**Upgrade notes:**

- `1.4.5-lts.1` is the LTS fork; do not downgrade to unmaintained `1.4.4`. Check https://github.com/expressjs/multer for CVEs.

---

### 2.3 `adm-zip` `^0.5.16` (`package.json:13`)

**Purpose:** ZIP parsing, selective extraction, and ZIP generation — no native bindings.

**Where used:**

| Location | Usage |
|----------|-------|
| `lib/storage.js:85` | `require('adm-zip')` inside `extractZip()` (lazy) |
| `lib/storage.js:86` | `new AdmZip(zipPath)` |
| `lib/storage.js:87` | `getEntries().filter(!isDirectory)` |
| `lib/storage.js:91-96` | Traversal guard `entryName.includes('..')` |
| `lib/storage.js:97-103` | Blocked-extension filter + `skipped[]` |
| `lib/storage.js:110-112` | `extractEntryTo(dest, true, true)` per entry |
| `lib/storage.js:115-122` | Flatten single top-level folder after extract |
| `server.js:301` | `require('adm-zip')` for `GET /:id/archive` export |
| `server.js:302-311` | `new AdmZip()`, `addFile`/`addLocalFile`, `toBuffer()` |

**Export path (`server.js:301-311`):**

```js
const zip = new AdmZip();
for (const entry of storage.walk(repoPath, repoPath)) {
  if (entry.type === 'dir') zip.addFile(entry.path + '/', Buffer.alloc(0));
  else zip.addLocalFile(abs, dirname, basename);
}
res.set('Content-Disposition', `attachment; filename="${sanitizeName(name)}.zip"`);
res.send(zip.toBuffer());
```

**Limits & guards:**

- Rejects archives with `..` in any entry name (`lib/storage.js:91-96`).
- Rejects empty archives after blocklist filtering (`lib/storage.js:104-108`).
- No streaming — whole ZIP is buffered. Large archives rely on `MAX_UPLOAD_BYTES` (200 MB).

**Alternatives:** `yauzl` (streaming), `unzipper` — would reduce memory for huge zips but add complexity.

---

### 2.4 `isomorphic-git` `^1.41.9` (`package.json:15`)

**Purpose:** Pure-JavaScript Git implementation — no `git` binary, no shell-out, works offline. Each project gets a real `.git` repo under `data/repos/<uuid>/.git`.

**Where used — `lib/git.js:6-8`:**

```js
const git = require('isomorphic-git');
const { diffLines, diffStats } = require('./diff');
```

All `git.*` calls pass `{ fs, dir }` with Node `fs` (`lib/git.js:23,30-34,44,48,74,78,94,104,109,134,145,186,198,203,210,226,233,239,244`).

| Call | Lines | Purpose |
|------|-------|---------|
| `git.init({ defaultBranch: 'main' })` | `23` | Init on first use |
| `git.statusMatrix` | `30,48` | Stage + status |
| `git.add` / `git.remove` | `33,35` | Stage |
| `git.commit` | `25,68` | Commit with `AUTHOR` |
| `git.currentBranch` | `41,188,220,238` | Branch name |
| `git.log` | `77` | History (`depth:500`, optional `filepath`) |
| `git.readTree` | `94` | Flatten tree for `commitDetail` |
| `git.readCommit` | `104,109,176` | Commit metadata + tree oid |
| `git.readBlob` | `136,244` | File at `oid` |
| `git.resolveRef(HEAD)` | `167` | HEAD oid for working diff |
| `git.listBranches` | `186,203` | Branch list |
| `git.branch` | `198` | Create (with `checkout`) |
| `git.checkout` | `210,233,239` | Switch / restore / discard |
| `git.deleteBranch` | `226` | Delete |

**High-level flows:**

| Function | Lines | Flow |
|----------|-------|------|
| `ensureRepo` | `21-27` | `hasRepo`? no → `init` → `stageAll` → `Initial import` |
| `commitAll` | `63-70` | `ensureRepo` → `status` → if clean `null` else `stageAll`+`commit` |
| `status` | `46-60` | `statusMatrix` → map `0/0/1/2` to `added/deleted/modified` |
| `log` | `72-89` | `git.log` → `{ oid, short, message, author, timestamp, parents }` |
| `commitDetail` | `103-132` | Two `flattenTree` + set diff → `files[]` |
| `diffWorkingFile` / `diffCommitFile` | `166-181` | `blobLinesAt`/`workdirLines` → `buildDiff` → `diffLines`/`diffStats` |

**Constraints:**

- `isomorphic-git` does not implement hooks, LFS, or SSH transports — intentional for local-first (`ARCHITECTURE.md` would use `git2-rs`/`go-git` in a future service).
- Branch name validation mirrors Git rules (`lib/git.js:193`); keep in sync if you change `GIT_DEFAULT_BRANCH`.

**Upgrade notes:**

- Pin to `^1.41.9`; major bumps may change `statusMatrix` shape — run `GET /:id/git/status` + `log` after upgrade.

---

## 3. Frontend Vendor Assets

All loaded synchronously in `public/index.html:8-11` before `public/app.js`:

```html
<link rel="stylesheet" href="/vendor/atom-one-dark.min.css">
<script src="/vendor/highlight.min.js"></script>
<script src="/vendor/marked.min.js"></script>
<script src="/vendor/purify.min.js"></script>
```

Files on disk `public/vendor/`:

| File | Size | Role |
|------|------|------|
| `highlight.min.js` | 121 KB | `hljs` global — syntax highlighting |
| `marked.min.js` | 35 KB | `marked` global — Markdown → HTML |
| `atom-one-dark.min.css` | <1 KB | Highlight theme |
| `purify.min.js` | 21 KB | `DOMPurify` global — HTML sanitizer |
| `atom-one-light.min.css` | <1 KB | Alternate theme (not loaded by default) |

### 3.1 highlight.js

**Used at:** `public/app.js:586-593` (`highlightToLines`), `552-623`.

- `EXT_LANG` → `hljs` language map `public/app.js:113-123` (~30 extensions).
- `hljsLang(path)` returns language if `hljs.getLanguage(lang)` exists `public/app.js:131-134`.
- `highlightToLines(code, lang)` `public/app.js:587-623` calls `hljs.highlight(..., {ignoreIllegals:true})` or `highlightAuto`, then splits highlighted HTML into per-line strings while preserving open `<span>` tags for line-number alignment.

**Config:** Theme is `atom-one-dark.min.css`; swap to `atom-one-light` by changing `index.html:8`.

### 3.2 marked

**Used at:** `public/app.js:460`, `579` after `DOMPurify` check:

```js
DOMPurify.sanitize(marked.parse(content))
```

- Renders `README` in directory view `public/app.js:459-461` and Markdown files `public/app.js:578-579`.
- Inline fallback: `readme-plain` `<pre>` if not Markdown `public/app.js:462`.

### 3.3 DOMPurify

**Used at:** same lines as `marked` — always sanitizes `marked.parse` output before `innerHTML`. Prevents XSS via `javascript:` links, `<svg onload>`, etc. in Markdown.

**Do not** remove — user-uploaded Markdown is untrusted.

### 3.4 atom-one-dark theme

Pure CSS. No JS. Loaded via `<link>` before highlight runs, so `hljs` classes have styles immediately.

---

## 4. Implicit / Platform Integrations

| Integration | Where | Purpose |
|-------------|-------|---------|
| **Node `fs` / `path` / `crypto`** | `server.js:5-7`, `lib/storage.js:3-4`, `lib/git.js:3-4` | Disk I/O, path ops, `randomUUID` / `randomBytes` for uploads & project IDs `server.js:70,151` |
| **IndexedDB `lsgit-prefs`** | `public/app.js:52-103` | UI state (`expanded`, `last`, `ui:wrap`, `ui:md`) with `localStorage` fallback |
| **HTTP/JSON** | `server.js:16,48-586` | REST API contract — see `docs/DEVELOPER_GUIDE.md` |
| **Browser File API** | `public/app.js:1162-1243` | Drag & drop for uploads (`drop-zone`, `drop-target`) |
| **Git protocol (future)** | `ARCHITECTURE.md:24,119,124` | Smart HTTP / SSH — not implemented yet; `isomorphic-git` is local only |

---

## 5. Data Flow Per Integration

### 5.1 Upload via `multer` → `adm-zip` → `isomorphic-git`

```
Browser FormData (files/archive)  public/app.js:1258-1263,1232
  → multer.diskStorage → data/upload-<hex>  server.js:22-25
  → server.js:57-123 POST /upload
    ├─ if archive: storage.extractZip → adm-zip → data/repos/<uuid>/  lib/storage.js:84-130
    └─ if loose: safeResolve + rename each  server.js:84-93
  → countFiles/dirSize → writeMetadata → audit → git.commitAll  server.js:97-114
```

### 5.2 Git commit / status / diff

```
PUT /file or POST /:id/files → disk write  server.js:244-264,139-180
  → touchProject → audit
  → git.commitAll / git.status / git.diff*  lib/git.js:63-181 → diffLines  lib/diff.js:8-61
```

### 5.3 Markdown → HTML → sanitize → render

```
GET /file?path=... → isBinary? → utf8  server.js:210-229
  → app.js openFile → isMarkdown? → marked.parse → DOMPurify.sanitize → innerHTML  public/app.js:578-579
```

---

## 6. Configuration & Tuning

| Integration | Knob | Location | Default | When to change |
|-------------|------|----------|---------|----------------|
| `multer` | `fileSize` | `server.js:26` | `MAX_UPLOAD_BYTES` 200 MB | Match `nginx client_max_body_size` |
| `multer` | `files` | `server.js:26` | `5000` | Lower to `500` if you see `Too many files` abuse |
| `multer` | `destination` | `server.js:23` | `DATA_DIR` | Use ephemeral tmpfs if you want upload-then-move to be atomic |
| `adm-zip` | blocked list | `lib/storage.js:13,98` | 9 exts | Add org-specific blocked exts |
| `isomorphic-git` | `AUTHOR` | `lib/git.js:11` | `LSGit` | Set to org identity via env |
| `isomorphic-git` | `depth` | `lib/git.js:74` | `500` | Raise for long-lived repos; paginate if >1000 |
| `highlight.js` | `EXT_LANG` | `public/app.js:113` | ~30 | Add `toml→ini`, `env→ini`, new langs as needed |
| `marked` | options | `public/app.js:460,579` | defaults | Pass `{ gfm:true, breaks:false }` explicitly if you upgrade |
| `DOMPurify` | config | `public/app.js:460,579` | default allowlist | Tighten with `ALLOWED_TAGS` if you render user Markdown in email |
| `express.json` | `limit` | `server.js:16` | `1mb` | Raise if `PUT /file` payloads exceed it (large edits) |

---

## 7. Security & Supply-Chain Notes

- **Pinfile:** `package-lock.json` pins exact resolved versions — commit it (already committed). Use `npm ci` in CI/Docker.
- **Audit:** `npm audit` — fix `adm-zip` and `isomorphic-git` CVEs before `multer/express` (they touch untrusted bytes).
- **No `fileFilter` bypass:** `multer.fileFilter` is intentionally permissive (`server.js:27-29`); real enforcement is in `storage.extractZip` and `PUT /file` — keep both.
- **Traversal:** `safeResolve` `lib/storage.js:38-46` + ZIP `..` check `lib/storage.js:91-96` — do not relax either.
- **XSS:** `marked` output is **always** through `DOMPurify.sanitize` `public/app.js:460,579` — never set `innerHTML` from Markdown without it.
- **Supply chain:** Vendor JS is checked into `public/vendor/` — verify SRI or re-download from official releases when upgrading; do not pull from random CDN.

---

## 8. Upgrade Playbook

```powershell
# 1. Check outdated
npm outdated

# 2. Upgrade one at a time and test
npm install express@latest --save
npm test  # or manual: upload zip, upload loose, edit file, commit, branch, search
npm audit fix

# 3. Frontend vendors — replace files in public/vendor/ from official releases:
# highlight.js: https://highlightjs.org/download  (common + languages you use)
# marked: https://github.com/markedjs/marked/releases
# dompurify: https://github.com/cure53/DOMPurify/releases
# atom-one-dark: bundled with highlight.js

# 4. Record in git
git add package.json package-lock.json public/vendor/
git commit -m "chore: bump <dep> to <ver>"
```

Test matrix after each bump:

- [ ] `POST /api/projects/upload` with `.zip` (including one with blocked `.exe` inside → `skippedFiles`)
- [ ] `POST /api/projects/upload` with loose files (no `name` → `400` `server.js:66`)
- [ ] `PUT /api/projects/:id/file` + `GET /:id/git/status` → `modified`
- [ ] `POST /:id/git/commit` → `GET /:id/git/log` → `GET /:id/git/commit/:oid`
- [ ] Markdown file renders sanitized (try `![x](javascript:alert(1))` — must not execute)

---

## 9. Future Integrations (from `ARCHITECTURE.md`)

These are **planned, not implemented** — listed in `ARCHITECTURE.md:142-155`:

| Layer | Planned Choice | Rationale | Current stub |
|-------|---------------|-----------|--------------|
| Primary language | Rust or Go | Perf, safety | Node/Express today |
| Web framework | `Axum`/`Chi` | Async, middleware | `express` |
| DB | PostgreSQL 16+ | ACID, JSONB | `metadata.json` on disk |
| Cache/Queue | Redis 7+ | Pub/sub, streams | none |
| Git backend | `git2-rs` / `go-git` | Native git | `isomorphic-git` |
| gRPC | `tonic` / `grpc-go` | Git service | none |
| GraphQL | `async-graphql` / `gqlgen` | Schema-first | REST only |
| Object storage | S3 API | Standard | local `data/repos/` |
| Search | Meilisearch / Typesense | Simpler than ES | linear scan `server.js:384-418` |
| Observability | Prometheus/Grafana + OTel | Standard | `console.error` + `audit.log` |

When you adopt any of these, add a section here with version, config file, and wire-up location.

---

## 10. Appendix — License & Links

| Package | License | Links |
|---------|---------|-------|
| `express` 4.21.2 | MIT | https://expressjs.com |
| `multer` 1.4.5-lts.1 | MIT | https://github.com/expressjs/multer |
| `adm-zip` 0.5.16 | MIT | https://github.com/cthackers/adm-zip |
| `isomorphic-git` 1.41.9 | MIT | https://isomorphic-git.org |
| `highlight.js` | BSD-3 | https://highlightjs.org |
| `marked` | MIT | https://marked.js.org |
| `DOMPurify` | Apache-2.0 / MPL-2.0 | https://github.com/cure53/DOMPurify |

Backend license for this repo: MIT (`package.json:11`).

*Last verified against `package.json:12-17`, `server.js:3-7,21-30,57,139,301`, `lib/storage.js:13,85-130`, `lib/git.js:6-8`, `public/index.html:8-11`, `public/app.js:113-123,460,579,586-623` on 2026-08-23.*
