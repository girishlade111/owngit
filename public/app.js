'use strict';

const $ = (sel) => document.querySelector(sel);
const state = { projects: [], current: null, tree: [] };

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $('#view-' + name).classList.remove('hidden');
  document.querySelectorAll('.navbtn').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === name || (name === 'browser' && b.dataset.view === 'projects'))
  );
  if (name === 'projects') loadProjects();
  if (name === 'audit') loadAudit();
}

document.querySelectorAll('.navbtn').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

// --- Projects ---------------------------------------------------------------

async function loadProjects() {
  const data = await api('/api/projects');
  state.projects = data.projects;
  const list = $('#project-list');
  if (data.projects.length === 0) {
    list.innerHTML = '<p class="muted">No projects yet. Upload source code to get started.</p>';
    return;
  }
  list.innerHTML = data.projects
    .map(
      (p) => `
    <div class="card panel" onclick="openProject('${p.id}')">
      <h3>${esc(p.name)}</h3>
      <div class="desc">${esc(p.description || p.source)}</div>
      <div class="stats"><span>📄 ${p.fileCount} files</span><span>💾 ${fmtBytes(p.totalBytes)}</span></div>
      <div class="foot"><span>${new Date(p.createdAt).toLocaleString()}</span><span>${esc(p.id.slice(0, 8))}</span></div>
    </div>`
    )
    .join('');
}

// --- Browser ----------------------------------------------------------------

async function openProject(id) {
  const data = await api(`/api/projects/${id}/tree`);
  state.current = data.project;
  state.tree = data.entries;
  $('#browser-title').textContent = data.project.name;
  $('#browser-meta').textContent =
    `${data.project.fileCount} files · ${fmtBytes(data.project.totalBytes)} · created ${new Date(data.project.createdAt).toLocaleString()}`;
  renderTree();
  showView('browser');
}

function renderTree(filter = '') {
  const tree = $('#file-tree');
  const entries = filter
    ? state.tree.filter((e) => e.path.toLowerCase().includes(filter.toLowerCase()))
    : [...state.tree].sort((a, b) => a.path.localeCompare(b.path));
  const dirs = entries.filter((e) => e.type === 'dir');
  const files = entries.filter((e) => e.type === 'file');
  tree.innerHTML =
    dirs.map((e) => `<div class="dir">📁 ${esc(e.path)}/</div>`).join('') +
    files
      .map((e) => `<div class="file" data-path="${esc(e.path)}" onclick="viewFile('${esc(e.path)}')">📄 ${esc(e.path)}</div>`)
      .join('') || '<p class="muted" style="padding:8px">No matches</p>';
}

async function viewFile(path, highlightLine = null) {
  document.getElementById('search-results').classList.add('hidden');
  const empty = $('#viewer-empty');
  empty.classList.add('hidden');
  const pre = $('#file-view');
  pre.classList.remove('hidden');
  document.querySelectorAll('.tree .file').forEach((f) => f.classList.toggle('active', f.dataset.path === path));

  try {
    const data = await api(`/api/projects/${state.current.id}/file?path=${encodeURIComponent(path)}`);
    const code = pre.querySelector('code');
    if (data.binary) {
      pre.innerHTML = `<div class="binary-note">Binary file (${fmtBytes(data.size)}) — <a style="color:var(--accent)" href="/api/projects/${state.current.id}/raw?path=${encodeURIComponent(path)}">download</a></div>`;
      return;
    }
    code.textContent = data.content;
    delete code.dataset.highlighted;
    hljs.highlightElement(code);
    if (highlightLine) {
      setTimeout(() => {
        const lines = pre.textContent.split('\n');
        void lines;
        const el = code.querySelector('.hljs-ln-line:nth-child(' + highlightLine + ')');
        if (el) el.scrollIntoView({ block: 'center' });
      }, 50);
    }
    pre.setAttribute('data-file', path);
  } catch (err) {
    code.textContent = err.message;
  }
}

$('#search-input').addEventListener('input', (e) => {
  const q = e.target.value.trim();
  if (!q) {
    $('#search-results').classList.add('hidden');
    $('#file-view').classList.remove('hidden');
    $('#viewer-empty').classList.toggle('hidden', !!preHasFile());
    return;
  }
  searchProject(q);
});

function preHasFile() {
  return $('#file-view').getAttribute('data-file');
}

let searchSeq = 0;
async function searchProject(q) {
  const seq = ++searchSeq;
  const data = await api(`/api/projects/${state.current.id}/search?q=${encodeURIComponent(q)}`);
  if (seq !== searchSeq) return;
  $('#file-view').classList.add('hidden');
  const box = $('#search-results');
  box.classList.remove('hidden');
  box.innerHTML =
    `<p class="muted">${data.results.length}${data.truncated ? '+' : ''} results for "${esc(q)}"</p>` +
    data.results
      .map(
        (r) =>
          `<div class="search-hit" onclick="viewFile('${esc(r.path)}')"><b>${esc(r.path)}:${r.line}</b> — ${esc(r.text)}</div>`
      )
      .join('');
}

async function deleteProject() {
  if (!confirm(`Delete project "${state.current.name}" and all its files?`)) return;
  await api('/api/projects/' + state.current.id, { method: 'DELETE' });
  state.current = null;
  showView('projects');
}

// --- Upload -----------------------------------------------------------------

$('#upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = $('#upload-status');
  status.className = '';
  status.textContent = '';

  if (!form.archive.files.length && !form.files.files.length) {
    status.className = 'err';
    status.textContent = 'Choose an archive or at least one file.';
    return;
  }

  const fd = new FormData();
  fd.append('name', form.name.value);
  fd.append('description', form.description.value);
  if (form.archive.files[0]) fd.append('archive', form.archive.files[0]);
  for (const f of form.files.files) fd.append('files', f);

  const btn = $('#upload-btn');
  btn.disabled = true;
  btn.textContent = 'Uploading…';
  try {
    const data = await api('/api/projects/upload', { method: 'POST', body: fd });
    status.className = 'ok';
    status.textContent = `Uploaded "${data.project.name}" (${data.project.fileCount} files).`;
    form.reset();
    setTimeout(() => openProject(data.project.id), 600);
  } catch (err) {
    status.className = 'err';
    status.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload';
  }
});

// --- Audit ------------------------------------------------------------------

async function loadAudit() {
  const data = await api('/api/audit');
  $('#audit-body').innerHTML = data.events
    .map(
      (e) =>
        `<tr><td>${new Date(e.ts).toLocaleString()}</td><td><code>${esc(e.action)}</code></td>` +
        `<td>${esc(e.projectId ? e.projectId.slice(0, 8) : '')} ${esc(e.query || e.name || '')}</td><td>${esc(e.actor || '')}</td></tr>`
    )
    .join('') || '<tr><td colspan="4" class="muted">No audit events yet</td></tr>';
}

showView('projects');
