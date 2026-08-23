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
  document.querySelectorAll('.sidebtn').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === name || (name === 'browser' && b.dataset.view === 'projects'))
  );
  if (name === 'projects') loadProjects();
  if (name === 'audit') loadAudit();
}

document.querySelectorAll('.sidebtn').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

// --- Projects ---------------------------------------------------------------

async function loadProjects() {
  const data = await api('/api/projects');
  state.projects = data.projects;
  renderProjectTable(data.projects);
}

function renderProjectTable(projects) {
  const tbody = document.querySelector('#project-table tbody');
  const empty = $('#project-empty');
  const table = $('#project-table');
  if (projects.length === 0) {
    table.classList.add('hidden');
    empty.classList.remove('hidden');
    tbody.innerHTML = '';
    return;
  }
  table.classList.remove('hidden');
  empty.classList.add('hidden');
  tbody.innerHTML = projects
    .map(
      (p) => `
      <tr onclick="openProject('${p.id}')">
        <td><span class="repo-name">${esc(p.name)}</span></td>
        <td class="muted">${esc(p.description || p.source)}</td>
        <td class="num muted">${p.fileCount}</td>
        <td class="num muted">${fmtBytes(p.totalBytes)}</td>
        <td class="muted">${new Date(p.createdAt).toLocaleDateString()}</td>
      </tr>`
    )
    .join('');
}

$('#global-search').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  renderProjectTable(state.projects.filter((p) => p.name.toLowerCase().includes(q)));
});

// --- Browser ----------------------------------------------------------------

const FILE_ICONS = { '.js': '🟨', '.ts': '🟦', '.py': '🐍', '.json': '⚙️', '.md': '📘', '.html': '🌐' };
function fileIcon(p) {
  return FILE_ICONS[p.slice(p.lastIndexOf('.')).toLowerCase()] || '📄';
}

async function openProject(id) {
  const data = await api(`/api/projects/${id}/tree`);
  state.current = data.project;
  state.tree = data.entries;
  $('#browser-title').textContent = data.project.name;
  $('#browser-meta').textContent =
    `${data.project.fileCount} files · ${fmtBytes(data.project.totalBytes)} · created ${new Date(data.project.createdAt).toLocaleDateString()}`;
  renderTree($('#search-input').value.trim());
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
    dirs.map((e) => `<div class="tree-dir">📁 ${esc(e.path)}/</div>`).join('') +
    files
      .map(
        (e) =>
          `<div class="tree-file" data-path="${esc(e.path)}" onclick="viewFile('${esc(e.path)}')">` +
          `<span>${fileIcon(e.path)}</span><span>${esc(e.path)}</span></div>`
      )
      .join('') || '<div class="empty-state">No matching files</div>';
}

async function viewFile(path) {
  $('#search-results').classList.add('hidden');
  $('#viewer-empty').classList.add('hidden');
  $('#viewer-path').textContent = path;
  const pre = $('#file-view');
  pre.classList.remove('hidden');
  pre.setAttribute('data-file', path);
  document.querySelectorAll('.tree-file').forEach((f) => f.classList.toggle('active', f.dataset.path === path));

  try {
    const data = await api(`/api/projects/${state.current.id}/file?path=${encodeURIComponent(path)}`);
    const code = pre.querySelector('code');
    if (data.binary) {
      pre.innerHTML = `<div class="binary-note">Binary file (${fmtBytes(data.size)}) — <a href="/api/projects/${state.current.id}/raw?path=${encodeURIComponent(path)}">download</a></div>`;
      return;
    }
    code.textContent = data.content;
    delete code.dataset.highlighted;
    hljs.highlightElement(code);
  } catch (err) {
    pre.querySelector('code').textContent = err.message;
  }
}

let searchSeq = 0;
$('#search-input').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim();
  if (!q || !state.current) return;
  const seq = ++searchSeq;
  const data = await api(`/api/projects/${state.current.id}/search?q=${encodeURIComponent(q)}`);
  if (seq !== searchSeq) return;
  $('#file-view').classList.add('hidden');
  $('#viewer-empty').classList.add('hidden');
  $('#viewer-path').textContent = `Results for "${q}"`;
  const box = $('#search-results');
  box.classList.remove('hidden');
  box.innerHTML =
    `<div class="search-head">${data.results.length}${data.truncated ? '+' : ''} matches — click a result to open the file</div>` +
    data.results
      .map(
        (r) =>
          `<div class="search-hit" onclick="viewFile('${esc(r.path)}')"><b>${esc(r.path)}:${r.line}</b> — ${esc(r.text)}</div>`
      )
      .join('');
});

function focusSearch() {
  $('#search-input').focus();
}

async function deleteProject() {
  if (!confirm(`Delete repository "${state.current.name}" and all of its files? This cannot be undone.`)) return;
  await api('/api/projects/' + state.current.id, { method: 'DELETE' });
  state.current = null;
  showView('projects');
}

// --- Upload -----------------------------------------------------------------

const archiveInput = document.querySelector('#upload-form input[name=archive]');
const filesInput = document.querySelector('#upload-form input[name=files]');

function refreshPicks() {
  const picks = [];
  if (archiveInput.files[0]) picks.push(`${archiveInput.files[0].name} (${fmtBytes(archiveInput.files[0].size)})`);
  for (const f of filesInput.files) picks.push(f.name);
  $('#file-picks').innerHTML = picks.map((p) => `<li>${esc(p)}</li>`).join('');
}
archiveInput.addEventListener('change', refreshPicks);
filesInput.addEventListener('change', refreshPicks);

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
  btn.textContent = 'Creating…';
  try {
    const data = await api('/api/projects/upload', { method: 'POST', body: fd });
    status.className = 'ok';
    status.textContent = `Repository "${data.project.name}" created with ${data.project.fileCount} files.`;
    form.reset();
    refreshPicks();
    setTimeout(() => openProject(data.project.id), 500);
  } catch (err) {
    status.className = 'err';
    status.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create repository';
  }
});

// --- Audit ------------------------------------------------------------------

async function loadAudit() {
  const data = await api('/api/audit');
  $('#audit-body').innerHTML = data.events
    .map(
      (e) =>
        `<tr><td class="muted">${new Date(e.ts).toLocaleString()}</td><td><code>${esc(e.action)}</code></td>` +
        `<td class="muted">${esc(e.name || e.query || e.projectId?.slice(0, 8) || '')}</td><td class="muted">${esc(e.actor || '')}</td></tr>`
    )
    .join('') || '<tr><td colspan="4"><div class="empty-state">No audit events yet</div></td></tr>';
}

showView('projects');
