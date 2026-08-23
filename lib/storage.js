'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const REPOS_DIR = path.join(DATA_DIR, 'repos');
const META_FILE = path.join(DATA_DIR, 'metadata.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB
const BLOCKED_EXTENSIONS = new Set(['.exe', '.dll', '.so', '.bat', '.cmd', '.sh', '.msi', '.scr', '.com']);
const MAX_FILE_VIEW_BYTES = 2 * 1024 * 1024; // 2 MB preview limit
const BINARY_SNIFF_BYTES = 8000;

function ensureDataDirs() {
  fs.mkdirSync(REPOS_DIR, { recursive: true });
}

function readMetadata() {
  try {
    return JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
  } catch {
    return { projects: [] };
  }
}

function writeMetadata(meta) {
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
}

function audit(event) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  fs.appendFileSync(AUDIT_FILE, line + '\n');
}

function safeResolve(root, relative) {
  const resolved = path.resolve(root, '.' + path.sep + relative);
  if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) {
    const err = new Error('Path traversal rejected');
    err.status = 400;
    throw err;
  }
  return resolved;
}

function isBinary(buf) {
  const len = Math.min(buf.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function walk(dir, base, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(base, abs).split(path.sep).join('/');
    if (entry.isDirectory()) {
      acc.push({ path: rel, type: 'dir', size: 0 });
      walk(abs, base, acc);
    } else {
      acc.push({ path: rel, type: 'file', size: fs.statSync(abs).size });
    }
  }
  return acc;
}

function sanitizeName(name) {
  const clean = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return clean || 'project';
}

function stripCommonRoot(entries) {
  if (entries.length === 0) return entries;
  const first = entries[0].split('/')[0];
  const hasCommon = entries.every((e) => e.split('/')[0] === first && e.includes('/'));
  return hasCommon ? entries.map((e) => e.slice(first.length + 1)) : entries;
}

function extractZip(zipPath, destDir, originalName) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);

  for (const entry of entries) {
    if (entry.entryName.includes('..')) {
      const err = new Error('Zip contains unsafe path: ' + entry.entryName);
      err.status = 400;
      throw err;
    }
    if (BLOCKED_EXTENSIONS.has(path.extname(entry.entryName).toLowerCase())) {
      const err = new Error('Blocked file type in archive: ' + entry.entryName);
      err.status = 400;
      throw err;
    }
  }
  if (entries.length === 0) {
    const err = new Error('Archive is empty');
    err.status = 400;
    throw err;
  }

  zip.extractAllTo(destDir, true);

  // Flatten a single top-level folder (common in GitHub-style zips)
  const topLevel = fs.readdirSync(destDir);
  if (topLevel.length === 1 && fs.statSync(path.join(destDir, topLevel[0])).isDirectory()) {
    const inner = path.join(destDir, topLevel[0]);
    for (const item of fs.readdirSync(inner)) {
      fs.renameSync(path.join(inner, item), path.join(destDir, item));
    }
    fs.rmdirSync(inner);
  }

  return {
    fileCount: entries.length,
    totalBytes: entries.reduce((sum, e) => sum + e.header.size, 0),
    source: 'zip:' + originalName,
  };
}

module.exports = {
  DATA_DIR,
  REPOS_DIR,
  MAX_UPLOAD_BYTES,
  MAX_FILE_VIEW_BYTES,
  BLOCKED_EXTENSIONS,
  ensureDataDirs,
  readMetadata,
  writeMetadata,
  audit,
  safeResolve,
  isBinary,
  walk,
  sanitizeName,
  stripCommonRoot,
  extractZip,
};
