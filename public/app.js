'use strict';

// --- Helpers -----------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);

const state = {
  projects: [],
  current: null,
  tree: [],
  cwd: '',
  currentFile: null,
  currentContent: null,
  editing: false,
  mdRender: true,
  expanded: new Set(),
  wrap: false,
};

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}

function fmtDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
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

// --- Local preference store (IndexedDB, localStorage fallback) ---------------
// All user data stays on this machine: files on local disk, UI state in IndexedDB.

const prefs = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve) => {
      let done = false;
      const settle = (db) => { if (!done) { done = true; this._db = db; resolve(db); } };
      try {
        const req = indexedDB.open('lsgit-prefs', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => settle(req.result);
        req.onerror = () => settle(null);
      } catch { settle(null); }
    });
  },
  async get(key, dflt) {
    const db = await this.open();
    if (!db) {
      try {
        const v = localStorage.getItem('lsgit:' + key);
        return v === null ? dflt : JSON.parse(v);
      } catch { return dflt; }
    }
    return new Promise((resolve) => {
      const tx = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      tx.onsuccess = () => resolve(tx.result === undefined ? dflt : tx.result);
      tx.onerror = () => resolve(dflt);
    });
  },
  async set(key, val) {
    const db = await this.open();
    if (!db) {
      try { localStorage.setItem('lsgit:' + key, JSON.stringify(val)); } catch {}
      return;
    }
    return new Promise((resolve) => {
      const tx = db.transaction('kv', 'readwrite').objectStore('kv').put(val, key);
      tx.onsuccess = () => resolve();
      tx.onerror = () => resolve();
    });
  },
  async del(key) {
    const db = await this.open();
    if (!db) {
      try { localStorage.removeItem('lsgit:' + key); } catch {}
      return;
    }
    return new Promise((resolve) => {
      const tx = db.transaction('kv', 'readwrite').objectStore('kv').delete(key);
      tx.onsuccess = () => resolve();
      tx.onerror = () => resolve();
    });
  },
};

// --- Icons -------------------------------------------------------------------

const ICON = {
  folder: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  file: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  chevron: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m9 18 6-6-6-6"/></svg>',
};

const EXT_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
  swift: 'swift', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp',
  php: 'php', sh: 'shell', bash: 'shell', zsh: 'shell',
  html: 'xml', xml: 'xml', svg: 'xml', css: 'css', scss: 'scss', less: 'less',
  json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini',
  sql: 'sql', md: 'markdown', markdown: 'markdown', diff: 'diff', lua: 'lua',
  dart: 'dart', gradle: 'gradle', properties: 'ini', env: 'ini', pl: 'perl',
};

function extOf(p) {
  const base = p.slice(p.lastIndexOf('/') + 1);
  const i = base.lastIndexOf('.');
  return i === -1 ? '' : base.slice(i + 1).toLowerCase();
}

function hljsLang(p) {
  const lang = EXT_LANG[extOf(p)];
  return lang && window.hljs && hljs.getLanguage(lang) ? lang : null;
}

function isMarkdown(p) {
  return ['md', 'markdown'].includes(extOf(p));
}

// --- Views -------------------------------------------------------------------

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

// --- Collapsible sidebar (persisted in IndexedDB) ---------------------------

const sidebarEl = document.querySelector('.sidebar');

(async () => {
  if (await prefs.get('ui:sidebarCollapsed', false)) sidebarEl.classList.add('collapsed');
})();

$('#sb-toggle').addEventListener('click', async () => {
  sidebarEl.classList.toggle('collapsed');
  await prefs.set('ui:sidebarCollapsed', sidebarEl.classList.contains('collapsed'));
});

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

// --- Tree model ---------------------------------------------------------------

function childrenOf(dir) {
  const prefix = dir ? dir + '/' : '';
  return state.tree
    .filter((e) => e.path.startsWith(prefix))
    .map((e) => ({ ...e, name: e.path.slice(prefix.length) }))
    .filter((e) => !e.name.includes('/'))
    .sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === 'dir' ? -1 : 1
    );
}

function hasChildren(dir) {
  return state.tree.some((e) => e.path.startsWith(dir + '/'));
}

function expandAncestors(p) {
  const segs = p.split('/');
  for (let i = 1; i < segs.length; i++) state.expanded.add(segs.slice(0, i).join('/'));
  prefs.set('expanded:' + state.current.id, [...state.expanded]);
}

async function persistLocation() {
  if (!state.current) return;
  await prefs.set('last:' + state.current.id, { cwd: state.cwd, file: state.currentFile });
}

// --- Browser ------------------------------------------------------------------

async function openProject(id) {
  const data = await api(`/api/projects/${id}/tree`);
  state.current = data.project;
  state.tree = data.entries;
  $('#browser-title').textContent = data.project.name;
  $('#download-btn').href = `/api/projects/${id}/archive`;
  switchRepoTab('source');

  state.expanded = new Set(await prefs.get('expanded:' + id, []));
  state.wrap = await prefs.get('ui:wrap', false);
  state.cwd = '';
  state.currentFile = null;

  const last = await prefs.get('last:' + id, null);
  if (last) {
    if (last.cwd && state.tree.some((e) => e.path === last.cwd && e.type === 'dir')) state.cwd = last.cwd;
    else if (last.cwd === '') state.cwd = '';
    if (last.file && state.tree.some((e) => e.path === last.file && e.type === 'file')) state.currentFile = last.file;
  }

  showView('browser');
  refreshBranch();
  if (state.currentFile) {
    expandAncestors(state.currentFile);
    renderSidebar($('#tree-filter').value.trim());
    openFile(state.currentFile);
  } else {
    if (state.cwd) expandAncestors(state.cwd);
    renderSidebar($('#tree-filter').value.trim());
    renderCrumbs();
    renderDir();
    persistLocation();
  }
}

function switchRepoTab(tab) {
  document.querySelectorAll('[data-repotab]').forEach((t) => t.classList.toggle('active', t.dataset.repotab === tab));
  document.getElementById('repo-source').classList.toggle('hidden', tab !== 'source');
  document.getElementById('repo-commits').classList.toggle('hidden', tab !== 'commits');
  document.getElementById('repo-stats').classList.toggle('hidden', tab !== 'stats');
  if (tab === 'stats') loadStats();
  if (tab === 'commits') loadCommits();
}

document.querySelectorAll('[data-repotab]').forEach((t) =>
  t.addEventListener('click', () => switchRepoTab(t.dataset.repotab))
);

async function loadStats() {
  const data = await api(`/api/projects/${state.current.id}/stats`);
  $('#stat-files').textContent = data.totalFiles;
  $('#stat-lines').textContent = data.totalLines.toLocaleString();
  $('#stat-langs').textContent = data.languages.length;
  $('#stat-size').textContent = fmtBytes(data.project.totalBytes);

  const palette = ['lg1', 'lg2', 'lg3', 'lg4', 'lg5', 'lg6', 'lg0'];
  const total = Math.max(data.languages.reduce((s, l) => s + l.lines, 0), 1);
  $('#lang-bar').innerHTML = data.languages
    .slice(0, 7)
    .map((l, i) => `<div class="${palette[i % palette.length]}" style="flex:${Math.max(l.lines, 0.001)}" title="${esc(l.language)}"></div>`)
    .join('');
  document.querySelector('#lang-table tbody').innerHTML = data.languages
    .map((l, i) => {
      const pct = ((l.lines / total) * 100).toFixed(1);
      return `<tr><td><span class="dot ${palette[i % palette.length]}"></span>${esc(l.language)}</td>
        <td class="num muted">${pct}%</td><td class="num muted">${l.files}</td><td class="num muted">${l.lines.toLocaleString()} lines</td></tr>`;
    })
    .join('') || '<tr><td colspan="4"><div class="empty-state">No files</div></td></tr>';
}

async function renameProject() {
  const name = prompt('Repository name:', state.current.name);
  if (name === null) return;
  const description = prompt('Description:', state.current.description || '') ?? state.current.description;
  const data = await api('/api/projects/' + state.current.id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
  state.current = { ...state.current, ...data.project };
  $('#browser-title').textContent = data.project.name;
  renderCrumbs();
}

// --- Sidebar tree -------------------------------------------------------------

function renderSidebar(filter = '') {
  const el = $('#file-tree');
  if (filter) {
    const q = filter.toLowerCase();
    const hits = state.tree
      .filter((e) => e.path.toLowerCase().includes(q))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, 400);
    el.innerHTML =
      hits
        .map((e) => {
          const cls = e.path === state.currentFile ? ' active' : '';
          const idx = e.path.toLowerCase().lastIndexOf(q);
          const name = idx === -1 ? esc(e.path) : esc(e.path.slice(0, idx)) + '<b>' + esc(e.path.slice(idx, idx + q.length)) + '</b>' + esc(e.path.slice(idx + q.length));
          return `<div class="tree-row${cls}" data-path="${esc(e.path)}" data-type="${e.type}" title="${esc(e.path)}">${ICON[e.type === 'dir' ? 'folder' : 'file']}<span class="nm">${name}</span></div>`;
        })
        .join('') || '<div class="tree-empty muted">No matches</div>';
    return;
  }
  if (state.tree.length === 0) {
    el.innerHTML = '<div class="tree-empty muted">No files yet</div>';
    return;
  }
  const rows = [];
  walkSidebar('', 0, rows);
  el.innerHTML = rows.join('');
}

function walkSidebar(dir, depth, out) {
  for (const e of childrenOf(dir)) {
    const isOpen = e.type === 'dir' && state.expanded.has(e.path);
    const isActive = e.path === state.currentFile || (!state.currentFile && e.path === state.cwd);
    out.push(
      `<div class="tree-row${isOpen ? ' open' : ''}${isActive ? ' active' : ''}" data-path="${esc(e.path)}" data-type="${e.type}" ` +
        `style="padding-left:${10 + depth * 16}px" title="${esc(e.path)}">` +
        (e.type === 'dir' ? ICON.chevron : '<span class="chev-spacer"></span>') +
        `<span class="ic-wrap ${e.type}">${ICON[e.type === 'dir' ? 'folder' : 'file']}</span>` +
        `<span class="nm">${esc(e.name)}</span></div>`
    );
    if (isOpen) walkSidebar(e.path, depth + 1, out);
  }
}

$('#file-tree').addEventListener('click', (e) => {
  const row = e.target.closest('.tree-row');
  if (!row) return;
  const p = row.dataset.path;
  if (row.dataset.type === 'dir') {
    if (state.expanded.has(p)) state.expanded.delete(p);
    else state.expanded.add(p);
    prefs.set('expanded:' + state.current.id, [...state.expanded]);
    navigate(p);
  } else {
    openFile(p);
  }
});

$('#tree-filter').addEventListener('input', (e) => renderSidebar(e.target.value.trim()));
$('#tree-filter').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.target.value = '';
    renderSidebar('');
  }
});

// --- Breadcrumbs ----------------------------------------------------------------

function renderCrumbs() {
  const nav = $('#bb-crumbs');
  if (!state.current) return;
  let html = `<a href="#" data-cwd="">${esc(state.current.name)}</a>`;
  const segs = state.cwd ? state.cwd.split('/') : [];
  segs.forEach((s, i) => {
    const p = segs.slice(0, i + 1).join('/');
    const isLast = i === segs.length - 1 && !state.currentFile;
    html += `<span class="crumb-sep">/</span>` +
      (isLast ? `<span class="crumb-here">${esc(s)}</span>` : `<a href="#" data-cwd="${esc(p)}">${esc(s)}</a>`);
  });
  if (state.currentFile) {
    html += `<span class="crumb-sep">/</span><span class="crumb-here">${esc(state.currentFile.split('/').pop())}</span>`;
  }
  nav.innerHTML = html;
}

$('#bb-crumbs').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-cwd]');
  if (!a) return;
  e.preventDefault();
  navigate(a.dataset.cwd);
});

// --- Directory view --------------------------------------------------------------

function navigate(dir) {
  exitEditMode();
  state.cwd = dir;
  state.currentFile = null;
  renderSidebar($('#tree-filter').value.trim());
  renderCrumbs();
  renderDir();
  persistLocation();
}

let dirSeq = 0;

function renderDir() {
  const seq = ++dirSeq;
  const kids = childrenOf(state.cwd);
  const label = state.cwd ? state.cwd.split('/').pop() : 'Repository root';

  let html = `<div class="bb-dir-head">
    <span class="bb-dir-title">${ICON.folder}<b>${esc(label)}</b></span>
    <span class="muted small">${kids.filter((k) => k.type === 'dir').length} folders · ${kids.filter((k) => k.type === 'file').length} files</span>
  </div>`;

  if (kids.length === 0) {
    html += `<div class="empty-state">This folder is empty.<br>Drop files here or use “+ New file”.</div>`;
  } else {
    html += `<table class="repo-table bb-dir-table"><thead><tr>
      <th>Name</th><th class="num">Size</th><th>Last modified</th></tr></thead><tbody>`;
    for (const e of kids) {
      if (e.type === 'dir') {
        html += `<tr data-nav="${esc(e.path)}" data-type="dir">
          <td><span class="bb-name dir">${ICON.folder}${esc(e.name)}</span></td>
          <td class="num muted">—</td><td class="muted">${fmtDate(e.mtime)}</td></tr>`;
      } else {
        html += `<tr data-nav="${esc(e.path)}" data-type="file">
          <td><span class="bb-name file">${ICON.file}${esc(e.name)}</span></td>
          <td class="num muted">${fmtBytes(e.size)}</td><td class="muted">${fmtDate(e.mtime)}</td></tr>`;
      }
    }
    html += '</tbody></table>';
  }

  const readme = kids.find((f) => f.type === 'file' && /^readme(\.md|\.markdown|\.txt)?$/i.test(f.name));
  if (readme) html += `<div class="bb-readme" id="bb-readme"></div>`;

  $('#bb-content').innerHTML = html;

  if (readme) loadReadme(readme, seq);
}

async function loadReadme(entry, seq) {
  try {
    const data = await api(`/api/projects/${state.current.id}/file?path=${encodeURIComponent(entry.path)}`);
    if (seq !== dirSeq) return;
    const box = $('#bb-readme');
    if (!box || data.binary) return;
    const ext = extOf(entry.path);
    let inner;
    if ((ext === 'md' || ext === 'markdown') && window.marked && window.DOMPurify) {
      inner = DOMPurify.sanitize(marked.parse(data.content));
    } else {
      inner = '<pre class="readme-plain">' + esc(data.content) + '</pre>';
    }
    box.innerHTML =
      `<div class="bb-readme-head">${ICON.file}<span>${esc(entry.name)}</span></div>` +
      `<div class="markdown-body">${inner}</div>`;
  } catch { /* readme is best-effort */ }
}

$('#bb-content').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-nav]');
  if (!tr) return;
  if (tr.dataset.type === 'dir') navigate(tr.dataset.nav);
  else openFile(tr.dataset.nav);
});

// --- Code viewer -----------------------------------------------------------------

let fileSeq = 0;

async function openFile(path) {
  exitEditMode();
  const seq = ++fileSeq;
  state.cwd = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  state.currentFile = path;
  renderSidebar($('#tree-filter').value.trim());
  renderCrumbs();
  persistLocation();
  state.mdRender = await prefs.get('ui:md', true);

  const wrap = $('#bb-content');
  wrap.innerHTML =
    `<div class="bb-loading muted">Loading ${esc(path)}…</div>`;
  let data;
  try {
    data = await api(`/api/projects/${state.current.id}/file?path=${encodeURIComponent(path)}`);
  } catch (err) {
    if (seq !== fileSeq) return;
    wrap.innerHTML = renderFileHeader(path, null) +
      `<div class="empty-state">${esc(err.message)}<br><a class="crumb-link" href="/api/projects/${state.current.id}/raw?path=${encodeURIComponent(path)}">Download raw file</a></div>`;
    return;
  }
  if (seq !== fileSeq) return;

  if (data.binary) {
    wrap.innerHTML = renderFileHeader(path, { size: data.size }) +
      `<div class="empty-state">Binary file (${fmtBytes(data.size)}) —
        <a class="crumb-link" href="/api/projects/${state.current.id}/raw?path=${encodeURIComponent(path)}">download</a></div>`;
    return;
  }

  state.currentContent = data.content;
  const lines = data.content.split('\n').length;
  wrap.innerHTML = renderFileHeader(path, { size: data.size, lines }) + `<div id="bb-filebody"></div>`;

  if (isMarkdown(path)) renderMarkdownFile(path, data.content, seq);
  else renderCode(path, data.content, seq);
}

function renderFileHeader(path, info) {
  const raw = `/api/projects/${state.current.id}/raw?path=${encodeURIComponent(path)}`;
  const meta = [];
  if (info && info.lines != null) meta.push(info.lines.toLocaleString() + ' lines');
  if (info && info.size != null) meta.push(fmtBytes(info.size));
  const editing = state.editing;
  return `<div class="bb-file-head">
    <span class="bb-file-name">${ICON.file}<b>${esc(path.split('/').pop())}</b></span>
    <span class="muted small">${meta.join(' · ')}</span>
    <div class="bb-file-actions">
      ${isMarkdown(path) && !editing
        ? `<div class="seg">
            <button class="seg-btn${state.mdRender ? ' active' : ''}" data-act="md-rendered">Rendered</button>
            <button class="seg-btn${state.mdRender ? '' : ' active'}" data-act="md-source">Source</button>
          </div>`
        : ''}
      ${editing
        ? `<button class="btn small primary" data-act="save">Save</button>
           <button class="btn small" data-act="cancel">Cancel</button>`
        : `<button class="btn small" data-act="copy">Copy</button>
           <a class="btn small" href="${raw}" target="_blank" rel="noopener">Raw</a>
           <a class="btn small" href="${raw}" download>Download</a>
           <button class="btn small" data-act="history">History</button>
           <button class="btn small" data-act="edit">Edit</button>
           <button class="btn small danger subtle" data-act="delete">Delete</button>`}
      ${!editing && !isMarkdown(path)
        ? `<label class="toggle" title="Toggle soft wrap"><input type="checkbox" id="wrap-toggle" ${state.wrap ? 'checked' : ''}><span>⏎</span></label>`
        : ''}
    </div>
  </div>`;
}

function renderCode(path, content, seq) {
  if (seq !== fileSeq) return;
  const body = $('#bb-filebody');
  if (!body) return;
  const lines = highlightToLines(content, hljsLang(path));
  body.innerHTML =
    `<div class="code-wrap${state.wrap ? ' wrap' : ''}"><table class="code-table"><tbody>` +
    lines
      .map(
        (l, i) =>
          `<tr data-line="${i + 1}"><td class="ln" data-ln="${i + 1}">${i + 1}</td><td class="lc">${l || '\n'}</td></tr>`
      )
      .join('') +
    '</tbody></table></div>';
  const wt = $('#wrap-toggle');
  if (wt) wt.addEventListener('change', async (e) => {
    state.wrap = e.target.checked;
    await prefs.set('ui:wrap', state.wrap);
    document.querySelector('.code-wrap')?.classList.toggle('wrap', state.wrap);
  });
}

function renderMarkdownFile(path, content, seq) {
  if (seq !== fileSeq) return;
  const body = $('#bb-filebody');
  if (!body) return;
  if (state.mdRender && window.marked && window.DOMPurify) {
    body.innerHTML = `<div class="markdown-body md-file">${DOMPurify.sanitize(marked.parse(content))}</div>`;
  } else {
    renderCode(path, content, seq);
  }
}

// Highlight whole file, then split the highlighted HTML into per-line HTML
// so line numbers stay aligned even when spans cross newlines.
function highlightToLines(code, lang) {
  let value;
  try {
    value = lang
      ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      : hljs.highlightAuto(code).value;
  } catch {
    return code.split('\n').map(esc);
  }
  const tpl = document.createElement('template');
  tpl.innerHTML = value;
  const lines = [];
  let cur = '';
  const open = [];
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parts = node.textContent.split('\n');
      parts.forEach((p, i) => {
        if (i > 0) {
          lines.push(cur + '</span>'.repeat(open.length));
          cur = open.join('');
        }
        cur += esc(p);
      });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = `<span${node.getAttribute('class') ? ` class="${node.getAttribute('class')}"` : ''}>`;
      cur += tag;
      open.push(tag);
      node.childNodes.forEach(walk);
      open.pop();
      cur += '</span>';
    }
  };
  tpl.content.childNodes.forEach(walk);
  lines.push(cur);
  return lines;
}

$('#bb-content').addEventListener('click', async (e) => {
  const ln = e.target.closest('.ln');
  if (ln) {
    const tr = ln.closest('tr');
    document.querySelectorAll('.code-table tr.sel').forEach((r) => r.classList.remove('sel'));
    tr.classList.toggle('sel');
    return;
  }
  const btn = e.target.closest('[data-act]');
  if (!btn || !state.currentFile) return;
  const act = btn.dataset.act;
  if (act === 'edit') startEdit();
  else if (act === 'save') saveFile();
  else if (act === 'cancel') cancelEdit();
  else if (act === 'delete') deleteFile(state.currentFile);
  else if (act === 'history') loadFileHistory(state.currentFile);
  else if (act === 'copy') {
    try {
      await navigator.clipboard.writeText(state.currentContent ?? '');
      btn.textContent = 'Copied!';
      setTimeout(() => (btn.textContent = 'Copy'), 1200);
    } catch { /* clipboard unavailable */ }
  } else if (act === 'md-rendered' || act === 'md-source') {
    state.mdRender = act === 'md-rendered';
    await prefs.set('ui:md', state.mdRender);
    openFile(state.currentFile);
  }
});

// --- Editor -----------------------------------------------------------------

function startEdit() {
  if (state.currentContent === null || !state.currentFile) return;
  state.editing = true;
  const body = $('#bb-filebody');
  if (!body) return;
  body.innerHTML = `<textarea id="editor" spellcheck="false"></textarea>`;
  $('#editor').value = state.currentContent;
  const head = document.querySelector('.bb-file-head');
  if (head) head.outerHTML = renderFileHeader(state.currentFile, null);
  $('#editor').focus();
}

function exitEditMode() {
  if (!state.editing) return;
  state.editing = false;
}

function cancelEdit() {
  state.editing = false;
  openFile(state.currentFile);
}

async function saveFile() {
  const content = $('#editor').value;
  await api(`/api/projects/${state.current.id}/file`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: state.currentFile, content }),
  });
  state.currentContent = content;
  state.editing = false;
  await reloadTree();
  openFile(state.currentFile);
  refreshProjectMeta();
}

async function deleteFile(path) {
  if (!confirm(`Delete ${path}? This cannot be undone.`)) return;
  await api(`/api/projects/${state.current.id}/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
  await reloadTree();
  navigate(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
  refreshProjectMeta();
}

async function newFile() {
  const path = prompt('New file path (e.g. src/utils.js):');
  if (!path) return;
  await api(`/api/projects/${state.current.id}/file`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: path.replace(/\\/g, '/'), content: '' }),
  });
  await reloadTree();
  expandAncestors(path);
  openFile(path);
  refreshProjectMeta();
}

async function reloadTree() {
  const data = await api(`/api/projects/${state.current.id}/tree`);
  state.tree = data.entries;
  renderSidebar($('#tree-filter').value.trim());
}

async function refreshProjectMeta() {
  const meta = await api('/api/projects');
  const updated = meta.projects.find((p) => p.id === state.current.id);
  if (updated) Object.assign(state.current, updated);
}

async function deleteProject() {
  if (!confirm(`Delete repository "${state.current.name}" and all of its files? This cannot be undone.`)) return;
  await api('/api/projects/' + state.current.id, { method: 'DELETE' });
  await prefs.del?.('last:' + state.current.id);
  state.current = null;
  showView('projects');
}

// --- Search -----------------------------------------------------------------

let searchSeq = 0;
$('#search-input').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim();
  if (!q || !state.current) return;
  const regex = $('#opt-regex').checked ? 1 : 0;
  const cs = $('#opt-case').checked ? 1 : 0;
  const seq = ++searchSeq;
  try {
    const data = await api(
      `/api/projects/${state.current.id}/search?q=${encodeURIComponent(q)}&regex=${regex}&case=${cs}`
    );
    if (seq !== searchSeq) return;
    exitEditMode();
    state.currentFile = null;
    renderCrumbs();
    $('#bb-content').innerHTML =
      `<div class="bb-dir-head"><span class="bb-dir-title"><b>Search results</b></span>
        <span class="muted small">${data.results.length}${data.truncated ? '+' : ''} matches for “${esc(q)}”</span></div>` +
      `<div class="bb-search-list">` +
      (data.results
        .map(
          (r) =>
            `<div class="search-hit" data-open="${esc(r.path)}"><b>${esc(r.path)}:${r.line}</b> — ${esc(r.text)}</div>`
        )
        .join('') || '<div class="empty-state">No matches</div>') +
      '</div>';
  } catch (err) {
    if (seq === searchSeq) {
      $('#bb-content').innerHTML = `<div class="empty-state">${esc(err.message)}</div>`;
    }
  }
});

$('#bb-content').addEventListener('click', (e) => {
  const hit = e.target.closest('[data-open]');
  if (hit) openFile(hit.dataset.open);
});

// --- Git versioning (local) ---------------------------------------------------

function relTime(ts) {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' d ago';
  return new Date(ts * 1000).toLocaleDateString();
}

const STATUS_LABEL = { added: 'A', modified: 'M', deleted: 'D' };

async function gitApi(path, opts) {
  return api(`/api/projects/${state.current.id}/git${path}`, opts);
}

async function refreshBranch() {
  try {
    const data = await gitApi('/branches');
    state.branches = data;
    $('#branch-name').textContent = data.current;
  } catch { /* git not critical for browsing */ }
}

// --- Branch dropdown ---

$('#branch-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = $('#branch-menu');
  if (!menu.classList.contains('hidden')) { menu.classList.add('hidden'); return; }
  renderBranchMenu();
  menu.classList.remove('hidden');
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#branch-dd')) $('#branch-menu').classList.add('hidden');
});

function renderBranchMenu() {
  const data = state.branches || { current: 'main', branches: ['main'] };
  const items = data.branches.map((b) => {
    const isCur = b === data.current;
    return `<div class="branch-item${isCur ? ' current' : ''}" data-branch="${esc(b)}">
      <span class="branch-check">${isCur ? '✓' : ''}</span><span class="nm">${esc(b)}</span>
      ${isCur ? '' : '<button class="branch-del" data-del-branch="' + esc(b) + '" title="Delete branch">✕</button>'}
    </div>`;
  }).join('');
  $('#branch-menu').innerHTML =
    `<div class="branch-list">${items}</div>
     <div class="branch-new">
       <input type="text" id="new-branch-name" placeholder="new-branch-name">
       <button class="btn small" id="create-branch-btn">Create</button>
     </div>`;
}

$('#branch-menu').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del-branch]');
  if (del) {
    e.stopPropagation();
    if (!confirm(`Delete branch "${del.dataset.delBranch}"?`)) return;
    try {
      state.branches = await gitApi(`/branches?name=${encodeURIComponent(del.dataset.delBranch)}`, { method: 'DELETE' });
      renderBranchMenu();
    } catch (err) { alert(err.message); }
    return;
  }
  const createBtn = e.target.closest('#create-branch-btn');
  if (createBtn) {
    const input = $('#new-branch-name');
    const name = input.value.trim();
    if (!name) return;
    try {
      state.branches = await gitApi('/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, checkout: true }),
      });
      $('#branch-name').textContent = state.branches.current;
      $('#branch-menu').classList.add('hidden');
      await reloadTree();
      navigate('');
    } catch (err) { alert(err.message); }
    return;
  }
  const item = e.target.closest('.branch-item');
  if (item && !item.classList.contains('current')) {
    try {
      state.branches = await gitApi('/branches/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: item.dataset.branch }),
      });
      $('#branch-name').textContent = state.branches.current;
      $('#branch-menu').classList.add('hidden');
      state.currentFile = null;
      state.cwd = '';
      await reloadTree();
      renderCrumbs();
      renderDir();
      refreshProjectMeta();
    } catch (err) { alert(err.message); }
  }
});

$('#branch-menu').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter' || e.target.id !== 'new-branch-name') return;
  const name = e.target.value.trim();
  if (!name) return;
  try {
    state.branches = await gitApi('/branches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, checkout: true }),
    });
    $('#branch-name').textContent = state.branches.current;
    $('#branch-menu').classList.add('hidden');
    await reloadTree();
    navigate('');
  } catch (err) { alert(err.message); }
});

// --- Commits tab ---

let commitsSeq = 0;
let commitsState = { selected: null, showWorking: false };

async function loadCommits() {
  const seq = ++commitsSeq;
  const box = $('#repo-commits');
  box.innerHTML = '<div class="bb-loading muted">Loading history…</div>';
  let status, logData;
  try {
    [status, logData] = await Promise.all([gitApi('/status'), gitApi('/log')]);
  } catch (err) {
    if (seq === commitsSeq) box.innerHTML = `<div class="empty-state">${esc(err.message)}</div>`;
    return;
  }
  if (seq !== commitsSeq) return;
  const commits = logData.commits || [];
  state.gitStatus = status;
  // Fresh entry into the tab: if there are uncommitted changes, show the
  // working copy first; otherwise select the latest commit.
  commitsState = { selected: null, showWorking: status.files.length > 0 };
  if (!commitsState.showWorking && commits.length) {
    commitsState.selected = commits[0].oid;
  }
  renderCommitsView(status, commits);
}

function renderCommitsView(status, commits) {
  const box = $('#repo-commits');
  const list = commits.map((c) => {
    const isHead = c.oid === (commits[0] && commits[0].oid);
    const sel = commitsState.selected === c.oid && !commitsState.showWorking;
    return `<div class="commit-item${sel ? ' selected' : ''}" data-oid="${esc(c.oid)}">
      <div class="commit-top"><span class="commit-hash">${esc(c.short)}</span>
        ${isHead ? `<span class="badge git-badge">HEAD · ${esc(state.branches?.current || 'main')}</span>` : ''}</div>
      <div class="commit-msg">${esc(c.message.split('\n')[0])}</div>
      <div class="commit-meta muted small">${esc(c.author)} · ${relTime(c.timestamp)}</div>
    </div>`;
  }).join('');

  const wcCount = status.files.length;
  const wcItem = `<div class="commit-item working${commitsState.showWorking ? ' selected' : ''}" data-working="1">
    <div class="commit-top"><span class="wc-dot"></span><b>Working copy</b>
      ${wcCount ? `<span class="badge git-badge">${wcCount} changed</span>` : '<span class="badge git-badge clean">clean</span>'}</div>
    <div class="commit-meta muted small">Uncommitted changes</div>
  </div>`;

  box.innerHTML =
    `<div class="commits-split">
       <aside class="commits-list card">${wcItem}${list || '<div class="tree-empty muted">No commits yet</div>'}</aside>
       <section class="commit-detail card" id="commit-detail"></section>
     </div>`;

  if (commitsState.showWorking) renderWorkingCopy(status);
  else if (commitsState.selected) showCommitDetail(commitsState.selected);
  else $('#commit-detail').innerHTML = '<div class="empty-state">Select a commit</div>';
}

$('#repo-commits').addEventListener('click', (e) => {
  const wc = e.target.closest('[data-working]');
  if (wc) {
    commitsState = { selected: null, showWorking: true };
    document.querySelectorAll('.commit-item').forEach((i) => i.classList.toggle('selected', i === wc));
    renderWorkingCopy(state.gitStatus);
    return;
  }
  const item = e.target.closest('.commit-item[data-oid]');
  if (!item) return;
  commitsState = { selected: item.dataset.oid, showWorking: false };
  document.querySelectorAll('.commit-item').forEach((i) => i.classList.toggle('selected', i === item));
  showCommitDetail(item.dataset.oid);
});

async function showCommitDetail(oid) {
  const box = $('#commit-detail');
  box.innerHTML = '<div class="bb-loading muted">Loading commit…</div>';
  let c;
  try { c = await gitApi(`/commit/${oid}`); } catch (err) { box.innerHTML = `<div class="empty-state">${esc(err.message)}</div>`; return; }
  box.innerHTML =
    `<div class="cd-head">
       <div class="cd-msg">${esc(c.message)}</div>
       <div class="cd-meta muted small"><code>${esc(c.short)}</code> · ${esc(c.author)} · ${new Date(c.timestamp * 1000).toLocaleString()}
         ${c.parentShort ? ` · parent <code>${esc(c.parentShort)}</code>` : ''}</div>
     </div>
     <div class="cd-files-head pane-title">Changed files (${c.files.length})</div>
     <div class="cd-files">
       ${c.files.map((f) => `<div class="cd-file" data-cfile="${esc(f.path)}" data-coid="${esc(c.oid)}">
          <span class="st st-${f.status}">${STATUS_LABEL[f.status]}</span>
          <span class="nm">${esc(f.path)}</span></div>`).join('') || '<div class="empty-state">No files changed</div>'}
     </div>
     <div class="cd-diff" id="cd-diff"></div>`;
  box.querySelector('.cd-files').addEventListener('click', async (e) => {
    const f = e.target.closest('[data-cfile]');
    if (!f) return;
    box.querySelectorAll('.cd-file').forEach((x) => x.classList.toggle('open', x === f));
    const diffBox = $('#cd-diff');
    diffBox.innerHTML = '<div class="bb-loading muted">Loading diff…</div>';
    try {
      const d = await gitApi(`/commit/${c.oid}/diff?path=${encodeURIComponent(f.dataset.cfile)}`);
      diffBox.innerHTML = renderDiffTable(f.dataset.cfile, d);
    } catch (err) { diffBox.innerHTML = `<div class="empty-state">${esc(err.message)}</div>`; }
  });
}

// --- Working copy ---

function renderWorkingCopy(status) {
  const box = $('#commit-detail');
  box.innerHTML =
    `<div class="cd-head">
       <div class="cd-msg">Working copy</div>
       <div class="cd-meta muted small">${status.files.length} uncommitted change(s) on branch <code>${esc(status.branch)}</code></div>
     </div>
     ${status.files.length ? `
     <div class="cd-files">
       ${status.files.map((f) => `<div class="cd-file" data-wfile="${esc(f.path)}">
          <span class="st st-${f.status}">${STATUS_LABEL[f.status]}</span>
          <span class="nm">${esc(f.path)}</span>
          ${f.status !== 'added' ? '<button class="btn small danger subtle" data-restore="' + esc(f.path) + '">Restore</button>' : ''}
        </div>`).join('')}
     </div>
     <div class="cd-diff" id="cd-diff"></div>
     <div class="commit-form">
       <input type="text" id="commit-message" placeholder="Commit message (e.g. Fix login validation)">
       <button class="btn primary" id="do-commit">Commit</button>
       <button class="btn danger subtle" id="discard-all">Discard all</button>
     </div>` : '<div class="empty-state">Working copy is clean — every change is committed.</div>'}`;

  if (status.files.length) {
    box.querySelector('.cd-files').addEventListener('click', async (e) => {
      const r = e.target.closest('[data-restore]');
      if (r) {
        if (!confirm(`Restore "${r.dataset.restore}" to the last commit? Local changes will be lost.`)) return;
        try {
          const st = await gitApi('/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: r.dataset.restore }) });
          state.gitStatus = st.status;
          renderWorkingCopy(st.status);
          await reloadTree();
        } catch (err) { alert(err.message); }
        return;
      }
      const f = e.target.closest('[data-wfile]');
      if (!f) return;
      box.querySelectorAll('.cd-file').forEach((x) => x.classList.toggle('open', x === f));
      const diffBox = $('#cd-diff');
      diffBox.innerHTML = '<div class="bb-loading muted">Loading diff…</div>';
      try {
        const d = await gitApi(`/diff?path=${encodeURIComponent(f.dataset.wfile)}`);
        diffBox.innerHTML = renderDiffTable(f.dataset.wfile, d);
      } catch (err) { diffBox.innerHTML = `<div class="empty-state">${esc(err.message)}</div>`; }
    });

    $('#do-commit').addEventListener('click', async () => {
      const msg = $('#commit-message').value.trim();
      if (!msg) { alert('Enter a commit message first.'); return; }
      try {
        await gitApi('/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg }) });
        commitsState = { selected: null, showWorking: false };
        loadCommits();
      } catch (err) { alert(err.message); }
    });

    $('#discard-all').addEventListener('click', async () => {
      if (!confirm('Discard ALL uncommitted changes? Files return to the last committed state. This cannot be undone.')) return;
      try {
        const st = await gitApi('/discard', { method: 'POST' });
        state.gitStatus = st.status;
        renderWorkingCopy(st.status);
        await reloadTree();
        renderCrumbs();
        renderDir();
      } catch (err) { alert(err.message); }
    });

    $('#commit-message').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#do-commit').click(); }
    });
  }
}

// --- Diff rendering ---

function escLine(s) { return esc(s); }

function renderDiffTable(path, d) {
  const rows = d.rows || [];
  const { add, del } = d.stats || { add: 0, del: 0 };
  return `<div class="diff-head"><span class="nm">${esc(path)}</span>
      <span class="diff-stat"><span class="d-add">+${add}</span> <span class="d-del">−${del}</span></span></div>
    <div class="diff-table-wrap"><table class="diff-table"><tbody>
      ${rows.map((r) => `<tr class="diff-${r.t}">
        <td class="dn">${r.a ?? ''}</td><td class="dn">${r.b ?? ''}</td>
        <td class="ds">${r.t === 'add' ? '+' : r.t === 'del' ? '−' : ''}</td>
        <td class="dc">${escLine(r.s) || ' '}</td></tr>`).join('')}
    </tbody></table></div>`;
}

// --- File history ---

async function loadFileHistory(path) {
  const seq = ++fileSeq;
  renderCrumbs();
  const wrap = $('#bb-content');
  wrap.innerHTML = '<div class="bb-loading muted">Loading history…</div>';
  let commits;
  try {
    commits = (await gitApi(`/log?filepath=${encodeURIComponent(path)}`)).commits;
  } catch (err) {
    if (seq === fileSeq) wrap.innerHTML = `<div class="empty-state">${esc(err.message)}</div>`;
    return;
  }
  if (seq !== fileSeq) return;
  wrap.innerHTML =
    `<div class="bb-file-head">
       <span class="bb-file-name">${ICON.file}<b>History — ${esc(path)}</b></span>
       <div class="bb-file-actions"><button class="btn small" data-act="back-latest">Back to latest</button></div>
     </div>
     <div class="file-history">
       ${commits.map((c) => `<div class="commit-item" data-hist-oid="${esc(c.oid)}">
          <div class="commit-top"><span class="commit-hash">${esc(c.short)}</span></div>
          <div class="commit-msg">${esc(c.message.split('\n')[0])}</div>
          <div class="commit-meta muted small">${esc(c.author)} · ${relTime(c.timestamp)}</div>
        </div>`).join('') || '<div class="empty-state">No history recorded for this file</div>'}
     </div>`;
  wrap.querySelector('.file-history').addEventListener('click', async (e) => {
    const item = e.target.closest('[data-hist-oid]');
    if (item) viewFileAtCommit(item.dataset.histOid, path);
  });
}

async function viewFileAtCommit(oid, path) {
  const seq = ++fileSeq;
  state.currentFile = path;
  state.currentContent = null;
  renderCrumbs();
  const wrap = $('#bb-content');
  wrap.innerHTML = '<div class="bb-loading muted">Loading…</div>';
  let data;
  try {
    data = await gitApi(`/file?oid=${encodeURIComponent(oid)}&path=${encodeURIComponent(path)}`);
  } catch (err) {
    if (seq === fileSeq) wrap.innerHTML = `<div class="empty-state">${esc(err.message)}</div>`;
    return;
  }
  if (seq !== fileSeq) return;
  const lines = data.content.split('\n');
  const codeLines = highlightToLines(data.content, hljsLang(path));
  wrap.innerHTML =
    `<div class="bb-file-head">
       <span class="bb-file-name">${ICON.file}<b>${esc(path)}</b></span>
       <span class="badge git-badge">revision ${esc(oid.slice(0, 7))}</span>
       <span class="muted small">${lines.length.toLocaleString()} lines · ${fmtBytes(data.content.length)}</span>
       <div class="bb-file-actions">
         <button class="btn small" data-act="back-latest">Back to latest</button>
         <a class="btn small" href="/api/projects/${state.current.id}/raw?path=${encodeURIComponent(path)}" download>Download</a>
       </div>
     </div>
     <div class="code-wrap"><table class="code-table"><tbody>
       ${codeLines.map((l, i) => `<tr><td class="ln" data-ln="${i + 1}">${i + 1}</td><td class="lc">${l || '\n'}</td></tr>`).join('')}
     </tbody></table></div>`;
}

// --- Upload -----------------------------------------------------------------

const form = document.getElementById('upload-form');
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

// Drag & drop onto the upload form
const dropZone = $('#drop-zone');
['dragenter', 'dragover'].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add('dragging');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragging');
  })
);
dropZone.addEventListener('drop', (e) => {
  const { files } = e.dataTransfer;
  if (!files.length) return;
  const list = [...files];
  const isSingleZip = list.length === 1 && list[0].name.toLowerCase().endsWith('.zip');
  if (isSingleZip) {
    archiveInput.files = e.dataTransfer.files;
    if (!form.name.value) form.name.value = list[0].name.replace(/\.zip$/i, '');
  } else {
    filesInput.files = e.dataTransfer.files;
    if (!form.name.value) form.name.value = '';
  }
  refreshPicks();
});

// Drag & drop into an open repository
const repoDrop = $('#drop-target');
const dropOverlay = $('#drop-overlay');
let dragDepth = 0;

function hasFiles(e) {
  return e.dataTransfer && [...e.dataTransfer.types].includes('Files');
}

repoDrop.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  dropOverlay.classList.remove('hidden');
});
repoDrop.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
repoDrop.addEventListener('dragleave', () => {
  dragDepth = Math.max(dragDepth - 1, 0);
  if (dragDepth === 0) dropOverlay.classList.add('hidden');
});
repoDrop.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.classList.add('hidden');
  if (!state.current || !e.dataTransfer.files.length) return;
  const fd = new FormData();
  for (const f of e.dataTransfer.files) fd.append('files', f);
  try {
    await api(`/api/projects/${state.current.id}/files`, { method: 'POST', body: fd });
    await reloadTree();
    renderCrumbs();
    renderDir();
    refreshProjectMeta();
  } catch (err) {
    alert('Upload failed: ' + err.message);
  }
});

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);
  try {
    const data = await api('/api/projects/upload', { method: 'POST', body: fd, signal: controller.signal });
    status.className = 'ok';
    const skipped = data.skippedFiles || [];
    let msg = `Repository "${data.project.name}" created with ${data.project.fileCount} files.`;
    if (skipped.length) msg += ` Skipped ${skipped.length} blocked file(s): ${skipped.slice(0, 5).map((s) => s.split('/').pop()).join(', ')}${skipped.length > 5 ? '…' : ''}`;
    status.textContent = msg;
    form.reset();
    refreshPicks();
    setTimeout(() => openProject(data.project.id), 500);
  } catch (err) {
    status.className = 'err';
    status.textContent = err.name === 'AbortError' ? 'Upload timed out. Please try again.' : err.message;
  } finally {
    clearTimeout(timer);
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
