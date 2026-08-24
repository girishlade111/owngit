# API Reference

All endpoints are served from the same origin as the UI (default
`http://localhost:3000`). Every response is JSON unless stated otherwise.
Errors always have the shape:

```json
{ "error": "Human-readable message" }
```

Common status codes: `400` bad input · `404` unknown project/path · `409`
conflict (e.g. branch switch) · `413` upload too large · `500` internal.

> There is **no authentication** — LSGit is a local tool. Bind `HOST=127.0.0.1`
> (see [CONFIGURATION.md](CONFIGURATION.md)) if that concerns you.

---

## Table of contents

- [Meta](#meta)
- [Projects](#projects)
- [Files & browsing](#files--browsing)
- [Search & stats](#search--stats)
- [Git versioning](#git-versioning)
- [Audit](#audit)

---

## Meta

### `GET /api/config`

Effective runtime configuration (used by the UI to render limits).

```json
{ "version": "0.1.0", "maxUploadMB": 200, "maxPreviewMB": 2 }
```

---

## Projects

### `GET /api/projects`

List all repositories, newest first.

```json
{
  "projects": [
    {
      "id": "9cafddf3-4842-4a4e-be4f-fd8aaccac922",
      "name": "namida",
      "description": "Flutter music player",
      "createdAt": "2026-08-23T18:53:55.634Z",
      "updatedAt": "2026-08-23T18:53:55.634Z",
      "fileCount": 634,
      "totalBytes": 75018702,
      "source": "zip:namida-main.zip"
    }
  ]
}
```

### `POST /api/projects/upload`

Create a repository from a zip archive and/or loose files.
`Content-Type: multipart/form-data`.

| Field | Type | Notes |
|-------|------|-------|
| `name` | text | Required when uploading loose files without an archive (otherwise derived from the zip filename) |
| `description` | text | Optional |
| `archive` | file | One `.zip` (≤ `MAX_UPLOAD_MB`). Executables inside are skipped, not rejected |
| `files` | file(s) | Zero or more loose files, preserving relative paths |

```bash
curl -X POST -F "name=namida" -F "description=test" \
     -F "archive=@namida-main.zip" \
     http://localhost:3000/api/projects/upload
```

**201 Created**

```json
{
  "project": { "id": "…", "name": "namida", "fileCount": 634, "…": "…" },
  "skippedFiles": ["namida-main/scripts/gen_beta_changelog.sh"]
}
```

The repo is git-initialized and an auto-commit (`Upload: <archive name>`) is created.

### `PATCH /api/projects/:id`

Rename / edit description. Body: `{ "name": "…", "description": "…" }` (both optional).

### `DELETE /api/projects/:id`

Deletes the repository folder **including its git history**. Returns `{ "ok": true }`.

### `POST /api/projects/:id/files`

Add files to an existing repository (same multipart fields as upload, `name` not
needed). Added files are auto-committed (`Add N file(s)` / `Add archive: <name>`).

```json
{ "ok": true, "added": 12, "project": { "…": "…" } }
```

---

## Files & browsing

### `GET /api/projects/:id/tree`

Full recursive listing (`.git` excluded).

```json
{
  "project": { "…": "…" },
  "entries": [
    { "path": "lib", "type": "dir", "size": 0, "mtime": 1758589600000 },
    { "path": "lib/app.js", "type": "file", "size": 4096, "mtime": 1758589600000 }
  ]
}
```

### `GET /api/projects/:id/file?path=<rel>`

File content for the viewer. Binary sniffing: any NUL in the first 8 KB ⇒ binary.

```json
{ "path": "lib/app.js", "binary": false, "size": 4096, "content": "…utf8 text…" }
```

- Binary → `{ "path": "…", "binary": true, "size": 123 }`
- Larger than `MAX_PREVIEW_MB` → `413 { "error": "File too large to preview" }`

### `PUT /api/projects/:id/file`

Create or overwrite a text file. Body: `{ "path": "src/x.js", "content": "…" }`.
Blocked extensions (`.exe`, `.bat`, …) → `400`. Updates project size/count.

### `DELETE /api/projects/:id/file?path=<rel>`

Delete a file. Returns `{ "ok": true }`.

### `GET /api/projects/:id/raw?path=<rel>`

Raw download (`Content-Disposition: attachment`). Used by the viewer's
Raw/Download buttons.

### `GET /api/projects/:id/archive`

Whole repository as a zip download (`.git` excluded).

---

## Search & stats

### `GET /api/projects/:id/search?q=<query>&regex=0|1&case=0|1`

Text search across all text files ≤ preview limit. Max 200 hits.

```json
{
  "query": "Namida",
  "truncated": true,
  "results": [
    { "path": "lib/app.dart", "line": 365, "column": 20, "text": "title = 'Namida';" }
  ]
}
```

### `GET /api/projects/:id/stats`

```json
{
  "project": { "…": "…" },
  "totalFiles": 634,
  "totalLines": 104729,
  "languages": [
    { "language": "Dart", "files": 412, "lines": 90000, "bytes": 2500000 }
  ]
}
```

---

## Git versioning

All routes are prefixed with `/api/projects/:id/git`. The repo is lazily
initialized (`init` + `"Initial import"`) on first git call.

### `GET /api/projects/:id/git/status`

```json
{
  "branch": "main",
  "files": [
    { "path": "index.js", "status": "modified" },
    { "path": "new.txt",  "status": "added" },
    { "path": "old.txt",  "status": "deleted" }
  ]
}
```

### `POST /api/projects/:id/git/commit`

Body: `{ "message": "Fix login validation" }` (required, non-empty).

```json
{ "oid": "b482b65…", "short": "b482b65", "status": { "branch": "main", "files": [] } }
```

`400` when the message is empty or there is nothing to commit.

### `GET /api/projects/:id/git/log?filepath=<optional>`

Commit list (newest first, max depth 500). With `filepath`: history of that file.

```json
{
  "commits": [
    {
      "oid": "b482b65…", "short": "b482b65",
      "message": "Fix login validation",
      "author": "LSGit", "timestamp": 1787521364,
      "parents": ["1ca9158…"]
    }
  ]
}
```

### `GET /api/projects/:id/git/commit/:oid`

Commit metadata + changed files (vs first parent).

```json
{
  "oid": "b482b65…", "short": "b482b65",
  "parent": "1ca9158…", "parentShort": "1ca9158",
  "message": "Fix login validation", "author": "LSGit", "timestamp": 1787521364,
  "files": [ { "path": "lib/auth.js", "status": "modified" } ]
}
```

### `GET /api/projects/:id/git/commit/:oid/diff?path=<rel>`

Line diff of one file in that commit (vs parent). Root-commit additions show every
line as `add`.

```json
{
  "path": "lib/auth.js",
  "rows": [
    { "t": "ctx", "a": 1, "b": 1, "s": "function login() {" },
    { "t": "del", "a": 2, "b": null, "s": "  return false;" },
    { "t": "add", "a": null, "b": 2, "s": "  return token;" }
  ],
  "stats": { "add": 1, "del": 1 },
  "empty": false
}
```

Row types: `ctx` (context) · `add` · `del`. `a`/`b` are 1-based old/new line
numbers (`null` where not applicable).

### `GET /api/projects/:id/git/diff?path=<rel>`

Same shape, comparing the **working copy** against HEAD.

### `GET /api/projects/:id/git/branches`

```json
{ "current": "main", "branches": ["feature/dark-mode", "main"] }
```

### `POST /api/projects/:id/git/branches`

Body: `{ "name": "feature/x", "checkout": true }`. Creates (and by default
switches to) the branch. Invalid names → `400`.

### `POST /api/projects/:id/git/branches/switch`

Body: `{ "name": "main" }`. Conflicting uncommitted changes →
`409 { "error": "Cannot switch branch with uncommitted conflicting changes…" }`.

### `DELETE /api/projects/:id/git/branches?name=<branch>`

Delete a branch. Deleting the current branch → `400`.

### `POST /api/projects/:id/git/restore`

Body: `{ "path": "index.js" }`. Restore one file from HEAD (destructive).
Returns `{ "ok": true, "status": { … } }`.

### `POST /api/projects/:id/git/discard`

Discard **all** uncommitted changes (force checkout of the current branch).
Untracked files are kept. Returns `{ "ok": true, "status": { … } }`.

### `GET /api/projects/:id/git/file?oid=<commit>&path=<rel>`

File content as of a specific commit (read-only revision view).

```json
{ "path": "index.js", "oid": "b482b65…", "content": "…" }
```

---

## Audit

### `GET /api/audit`

Last 100 audit events (newest first) from `data/audit.log` (JSONL).

```json
{
  "events": [
    { "ts": "2026-08-23T19:40:56.001Z", "action": "git.commit",
      "projectId": "9cafddf3…", "oid": "b482b65", "actor": "::1" }
  ]
}
```

Actions include: `project.create`, `project.upload`, `project.update`,
`project.delete`, `project.export`, `project.search`, `file.save`, `file.delete`,
`git.commit`, `git.branch`, `git.checkout`, `git.restore`, `git.discard`.
