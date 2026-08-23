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

// Add files to an existing project via drag & drop
const addToProject = upload.fields([{ name: 'files' }, { name: 'archive' }]);
app.post('/api/projects/:id/files', addToProject, (req, res, next) => {
  const ctx = getProjectOr404(req, res);
  if (!ctx) return;
  const archive = (req.files.archive || [])[0];
  const looseFiles = req.files.files || [];
  if (!archive && looseFiles.length === 0) {
    return res.status(400).json({ error: 'No files provided' });
  }
  const destDir = path.join(storage.REPOS_DIR, ctx.project.id);
  let added = 0;
  try {
    if (archive) {
      const tmpDir = path.join(storage.DATA_DIR, 'merge-' + crypto.randomBytes(8).toString('hex'));
      fs.mkdirSync(tmpDir, { recursive: true });
      try {
        storage.extractZip(archive.path, tmpDir, archive.originalname);
        fs.unlinkSync(archive.path);
        added += mergeTree(tmpDir, destDir);
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (err) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        throw err;
      }
    }
    for (const f of looseFiles) {
      const rel = f.originalname.replace(/\\/g, '/').replace(/^(\.\.\/)+/, '');
      if (storage.BLOCKED_EXTENSIONS.has(path.extname(rel).toLowerCase())) continue;
      const target = storage.safeResolve(destDir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(f.path, target);
      added++;
    }
    touchProject(ctx, { fileCount: countFiles(destDir), totalBytes: dirSize(destDir) });
    storage.audit({ action: 'project.upload', projectId: ctx.project.id, count: added, actor: req.ip });
    res.json({ ok: true, added, project: publicProject(ctx.project) });
  } catch (err) {
    next(err);
  }
});

function mergeTree(srcDir, destDir) {
  let count = 0;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      count += mergeTree(src, dst);
    } else {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      count++;
    }
  }
  return count;
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

app.get('/api/projects/:id/raw', (req, res, next) => {
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

// Save (create or update) a file
app.put('/api/projects/:id/file', (req, res, next) => {
  const ctx = getProjectOr404(req, res);
  if (!ctx) return;
  const rel = String(req.body.path || '').replace(/\\/g, '/');
  const content = typeof req.body.content === 'string' ? req.body.content : null;
  if (!rel || content === null) return res.status(400).json({ error: 'path and content are required' });
  try {
    const repoPath = path.join(storage.REPOS_DIR, ctx.project.id);
    const filePath = storage.safeResolve(repoPath, rel);
    if (storage.BLOCKED_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
      return res.status(400).json({ error: 'Blocked file type: ' + path.extname(filePath) });
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    touchProject(ctx, { fileCount: countFiles(repoPath), totalBytes: dirSize(repoPath) });
    storage.audit({ action: 'file.save', projectId: ctx.project.id, path: rel, actor: req.ip });
    res.json({ ok: true, path: rel });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/projects/:id/file', (req, res, next) => {
  const ctx = getProjectOr404(req, res);
  if (!ctx) return;
  try {
    const repoPath = path.join(storage.REPOS_DIR, ctx.project.id);
    const filePath = storage.safeResolve(repoPath, String(req.query.path || ''));
    fs.rmSync(filePath);
    touchProject(ctx, { fileCount: countFiles(repoPath), totalBytes: dirSize(repoPath) });
    storage.audit({ action: 'file.delete', projectId: ctx.project.id, path: String(req.query.path), actor: req.ip });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Rename project / edit description
app.patch('/api/projects/:id', (req, res, next) => {
  const ctx = getProjectOr404(req, res);
  if (!ctx) return;
  const name = (typeof req.body.name === 'string' && req.body.name.trim()) || ctx.project.name;
  const description = typeof req.body.description === 'string'
    ? req.body.description.trim()
    : ctx.project.description;
  ctx.project.name = name;
  ctx.project.description = description;
  touchProject(ctx);
  storage.audit({ action: 'project.update', projectId: ctx.project.id, name, actor: req.ip });
  res.json({ project: publicProject(ctx.project) });
});

// Download whole project as zip
app.get('/api/projects/:id/archive', (req, res, next) => {
  const ctx = getProjectOr404(req, res);
  if (!ctx) return;
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    const repoPath = path.join(storage.REPOS_DIR, ctx.project.id);
    for (const entry of storage.walk(repoPath, repoPath)) {
      const abs = path.join(repoPath, entry.path);
      if (entry.type === 'dir') zip.addFile(entry.path + '/', Buffer.alloc(0));
      else zip.addLocalFile(abs, path.dirname(entry.path) === '.' ? '' : path.dirname(entry.path), path.basename(entry.path));
    }
    storage.audit({ action: 'project.export', projectId: ctx.project.id, actor: req.ip });
    res.set('Content-Disposition', `attachment; filename="${storage.sanitizeName(ctx.project.name)}.zip"`);
    res.send(zip.toBuffer());
  } catch (err) {
    next(err);
  }
});

// Code statistics: language breakdown and line counts
app.get('/api/projects/:id/stats', (req, res, next) => {
  const ctx = getProjectOr404(req, res);
  if (!ctx) return;
  try {
    const repoPath = path.join(storage.REPOS_DIR, ctx.project.id);
    const LANGS = {
      '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
      '.ts': 'TypeScript', '.tsx': 'TypeScript', '.jsx': 'JavaScript',
      '.py': 'Python', '.rb': 'Ruby', '.go': 'Go', '.rs': 'Rust',
      '.java': 'Java', '.kt': 'Kotlin', '.swift': 'Swift', '.c': 'C',
      '.h': 'C/C++ Header', '.cpp': 'C++', '.cs': 'C#', '.php': 'PHP',
      '.sh': 'Shell', '.bash': 'Shell', '.html': 'HTML', '.css': 'CSS',
      '.scss': 'SCSS', '.json': 'JSON', '.yml': 'YAML', '.yaml': 'YAML',
      '.md': 'Markdown', '.sql': 'SQL', '.toml': 'TOML', '.xml': 'XML',
    };
    const langs = {};
    let totalLines = 0;
    let codeFiles = 0;
    for (const entry of storage.walk(repoPath, repoPath)) {
      if (entry.type !== 'file') continue;
      codeFiles++;
      const ext = path.extname(entry.path).toLowerCase();
      let lines = 1;
      if (entry.size <= storage.MAX_FILE_VIEW_BYTES && !storage.isBinary(fs.readFileSync(path.join(repoPath, entry.path)).subarray(0, 8000))) {
        lines = fs.readFileSync(path.join(repoPath, entry.path), 'utf8').split('\n').length;
        totalLines += lines;
      }
      const lang = LANGS[ext] || (ext ? 'Other (' + ext + ')' : 'No extension');
      const bucket = (langs[lang] ||= { files: 0, lines: 0, bytes: 0 });
      bucket.files++;
      bucket.lines += lines;
      bucket.bytes += entry.size;
    }
    const breakdown = Object.entries(langs)
      .map(([language, s]) => ({ language, ...s }))
      .sort((a, b) => b.lines - a.lines);
    res.json({ project: publicProject(ctx.project), totalFiles: codeFiles, totalLines, languages: breakdown });
  } catch (err) {
    next(err);
  }
});

function touchProject(ctx, extra = {}) {
  Object.assign(ctx.project, { updatedAt: new Date().toISOString() }, extra);
  saveMeta(ctx.meta);
}

function publicProject(p) {
  const { id, name, description, createdAt, updatedAt, fileCount, totalBytes, source } = p;
  return { id, name, description, createdAt, updatedAt, fileCount, totalBytes, source };
}

function matchLine(line, q, useRegex, caseSensitive) {
  if (useRegex) {
    let re;
    try {
      re = new RegExp(q, caseSensitive ? '' : 'i');
    } catch {
      return -1;
    }
    const m = re.exec(line);
    return m ? m.index : -1;
  }
  return line.indexOf(q);
}

app.get('/api/projects/:id/search', (req, res) => {
  const ctx = getProjectOr404(req, res);
  if (!ctx) return;
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ query: q, results: [] });
  const useRegex = req.query.regex === '1';
  const caseSensitive = req.query.case === '1';
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
        const idx = matchLine(line, q, useRegex, caseSensitive);
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
