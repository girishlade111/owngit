# Configuration — Complete Reference

> Covers every tunable, path, constant, and runtime flag in LSGit. Source of truth is code at `lib/storage.js:1-148`, `lib/git.js:1-264`, `lib/diff.js:1-72`, `server.js:1-604`, `public/app.js:1-1301`.

---

## Table of Contents

1. [Mental Model](#1-mental-model)
2. [File Map — Where Config Lives](#2-file-map--where-config-lives)
3. [Storage Layer (`lib/storage.js`)](#3-storage-layer-libstoragejs)
4. [Git Layer (`lib/git.js`)](#4-git-layer-libgitjs)
5. [Diff Engine (`lib/diff.js`)](#5-diff-engine-libdiffjs)
6. [HTTP Server (`server.js`)](#6-http-server-serverjs)
7. [Frontend Preferences (`public/app.js`)](#7-frontend-preferences-publicappjs)
8. [Runtime Modes: dev vs prod](#8-runtime-modes-dev-vs-prod)
9. [Changing Configuration Safely](#9-changing-configuration-safely)
10. [Hardening Checklist](#10-hardening-checklist)
11. [Appendix — Defaults Table](#11-appendix--defaults-table)

---

## 1. Mental Model

```
.env ──(PORT only today)──▶ server.js ──▶ lib/storage.js ──▶ data/
                              │                │
                              ├─▶ lib/git.js ──▶ data/repos/<uuid>/.git
                              └─▶ lib/diff.js ──▶ in-memory LCS
public/app.js ◀── IndexedDB lsgit-prefs (ui:wrap, ui:md, expanded:<id>, last:<id>)
```

- **Server constants** are authoritative for persistence, validation, and limits.
- **Frontend prefs** never touch the server — they stay in the browser (`public/app.js:52-103`).
- **`.env`** currently controls only `PORT`; wire more vars as described in `docs/ENV_VARIABLES.md`.

---

## 2. File Map — Where Config Lives

| File | What it configures | Lines |
|------|--------------------|-------|
| `lib/storage.js` | Paths, limits, blocked extensions, binary sniff, helpers | `1-148` |
| `lib/git.js` | Author identity, diff cap, history depth, branch rules | `1-264` |
| `lib/diff.js` | LCS DP cap, diff output shape | `1-72` |
| `server.js` | Multer, JSON limit, error handler, audit slice, port | `1-604` |
| `public/app.js` | IndexedDB prefs, highlight mapping, prefs keys | `52-103`, `113-123` |
| `package.json` | Scripts `start` / `dev`, dependency versions | `7-9`, `12-17` |
| `.gitignore` | Ignored paths (`data/`, `node_modules/`, `.scratch/`) | `1-3` |
| `.env.example` | Proposed env contract | root |

---

## 3. Storage Layer (`lib/storage.js`)

### 3.1 Paths

```js
const ROOT = path.join(__dirname, '..');          // lib/storage.js:6
const DATA_DIR = path.join(ROOT, 'data');         // lib/storage.js:7
const REPOS_DIR = path.join(DATA_DIR, 'repos');   // lib/storage.js:8
const META_FILE = path.join(DATA_DIR, 'metadata.json'); // lib/storage.js:9
const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');    // lib/storage.js:10
```

| Key | Default | Writable? | Created when |
|-----|---------|-----------|--------------|
| `DATA_DIR` | `<root>/data` | yes | `ensureDataDirs()` `server.js:12` |
| `REPOS_DIR` | `<DATA_DIR>/repos` | yes | `ensureDataDirs()` |
| `META_FILE` | `<DATA_DIR>/metadata.json` | JSON `{ projects: [] }` fallback `lib/storage.js:21-27` | `writeMetadata()` `lib/storage.js:29-31` |
| `AUDIT_FILE` | `<DATA_DIR>/audit.log` | JSON-lines | `audit()` append `lib/storage.js:33-36` |

**Operations:**
- `ensureDataDirs()` — `mkdir -p REPOS_DIR` `lib/storage.js:17-19`
- `readMetadata()` — parse `META_FILE` or return `{ projects: [] }` `lib/storage.js:21-27`
- `writeMetadata(meta)` — pretty-printed JSON `lib/storage.js:29-31`
- `audit(event)` — `JSON.stringify({ ts: ISO, ...event }) + "\n"` `lib/storage.js:33-36`

### 3.2 Limits

```js
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;  // lib/storage.js:12
const MAX_FILE_VIEW_BYTES = 2 * 1024 * 1024; // lib/storage.js:14
const BINARY_SNIFF_BYTES = 8000;             // lib/storage.js:15
```

| Limit | Value | Used in | Effect when exceeded |
|-------|-------|---------|----------------------|
| `MAX_UPLOAD_BYTES` | 200 MB | `server.js:26` multer, `server.js:594-596` error handler | `413 Upload exceeds the 200 MB size limit` |
| `MAX_FILE_VIEW_BYTES` | 2 MB | `server.js:218`, `341`, `395` | Preview `413 File too large to preview`; search skip; stats fallback |
| `BINARY_SNIFF_BYTES` | 8000 | `lib/storage.js:48-54` `isBinary()` | Only first 8 KB scanned for `0x00` |

### 3.3 Blocked Extensions

```js
const BLOCKED_EXTENSIONS = new Set(['.exe','.dll','.so','.bat','.cmd','.sh','.msi','.scr','.com']); // lib/storage.js:13
```

Enforcement points:
- `extractZip()` — filters entries, collects `skipped[]` `lib/storage.js:97-103,128`
- `POST /:id/files` loose loop — `continue` skips `lib/storage.js` blocked `server.js:165`
- `PUT /:id/file` — `400 Blocked file type` `server.js:253-254`

Returned to client as `skippedFiles` `server.js:115`.

### 3.4 Security Helpers

| Helper | Location | What it does |
|--------|----------|--------------|
| `safeResolve(root, rel)` | `lib/storage.js:38-46` | `path.resolve(root, '.'+sep+rel)` + prefix check; throws `400 Path traversal rejected` |
| `isBinary(buf)` | `lib/storage.js:48-54` | True if any `0x00` in first `BINARY_SNIFF_BYTES` |
| `walk(dir, base)` | `lib/storage.js:56-70` | Recursive listing, skips `.git`, returns `{ path, type, size, mtime }` |
| `sanitizeName(name)` | `lib/storage.js:72-75` | `[^a-zA-Z0-9._-]+ → -`, trim `-`, lowercase, fallback `project` |
| `stripCommonRoot(entries)` | `lib/storage.js:77-82` | Strips single top-level folder name if all entries share it |
| `extractZip(zipPath, dest, original)` | `lib/storage.js:84-130` | Validates `..`, filters blocked, flattens top-level folder, returns `{ fileCount, totalBytes, source, skipped }` |

ZIP flattening: `lib/storage.js:115-122` — if `dest` has exactly one subdir, its children are moved up and the dir removed (GitHub-style archives).

---

## 4. Git Layer (`lib/git.js`)

```js
const AUTHOR = { name: 'LSGit', email: 'lsgit@local' }; // lib/git.js:11
const MAX_DIFF_BYTES = 1024 * 1024;                      // lib/git.js:12
```

| Setting | Location | Default | Notes |
|---------|----------|---------|-------|
| `AUTHOR` | `lib/git.js:11` | `LSGit <lsgit@local>` | Used in every commit `lib/git.js:25,68` |
| `MAX_DIFF_BYTES` | `lib/git.js:12` | 1 MB | `blobLinesAt` / `workdirLines` return `null` above this `lib/git.js:137,145` |
| `defaultBranch` | `lib/git.js:23` | `main` | `git.init({ defaultBranch: 'main' })` |
| `log depth` | `lib/git.js:74` | `500` | `git.log({ depth: 500 })` |
| Branch name regex | `lib/git.js:193` | `/^[^~^:\s\*\?\\\[]+(\/[^~^:\s\*\?\\\[]+)*$/` + no leading `-`, no `.lock` suffix | Validates `createBranch` |

**Core ops:**

| Function | Lines | Behavior |
|----------|-------|----------|
| `hasRepo(dir)` | `16-18` | `fs.existsSync(dir/.git)` |
| `ensureRepo(dir)` | `21-27` | `init` + `stageAll` + `Initial import` commit; idempotent |
| `stageAll(dir)` | `29-38` | `statusMatrix` → `add` / `remove` |
| `currentBranch(dir)` | `40-42` | `git.currentBranch` or `'main'` |
| `status(dir)` | `46-60` | Maps matrix to `added/deleted/modified`, sorted |
| `commitAll(dir, msg)` | `63-70` | `ensureRepo` → `status` → `stageAll` → `commit`; returns `oid` or `null` if clean |
| `log(dir, filepath?)` | `72-89` | `depth:500`, optional `filepath` filter; swallows errors → `[]` |
| `flattenTree(dir, oid)` | `93-101` | Recursive `readTree` → `{ path: oid }` map |
| `commitDetail(dir, oid)` | `103-132` | Compares `newTree` vs `oldTree` of parent → `files[]` with `added/deleted/modified` |
| `blobLinesAt` / `workdirLines` | `134-149` | Read+split or `null` if missing/too large |
| `buildDiff` | `151-163` | Calls `diffLines`, adapts for null sides, returns `{ rows, stats, empty }` |
| `diffWorkingFile` | `166-172` | `HEAD` vs working copy |
| `diffCommitFile` | `175-181` | Commit vs parent |
| `listBranches` | `185-189` | Sorted + current |
| `createBranch(name, checkout)` | `192-200` | Regex validate → `git.branch` |
| `switchBranch(name)` | `202-217` | Existence check → `checkout`; `409` on conflict |
| `deleteBranch(name)` | `219-228` | Refuse if `current`; `git.deleteBranch` |
| `restoreFile` | `232-235` | `checkout HEAD -- filepath` |
| `discardAll` | `237-241` | `checkout <branch> --force` |
| `fileAt(oid, filepath)` | `243-246` | `readBlob` → utf8 |

---

## 5. Diff Engine (`lib/diff.js`)

```js
const MAX_CELLS = 4_000_000; // lib/diff.js:6
```

**`diffLines(a: string[], b: string[]): Row[]`** `lib/diff.js:8-61`

Shape: `{ t: 'ctx'|'add'|'del', a: oldLineNo|null, b: newLineNo|null, s: text }`

Algorithm:
1. Trim common prefix `start` `lib/diff.js:9-11` and suffix `endA/endB` `lib/diff.js:12-13`.
2. Emit leading `ctx` rows `lib/diff.js:16`.
3. Slice middles `midA/midB` `lib/diff.js:18-19`.
4. If one side empty → emit pure `add`/`del` `lib/diff.js:22-25`.
5. If `n*m > MAX_CELLS` → emit block replace (all `del` then all `add`) `lib/diff.js:26-30` — avoids O(n*m) blowup.
6. Else LCS DP with `(n+1)*(m+1)` `Int32Array` `lib/diff.js:31-54`, backtrack emitting `ctx/del/add`.
7. Emit trailing `ctx` `lib/diff.js:57-59`.

**`diffStats(rows)`** `lib/diff.js:63-70` counts `add`/`del`.

Tunable: lower `MAX_CELLS` for faster large-file handling (more block replaces); raise for finer diffs at memory cost.

---

## 6. HTTP Server (`server.js`)

### 6.1 App Bootstrap

```js
storage.ensureDataDirs();               // server.js:12
app.disable('x-powered-by');            // server.js:15
app.use(express.json({ limit: '1mb' }));// server.js:16
app.use(express.static('public'));      // server.js:17
```

| Setting | Location | Value | How to change |
|---------|----------|-------|---------------|
| `x-powered-by` | `15` | disabled | keep disabled |
| `json limit` | `16` | `1mb` | Raise if you accept large JSON payloads (e.g., big `PUT /file` bodies) |
| `static dir` | `17` | `public/` | Change if you serve from `dist/` |

### 6.2 Upload (multer)

```js
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req,_file,cb)=>cb(null, storage.DATA_DIR), // server.js:23
    filename: (_req,file,cb)=>cb(null, 'upload-'+randomHex),   // server.js:24
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 5000 }, // server.js:26
  fileFilter: (_req,file,cb)=>cb(null,true),           // server.js:27-29
}); // server.js:21-30
```

| Field | Value | Notes |
|-------|-------|-------|
| `destination` | `DATA_DIR` | Temp files land alongside `repos/`; cleaned after success `server.js:81,155,117` |
| `filename` | `upload-<hex>` | `crypto.randomBytes(8).hex` |
| `fileSize` | `MAX_UPLOAD_BYTES` | Triggers `LIMIT_FILE_SIZE` |
| `files` | `5000` | Max multipart file count per request |
| `fileFilter` | allow all | Blocking happens later (zip filter / loose loop) |

### 6.3 Helpers

| Helper | Lines | Purpose |
|--------|-------|---------|
| `getProjectOr404(req,res)` | `32-40` | Loads `metadata.json`, finds by `id`, `404` if missing |
| `saveMeta(meta)` | `42-44` | `writeMetadata` wrapper |
| `sanitizeDefault(n)` | `125-127` | Delegates to `storage.sanitizeName` |
| `countFiles(dir)` | `129-131` | `walk().filter(file).length` |
| `dirSize(dir)` | `133-135` | `walk().reduce(size)` |
| `mergeTree(src,dst)` | `182-196` | Recursive copy for archive-to-project merge |
| `matchLine(line,q,regex,cs)` | `370-382` | `RegExp` or `indexOf` |
| `touchProject(ctx, extra)` | `360-363` | `updatedAt=now`, `Object.assign(extra)`, `saveMeta` |
| `publicProject(p)` | `365-368` | Picks `id,name,description,createdAt,updatedAt,fileCount,totalBytes,source` |
| `repoDir(ctx)` | `446-448` | `REPOS_DIR/<id>` |

### 6.4 Routes Summary

All routes are under `/api` (404 handler `server.js:589`). Full spec in `docs/DEVELOPER_GUIDE.md`; key config-relevant ones:

| Route | Lines | Config knob |
|-------|-------|-------------|
| `GET /api/projects` | `48-55` | Sort by `createdAt` |
| `POST /api/projects/upload` | `57-123` | Requires `archive` or `files`; `name` required for loose; creates UUID `70`, `mkdir`, `extractZip` or `safeResolve+rename`, counts, writes meta, audits, `git.commitAll` |
| `POST /api/projects/:id/files` | `139-180` | `BLOCKED_EXTENSIONS` check `165`, `mergeTree` for archives `156`, audits |
| `GET /api/projects/:id/tree` | `198-208` | `walk()` |
| `GET /api/projects/:id/file` | `210-229` | `MAX_FILE_VIEW_BYTES` `218`, `isBinary` `222` |
| `GET /api/projects/:id/raw` | `231-241` | `res.download` |
| `PUT /api/projects/:id/file` | `244-264` | `safeResolve` `252`, blocked ext `253-254`, writes utf8 |
| `DELETE /api/projects/:id/file` | `266-279` | `fs.rmSync` (no `force`) |
| `PATCH /api/projects/:id` | `282-294` | Rename/description; `touchProject` |
| `GET /api/projects/:id/archive` | `297-315` | `adm-zip` walk → zip |
| `GET /api/projects/:id/stats` | `318-358` | `LANGS` map `323-332`, counts lines/bytes per language |
| `GET /api/projects/:id/search` | `384-418` | `q`, `regex`, `case`; cap `200` results `402,411`; skips binary/large |
| `DELETE /api/projects/:id` | `420-432` | `rm -rf REPOS_DIR/id`, filter meta |
| `GET /api/audit` | `434-442` | `slice(-100).map(JSON.parse).reverse()` |
| Git group | `450-585` | `status`, `commit`, `log`, `commit/:oid`, `diff`, `branches`, `restore`, `discard`, `file` |

### 6.5 Error Handling

```js
app.use('/api', (_req,res)=>res.status(404).json({error:'Not found'})); // server.js:589
app.use((err,_req,res,_next)=>{ // server.js:591-599
  const status = err.status || (err.code==='LIMIT_FILE_SIZE'?413:500);
  const message = err.code==='LIMIT_FILE_SIZE'
    ? 'Upload exceeds the 200 MB size limit'
    : err.message || 'Internal server error';
  if(status===500) console.error(err);
  res.status(status).json({ error: message });
});
```

### 6.6 Listen

```js
const PORT = process.env.PORT || 3000; // server.js:601
app.listen(PORT, ()=>console.log(`LSGit code manager listening on http://localhost:${PORT}`)); // server.js:602-604
```

---

## 7. Frontend Preferences (`public/app.js`)

No env vars — stored in `IndexedDB: lsgit-prefs` with `localStorage` fallback `public/app.js:52-103`.

| Key | Location | Default | Purpose |
|-----|----------|---------|---------|
| `expanded:<projectId>` | `public/app.js:213,359,213` | `[]` | Open folders in file tree |
| `last:<projectId>` | `public/app.js:216-241,729` | `null` | Last `cwd` + `file` for restore |
| `ui:wrap` | `public/app.js:232,567-570` | `false` | Soft wrap in code viewer |
| `ui:md` | `public/app.js:489,649,489` | `true` | Markdown rendered vs source |

Other frontend constants:

| Constant | Lines | Value |
|----------|-------|-------|
| `EXT_LANG` | `113-123` | Maps ~30 extensions to highlight.js languages |
| `MAX_CELLS` (diff) | `lib/diff.js:6` | Already covered |

---

## 8. Runtime Modes: dev vs prod

| Aspect | `npm run dev` `package.json:9` | `npm start` `package.json:8` |
|--------|-------------------------------|------------------------------|
| Command | `node --watch server.js` | `node server.js` |
| Autoreload | yes (Node watch) | no |
| Recommended `NODE_ENV` | `development` | `production` |
| Static cache | none | add `express.static` cache headers in prod |
| Log verbosity | `console.error` on 500 `server.js:597` | same; add structured logger later |

---

## 9. Changing Configuration Safely

1. **Read this doc + `docs/ENV_VARIABLES.md`** before editing constants.
2. **Prefer env vars** over code edits for limits/paths (wire `process.env.*` as shown in `docs/ENV_VARIABLES.md:3`).
3. **Validate** new values (e.g., `PORT` range, `BLOCKED_EXTENSIONS` format) — fail fast at boot.
4. **Test** with a real project: upload zip, upload loose, preview large file, search, diff big file.
5. **Check audit**: `GET /api/audit` should still return last 100 `server.js:437`.
6. **Restart** the server after any `lib/*.js` or `server.js` change.

---

## 10. Hardening Checklist

- [ ] Set `DATA_DIR` to a persistent volume outside container ephemeral FS.
- [ ] Keep `BLOCKED_EXTENSIONS` restrictive; review per org policy.
- [ ] Align `MAX_UPLOAD_BYTES` with reverse-proxy limit (`client_max_body_size` for nginx).
- [ ] Add `CORS_ORIGINS` + rate limiting if exposed beyond localhost.
- [ ] Ensure `.gitignore` ignores `.env` and `data/` already does ` .gitignore:1-3`.
- [ ] Rotate audit log: `data/audit.log` grows unbounded; add logrotate or cap file size.

---

## 11. Appendix — Defaults Table

| Key | Default | File:Line |
|-----|---------|-----------|
| `PORT` | `3000` | `server.js:601` |
| `DATA_DIR` | `<root>/data` | `lib/storage.js:7` |
| `REPOS_DIR` | `<DATA_DIR>/repos` | `lib/storage.js:8` |
| `META_FILE` | `<DATA_DIR>/metadata.json` | `lib/storage.js:9` |
| `AUDIT_FILE` | `<DATA_DIR>/audit.log` | `lib/storage.js:10` |
| `MAX_UPLOAD_BYTES` | `209715200` | `lib/storage.js:12` |
| `BLOCKED_EXTENSIONS` | 9 executables | `lib/storage.js:13` |
| `MAX_FILE_VIEW_BYTES` | `2097152` | `lib/storage.js:14` |
| `BINARY_SNIFF_BYTES` | `8000` | `lib/storage.js:15` |
| `AUTHOR` | `LSGit <lsgit@local>` | `lib/git.js:11` |
| `MAX_DIFF_BYTES` | `1048576` | `lib/git.js:12` |
| `MAX_CELLS` | `4000000` | `lib/diff.js:6` |
| `git log depth` | `500` | `lib/git.js:74` |
| `audit slice` | `100` | `server.js:437` |
| `json limit` | `1mb` | `server.js:16` |
| `multer files` | `5000` | `server.js:26` |

*Last verified:* `lib/storage.js:1-148`, `lib/git.js:1-264`, `lib/diff.js:1-72`, `server.js:1-604` on 2026-08-23.
