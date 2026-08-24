# LSGit — Local Code Manager

> **Enterprise-grade, local-first code manager** to upload, browse, search, and manage source repositories — *without* a cloud, *without* a database, *without* your data ever leaving the device.

[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](#prerequisites)
[![Express](https://img.shields.io/badge/express-4.21.2-black)](#stack)
[![License](https://img.shields.io/badge/license-MIT-blue)](#license)
[![Local First](https://img.shields.io/badge/storage-local%20disk-orange)](#persistence)
[![Git](https://img.shields.io/badge/git-isomorphic--git%20pure%20JS-lightgrey)](#git-versioning)

**`lsgit-code-manager@0.1.0`** · `package.json:2-4` · Entrypoint `server.js:1-604` · SPA `public/app.js:1-1301` · Data in `data/` (git-ignored `.gitignore:1`).

---

## Table of Contents

- [Why LSGit](#why-lsgit)
- [Features](#features)
- [Screenshots & UX](#screenshots--ux)
- [Quick Start (60s)](#quick-start-60s)
- [Project Layout](#project-layout)
- [Configuration (.env & constants)](#configuration-env--constants)
- [Third-Party Integrations](#third-party-integrations)
- [API Reference](#api-reference)
- [Git Versioning](#git-versioning)
- [Frontend Guide](#frontend-guide)
- [Persistence & Audit](#persistence--audit)
- [Security Model](#security-model)
- [Performance & Limits](#performance--limits)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Deployment (Docker / systemd / proxy)](#deployment-docker--systemd--proxy)
- [Roadmap — Toward ARCHITECTURE.md](#roadmap--toward-architecturemd)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)
- [Appendix — File-Line Index](#appendix--file-line-index)

---

## Why LSGit

- **Local-first, zero vendor lock-in.** All repos live under `data/repos/<uuid>/` on your disk (`lib/storage.js:8`). Metadata is `data/metadata.json` (`lib/storage.js:9`), audit is `data/audit.log` (`lib/storage.js:10`). Delete `data/` and you have a clean slate.
- **Real Git, no binary.** Every project gets a real `.git` repo via `isomorphic-git` `1.41.9` (`lib/git.js:6-8`, `package.json:15`) — branches, commits, diffs, history, restore — fully offline.
- **Zip or loose files.** `POST /api/projects/upload` handles `archive` and/or `files` fields (`server.js:57-123`); drag & drop into an open repo hits `POST /:id/files` (`server.js:139-180`, `public/app.js:1232`).
- **Developer-tool UX.** Quiet dark mode (`public/style.css:7-21`), file tree with `expanded:<id>` memory (`public/app.js:52-103`), code viewer with line numbers + highlight (`public/app.js:552-623`), Markdown rendered via `marked` + `DOMPurify` (`public/app.js:460,579`), stats insights, search, commits, branch switching, diffs.
- **Sensible guardrails.** 200 MB uploads (`lib/storage.js:12`), 2 MB previews (`lib/storage.js:14`), executable blocklist (`lib/storage.js:13`), traversal guards (`lib/storage.js:38-46,91-96`), LCS cap (`lib/diff.js:6`), diff cap (`lib/git.js:12`).

Compare to cloud Git hosts: LSGit is the *Bitbucket/GitLab file browser + local Git* you can run on a laptop, an air-gapped workstation, or a VPS with zero external deps.

---

## Features

| Area | What you get | Key files |
|------|--------------|-----------|
| **Upload** | Zip archive or loose files; flatten GitHub-style top-level folder; skip blocked executables and report `skippedFiles` | `server.js:57-123`, `lib/storage.js:84-130` |
| **Browse** | Breadcrumbs (`public/app.js:376-398`), dir table (`public/app.js:414-448`), README auto-render (`public/app.js:451-468`), subtree filter, persist `expanded`/`last` (`public/app.js:213,359`) | `public/app.js:195-477` |
| **View & Edit** | Line-numbered code with highlight (`public/app.js:587-623`), soft wrap (`public/app.js:567-571`), Markdown Rendered/Source toggle (`public/app.js:530-534,648-651`), edit in place (`public/app.js:656-690`), raw/download (`server.js:231-241`), binary fallback (`server.js:222`) | `public/app.js:481-718` |
| **Search** | Literal or regex, case-sensitive toggle, 200-hit cap, binary/large skip | `server.js:384-418`, `public/app.js:737-773` |
| **Insights** | Lines, files, size, language bar + table (`LANGS` map `server.js:323-332`) | `server.js:318-358`, `public/app.js:271-291` |
| **Git** | Status, commit, log, commit detail, file diff (HEAD vs work, commit vs parent), branches create/switch/delete, restore one file, discard all, file at commit | `lib/git.js:16-246`, `server.js:450-585`, `public/app.js:776-1158` |
| **Audit** | JSON-lines, last 100 reversed, every mutation audited with `req.ip` | `lib/storage.js:33-36`, `server.js:434-442,111,172,259...` |
| **Security** | Traversal reject, blocked extensions, binary sniff, diff/upload caps, XSS sanitize, `x-powered-by` disabled | `lib/storage.js:38-54`, `server.js:15` |

---

## Screenshots & UX

*Quiet dark mode* — tokens `public/style.css:7-21`:

```css
--bg:#0d0d0d --panel:#161616 --border:#2a2a2a --text:#e8e8e8 --accent:#e07856
```

Layout: 260 px sidebar (`public/style.css:51-83`) + slim 52 px topbar (`public/style.css:87-110`) + `main` with `Projects / Upload / Browser / Audit` views (`public/index.html:52-192`).

- **Projects table** sorted by `createdAt` desc (`server.js:53`), global name filter (`public/app.js:188-191`).
- **Source tab** — `bb-toolbar` (breadcrumbs + search + toggles), `bb-split` grid `280px 1fr` (`public/style.css:266-270`), tree (`public/app.js:309-350`) + content (`public/app.js:392-477`).
- **Commits tab** — `360px 1fr` split (`public/style.css:511-514`), working copy + commit list (`public/app.js:925-968`), per-file diff (`public/app.js:1082-1093`).
- **Insights** — 4 stat cards (`public/style.css:439-450`) + language bar (`public/style.css:456-470`).

Responsive: stacks sidebar, collapses side labels at `980px` (`public/style.css:605-624`).

---

## Quick Start (60s)

**Prereqs:** Node.js 18+ (for `crypto.randomUUID` + `node --watch`), npm 9+.

```powershell
# PowerShell
git clone <your-fork>
Set-Location owngit
npm install
Copy-Item .env.example .env   # edit PORT if 3000 is busy
npm run dev                    # http://localhost:3000  server.js:602-603
```

```bash
# bash
cp .env.example .env
npm install
npm run dev
# or
npm start
```

**Smoke test:**

```powershell
Invoke-RestMethod http://localhost:3000/api/projects | ConvertTo-Json
# upload a fixture zip
curl -F "name=my-app" -F "archive=@my-app.zip" http://localhost:3000/api/projects/upload
```

Open http://localhost:3000 → **Upload code** → drag a `.zip` or click **Choose files**. Your repo appears in **Projects** and is browsable.

---

## Project Layout

```
owngit/
├── server.js              # 604-line Express app — all routes  server.js:1-604
├── lib/
│   ├── storage.js         # paths, limits, helpers, zip      lib/storage.js:1-148
│   ├── git.js             # isomorphic-git wrapper           lib/git.js:1-264
│   └── diff.js            # LCS diff + stats                 lib/diff.js:1-72
├── public/
│   ├── index.html         # SPA shell                        public/index.html:1-197
│   ├── app.js             # 1301-line SPA                    public/app.js:1-1301
│   ├── style.css          # design system                    public/style.css:1-625
│   └── vendor/            # highlight, marked, dompurify, themes
├── data/                  # runtime (git-ignored) .gitignore:1
│   ├── metadata.json      # project index
│   ├── audit.log          # JSON-lines trail
│   └── repos/<uuid>/      # one dir per project + .git
├── docs/
│   ├── ENV_VARIABLES.md       # .env deep dive
│   ├── CONFIGURATION.md       # every tunable
│   ├── THIRD_PARTY_INTEGRATIONS.md
│   └── DEVELOPER_GUIDE.md     # contributor handbook
├── .env.example           # copy to .env
├── ARCHITECTURE.md        # future Rust/Go + Postgres + Redis + S3 vision
├── package.json           # 0.1.0, scripts, deps  package.json:1-18
└── .gitignore             # data/, node_modules/, .scratch/
```

---

## Configuration (.env & constants)

**Today** only `PORT` is env-driven (`server.js:601` → default `3000`).

```ini
# .env (see .env.example for full commented template)
PORT=3000
NODE_ENV=development
# DATA_DIR=./data
# MAX_UPLOAD_BYTES=209715200
# MAX_FILE_VIEW_BYTES=2097152
# BLOCKED_EXTENSIONS=.exe,.dll,.so,.bat,.cmd,.sh,.msi,.scr,.com
# GIT_AUTHOR_NAME=LSGit
# GIT_AUTHOR_EMAIL=lsgit@local
```

All other tunables are constants you can wire to env as shown in `docs/ENV_VARIABLES.md:3`:

| Key | Default | File:Line |
|-----|---------|-----------|
| `DATA_DIR` | `<root>/data` | `lib/storage.js:7` |
| `REPOS_DIR` | `<DATA_DIR>/repos` | `lib/storage.js:8` |
| `META_FILE` | `<DATA_DIR>/metadata.json` | `lib/storage.js:9` |
| `AUDIT_FILE` | `<DATA_DIR>/audit.log` | `lib/storage.js:10` |
| `MAX_UPLOAD_BYTES` | 200 MB | `lib/storage.js:12` (`server.js:26`) |
| `MAX_FILE_VIEW_BYTES` | 2 MB | `lib/storage.js:14` |
| `BLOCKED_EXTENSIONS` | 9 executables | `lib/storage.js:13` |
| `MAX_DIFF_BYTES` | 1 MB | `lib/git.js:12` |
| `MAX_CELLS` (LCS) | 4 000 000 | `lib/diff.js:6` |
| `AUTHOR` | `LSGit <lsgit@local>` | `lib/git.js:11` |
| `git log depth` | 500 | `lib/git.js:74` |
| `audit slice` | 100 | `server.js:437` |
| `express.json limit` | 1 MB | `server.js:16` |

Deep guides:

- **`docs/ENV_VARIABLES.md`** — every env var, validation, Docker/systemd examples, troubleshooting table.
- **`docs/CONFIGURATION.md`** — full constant → enforcement-point matrix, storage/git/diff/server/frontend sections.

---

## Third-Party Integrations

| Package | Version `package.json:12-17` | Role | Where |
|---------|-----------------------------|------|-------|
| `express` | `^4.21.2` | HTTP, routing, static, JSON | `server.js:3-17,48-599` |
| `multer` | `^1.4.5-lts.1` | Multipart uploads → `data/upload-<hex>` | `server.js:21-30,57,139` |
| `adm-zip` | `^0.5.16` | Zip extract + export | `lib/storage.js:85-130`, `server.js:301-311` |
| `isomorphic-git` | `^1.41.9` | Pure-JS Git (no binary) | `lib/git.js:6-246` |
| `highlight.js` | vendor `public/vendor/highlight.min.js` | Syntax coloring | `public/app.js:586-623` |
| `marked` | vendor `public/vendor/marked.min.js` | Markdown → HTML | `public/app.js:460,579` |
| `DOMPurify` | vendor `public/vendor/purify.min.js` | Sanitize Markdown HTML | `public/app.js:460,579` |
| `atom-one-dark` | vendor `public/vendor/atom-one-dark.min.css` | Highlight theme | `public/index.html:8` |
| Node `fs/path/crypto` | built-in | Disk, paths, UUIDs | `server.js:5-7` |

No database, queue, or cloud SDK today — just local disk. Future stack in `ARCHITECTURE.md:142-155` anticipates Postgres, Redis, S3, Meilisearch, etc., but they are *not* required now.

Full per-integration config, data flows, security and upgrade notes → **`docs/THIRD_PARTY_INTEGRATIONS.md`**.

---

## API Reference

Base `http://localhost:3000`. All `/:id` routes return `404 { error: 'Project not found' }` (`server.js:32-40`). Errors are `{ error: string }` (`server.js:598`).

| Method & Path | Purpose | File:Line |
|--------------|---------|-----------|
| `GET /api/projects` | List public projects, sorted `createdAt` desc | `server.js:48-55` |
| `POST /api/projects/upload` | Create project from `archive` (zip) and/or `files` (loose) | `server.js:57-123` |
| `POST /api/projects/:id/files` | Add files/archive to existing project | `server.js:139-180` |
| `GET /api/projects/:id/tree` | File tree (`walk`) | `server.js:198-208` |
| `GET /api/projects/:id/file?path=` | Preview file (2 MB cap, binary sniff) | `server.js:210-229` |
| `GET /api/projects/:id/raw?path=` | Download raw bytes | `server.js:231-241` |
| `PUT /api/projects/:id/file` | Create/update file (JSON `{path,content}`) | `server.js:244-264` |
| `DELETE /api/projects/:id/file?path=` | Delete file | `server.js:266-279` |
| `PATCH /api/projects/:id` | Rename / edit description | `server.js:282-294` |
| `GET /api/projects/:id/archive` | Download repo as zip | `server.js:297-315` |
| `GET /api/projects/:id/stats` | Language breakdown, lines, size | `server.js:318-358` |
| `GET /api/projects/:id/search?q=&regex=&case=` | Text search (200 cap) | `server.js:384-418` |
| `DELETE /api/projects/:id` | Delete project + disk data | `server.js:420-432` |
| `GET /api/audit` | Last 100 audit events | `server.js:434-442` |
| `GET /:id/git/status` | Working copy status | `server.js:450-456` |
| `POST /:id/git/commit` | Commit (`{message}`) | `server.js:458-470` |
| `GET /:id/git/log?filepath=` | Commit history (depth 500) | `server.js:472-479` |
| `GET /:id/git/commit/:oid` | Commit detail + file list | `server.js:481-487` |
| `GET /:id/git/commit/:oid/diff?path=` | Diff commit vs parent | `server.js:489-497` |
| `GET /:id/git/diff?path=` | Diff HEAD vs working copy | `server.js:499-507` |
| `GET /:id/git/branches` | List branches | `server.js:509-515` |
| `POST /:id/git/branches` | Create branch `{name,checkout?}` | `server.js:517-527` |
| `POST /:id/git/branches/switch` | Switch branch `{name}` | `server.js:529-540` |
| `DELETE /:id/git/branches?name=` | Delete branch | `server.js:542-551` |
| `POST /:id/git/restore` | Restore file to HEAD | `server.js:553-563` |
| `POST /:id/git/discard` | Discard all changes | `server.js:565-573` |
| `GET /:id/git/file?oid=&path=` | Content at commit | `server.js:575-585` |

**Detailed request/response examples, caps, and status codes** → `docs/DEVELOPER_GUIDE.md:7`.

**Conventions:**
- `getProjectOr404` is used at top of every `/:id` handler (`server.js:32-40`).
- Mutations call `touchProject(ctx, {fileCount,totalBytes})` (`server.js:360-363`) to bump `updatedAt`.
- Audit is appended for every state change via `storage.audit` (`lib/storage.js:33-36`).

---

## Git Versioning

Isolated per project — each `data/repos/<uuid>` becomes a standalone repo on first mutation.

```
ensureRepo(dir)  lib/git.js:21-27
  → if no .git: git.init({ defaultBranch:'main' }) → stageAll → commit('Initial import')
commitAll(dir, msg)  lib/git.js:63-70
  → ensureRepo → status → if clean return null else stageAll → git.commit(AUTHOR)
status(dir)  lib/git.js:46-60
  → statusMatrix → map to added/deleted/modified (sorted)
log(dir, filepath?)  lib/git.js:72-89   depth 500
commitDetail(oid)    lib/git.js:103-132  compares two trees → files[]
diffWorkingFile / diffCommitFile  lib/git.js:166-181  → buildDiff → diffLines/diffStats
Branches: regex ^[^~^:\s\*\?\\\[]+  lib/git.js:193, listBranches/sort, delete guard
Restore/discard: checkout HEAD --force  lib/git.js:232-241
```

Diff engine (`lib/diff.js:8-61`): common prefix/suffix trim → LCS DP (`(n+1)*(m+1)` `Int32Array`) → backtrack → rows `{ t:'ctx'|'add'|'del', a,b,s }` → `diffStats` for `+N -M` (`lib/diff.js:63-70`). Block replace when `n*m > MAX_CELLS` (`lib/diff.js:26-30`).

Frontend: branch pill + menu (`public/app.js:802-895`, `public/style.css:472-508`), commits split (`public/app.js:902-1076`, `public/style.css:511-567`), diff table (`public/app.js:1082-1093`, `public/style.css:569-597`).

---

## Frontend Guide

- **Shell:** fixed sidebar + topbar + `view-*` sections (`public/index.html:14-192`, `public/style.css:51-110`).
- **State:** single `state` object (`public/app.js:7-18`) — no framework, direct `innerHTML` updates.
- **Tree:** `childrenOf`/`walkSidebar` + `expanded` set persisted as `expanded:<id>` (`public/app.js:195-364`).
- **Viewer:** `openFile` → fetch → `renderCode` or `renderMarkdownFile` (`public/app.js:481-583`); `highlightToLines` preserves spans across line breaks (`public/app.js:587-623`); header via `renderFileHeader` (`public/app.js:520-550`).
- **Edit:** `startEdit`→textarea `#editor` (`public/style.css:379-385`)→`saveFile` `PUT` (`public/app.js:656-690`).
- **Upload:** drag & drop onto `drop-zone` vs `drop-target` (`public/app.js:1175-1242`), file picks UI (`public/app.js:1166-1172`).
- **Prefs:** `IndexedDB lsgit-prefs` (`public/app.js:52-103`) keys `expanded:<id>`, `last:<id>`, `ui:wrap`, `ui:md`.

To add a new view, see `docs/DEVELOPER_GUIDE.md:6.6`.

---

## Persistence & Audit

| File | Written by | Read by | Format |
|------|-----------|---------|--------|
| `data/metadata.json` | `writeMetadata` `lib/storage.js:29-31` after every project mutation | `readMetadata` `lib/storage.js:21-27` at each request | `{ projects: [...] }` pretty JSON |
| `data/repos/<id>/*` | `extractZip` / `safeResolve+rename` / `PUT /file` | `walk` / `readFileSync` / `isomorphic-git` | Raw files + `.git` (hidden from `walk` `lib/storage.js:58`) |
| `data/audit.log` | `audit(event)` `lib/storage.js:33-36` from 12+ sites | `GET /api/audit` `server.js:434-442` | JSON-lines `{ ts, action, ... }`, last 100 reversed |
| Browser `lsgit-prefs` (IDB) | `prefs.set` `public/app.js:79-89` | `prefs.get` `public/app.js:65-77` | `expanded`, `last`, `ui:wrap`, `ui:md` |

`data/` is git-ignored (` .gitignore:1`). Back up by tarring `data/` — it is the entire state including `.git` dirs.

---

## Security Model

| Concern | Guard | Where |
|---------|-------|-------|
| Path traversal | `entryName.includes('..')` reject (zip) + `safeResolve` prefix check (API) | `lib/storage.js:91-96`, `38-46` |
| Executables | `BLOCKED_EXTENSIONS` filter → `skippedFiles` | `lib/storage.js:97-103`, `server.js:165,253` |
| Large file DoS | `MAX_UPLOAD_BYTES` 200 MB (multer), `MAX_FILE_VIEW_BYTES` 2 MB, `MAX_DIFF_BYTES` 1 MB, `MAX_CELLS` 4 M | `lib/storage.js:12,14`, `lib/git.js:12`, `lib/diff.js:6` |
| Binary vs text | `0x00` sniff in first 8 KB | `lib/storage.js:48-54` |
| XSS via Markdown | `DOMPurify.sanitize(marked.parse(...))` before `innerHTML` | `public/app.js:460,579` |
| Info leak | `x-powered-by` disabled | `server.js:15` |
| Audit | Append-only JSON-lines, 100 newest via `GET /api/audit` | `lib/storage.js:33-36`, `server.js:437` |

Before exposing beyond `localhost`, add: auth (JWT/PAT), `helmet`, `cors` with `CORS_ORIGINS`, rate limiting, proxy body-size parity, and `audit.log` rotation (grows unbounded).

---

## Performance & Limits

| Limit | Value | Tune where | Effect |
|-------|-------|-----------|--------|
| Upload per file | 200 MB | `lib/storage.js:12` / `server.js:26` | `413` on overflow `server.js:595` |
| Preview / search per file | 2 MB | `lib/storage.js:14` | `413` or skip; use Raw/Download |
| Diff blob | 1 MB | `lib/git.js:12` | Diff shows empty; view raw at commit |
| LCS cells | 4 M | `lib/diff.js:6` | Falls back to block replace |
| Search hits | 200 | `server.js:402,411` | `truncated:true` |
| Multer files | 5000 | `server.js:26` | Cap on multipart file count |
| Git log depth | 500 | `lib/git.js:74` | Paginate if you raise it |
| Audit slice | 100 | `server.js:437` | Last 100 only |

For large repos, `walk()` `lib/storage.js:56-70` is synchronous recursion — fine for local use; shard or index if you grow to 10k+ files.

---

## Development Workflow

```powershell
npm install          # one-time
npm run dev          # node --watch server.js  package.json:9
# edit files → auto-restart → refresh browser
# hard reset
Remove-Item -Recurse -Force data\repos\*, data\metadata.json, data\audit.log -ErrorAction SilentlyContinue
```

**Add a route:** use `getProjectOr404` + `safeResolve` + `touchProject` + `audit` + `next(err)` (template in `docs/DEVELOPER_GUIDE.md:5.4`).

**Add a frontend view:** new `<section id="view-x">` + side btn + `showView('x')` handler (`public/app.js:142-150`).

**Change a limit:** prefer env var wiring (`docs/ENV_VARIABLES.md:3`) over hard-coded edit; validate at boot.

---

## Testing

No suite ships yet. Recommended: unit (Vitest) for `safeResolve`/`isBinary`/`sanitizeName`/`extractZip`/`diffLines`; API (Supertest) for every route in the table above; E2E (Playwright) for upload→browse→edit→commit→branch→diff→audit. See scaffold in `docs/DEVELOPER_GUIDE.md:12`.

---

## Deployment (Docker / systemd / proxy)

**Docker:**

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

**Compose:**

```yaml
services:
  lsgit:
    build: .
    ports: ["3000:3000"]
    env_file: .env
    volumes: [lsgit_data:/app/data]
volumes: { lsgit_data: {} }
```

**systemd:**

```ini
[Service]
EnvironmentFile=/srv/lsgit/.env
ExecStart=/usr/bin/node /srv/lsgit/server.js
```

**Nginx:** `client_max_body_size 210M;` + `proxy_pass http://127.0.0.1:3000;` + `X-Forwarded-For`; set `app.set('trust proxy',1)` in `server.js` for correct `req.ip` auditing.

---

## Roadmap — Toward ARCHITECTURE.md

`ARCHITECTURE.md:19-57` sketches a modular monolith with API Gateway, Gitaly-like Git service (gRPC), background workers (Redis), SSH service, plus Postgres, S3, Meilisearch, Prometheus/OTel, Kubernetes. Current `0.1.0` is the **single-process, local-disk** slice of that vision (`ARCHITECTURE.md:176-180`):

| Today (0.1.0) | Planned (per ARCHITECTURE.md) |
|---------------|-------------------------------|
| `express` + local `lib/git.js` (isomorphic-git) | `Axum`/`Chi` + `git2-rs`/`go-git` gRPC Git service `ARCHITECTURE.md:143-149` |
| `data/metadata.json` on disk | `PostgreSQL 16+` `ARCHITECTURE.md:146` |
| JSON-lines `audit.log` | Structured audit with OTel `ARCHITECTURE.md:154` |
| Linear scan search `server.js:384-418` | Meilisearch/Typesense `ARCHITECTURE.md:152` |
| `console.error` + `GET /api/audit` | Prometheus + Grafana `ARCHITECTURE.md:153` |

Keep `server.js` as the API surface so extraction later is incremental — split `lib/git.js` first, then storage.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `EADDRINUSE :3000` | `PORT=3001 npm start` (or kill holder) |
| `Upload exceeds 200 MB` | Raise `MAX_UPLOAD_BYTES` or split zip (`server.js:595`) |
| `File too large to preview` | Use **Raw**/**Download** or raise `MAX_FILE_VIEW_BYTES` (`server.js:218`) |
| `Blocked file type: .exe` | Remove from `BLOCKED_EXTENSIONS` if policy allows (`server.js:253`) |
| `Zip contains unsafe path: ..` | Repack without `..` (`lib/storage.js:92`) |
| `Path traversal rejected` | Check `path` query encoding (`lib/storage.js:41`) |
| `Nothing to commit` | `GET /:id/git/status` shows clean (`server.js:465`) |
| `Cannot switch branch with uncommitted...` | Commit or **Discard all** first (`lib/git.js:213`) |
| Empty diff for large file | Over `MAX_DIFF_BYTES` 1 MB (`lib/git.js:137`) — view raw at commit |
| Markdown `javascript:` runs | Ensure `DOMPurify.sanitize` kept (`public/app.js:460`) |

Server logs: `console.error` on `500` (`server.js:597`) and `git snapshot failed` (`server.js:114,175`).

---

## Contributing

1. Fork & branch: `git checkout -b feat/thing`.
2. Keep `'use strict'` and CommonJS (`package.json:6`); match 2-space indent.
3. Touch `data/` only via `lib/storage.js` helpers — never raw `fs` with user paths without `safeResolve`.
4. Call `touchProject` + `audit` for every repo mutation.
5. `npm audit`; keep `package-lock.json` committed; test upload/search/diff manually before PR.

---

## License

MIT — `package.json:11`.

---

## Appendix — File-Line Index

Every hard reference in this README, so you can jump straight to source (`path:line`):

| Symbol | File:Line |
|--------|-----------|
| `PORT` default & listen | `server.js:601-603` |
| `express.json` + `static` | `server.js:16-17` |
| `x-powered-by` | `server.js:15` |
| `multer` config | `server.js:21-30` |
| `getProjectOr404` | `server.js:32-40` |
| `POST /upload` | `server.js:57-123` |
| `POST /:id/files` | `server.js:139-180` |
| `mergeTree` | `server.js:182-196` |
| `PUT /file` blocked check | `server.js:253-254` |
| `GET /archive` zip | `server.js:301-311` |
| `GET /stats` `LANGS` | `server.js:323-332` |
| `GET /search` + cap | `server.js:384-418` |
| `GET /audit` slice 100 | `server.js:437` |
| Git group | `server.js:450-585` |
| Error handler `LIMIT_FILE_SIZE` | `server.js:592-596` |
| `DATA_DIR` etc. | `lib/storage.js:7-10` |
| `MAX_UPLOAD_BYTES` etc. | `lib/storage.js:12-15` |
| `ensureDataDirs` | `lib/storage.js:17-19` |
| `safeResolve` | `lib/storage.js:38-46` |
| `isBinary` | `lib/storage.js:48-54` |
| `walk` skip `.git` | `lib/storage.js:58` |
| `sanitizeName` | `lib/storage.js:72-75` |
| `extractZip` | `lib/storage.js:84-130` |
| `AUTHOR` / `MAX_DIFF_BYTES` | `lib/git.js:11-12` |
| `ensureRepo` | `lib/git.js:21-27` |
| `commitAll` null-on-clean | `lib/git.js:66` |
| `log` depth 500 | `lib/git.js:74` |
| Branch regex | `lib/git.js:193` |
| `diffLines` / `MAX_CELLS` | `lib/diff.js:6-61` |
| `diffStats` | `lib/diff.js:63-70` |
| `prefs` IndexedDB | `public/app.js:52-103` |
| `EXT_LANG` map | `public/app.js:113-123` |
| `showView` | `public/app.js:142-150` |
| `highlightToLines` | `public/app.js:587-623` |
| `openFile` + Markdown switch | `public/app.js:481-583` |
| `search` handler | `public/app.js:737-773` |
| `branch` dropdown | `public/app.js:802-895` |
| `uploads` drag & drop | `public/app.js:1175-1242` |
| Dark tokens | `public/style.css:7-21` |
| Backend deps | `package.json:12-17` |
| Ignored data | `.gitignore:1-3` |

*Last synced to code on 2026-08-23 — run `npm start` and hit `/api/projects` to verify.*
