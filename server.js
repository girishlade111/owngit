'use strict';

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const storage = require('./lib/storage');

storage.ensureDataDirs();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Upload handling -------------------------------------------------------

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, storage.DATA_DIR),
    filename: (_req, file, cb) => cb(null, 'upload-' + crypto.randomBytes(8).toString('hex')),
  }),
  limits: { fileSize: storage.MAX_UPLOAD_BYTES, files: 50 },
  fileFilter: (_req, file, cb) => {
    cb(null, true);
  },
});

function getProjectOr404(req, res) {
  const meta = storage.readMetadata();
  const project = meta.projects.find((p) => p.id === req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return null;
  }
  return { meta, project };
}

function saveMeta(meta) {
  storage.writeMetadata(meta);
}

// --- Routes ----------------------------------------------------------------

app.get('/api/projects', (_req, res) => {
  const meta = storage.readMetadata();
  const projects = meta.projects.map(({ id, name, description, createdAt, updatedAt, fileCount, totalBytes, source }) => ({
    id, name, description, createdAt, updatedAt, fileCount, totalBytes, source,
  }));
  projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ projects });
});

app.post('/api/projects/upload', upload.fields([{ name: 'files' }, { name: 'archive' }]), (req, res, next) => {
  const nameInput = (req.body.name || '').trim();
  const description = (req.body.description || '').trim();
  const archive = (req.files.archive || [])[0];
  const looseFiles = req.files.files || [];

  if (!archive && looseFiles.length === 0) {
    return res.status(400).json({ error: 'No files uploaded. Provide an archive or individual files.' });
  }
  if (!nameInput && !archive) {
    return res.status(400).json({ error: 'Project name is required when uploading individual files.' });
  }

  const id = crypto.randomUUID();
  const destDir = path.join(storage.REPOS_DIR, id);
  fs.mkdirSync(destDir, { recursive: true });

  try {
    let stats;
    let projectName = nameInput;

    if (archive) {
      stats = storage.extractZip(archive.path, destDir, archive.originalname);
      if (!projectName) projectName = path.basename(archive.originalname, path.extname(archive.originalname));
      fs.unlinkSync(archive.path);
    } else {
      for (const f of looseFiles) {
        const rel = f.originalname.replace(/\\/g, '/').replace(/^(\.\.\/)+/, '');
        const target = storage.safeResolve(destDir, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(f.path, target);
      }
      stats = {
        fileCount: looseFiles.length,
        totalBytes: looseFiles.reduce((s, f) => s + f.size, 0),
        source: 'files:' + looseFiles.length + ' items',
      };
    }

    const now = new Date().toISOString();
    const meta = storage.readMetadata();
    const project = {
      id,
      name: projectName || sanitizeDefault(nameInput),
      description,
      createdAt: now,
      updatedAt: now,
      fileCount: countFiles(destDir),
      totalBytes: dirSize(destDir),
      source: stats.source,
    };
    meta.projects.push(project);
    saveMeta(meta);

    storage.audit({ action: 'project.create', projectId: id, name: project.name, actor: req.ip });
    res.status(201).json({ project });
  } catch (err) {
    fs.rmSync(destDir, { recursive: true, force: true });
    next(err);
  }
});

function sanitizeDefault(n) {
  return storage.sanitizeName(String(n));
}

function countFiles(dir) {
  return storage.walk(dir, dir).filter((e) => e.type === 'file').length;
}

function dirSize(dir) {
  return storage.walk(dir, dir).reduce((s, e) => s + e.size, 0);
}

app.get('/api/projects/:id/tree', (req, res, next) => {
  const ctx = getProjectOr404(req, res);
  if (!ctx) return;
  try {
    const repoPath = path.join(storage.REPOS_DIR, ctx.project.id);
    const entries = storage.walk(repoPath, repoPath);
    res.json({ project: ctx.project, entries });
  } catch (err) {
    next(err);
  }
});

app.get('/api/projects/:id/file', (req, res, next) => {
  const ctx = getProjectOr404(req, res);
  if (!ctx) return;
  try {
    const repoPath = path.join(storage.REPOS_DIR, ctx.project.id);
    const filePath = storage.safeResolve(repoPath, String(req.query.path || ''));
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return res.status(400).json({ error: 'Not a file' });
    if (stat.size > storage.MAX_FILE_VIEW_BYTES) {
      return res.status(413).json({ error: 'File too large to preview', size: stat.size });
    }
    const buf = fs.readFileSync(filePath);
    if (storage.isBinary(buf)) {
      return res.json({ path: req.query.path, binary: true, size: stat.size });
    }
    res.json({ path: req.query.path, binary: false, size: stat.size, content: buf.toString('utf8') });
  } catch (err) {
    next(err);
  }
});

app.get('/api/projects/:id/raw', (req, res) => {
  const ctx = getProjectOr404(req, res);
  if (!ctx) return;
  try {
    const repoPath = path.join(storage.REPOS_DIR, ctx.project.id);
    const filePath = storage.safeResolve(repoPath, String(req.query.path || ''));
    res.download(filePath);
  } catch (err) {
    next(err);
  }
});

app.get('/api/projects/:id/search', (req, res) => {
  const ctx = getProjectOr404(req, res);
  if (!ctx) return;
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ query: q, results: [] });
  try {
    const repoPath = path.join(storage.REPOS_DIR, ctx.project.id);
    const results = [];
    for (const entry of storage.walk(repoPath, repoPath)) {
      if (entry.type !== 'file' || entry.size > storage.MAX_FILE_VIEW_BYTES) continue;
      const abs = path.join(repoPath, entry.path);
      const buf = fs.readFileSync(abs);
      if (storage.isBinary(buf)) continue;
      const lines = buf.toString('utf8').split('\n');
      lines.forEach((line, i) => {
        const idx = line.indexOf(q);
        if (idx !== -1 && results.length < 200) {
          results.push({
            path: entry.path,
            line: i + 1,
            column: idx + 1,
            text: line.trim().slice(0, 200),
          });
        }
      });
      if (results.length >= 200) break;
    }
    storage.audit({ action: 'project.search', projectId: ctx.project.id, query: q, hits: results.length, actor: req.ip });
    res.json({ query: q, truncated: results.length >= 200, results });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/projects/:id', (req, res, next) => {
  const ctx = getProjectOr404(req, res);
  if (!ctx) return;
  try {
    fs.rmSync(path.join(storage.REPOS_DIR, ctx.project.id), { recursive: true, force: true });
    ctx.meta.projects = ctx.meta.projects.filter((p) => p.id !== ctx.project.id);
    saveMeta(ctx.meta);
    storage.audit({ action: 'project.delete', projectId: ctx.project.id, actor: req.ip });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get('/api/audit', (_req, res) => {
  try {
    const raw = fs.readFileSync(storage.AUDIT_FILE, 'utf8').trim();
    const events = raw ? raw.split('\n').slice(-100).map(JSON.parse).reverse() : [];
    res.json({ events });
  } catch {
    res.json({ events: [] });
  }
});

// --- Errors ----------------------------------------------------------------

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  const message =
    err.code === 'LIMIT_FILE_SIZE'
      ? 'Upload exceeds the 200 MB size limit'
      : err.message || 'Internal server error';
  if (status === 500) console.error(err);
  res.status(status).json({ error: message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`LSGit code manager listening on http://localhost:${PORT}`);
});
