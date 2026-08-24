# Git Versioning

Every LSGit repository is a **real, standard git repository**. Versioning runs
100% locally via [isomorphic-git](https://isomorphic-git.org) (pure JavaScript —
no `git` binary, no network, no daemon), which means:

- History, branches and diffs work **offline**, always.
- The `.git` folder inside each repo is fully compatible with the standard
  `git` CLI — you can inspect, clone, or fsck it with ordinary tooling.

---

## Table of contents

- [How it works](#how-it-works)
- [What gets committed automatically](#what-gets-committed-automatically)
- [The Working Copy workflow](#the-working-copy-workflow)
- [Branches](#branches)
- [Diffs](#diffs)
- [File history & time travel](#file-history--time-travel)
- [Restore & discard](#restore--discard)
- [Storage layout](#storage-layout)
- [CLI interop](#cli-interop)
- [Limitations & design decisions](#limitations--design-decisions)
- [Data safety](#data-safety)

---

## How it works

```
Project created / first git API call
        │
        ▼
 ensureRepo(dir)
   ├── .git exists? ── yes ──► nothing to do
   └── no ──► git init (branch: main)
              ► stage every file
              ► commit "Initial import"
```

- Initialization is **lazy**: repositories created before the versioning feature
  (or restored from backup without `.git`) are migrated automatically the first
  time you open the Commits tab, fetch status, or use any git endpoint.
- The commit author is a fixed local identity: `LSGit <lsgit@local>`.
- Default branch: `main`.

---

## What gets committed automatically

| Event | Commit message |
|-------|----------------|
| Repository created from upload | `Upload: <archive name>` or `Upload: N file(s)` |
| Files added to an existing repo | `Add N file(s)` or `Add archive: <name>` |
| Lazy migration of an old repo | `Initial import` |
| **Manual edits in the viewer** | *Nothing — they stay in the working copy until you commit* |

This split is deliberate: uploads are atomic events worth snapshotting, while
interactive edits are meant to flow through the Working Copy → review → commit
workflow (like any git tool).

---

## The Working Copy workflow

The **Commits tab** shows a pinned *Working copy* entry whenever there are
uncommitted changes:

```
● Working copy  [1 changed]      ← green dot = pending changes
  b482b65  HEAD · main
  Fix login validation
  1ca9158  Initial import
```

Selecting it shows:

1. **Changed files** with status badges — `A` added, `M` modified, `D` deleted —
   and a per-file **Restore** button (revert that one file to HEAD).
2. **Unified diff** for any file (click it): dual old/new line-number gutters,
   red/green lines, `+N −M` summary.
3. **Commit form** — type a message, press Enter or *Commit*.
4. **Discard all** — force-restore the whole tree to HEAD (double-confirmed;
   untracked files are kept).

Status detection maps isomorphic-git's status matrix:

| Condition | Status |
|-----------|--------|
| Not in HEAD | `added` |
| Missing from disk | `deleted` |
| Content differs from HEAD | `modified` |

---

## Branches

The branch dropdown (tab bar, visible on every repo tab) supports:

- **Switch** — non-forced checkout; if uncommitted changes would be overwritten
  you get a conflict error telling you to commit or discard first (nothing is
  silently lost).
- **Create** — from the current HEAD, checked out immediately. Names are
  validated against git ref rules (`feature/dark-mode` is fine; `~ ^ : * ? \ [`,
  leading `-`, and `.lock` suffixes are rejected).
- **Delete** — any branch except the current one.

Switching reloads the file tree and project metadata — the working tree on disk
really changes, exactly like `git checkout`.

---

## Diffs

- Engine: `lib/diff.js` — common prefix/suffix trimming followed by LCS dynamic
  programming (`Int32Array`, capped at 4M cells; oversized files fall back to a
  block replace so memory stays bounded).
- Two contexts:
  - **Working copy vs HEAD** — `GET …/git/diff?path=…`
  - **Commit vs its parent** — `GET …/git/commit/:oid/diff?path=…`
- Rows are `{ t: 'ctx'|'add'|'del', a, b, s }` with 1-based old/new line numbers.

---

## File history & time travel

The **History** button in the file header lists every commit that touched the
file (isomorphic-git log with `filepath`). Selecting a revision opens the file's
content **as of that commit** — read-only, badged with the short hash, with
*Back to latest* and *Download*.

---

## Restore & discard

| Action | Scope | Mechanism |
|--------|-------|-----------|
| Restore (per file) | one modified file | `git checkout HEAD -- <path>` equivalent |
| Discard all | all tracked changes | force checkout of the current branch; **untracked files survive** |

Both are audit-logged and require explicit confirmation in the UI.

---

## Storage layout

```
data/repos/<project-uuid>/
├── .git/                 # standard repository — objects, refs, index
│   ├── HEAD              # ref: refs/heads/main (or current branch)
│   ├── refs/heads/       # branch tips
│   └── objects/          # zlib-compressed blobs/trees/commits
└── …working tree…
```

Nothing git-related lives outside the project folder — delete the project and
its entire history is gone; back up the folder and history goes with it.

---

## CLI interop

Because these are ordinary git repositories:

```bash
cd data/repos/<project-uuid>

git log --oneline           # see the same history as the UI
git status                  # same working-copy state
git show HEAD               # inspect a commit
git diff                    # same diffs as the Working Copy view
git remote add origin …     # possible, but LSGit itself never pushes/pulls
```

Author identity in LSGit commits is fixed (`LSGit <lsgit@local>`); commits made
via CLI with your own identity appear identically in the UI.

---

## Limitations & design decisions

- **No remote operations.** No push/pull/fetch UI — LSGit is deliberately
  local-only (offline-first, no network). Use the git CLI if you need to sync.
- **Single author.** No accounts, so every LSGit-made commit is authored as
  `LSGit <lsgit@local>`.
- **No merge UI.** Fast operations only (commit, branch, checkout). Resolving
  conflicts is out of scope; the checkout guard prevents creating most conflict
  situations.
- **No staging area UI.** Commits always include all pending changes
  (`git commit -a` semantics). Per-file selective staging may come later.
- **Log depth 500.** Very long histories truncate in the Commits list.
- **Binary files** are versioned (git handles them) but never diffed or previewed.

---

## Data safety

- Commits are atomic; a failed commit leaves the index untouched.
- `switchBranch` refuses to run when tracked files would be overwritten.
- The two destructive operations (**Restore file**, **Discard all**) are the only
  paths that destroy uncommitted work — both are confirm-gated and audit-logged.
- Backups = copy `DATA_DIR`. Everything (files, history, metadata, audit) is inside.
