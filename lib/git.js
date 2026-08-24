'use strict';

// Local git versioning via isomorphic-git (pure JS, fully offline).
// Every project directory gets a real, standard .git repository.

const path = require('path');
const fs = require('fs');
const git = require('isomorphic-git');
const { diffLines, diffStats } = require('./diff');

const AUTHOR = { name: 'LSGit', email: 'lsgit@local' };
const MAX_DIFF_BYTES = 1024 * 1024;

// --- Core -------------------------------------------------------------------

async function hasRepo(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

// Initialize a repo on first use and snapshot the current state.
async function ensureRepo(dir) {
  if (await hasRepo(dir)) return false;
  await git.init({ fs, dir, defaultBranch: 'main' });
  await stageAll(dir);
  await git.commit({ fs, dir, message: 'Initial import', author: AUTHOR });
  return true;
}

async function stageAll(dir) {
  const matrix = await git.statusMatrix({ fs, dir });
  for (const [filepath, head, workdir] of matrix) {
    if (workdir === 0) {
      if (head === 1) await git.remove({ fs, dir, filepath });
    } else {
      await git.add({ fs, dir, filepath });
    }
  }
}

async function currentBranch(dir) {
  return (await git.currentBranch({ fs, dir, fullname: false })) || 'main';
}

// --- Status / commit ----------------------------------------------------------

async function status(dir) {
  await ensureRepo(dir);
  const matrix = await git.statusMatrix({ fs, dir });
  const files = [];
  for (const [filepath, head, workdir] of matrix) {
    let st;
    if (head === 0) st = 'added';
    else if (workdir === 0) st = 'deleted';
    else if (workdir === 2) st = 'modified';
    else continue;
    files.push({ path: filepath, status: st });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { branch: await currentBranch(dir), files };
}

// Commit the working copy if there is anything to commit. Returns oid or null.
async function commitAll(dir, message) {
  await ensureRepo(dir);
  const st = await status(dir);
  if (st.files.length === 0) return null;
  await stageAll(dir);
  const oid = await git.commit({ fs, dir, message: message || 'Update', author: AUTHOR });
  return oid;
}

async function log(dir, filepath) {
  await ensureRepo(dir);
  const opts = { fs, dir, depth: 500 };
  if (filepath) { opts.filepath = filepath; opts.force = true; }
  try {
    const entries = await git.log(opts);
    return entries.map((e) => ({
      oid: e.oid,
      short: e.oid.slice(0, 7),
      message: e.commit.message.trim(),
      author: e.commit.author.name,
      timestamp: e.commit.author.timestamp,
      parents: e.commit.parent,
    }));
  } catch {
    return [];
  }
}

// --- Trees / diffs --------------------------------------------------------------

async function flattenTree(dir, oid, prefix = '', out = {}) {
  const { tree } = await git.readTree({ fs, dir, oid });
  for (const e of tree) {
    const full = prefix ? prefix + '/' + e.path : e.path;
    if (e.type === 'tree') await flattenTree(dir, e.oid, full, out);
    else out[full] = e.oid;
  }
  return out;
}

async function commitDetail(dir, oid) {
  const c = await git.readCommit({ fs, dir, oid });
  const parent = c.commit.parent[0] || null;
  const newTree = await flattenTree(dir, c.commit.tree);
  let oldTree = {};
  if (parent) {
    const p = await git.readCommit({ fs, dir, oid: parent });
    oldTree = await flattenTree(dir, p.commit.tree);
  }
  const paths = new Set([...Object.keys(newTree), ...Object.keys(oldTree)]);
  const files = [];
  for (const p of paths) {
    if (oldTree[p] === newTree[p]) continue;
    files.push({
      path: p,
      status: !oldTree[p] ? 'added' : !newTree[p] ? 'deleted' : 'modified',
    });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    oid,
    short: oid.slice(0, 7),
    parent,
    parentShort: parent ? parent.slice(0, 7) : null,
    message: c.commit.message.trim(),
    author: c.commit.author.name,
    timestamp: c.commit.author.timestamp,
    files,
  };
}

async function blobLinesAt(dir, oid, filepath) {
  try {
    const { blob } = await git.readBlob({ fs, dir, oid, filepath });
    if (blob.length > MAX_DIFF_BYTES) return null;
    return Buffer.from(blob).toString('utf8').split('\n');
  } catch { return null; }
}

function workdirLines(dir, filepath) {
  try {
    const abs = path.join(dir, filepath);
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > MAX_DIFF_BYTES) return null;
    return fs.readFileSync(abs, 'utf8').split('\n');
  } catch { return null; }
}

function buildDiff(oldLines, newLines) {
  const oldNull = oldLines === null;
  const newNull = newLines === null;
  const a = oldNull ? [] : oldLines;
  const b = newNull ? [] : newLines;
  const rows = diffLines(a, b).map((r) => {
    if (oldNull && r.t === 'add') { return { ...r, a: null }; }
    if (newNull && r.t === 'del') { return { ...r, b: null }; }
    return r;
  });
  // For a wholly new file every row is 'add'; for a deleted file every row 'del'.
  return { rows, stats: diffStats(rows), empty: oldNull && newNull };
}

// Diff one file in the working copy against HEAD.
async function diffWorkingFile(dir, filepath) {
  const head = (await git.resolveRef({ fs, dir, ref: 'HEAD' }).catch(() => null));
  let oldLines = null;
  if (head) oldLines = await blobLinesAt(dir, head, filepath);
  const newLines = workdirLines(dir, filepath);
  return buildDiff(oldLines, newLines);
}

// Diff one file between a commit and its parent (or nothing for root commit).
async function diffCommitFile(dir, oid, filepath) {
  const c = await git.readCommit({ fs, dir, oid });
  const parent = c.commit.parent[0] || null;
  const newLines = await blobLinesAt(dir, oid, filepath);
  const oldLines = parent ? await blobLinesAt(dir, parent, filepath) : null;
  return buildDiff(oldLines, newLines);
}

// --- Branches ---------------------------------------------------------------------

async function listBranches(dir) {
  await ensureRepo(dir);
  const list = await git.listBranches({ fs, dir });
  const current = await currentBranch(dir);
  return { current, branches: list.sort((a, b) => a.localeCompare(b)) };
}

async function createBranch(dir, name, doCheckout) {
  if (!/^[^~^:\s\*\?\\\[]+(\/[^~^:\s\*\?\\\[]+)*$/.test(name) || name.startsWith('-') || name.endsWith('.lock')) {
    const err = new Error('Invalid branch name');
    err.status = 400;
    throw err;
  }
  await git.branch({ fs, dir, ref: name, checkout: !!doCheckout });
  return name;
}

async function switchBranch(dir, name) {
  const exists = (await git.listBranches({ fs, dir })).includes(name);
  if (!exists) {
    const err = new Error('Branch not found: ' + name);
    err.status = 404;
    throw err;
  }
  try {
    await git.checkout({ fs, dir, ref: name });
  } catch (e) {
    const err = new Error('Cannot switch branch with uncommitted conflicting changes. Commit or discard first.');
    err.status = 409;
    throw err;
  }
  return name;
}

async function deleteBranch(dir, name) {
  const current = await currentBranch(dir);
  if (name === current) {
    const err = new Error('Cannot delete the current branch');
    err.status = 400;
    throw err;
  }
  await git.deleteBranch({ fs, dir, ref: name });
  return name;
}

// --- Restore / discard ---------------------------------------------------------------

async function restoreFile(dir, filepath) {
  await git.checkout({ fs, dir, ref: 'HEAD', force: true, filepath: [filepath] });
  return filepath;
}

async function discardAll(dir) {
  const branch = await currentBranch(dir);
  await git.checkout({ fs, dir, ref: branch, force: true });
  return branch;
}

async function fileAt(dir, oid, filepath) {
  const { blob } = await git.readBlob({ fs, dir, oid, filepath });
  return Buffer.from(blob).toString('utf8');
}

module.exports = {
  ensureRepo,
  status,
  commitAll,
  log,
  commitDetail,
  diffWorkingFile,
  diffCommitFile,
  listBranches,
  createBranch,
  switchBranch,
  deleteBranch,
  restoreFile,
  discardAll,
  fileAt,
  currentBranch,
};
