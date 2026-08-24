# Environment Variables (.env) — Complete Reference

> **Project:** LSGit Code Manager (`lsgit-code-manager@0.1.0`)
> **Status (current):** All variables below are **implemented** via the
> dependency-free loader [`lib/config.js`](../lib/config.js) — an optional `.env`
> file in the project root is parsed at boot, and real environment variables
> always win. Supported today: `PORT`, `HOST`, `MAX_UPLOAD_MB`, `MAX_PREVIEW_MB`,
> `DATA_DIR`. For the short version see
> [CONFIGURATION.md](CONFIGURATION.md); this page is the deep reference.

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Variables — What the Code Reads](#2-variables--what-the-code-reads)
3. [The .env Contract](#3-the-env-contract)
4. [Variable-by-Variable Reference](#4-variable-by-variable-reference)
5. [Configuration Precedence](#5-configuration-precedence)
6. [Environments: development / staging / production](#6-environments-development--staging--production)
7. [Validation & Fail-Fast](#7-validation--fail-fast)
8. [Secrets Handling](#8-secrets-handling)
9. [Docker & Compose Example](#9-docker--compose-example)
10. [.env.example (copy-paste)](#10-envexample-copy-paste)
11. [Troubleshooting](#11-troubleshooting)
12. [Checklist Before Deploy](#12-checklist-before-deploy)

---

## 1. Quick Start

```powershell
# PowerShell (Windows)
Copy-Item .env.example .env
# edit .env in your editor
npm install
npm run dev   # watches server.js with --watch  package.json:9
# or
npm start     # node server.js  package.json:8
```

```bash
# bash / macOS / Linux
cp .env.example .env
$EDITOR .env
npm install
npm run dev
```

Open http://localhost:3000 — the value comes from `server.js:601`.

No `.env` file is required for local dev; the app falls back to built-ins. For production, always provide `.env` or inject env vars via your orchestrator.

---

## 2. Variables — What the Code Reads

All five user-facing variables are wired through `lib/config.js`:

| Env var | Read at | Default | Purpose |
|---------|---------|---------|---------|
| `PORT` | `lib/config.js` | `3000` | HTTP listen port |
| `HOST` | `lib/config.js` | `0.0.0.0` | Bind interface (`127.0.0.1` = local only) |
| `MAX_UPLOAD_MB` | `lib/config.js` → `lib/storage.js` | `200` | Archive/upload cap (MB) |
| `MAX_PREVIEW_MB` | `lib/config.js` → `lib/storage.js` | `2` | Viewer/search preview cutoff (MB) |
| `DATA_DIR` | `lib/config.js` → `lib/storage.js` | `<root>/data` | All persistent state |

Everything else remains an internal constant:

| Constant | Location | Value | Notes |
|----------|----------|-------|-------|
| `DATA_DIR` | `lib/storage.js:7` | `<root>/data` | All persistent state |
| `REPOS_DIR` | `lib/storage.js:8` | `<DATA_DIR>/repos` | One folder per project UUID |
| `META_FILE` | `lib/storage.js:9` | `<DATA_DIR>/metadata.json` | Project index |
| `AUDIT_FILE` | `lib/storage.js:10` | `<DATA_DIR>/audit.log` | JSON-lines audit trail |
| `MAX_UPLOAD_BYTES` | `lib/storage.js:12` | `200 MB` | Multer limit `server.js:26` |
| `MAX_FILE_VIEW_BYTES` | `lib/storage.js:14` | `2 MB` | Preview / search cutoff |
| `BINARY_SNIFF_BYTES` | `lib/storage.js:15` | `8000` | `isBinary()` window |
| `BLOCKED_EXTENSIONS` | `lib/storage.js:13` | 9 executables | `.exe .dll .so .bat .cmd .sh .msi .scr .com` |
| `MAX_DIFF_BYTES` | `lib/git.js:12` | `1 MB` | Diff blob cap |
| `AUTHOR` | `lib/git.js:11` | `LSGit <lsgit@local>` | Commit author |
| `MAX_CELLS` | `lib/diff.js:6` | `4_000_000` | LCS DP cap |
| `depth` | `lib/git.js:74` | `500` | `log()` history depth |
| `audit slice` | `server.js:437` | `100` | `GET /api/audit` returns last 100 |

> If you want any of these to be env-driven, wire `process.env.FOO` in `lib/storage.js` / `lib/git.js` / `server.js` and document it here. Section 3 proposes the exact mapping.

---

## 3. The .env Contract

The core contract below is **implemented** in `lib/config.js` (MB-based limits,
`.env` parsing, env-var precedence). The "future extensions" list remains
optional and backward-compatible: if unset, code falls back to defaults.

```ini
# Implemented today
PORT=3000
HOST=0.0.0.0
MAX_UPLOAD_MB=200
MAX_PREVIEW_MB=2
DATA_DIR=./data
```

Future extension candidates (not yet wired):

```ini
MAX_DIFF_BYTES=1048576
BLOCKED_EXTENSIONS=.exe,.dll,.so,.bat,.cmd,.sh,.msi,.scr,.com
GIT_AUTHOR_NAME=LSGit
GIT_AUTHOR_EMAIL=lsgit@local
GIT_DEFAULT_BRANCH=main
GIT_LOG_DEPTH=500
```

---

## 4. Variable-by-Variable Reference

### 4.1 `PORT`

- **Type:** integer `1–65535`
- **Default:** `3000`
- **Example:** `PORT=8080`
- **Notes:** Change it if `3000` is occupied or for container port mapping.

### 4.2 `NODE_ENV`

- **Type:** enum `development | production | test`
- **Default:** `development`
- **Effect (recommended):** gate verbose error stacks (`server.js:591-598`), disable `X-Powered-By` already disabled `server.js:15`, enable caching/compression in production.
- **Example:** `NODE_ENV=production`

### 4.3 `HOST`

- **Type:** string (IP or hostname)
- **Default:** `0.0.0.0` (all interfaces)
- **Current:** implemented — `server.js` calls `app.listen(PORT, HOST)`.
- **Example:** `HOST=127.0.0.1` to restrict to localhost (recommended; also
  avoids the Windows Firewall first-run prompt).

### 4.4 `DATA_DIR`

- **Type:** path string (absolute, or relative to the project root)
- **Default:** `<root>/data`
- **Constraints:** Must be writable; `ensureDataDirs()` creates `<DATA_DIR>/repos` on boot. Use absolute paths for portable installs.
- **Security:** `safeResolve()` enforces traversal protection — keep repo data outside any web root.

### 4.5 `MAX_UPLOAD_MB`

- **Type:** integer megabytes
- **Default:** `200`
- **Enforced at:** `multer.limits.fileSize` and the `LIMIT_FILE_SIZE` → `413` error handler.
- **Tuning:** Lower to `50` on small VPS; raise only with disk headroom (uploads stream to disk under `DATA_DIR`).

### 4.6 `MAX_PREVIEW_MB`

- **Type:** integer megabytes
- **Default:** `2`
- **Enforced at:** file preview, search skip, and the stats line-count guard.
- **Effect:** Larger values allow previewing bigger files but increase memory and response time.

### 4.7 `MAX_DIFF_BYTES`

- **Type:** integer bytes
- **Default:** `1048576` (1 MB) `lib/git.js:12`
- **Enforced at:** `blobLinesAt()` and `workdirLines()` (`lib/git.js:136-149`) return `null` → diff renders as empty/fallback.

### 4.8 `BLOCKED_EXTENSIONS`

- **Type:** CSV of dot-extensions, lowercase
- **Default:** `.exe,.dll,.so,.bat,.cmd,.sh,.msi,.scr,.com` `lib/storage.js:13`
- **Enforced at:** `extractZip()` skip list (`lib/storage.js:98-101`), loose-file upload loop (`server.js:165`), and `PUT /file` guard (`server.js:253-254`). Skipped names returned as `skippedFiles` (`server.js:115`, `lib/storage.js:128`).
- **Example:** add `.appimage,.dmg` for stricter policy.

### 4.9 `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL`

- **Type:** strings
- **Default:** `LSGit` / `lsgit@local` `lib/git.js:11`
- **Used at:** `ensureRepo()` initial commit (`lib/git.js:25`) and `commitAll()` (`lib/git.js:68`).

### 4.10 `GIT_DEFAULT_BRANCH`

- **Type:** string branch name
- **Default:** `main` `lib/git.js:23`
- **Notes:** Must pass `createBranch()` regex (`lib/git.js:193`): no `~ ^ : \s * ? \ [`, no leading `-`, no trailing `.lock`.

### 4.11 `GIT_LOG_DEPTH`

- **Type:** integer
- **Default:** `500` `lib/git.js:74`
- **Used at:** `log()` `git.log({ depth })`. Higher depth increases history fetch cost.

### 4.12 `AUDIT_MAX_EVENTS`

- **Type:** integer
- **Default:** `100` `server.js:437` (`slice(-100)`)
- **Source file:** `AUDIT_FILE` (`lib/storage.js:10`, `lib/storage.js:33-36`, `server.js:434-442`).

### 4.13 Future Security Vars (not yet wired)

| Var | Purpose | Where to wire |
|-----|---------|---------------|
| `CORS_ORIGINS` | Allowed origins for SPA + API | `server.js` CORS middleware |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | Throttle uploads/search | `server.js` before routes |
| `LOG_LEVEL` | Structured logging verbosity | logger in `server.js:591-598` |

---

## 5. Configuration Precedence

Recommended order (highest wins):

1. **Process env** (`process.env.*`) — injected by shell / Docker / systemd / CI.
2. **`.env` file** — loaded via `dotenv` (add `require('dotenv').config()` at top of `server.js:1` if you adopt it).
3. **Built-in defaults** — constants in `lib/storage.js` / `lib/git.js` / `server.js`.

Never commit `.env` — `.gitignore:1-3` already ignores `data/` and `node_modules/`; add `.env` there:

```gitignore
.env
.env.local
.scratch/
```

---

## 6. Environments: development / staging / production

| Environment | Suggested values | Notes |
|-------------|------------------|-------|
| **development** | `NODE_ENV=development`, `PORT=3000`, `DATA_DIR=./data`, `MAX_UPLOAD_BYTES=209715200` | `npm run dev` (`server.js --watch`) |
| **staging** | `NODE_ENV=production`, `PORT=3000`, `DATA_DIR=/srv/lsgit/data` | Mirror prod paths, smaller limits |
| **production** | `NODE_ENV=production`, `PORT=3000`, `DATA_DIR=/srv/lsgit/data`, `LOG_LEVEL=warn`, stricter `BLOCKED_EXTENSIONS` | Behind reverse proxy, persistent volume |

Frontend preferences are **not** in `.env` — they live in `IndexedDB: lsgit-prefs` (`public/app.js:52-103`), so they survive across reloads but never leak to the server.

---

## 7. Validation & Fail-Fast

Add a tiny validator at boot (recommended):

```js
// top of server.js
if (process.env.PORT && (isNaN(+process.env.PORT) || +process.env.PORT < 1 || +process.env.PORT > 65535)) {
  console.error('Invalid PORT:', process.env.PORT); process.exit(1);
}
if (process.env.MAX_UPLOAD_BYTES && isNaN(+process.env.MAX_UPLOAD_BYTES)) {
  console.error('Invalid MAX_UPLOAD_BYTES'); process.exit(1);
}
```

Validate `BLOCKED_EXTENSIONS` items start with `.` and are lowercase. Validate `GIT_DEFAULT_BRANCH` with `lib/git.js:193` regex.

---

## 8. Secrets Handling

- **Today:** No secrets — no DB, no auth, no external API keys. Audit actor is `req.ip` (`server.js:111,172,259,274,292,309,413,427,466,524,536,560`).
- **Future:** When you add auth (JWT / PAT / OAuth), store secrets **only** in env or a vault, never in `metadata.json` or `audit.log`. Add `AUDIT_REDACT_KEYS` to strip tokens from logs.

Rules:
- `.env` is git-ignored.
- In CI, inject via repository secrets, not committed files.
- Rotate if a `.env` is ever pasted into an issue or log.

---

## 9. Docker & Compose Example

```dockerfile
# Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

```yaml
# docker-compose.yml
services:
  lsgit:
    build: .
    ports: ["3000:3000"]
    env_file: .env
    environment:
      NODE_ENV: production
      PORT: 3000
    volumes:
      - lsgit_data:/app/data
volumes:
  lsgit_data:
```

Systemd snippet:

```ini
[Service]
EnvironmentFile=/srv/lsgit/.env
ExecStart=/usr/bin/node /srv/lsgit/server.js
```

---

## 10. .env.example (copy-paste)

Keep `.env.example` committed; `.env` stays local. The repo ships one at `/.env.example` (generated from this doc). Copy it:

```powershell
Copy-Item .env.example .env
```

Full content is in `/.env.example` — see that file for inline comments per variable.

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `EADDRINUSE :3000` | Another process on 3000 | `PORT=3001 npm start` or kill the holder |
| `Upload exceeds the 200 MB size limit` | `MAX_UPLOAD_BYTES` hit | Raise `MAX_UPLOAD_BYTES` or split the archive (`server.js:595`) |
| `File too large to preview` | `MAX_FILE_VIEW_BYTES` guard | Raise limit or use Download Raw (`server.js:218`) |
| `Zip contains unsafe path: ..` | Archive has `..` entries | Repack without traversal (`lib/storage.js:91-96`) |
| `Blocked file type: .exe` | Extension blocklist | Remove from `BLOCKED_EXTENSIONS` if policy allows |
| Diffs empty for large files | `MAX_DIFF_BYTES` cap | Lower threshold or view raw file at commit (`lib/git.js:136-138`) |

---

## 12. Checklist Before Deploy

- [ ] `.env` created from `.env.example`, no defaults left as-is for prod paths
- [ ] `DATA_DIR` points to a persistent volume, not ephemeral container FS
- [ ] `MAX_UPLOAD_BYTES` fits disk + reverse-proxy body limit (nginx `client_max_body_size`)
- [ ] `BLOCKED_EXTENSIONS` reviewed with security policy
- [ ] `GIT_AUTHOR_*` set to org identity
- [ ] `NODE_ENV=production`
- [ ] `.env` is in `.gitignore` and not committed
- [ ] Audit log rotation in place (`data/audit.log` grows forever today)

---

*Last verified against:* `server.js:1-604`, `lib/storage.js:1-148`, `lib/git.js:1-264`, `lib/diff.js:1-72`, `package.json:1-18`, `.gitignore:1-3` on 2026-08-23.
