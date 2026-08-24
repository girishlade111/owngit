# Configuration Reference

LSGit is a **local-first** application: there are no user accounts, no sign-up, and no
cloud services. All configuration happens through **environment variables** and an
optional **`.env` file** — nothing else.

---

## Table of contents

- [Quick start](#quick-start)
- [How configuration is loaded](#how-configuration-is-loaded)
- [Environment variables](#environment-variables)
- [`.env` file syntax](#env-file-syntax)
- [Precedence rules](#precedence-rules)
- [Data directory layout](#data-directory-layout)
- [Recipes](#recipes)
- [Platform notes](#platform-notes)

---

## Quick start

```bash
# 1. Copy the example configuration (optional — defaults work out of the box)
cp .env.example .env

# 2. Edit .env if you need to change ports or limits
# 3. Run
npm start
```

If `.env` does not exist, LSGit runs entirely on built-in defaults.
The server prints the effective port on startup:

```
LSGit code manager listening on http://localhost:3000
```

---

## How configuration is loaded

Configuration is handled by [`lib/config.js`](../lib/config.js) and applied once at
server startup:

1. If a `.env` file exists in the **project root**, it is parsed line by line.
2. Every `KEY=VALUE` pair is written into `process.env` — **only if the variable is
   not already set** in the real environment.
3. The typed config object is built from `process.env` with per-variable defaults.

The loader has **zero dependencies** (no `dotenv` package) and never throws on a
missing or malformed `.env` — malformed lines are skipped silently.

---

## Environment variables

| Variable         | Type     | Default              | Description |
|------------------|----------|----------------------|-------------|
| `PORT`           | integer  | `3000`               | Port the HTTP server listens on. |
| `HOST`           | string   | `0.0.0.0`            | Network interface to bind. Use `127.0.0.1` to allow access **only from this machine** (recommended when on shared/public Wi-Fi). |
| `MAX_UPLOAD_MB`  | integer  | `200`                | Maximum accepted size (MB) for zip archives **and** total loose-file uploads. Larger uploads are rejected with HTTP 413. |
| `MAX_PREVIEW_MB` | integer  | `2`                  | Maximum file size (MB) that the code viewer will load. Larger files show a *download* prompt instead. |
| `DATA_DIR`       | path     | `<project>/data`     | Root folder for all persisted data (repositories, metadata, audit log). Absolute path, or relative to the project root. |

Notes:

- **`NODE_ENV`** is not used by LSGit. There is no production/build mode — the app
  serves the same static frontend in all environments.
- The frontend reads the effective limits from `GET /api/config` and adjusts the
  upload hint text automatically, so users always see the real cap.

---

## `.env` file syntax

```ini
# Full-line comments start with a hash.

PORT=3000                 # inline comments are NOT supported — keep values clean
HOST=127.0.0.1

# Quotes are optional; both single and double quotes are stripped.
MAX_UPLOAD_MB="500"

# Paths may be quoted if they contain spaces
DATA_DIR="D:\My Code Data"
```

Rules implemented by the loader:

| Rule | Behaviour |
|------|-----------|
| Comments | Lines starting with `#` (after trimming) are ignored. |
| Separator | The **first** `=` splits key and value. |
| Quotes | Leading/trailing matching `"` or `'` are stripped. |
| Whitespace | Keys and values are trimmed. |
| Empty / malformed lines | Skipped (no error). |
| Repeated keys | First occurrence wins. |
| Existing env vars | Never overwritten by `.env` values. |

---

## Precedence rules

From highest to lowest:

```
1. Real environment variable   (e.g. PORT=4000 set in the shell)
2. .env file value             (PORT=5000 in .env)
3. Built-in default            (3000)
```

Example — with `PORT=4000` exported in your shell and `PORT=5000` inside `.env`,
the server listens on **4000**.

---

## Data directory layout

Everything LSGit persists lives under `DATA_DIR`:

```
data/
├── repos/                  # one folder per repository (UUID-named)
│   └── <uuid>/
│       ├── .git/           # real, standard git repository (created lazily)
│       └── ...your files   # the working tree you browse and edit
├── metadata.json           # project list: names, descriptions, sizes, timestamps
└── audit.log               # append-only JSONL audit trail (last 100 shown in UI)
```

- Deleting a repository in the UI removes its folder **including its git history**.
- Backing up `DATA_DIR` backs up everything: files, history, metadata and audit log.
- See [GIT_VERSIONING.md](GIT_VERSIONING.md) for what lives inside each repo's `.git`.

---

## Recipes

### Run on a different port, localhost only

```ini
PORT=8080
HOST=127.0.0.1
```

### Portable installation (data on a USB drive)

```ini
DATA_DIR=E:\LSGitData
```

### Accept larger archives

```ini
MAX_UPLOAD_MB=1024
```

> Very large archives are extracted synchronously — multi-GB uploads will block the
> server for the duration of extraction. 200–500 MB is a practical ceiling.

### Keep large files previewable

```ini
MAX_PREVIEW_MB=10
```

> The viewer loads whole files into the browser; raising this too far makes the UI
> sluggish on big text files. Binary files are never previewed regardless of size.

---

## Platform notes

- **Windows / OneDrive:** if the project (or `DATA_DIR`) lives inside a OneDrive-synced
  folder, heavy file churn (uploads, branch switches) can trigger sync storms or
  transient `EPERM` errors during renames. Prefer a local, non-synced path for
  `DATA_DIR` on Windows.
- **Long paths:** Windows' 260-character `MAX_PATH` limit applies to extracted
  archives. Deeply nested repos may fail to extract unless long paths are enabled
  (`git config --global core.longpaths true` does **not** affect LSGit — enable the
  Windows long-path group policy instead).
- **Firewall:** first launch may trigger a Windows Firewall prompt for Node.js.
  Binding `HOST=127.0.0.1` avoids the prompt entirely (loopback is never blocked).
