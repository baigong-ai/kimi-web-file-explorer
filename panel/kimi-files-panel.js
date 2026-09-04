/* kimi-files-panel.js — Files sidebar for the Kimi Code web portal, injected
 * into the STOCK UI (no bundle replacement).
 *
 * A single self-contained classic script: no framework, no build step, no
 * network calls beyond the server's own same-origin session-scoped fs APIs
 * (POST /api/v1/sessions/{id}/fs:list, fs:read, fs:open, fs:reveal and the
 * fs/{path}:download GET). apply.sh copies this file into the running
 * server's dist-web assets and adds one <script defer> tag to index.html.
 *
 * Session detection: the portal has no router; the active session is encoded
 * in the URL path as /sessions/<id> (possibly behind a relay prefix under
 * Remote Control). We watch pushState/replaceState/popstate.
 *
 * Auth: the server requires a Bearer credential on every API call. The
 * official UI persists it in localStorage under 'kimi-web.server-credential'
 * (JSON, 7-day TTL) after reading #token= from the launch URL; we read the
 * same store (and the fragment, in case we ever run before the app scrubs
 * it). Remote Control: the relay tells the SPA which origin to call via
 * ?kimi_origin= / sessionStorage['kimi-desktop-server-origin'] — mirrored
 * here so the panel works over the tunnel too.
 */
(function () {
  'use strict';
  if (window.__kimiFilesPanelLoaded) return;
  window.__kimiFilesPanelLoaded = true;

  // ---------------------------------------------------------------- i18n ---

  const STR = {
    en: {
      title: 'Files',
      openPanel: 'Open Files panel',
      searchPlaceholder: 'Find in loaded files…',
      refresh: 'Refresh',
      toggleHidden: 'Show hidden files',
      hideHidden: 'Hide hidden files',
      close: 'Close',
      back: 'Back to tree',
      download: 'Download',
      openInEditor: 'Open in editor',
      reveal: 'Reveal in Finder',
      loading: 'Loading…',
      loadFailed: 'Failed to load.',
      retry: 'Retry',
      empty: 'Empty directory',
      noSession: 'Open a chat session to browse its workspace files.',
      authRequired: 'Server credential not available yet. Reload the portal page, then reopen this panel.',
      truncated: 'File is too large — showing the beginning only.',
      lineCap: 'Showing the first {n} lines for performance.',
      noPreview: 'No preview for this file type.',
      source: 'Source',
      rendered: 'Preview',
      actionFailed: 'Action failed',
      workspaceRoot: 'Workspace root',
    },
    zh: {
      title: '文件',
      openPanel: '打开文件面板',
      searchPlaceholder: '在已加载的文件中查找…',
      refresh: '刷新',
      toggleHidden: '显示隐藏文件',
      hideHidden: '隐藏隐藏文件',
      close: '关闭',
      back: '返回目录树',
      download: '下载',
      openInEditor: '在编辑器中打开',
      reveal: '在访达中显示',
      loading: '加载中…',
      loadFailed: '加载失败。',
      retry: '重试',
      empty: '空目录',
      noSession: '打开一个聊天会话后即可浏览其工作区文件。',
      authRequired: '尚未拿到服务器凭证。请刷新门户页面后再打开本面板。',
      truncated: '文件过大，仅显示开头部分。',
      lineCap: '为保证性能，仅显示前 {n} 行。',
      noPreview: '该文件类型无法预览。',
      source: '源码',
      rendered: '预览',
      actionFailed: '操作失败',
      workspaceRoot: '工作区根目录',
    },
  };

  let lang = resolveLang();
  function t(key) {
    const table = STR[lang] || STR.en;
    return table[key] || STR.en[key] || key;
  }
  function resolveLang() {
    const docLang = (document.documentElement.lang || '').toLowerCase();
    if (docLang) return docLang.startsWith('zh') ? 'zh' : 'en';
    return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }

  // ---------------------------------------------------------- server API ---

  const CRED_KEY = 'kimi-web.server-credential';
  const ORIGIN_KEY = 'kimi-desktop-server-origin';

  function serverOrigin() {
    try {
      const fromQuery = new URLSearchParams(window.location.search).get('kimi_origin');
      if (fromQuery) {
        window.sessionStorage.setItem(ORIGIN_KEY, fromQuery);
        return fromQuery.replace(/\/+$/, '');
      }
      const stored = window.sessionStorage.getItem(ORIGIN_KEY);
      if (stored) return stored.replace(/\/+$/, '');
    } catch { /* fall through */ }
    return window.location.origin;
  }

  function readFragmentToken() {
    const hash = window.location.hash || '';
    if (!hash.startsWith('#')) return undefined;
    const token = new URLSearchParams(hash.slice(1)).get('token');
    return token || undefined;
  }

  function getCredential() {
    const fragment = readFragmentToken();
    if (fragment) return fragment;
    try {
      const raw = window.localStorage.getItem(CRED_KEY);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw);
      if (typeof parsed.credential === 'string' && parsed.expiresAt > Date.now()) {
        return parsed.credential;
      }
    } catch { /* fall through */ }
    return undefined;
  }

  class ApiError extends Error {
    constructor(message, code) {
      super(message);
      this.code = code;
    }
    get isAuth() {
      return this.code === 40101;
    }
  }

  function authHeaders() {
    const headers = {};
    const cred = getCredential();
    if (cred) headers['Authorization'] = 'Bearer ' + cred;
    return headers;
  }

  async function api(path, body) {
    const res = await fetch(serverOrigin() + '/api/v1' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body || {}),
    });
    let json;
    try {
      json = await res.json();
    } catch {
      throw new ApiError('HTTP ' + res.status, res.status === 401 ? 40101 : res.status);
    }
    if (json.code !== 0) throw new ApiError(json.msg || 'code ' + json.code, json.code);
    return json.data;
  }

  async function apiGet(path) {
    const res = await fetch(serverOrigin() + '/api/v1' + path, { headers: authHeaders() });
    let json;
    try {
      json = await res.json();
    } catch {
      throw new ApiError('HTTP ' + res.status, res.status === 401 ? 40101 : res.status);
    }
    if (json.code !== 0) throw new ApiError(json.msg || 'code ' + json.code, json.code);
    return json.data;
  }

  // -------------------------------------------------------------- session ---

  /** The portal has no router: the active session lives in the URL path as
   *  /sessions/<id> (possibly behind a relay path prefix under RC). */
  function currentSessionId() {
    const m = /\/sessions\/([^/]+)/.exec(window.location.pathname);
    if (!m) return undefined;
    try {
      const id = decodeURIComponent(m[1]);
      return id.length > 0 ? id : undefined;
    } catch {
      return undefined;
    }
  }

  let sessionId = currentSessionId();
  const navigationListeners = new Set();
  function onNavigate() {
    const next = currentSessionId();
    if (next === sessionId) return;
    sessionId = next;
    navigationListeners.forEach((fn) => fn());
  }
  for (const fnName of ['pushState', 'replaceState']) {
    const orig = history[fnName];
    history[fnName] = function () {
      const ret = orig.apply(this, arguments);
      onNavigate();
      return ret;
    };
  }
  window.addEventListener('popstate', onNavigate);

  // --------------------------------------------------------------- state ---

  const state = {
    open: false,
    showHidden: false,
    children: {}, // '' = workspace root; keys are workspace-relative dir paths
    expanded: {},
    loadingDirs: {},
    rootLoaded: false,
    dirError: null,
    filter: '',
    preview: null, // { path, data?, loading, error, mode }
    cwd: '',
  };
  let previewSeq = 0;

  function resetTree() {
    state.children = {};
    state.expanded = {};
    state.loadingDirs = {};
    state.rootLoaded = false;
    state.dirError = null;
    state.filter = '';
    state.preview = null;
    state.cwd = '';
    previewSeq += 1;
  }

  // ------------------------------------------------------------ fs calls ---

  function sortEntries(entries) {
    return entries.slice().sort((a, b) => {
      const ad = a.kind === 'directory';
      const bd = b.kind === 'directory';
      if (ad !== bd) return ad ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async function loadDir(path) {
    if (!sessionId || state.loadingDirs[path]) return;
    state.loadingDirs[path] = true;
    state.dirError = null;
    renderBody();
    try {
      const data = await api('/sessions/' + encodeURIComponent(sessionId) + '/fs:list', {
        path: path === '' ? '.' : path,
        include_git_status: true,
        show_hidden: state.showHidden,
      });
      state.children[path] = sortEntries(data.items || []);
      if (path === '') state.rootLoaded = true;
    } catch (err) {
      state.dirError = err instanceof ApiError && err.isAuth ? 'auth' : path;
    } finally {
      delete state.loadingDirs[path];
      renderBody();
    }
  }

  function ensureRoot() {
    if (!state.rootLoaded && !state.loadingDirs['']) void loadDir('');
  }

  async function toggleDir(entry) {
    if (entry.kind !== 'directory') return;
    if (state.expanded[entry.path]) {
      delete state.expanded[entry.path];
      renderBody();
      return;
    }
    state.expanded[entry.path] = true;
    renderBody();
    if (!(entry.path in state.children)) await loadDir(entry.path);
  }

  async function refresh() {
    if (!sessionId) return;
    const openDirs = Object.keys(state.expanded);
    state.rootLoaded = false;
    state.children = {};
    await loadDir('');
    await Promise.all(openDirs.map((p) => loadDir(p)));
  }

  /** Best-effort absolute workspace path for the header strip. */
  async function loadCwd() {
    if (!sessionId || state.cwd) return;
    try {
      const data = await apiGet('/sessions/' + encodeURIComponent(sessionId));
      const cwd =
        (data && (data.cwd || data.session?.cwd || data.summary?.cwd)) || '';
      if (typeof cwd === 'string' && cwd) {
        state.cwd = cwd;
        renderCwd();
      }
    } catch { /* optional */ }
  }

  // ------------------------------------------------------------------ DOM ---

  function h(tag, className, attrs) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  const SVG_PATHS = {
    folder: 'M2 5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z',
    file: 'M6 2h7l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1v5h5',
    eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6zm10 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    refresh: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5',
    close: 'M6 6l12 12M18 6L6 18',
    back: 'M15 5l-7 7 7 7',
    chevron: 'M9 6l6 6-6 6',
    open: 'M14 4h6v6M20 4l-9 9M9 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
    download: 'M12 3v12m0 0l-4-4m4 4l4-4M4 21h16',
  };
  function svgIcon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '15');
    svg.setAttribute('height', '15');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', SVG_PATHS[name] || SVG_PATHS.file);
    svg.appendChild(path);
    return svg;
  }

  function iconBtn(icon, label, onClick) {
    const btn = h('button', 'kfp-iconbtn', { title: label, 'aria-label': label });
    btn.appendChild(svgIcon(icon));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(btn);
    });
    return btn;
  }

  // Header
  const root = h('div', 'kfp-root');
  const tab = h('button', 'kfp-tab', { title: t('openPanel'), 'aria-label': t('openPanel') });
  tab.appendChild(svgIcon('folder'));
  const panel = h('div', 'kfp-panel kfp-hidden');
  const resizer = h('div', 'kfp-resize');
  const header = h('div', 'kfp-header');
  const titleEl = h('span', 'kfp-title');
  const cwdEl = h('div', 'kfp-cwd');
  const filterWrap = h('div', 'kfp-filter');
  const filterInput = h('input', '', { type: 'search' });
  const bodyEl = h('div', 'kfp-body');

  titleEl.appendChild(svgIcon('folder'));
  titleEl.appendChild(document.createTextNode(t('title')));
  const hiddenBtn = iconBtn('eye', t('toggleHidden'), async (btn) => {
    state.showHidden = !state.showHidden;
    btn.classList.toggle('kfp-on', state.showHidden);
    btn.title = state.showHidden ? t('hideHidden') : t('toggleHidden');
    await refresh();
  });
  const refreshBtn = iconBtn('refresh', t('refresh'), () => void refresh());
  const closeBtn = iconBtn('close', t('close'), () => setOpen(false));
  header.appendChild(titleEl);
  header.appendChild(hiddenBtn);
  header.appendChild(refreshBtn);
  header.appendChild(closeBtn);

  filterInput.placeholder = t('searchPlaceholder');
  filterInput.addEventListener('input', () => {
    state.filter = filterInput.value;
    renderBody();
  });
  filterWrap.appendChild(filterInput);

  panel.appendChild(resizer);
  panel.appendChild(header);
  panel.appendChild(cwdEl);
  panel.appendChild(filterWrap);
  panel.appendChild(bodyEl);
  root.appendChild(tab);
  root.appendChild(panel);
  document.body.appendChild(root);

  // Resize (drag the left edge)
  const WIDTH_KEY = 'kimi-web.files-panel.width';
  try {
    const stored = Number(window.localStorage.getItem(WIDTH_KEY));
    if (stored >= 280 && stored <= 900) panel.style.width = stored + 'px';
  } catch { /* ignore */ }
  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    function onMove(ev) {
      const width = Math.min(900, Math.max(280, startWidth + (startX - ev.clientX)));
      panel.style.width = width + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      try {
        window.localStorage.setItem(WIDTH_KEY, String(parseInt(panel.style.width, 10)));
      } catch { /* ignore */ }
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // ------------------------------------------------------------- behavior ---

  function setOpen(open) {
    state.open = open;
    panel.classList.toggle('kfp-hidden', !open);
    tab.classList.toggle('kfp-hidden', open || !sessionId);
    if (open) {
      renderAll();
      ensureRoot();
      void loadCwd();
    }
  }

  tab.addEventListener('click', () => setOpen(!state.open));

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !state.open) return;
    if (state.preview) {
      backToTree();
    } else {
      setOpen(false);
    }
    e.stopPropagation();
  }, true);

  navigationListeners.add(() => {
    resetTree();
    filterInput.value = '';
    if (!sessionId) {
      setOpen(false);
      tab.classList.add('kfp-hidden');
      return;
    }
    tab.classList.toggle('kfp-hidden', state.open);
    if (state.open) {
      renderAll();
      ensureRoot();
      void loadCwd();
    }
  });

  // Initial visibility of the tab.
  tab.classList.toggle('kfp-hidden', !sessionId);

  function renderAll() {
    titleEl.textContent = '';
    titleEl.appendChild(svgIcon('folder'));
    titleEl.appendChild(document.createTextNode(t('title')));
    hiddenBtn.title = state.showHidden ? t('hideHidden') : t('toggleHidden');
    refreshBtn.title = t('refresh');
    closeBtn.title = t('close');
    filterInput.placeholder = t('searchPlaceholder');
    renderCwd();
    renderBody();
  }

  function renderCwd() {
    cwdEl.textContent = state.cwd || '';
    cwdEl.title = state.cwd || '';
  }

  // ------------------------------------------------------------ rendering ---

  function renderBody() {
    bodyEl.textContent = '';
    if (!sessionId) {
      bodyEl.appendChild(h('div', 'kfp-state')).textContent = t('noSession');
      return;
    }
    if (state.preview) {
      renderPreview();
      return;
    }
    renderTree();
  }

  function gitBadge(entry) {
    const raw = (entry.git_status || '').trim();
    if (!raw) return null;
    let letter = '';
    let cls = '';
    if (raw.includes('D')) { letter = 'D'; cls = 'kfp-git-d'; }
    else if (raw.includes('M')) { letter = 'M'; cls = 'kfp-git-m'; }
    else if (raw.includes('?') || raw.includes('A')) { letter = raw.includes('?') ? '?' : 'A'; cls = 'kfp-git-a'; }
    if (!letter) return null;
    const badge = h('span', 'kfp-git ' + cls);
    badge.textContent = letter;
    badge.title = raw;
    return badge;
  }

  function treeRow(entry, depth, showParent) {
    const row = h('div', 'kfp-row');
    row.style.paddingLeft = 10 + depth * 14 + 'px';
    const chevron = h('span', 'kfp-chevron' + (entry.kind === 'directory' ? '' : ' kfp-leaf') + (state.expanded[entry.path] ? ' kfp-open' : ''));
    chevron.appendChild(svgIcon('chevron'));
    const icon = h('span', 'kfp-fileicon');
    icon.appendChild(svgIcon(entry.kind === 'directory' ? 'folder' : 'file'));
    const name = h('span', 'kfp-name');
    name.textContent = entry.name;
    if (showParent) {
      const parent = entry.path.slice(0, entry.path.length - entry.name.length).replace(/\/$/, '');
      if (parent) {
        const sub = h('span', 'kfp-sub');
        sub.textContent = '  ' + parent;
        name.appendChild(sub);
      }
    }
    name.title = entry.path;
    row.appendChild(chevron);
    row.appendChild(icon);
    row.appendChild(name);
    const badge = gitBadge(entry);
    if (badge) row.appendChild(badge);
    if (state.preview && state.preview.path === entry.path) row.classList.add('kfp-selected');
    row.addEventListener('click', () => {
      if (entry.kind === 'directory') void toggleDir(entry);
      else void openFile(entry.path);
    });
    return row;
  }

  function renderTree() {
    if (state.dirError === 'auth') {
      const el = h('div', 'kfp-state');
      el.textContent = t('authRequired');
      bodyEl.appendChild(el);
      return;
    }
    if (state.dirError) {
      const el = h('div', 'kfp-state');
      el.appendChild(document.createTextNode(t('loadFailed') + ' '));
      const retry = h('button', 'kfp-linkbtn');
      retry.textContent = t('retry');
      retry.addEventListener('click', () => {
        const failed = state.dirError;
        state.dirError = null;
        void loadDir(failed === true ? '' : failed);
      });
      el.appendChild(retry);
      bodyEl.appendChild(el);
      return;
    }

    const query = state.filter.trim().toLowerCase();
    if (query) {
      const matches = [];
      for (const path in state.children) {
        for (const entry of state.children[path]) {
          if (entry.name.toLowerCase().includes(query)) matches.push(entry);
        }
      }
      matches.sort((a, b) => a.path.localeCompare(b.path));
      if (matches.length === 0) {
        bodyEl.appendChild(h('div', 'kfp-state')).textContent = t('empty');
        return;
      }
      for (const entry of matches) bodyEl.appendChild(treeRow(entry, 0, true));
      return;
    }

    if (!state.rootLoaded) {
      const el = h('div', 'kfp-state');
      el.appendChild(h('span', 'kfp-spinner'));
      bodyEl.appendChild(el);
      return;
    }
    const rootEntries = state.children[''] || [];
    if (rootEntries.length === 0) {
      bodyEl.appendChild(h('div', 'kfp-state')).textContent = t('empty');
      return;
    }
    const walk = (entries, depth) => {
      for (const entry of entries) {
        bodyEl.appendChild(treeRow(entry, depth, false));
        if (entry.kind === 'directory' && state.expanded[entry.path]) {
          const children = state.children[entry.path];
          if (children) walk(children, depth + 1);
          else {
            const loadingRow = h('div', 'kfp-row');
            loadingRow.style.paddingLeft = 10 + (depth + 1) * 14 + 'px';
            loadingRow.appendChild(h('span', 'kfp-spinner'));
            bodyEl.appendChild(loadingRow);
          }
        }
      }
    };
    walk(rootEntries, 0);
  }

  // -------------------------------------------------------------- preview ---

  async function openFile(path) {
    const seq = ++previewSeq;
    state.preview = { path, data: null, loading: true, error: null, mode: 'rendered' };
    renderBody();
    try {
      const data = await api('/sessions/' + encodeURIComponent(sessionId) + '/fs:read', { path });
      if (seq !== previewSeq) return;
      state.preview = { path, data, loading: false, error: null, mode: 'rendered' };
    } catch (err) {
      if (seq !== previewSeq) return;
      state.preview = {
        path,
        data: null,
        loading: false,
        error: err instanceof ApiError && err.isAuth ? t('authRequired') : t('loadFailed'),
        mode: 'rendered',
      };
    }
    renderBody();
  }

  function backToTree() {
    previewSeq += 1;
    state.preview = null;
    renderBody();
  }

  function downloadUrl(path) {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return serverOrigin() + '/api/v1/sessions/' + encodeURIComponent(sessionId) + '/fs/' + encoded + ':download';
  }

  async function downloadFile(path) {
    const res = await fetch(downloadUrl(path), { headers: authHeaders() });
    if (!res.ok) throw new ApiError('HTTP ' + res.status, res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = h('a', '', { href: url, download: path.split('/').pop() || 'file' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function toast(msg) {
    const el = h('div', 'kfp-toast');
    el.textContent = msg;
    panel.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function formatSize(size) {
    if (typeof size !== 'number') return '';
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
    return (size / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function renderPreview() {
    const pv = state.preview;
    const bar = h('div', 'kfp-backbar');
    const backBtn = iconBtn('back', t('back'), backToTree);
    const name = h('span', 'kfp-name');
    name.textContent = pv.path.split('/').pop() || pv.path;
    name.title = pv.path;
    bar.appendChild(backBtn);
    bar.appendChild(name);
    bodyEl.appendChild(bar);

    if (pv.loading) {
      const el = h('div', 'kfp-state');
      el.appendChild(h('span', 'kfp-spinner'));
      el.appendChild(document.createTextNode(' ' + t('loading')));
      bodyEl.appendChild(el);
      return;
    }
    if (pv.error) {
      const el = h('div', 'kfp-state kfp-error-text');
      el.textContent = pv.error;
      bodyEl.appendChild(el);
      return;
    }

    const data = pv.data;
    const meta = h('div', 'kfp-previewmeta');
    meta.appendChild(document.createTextNode(formatSize(data.size)));
    const spacer = h('span', 'kfp-spacer');
    meta.appendChild(spacer);

    const kind = previewKind(data);
    if (kind === 'markdown') {
      const toggle = h('button', 'kfp-linkbtn');
      toggle.textContent = pv.mode === 'rendered' ? t('source') : t('rendered');
      toggle.addEventListener('click', () => {
        pv.mode = pv.mode === 'rendered' ? 'source' : 'rendered';
        renderBody();
      });
      meta.appendChild(toggle);
    }
    for (const [icon, label, fn] of [
      ['download', t('download'), () => downloadFile(pv.path)],
      ['open', t('openInEditor'), () => api('/sessions/' + encodeURIComponent(sessionId) + '/fs:open', { path: pv.path })],
      ['folder', t('reveal'), () => api('/sessions/' + encodeURIComponent(sessionId) + '/fs:reveal', { path: pv.path })],
    ]) {
      const btn = iconBtn(icon, label, () => {
        Promise.resolve()
          .then(fn)
          .catch(() => toast(t('actionFailed')));
      });
      meta.appendChild(btn);
    }
    bodyEl.appendChild(meta);

    if (data.truncated) {
      const notice = h('div', 'kfp-notice');
      notice.textContent = t('truncated');
      bodyEl.appendChild(notice);
    }

    if (kind === 'image') {
      const wrap = h('div', 'kfp-media');
      const img = h('img');
      img.alt = pv.path;
      img.src =
        data.encoding === 'base64'
          ? 'data:' + data.mime + ';base64,' + data.content
          : 'data:' + data.mime + ';charset=utf-8,' + encodeURIComponent(data.content);
      wrap.appendChild(img);
      bodyEl.appendChild(wrap);
      return;
    }
    if (kind === 'pdf') {
      const frame = h('iframe', 'kfp-pdf');
      if (data.encoding === 'base64') {
        frame.src = URL.createObjectURL(base64ToBlob(data.content, 'application/pdf'));
      } else {
        frame.src = 'data:application/pdf,' + encodeURIComponent(data.content);
      }
      bodyEl.appendChild(frame);
      return;
    }
    if (kind === 'csv') {
      bodyEl.appendChild(renderCsv(data.content));
      return;
    }
    if (kind === 'markdown' && pv.mode === 'rendered') {
      const wrap = h('div', 'kfp-md');
      wrap.innerHTML = renderMarkdown(data.content);
      bodyEl.appendChild(wrap);
      return;
    }
    if (kind === 'text' || (kind === 'markdown' && pv.mode === 'source')) {
      bodyEl.appendChild(renderCode(data.content));
      return;
    }
    const el = h('div', 'kfp-state');
    el.appendChild(document.createTextNode(t('noPreview') + ' '));
    const dl = h('button', 'kfp-linkbtn');
    dl.textContent = t('download');
    dl.addEventListener('click', () => {
      downloadFile(pv.path).catch(() => toast(t('actionFailed')));
    });
    el.appendChild(dl);
    bodyEl.appendChild(el);
  }

  function previewKind(data) {
    const mime = (data.mime || '').toLowerCase();
    const langId = (data.language_id || '').toLowerCase();
    const name = (data.path || '').toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    if (data.is_binary) return 'binary';
    if (langId === 'markdown' || mime === 'text/markdown' || /\.(md|markdown)$/.test(name)) return 'markdown';
    if (mime === 'text/csv' || name.endsWith('.csv')) return 'csv';
    return 'text';
  }

  function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  const CODE_LINE_CAP = 8000;
  function renderCode(content) {
    const wrap = h('div');
    const pre = h('pre', 'kfp-code');
    const lines = content.split('\n');
    const capped = lines.length > CODE_LINE_CAP;
    const shown = capped ? lines.slice(0, CODE_LINE_CAP) : lines;
    const frag = document.createDocumentFragment();
    shown.forEach((line, i) => {
      const row = h('div', 'kfp-line');
      const ln = h('span', 'kfp-ln');
      ln.textContent = String(i + 1);
      const lc = h('span', 'kfp-lc');
      lc.textContent = line;
      row.appendChild(ln);
      row.appendChild(lc);
      frag.appendChild(row);
    });
    pre.appendChild(frag);
    wrap.appendChild(pre);
    if (capped) {
      const notice = h('div', 'kfp-notice');
      notice.textContent = t('lineCap').replace('{n}', String(CODE_LINE_CAP));
      wrap.appendChild(notice);
    }
    return wrap;
  }

  function renderCsv(content) {
    const rows = parseCsv(content);
    const table = h('table', 'kfp-csv');
    const MAX_ROWS = 2000;
    rows.slice(0, MAX_ROWS).forEach((cells, r) => {
      const tr = h('tr');
      for (const cell of cells) {
        const td = h(r === 0 ? 'th' : 'td');
        td.textContent = cell;
        tr.appendChild(td);
      }
      table.appendChild(tr);
    });
    return table;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else field += ch;
    }
    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
  }

  // ------------------------------------------------------------- markdown ---
  // Minimal renderer: everything is HTML-escaped first, then a small set of
  // block/inline patterns is re-introduced as our own tags. Links are
  // scheme-checked. No raw HTML from the source can survive.

  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function safeUrl(url) {
    const u = url.trim();
    if (/^(https?:|mailto:|data:image\/)/i.test(u)) return u;
    if (u.startsWith('#')) return u;
    return null;
  }

  function mdInline(text) {
    let s = escapeHtml(text);
    s = s.replace(/`([^`]+)`/g, (_, c) => '<code>' + c + '</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
      const safe = safeUrl(url);
      // Unsafe/relative image (e.g. a workspace-relative path we can't load):
      // degrade to the alt text, and neutralize the leading "!" so the link
      // pattern below can't pick the brackets back up.
      return safe ? '<img alt="' + alt + '" src="' + escapeHtml(safe) + '">' : '​' + alt;
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
      const safe = safeUrl(url);
      return safe
        ? '<a href="' + escapeHtml(safe) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>'
        : label;
    });
    return s;
  }

  function renderMarkdown(src) {
    const lines = src.split('\n');
    const out = [];
    let i = 0;
    let para = [];
    const flushPara = () => {
      if (para.length) {
        out.push('<p>' + para.map(mdInline).join('<br>') + '</p>');
        para = [];
      }
    };
    while (i < lines.length) {
      const line = lines[i];
      const fence = /^```(\w*)\s*$/.exec(line);
      if (fence) {
        flushPara();
        const buf = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.push('<pre><code>' + escapeHtml(buf.join('\n')) + '</code></pre>');
        continue;
      }
      const heading = /^(#{1,4})\s+(.*)$/.exec(line);
      if (heading) {
        flushPara();
        const level = heading[1].length;
        out.push('<h' + level + '>' + mdInline(heading[2]) + '</h' + level + '>');
        i++;
        continue;
      }
      if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
        flushPara();
        out.push('<hr>');
        i++;
        continue;
      }
      if (/^\s*>/.test(line)) {
        flushPara();
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        out.push('<blockquote>' + buf.map(mdInline).join('<br>') + '</blockquote>');
        continue;
      }
      if (/^\s*[-*+]\s+/.test(line)) {
        flushPara();
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push('<li>' + mdInline(lines[i].replace(/^\s*[-*+]\s+/, '')) + '</li>');
          i++;
        }
        out.push('<ul>' + items.join('') + '</ul>');
        continue;
      }
      if (/^\s*\d+[.)]\s+/.test(line)) {
        flushPara();
        const items = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          items.push('<li>' + mdInline(lines[i].replace(/^\s*\d+[.)]\s+/, '')) + '</li>');
          i++;
        }
        out.push('<ol>' + items.join('') + '</ol>');
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(line)) {
        flushPara();
        const tableLines = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) tableLines.push(lines[i++]);
        const parseRow = (l) =>
          l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const headerCells = parseRow(tableLines[0]);
        let bodyRows = tableLines.slice(1);
        if (bodyRows.length && /^[\s:|-]+$/.test(bodyRows[0].replace(/\|/g, ''))) {
          bodyRows = bodyRows.slice(1);
        }
        let html = '<table><thead><tr>';
        for (const c of headerCells) html += '<th>' + mdInline(c) + '</th>';
        html += '</tr></thead><tbody>';
        for (const r of bodyRows) {
          html += '<tr>';
          for (const c of parseRow(r)) html += '<td>' + mdInline(c) + '</td>';
          html += '</tr>';
        }
        html += '</tbody></table>';
        out.push(html);
        continue;
      }
      if (line.trim() === '') {
        flushPara();
        i++;
        continue;
      }
      para.push(line);
      i++;
    }
    flushPara();
    return out.join('\n');
  }

  // ----------------------------------------------------- theme + language ---

  function resolveDark() {
    const pref = document.documentElement.dataset.colorScheme;
    if (pref === 'dark') return true;
    if (pref === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyTheme() {
    root.classList.toggle('kfp-dark', resolveDark());
    root.classList.toggle('kfp-light', !resolveDark());
  }
  applyTheme();
  new MutationObserver(() => {
    applyTheme();
    const next = resolveLang();
    if (next !== lang) {
      lang = next;
      tab.title = t('openPanel');
      renderAll();
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-scheme', 'lang', 'class'] });
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  }
})();
