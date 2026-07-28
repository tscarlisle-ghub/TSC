// app.js — application state, rendering and event wiring for the
// CMA Construction Administration Task Manager.
// Vanilla JS, no build step: everything is a global loaded via <script> tags
// (see index.html) so the whole thing runs straight off GitHub Pages.

const App = (() => {
  const DEFAULT_SETTINGS = {
    ghOwner: 'tscarlisle-ghub',
    ghRepo: 'ca',
    ghBranch: 'main',
    ghPath: 'tasks.db',
    ghToken: '',
    aiKey: '',
    aiModel: 'claude-sonnet-4-6',
  };

  let state = {
    tab: 'overview',
    booted: false,
    bootError: null,
    settings: loadSettings(),
    remoteSha: null,
    dirty: false,
    lastSyncedAt: null,
    lastLocalSaveAt: null,
    syncing: false,
    toast: null, // { kind: 'ok'|'warn'|'error', msg }
    view: 'priority', // 'priority' | 'category'
    filters: { project: '', party: '', status: '', category: '' },
    modal: null, // { type: 'task'|'project'|'parse'|'exportpdf', data }
  };

  // ---------------- persistence (settings + local db cache) ----------------

  function loadSettings() {
    try {
      const raw = localStorage.getItem('ca_settings');
      return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
    } catch (_) { return { ...DEFAULT_SETTINGS }; }
  }

  function saveSettings() {
    localStorage.setItem('ca_settings', JSON.stringify(state.settings));
  }

  // github.js expects {owner, repo, branch, path, token} — map from our
  // gh-prefixed settings keys (kept prefixed so the Settings form + storage
  // stay unambiguous alongside the aiKey/aiModel fields).
  function ghConfig() {
    const s = state.settings;
    return { owner: s.ghOwner, repo: s.ghRepo, branch: s.ghBranch, path: s.ghPath, token: s.ghToken };
  }

  function cacheDbLocally() {
    try {
      const bytes = CATask_DB.exportBytes();
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      localStorage.setItem('ca_db_cache', btoa(binary));
      state.lastLocalSaveAt = new Date().toISOString();
    } catch (e) {
      console.warn('local cache save failed', e);
    }
  }

  function readLocalDbCache() {
    const raw = localStorage.getItem('ca_db_cache');
    if (!raw) return null;
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // ---------------- boot ----------------

  async function boot() {
    render(); // show loading shell immediately
    try {
      const cached = readLocalDbCache();
      if (cached) {
        await CATask_DB.init(cached);
        state.dirty = true; // we don't know if this matches GitHub's latest
        // Fetch the current remote sha in the background (without touching the
        // loaded db) so the next "Save to GitHub" already knows it, instead of
        // relying on push()'s own auto-recovery. Failures here are silent —
        // push() still works without it.
        if (state.settings.ghToken && state.settings.ghOwner && state.settings.ghRepo) {
          CAGitHub.pull(ghConfig()).then((r) => { if (!r.notFound) state.remoteSha = r.sha; }).catch(() => {});
        }
      } else if (state.settings.ghToken && state.settings.ghOwner && state.settings.ghRepo) {
        try {
          const { bytes, sha, notFound } = await CAGitHub.pull(ghConfig());
          if (notFound) {
            const seed = await fetch('./tasks.db').then((r) => r.arrayBuffer());
            await CATask_DB.init(new Uint8Array(seed));
          } else {
            await CATask_DB.init(bytes);
            state.remoteSha = sha;
            state.lastSyncedAt = new Date().toISOString();
          }
        } catch (e) {
          console.warn('GitHub pull failed, falling back to bundled db', e);
          const seed = await fetch('./tasks.db').then((r) => r.arrayBuffer());
          await CATask_DB.init(new Uint8Array(seed));
          setToast('warn', `Couldn't reach GitHub yet (${e.message}). Opened the local starter database — check Settings.`);
        }
      } else {
        const seed = await fetch('./tasks.db').then((r) => r.arrayBuffer());
        await CATask_DB.init(new Uint8Array(seed));
      }
      state.booted = true;
    } catch (e) {
      console.error(e);
      state.bootError = e.message || String(e);
    }
    render();
  }

  // ---------------- toast ----------------
  function setToast(kind, msg) {
    state.toast = { kind, msg };
    render();
    clearTimeout(setToast._t);
    setToast._t = setTimeout(() => { state.toast = null; render(); }, 6000);
  }

  // ---------------- mutations (all funnel through here so we always re-cache + re-render) ----------------

  function afterMutation() {
    cacheDbLocally();
    state.dirty = true;
    render();
  }

  function saveTaskDraft(draft, id) {
    if (id) CATask_DB.updateTask(id, draft);
    else CATask_DB.insertTask(draft);
    afterMutation();
  }

  function deleteTaskById(id) {
    if (!confirm('Delete this task? This cannot be undone.')) return;
    CATask_DB.deleteTask(id);
    closeModal();
    afterMutation();
  }

  function toggleDone(id, currentStatus) {
    CATask_DB.setStatus(id, currentStatus === 'Done' ? 'Open' : 'Done');
    afterMutation();
  }

  function saveProjectDraft(draft, id) {
    if (id) CATask_DB.updateProject(id, draft);
    else CATask_DB.insertProject(draft);
    afterMutation();
  }

  function deleteProjectById(id) {
    if (!confirm('Delete this project? Its tasks will be kept but unassigned.')) return;
    CATask_DB.deleteProject(id);
    closeModal();
    afterMutation();
  }

  // ---------------- GitHub sync ----------------

  async function pullFromGitHub() {
    state.syncing = true; render();
    try {
      const { bytes, sha, notFound } = await CAGitHub.pull(ghConfig());
      if (notFound) throw new Error(`"${state.settings.ghPath}" doesn't exist yet in that repo/branch — Save to GitHub first to create it.`);
      await CATask_DB.init(bytes);
      state.remoteSha = sha;
      state.lastSyncedAt = new Date().toISOString();
      state.dirty = false;
      cacheDbLocally();
      setToast('ok', 'Pulled the latest database from GitHub.');
    } catch (e) {
      setToast('error', e.message);
    }
    state.syncing = false;
    render();
  }

  async function pushToGitHub() {
    state.syncing = true; render();
    try {
      const bytes = CATask_DB.exportBytes();
      const { sha } = await CAGitHub.push(ghConfig(), bytes, 'Update tasks.db from the task manager', state.remoteSha);
      state.remoteSha = sha;
      state.lastSyncedAt = new Date().toISOString();
      state.dirty = false;
      setToast('ok', 'Saved to GitHub.');
    } catch (e) {
      setToast('error', e.message);
    }
    state.syncing = false;
    render();
  }

  async function testGitHubConnection() {
    try {
      const info = await CAGitHub.testConnection(ghConfig());
      setToast('ok', `Connected to ${info.fullName} (default branch "${info.defaultBranch}"${info.private ? ', private' : ', public'}).`);
    } catch (e) {
      setToast('error', e.message);
    }
  }

  function downloadDbFile() {
    const bytes = CATask_DB.exportBytes();
    const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'tasks.db';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  async function importDbFile(file) {
    if (!confirm('Import this file? It will replace everything currently loaded (your changes are still cached locally until you overwrite them).')) return;
    const buf = await file.arrayBuffer();
    await CATask_DB.init(new Uint8Array(buf));
    afterMutation();
    setToast('ok', 'Imported database file.');
  }

  function resetLocalCache() {
    if (!confirm('Clear the local browser cache of the database? Anything not saved to GitHub will be lost.')) return;
    localStorage.removeItem('ca_db_cache');
    setToast('ok', 'Local cache cleared. Reloading…');
    setTimeout(() => location.reload(), 800);
  }

  // ---------------- AI email parsing ----------------

  async function runParse(emailText) {
    const projectNames = CATask_DB.getProjects().map((p) => p.name);
    try {
      const drafts = await CAParse.parseEmailText({
        apiKey: state.settings.aiKey,
        model: state.settings.aiModel,
        emailText, projectNames,
      });
      if (!drafts.length) { setToast('warn', 'No actionable items found in that text.'); return; }
      state.modal = { type: 'parseReview', data: { drafts, index: 0, total: drafts.length } };
      render();
    } catch (e) {
      setToast('error', e.message);
    }
  }

  // ---------------- modal helpers ----------------

  function openModal(type, data) { state.modal = { type, data }; render(); }
  function closeModal() { state.modal = null; render(); }

  // ---------------- derived data ----------------

  function enrichedTasks() {
    const projects = CATask_DB.getProjects();
    const pMap = Object.fromEntries(projects.map((p) => [p.id, p]));
    return CATask_DB.getTasks().map((t) => ({
      ...t,
      project: t.project_id ? pMap[t.project_id] : null,
      daysOut: daysFromToday(t.due_date),
    }));
  }

  function filteredTasks() {
    let rows = enrichedTasks();
    const f = state.filters;
    if (f.project) rows = rows.filter((t) => String(t.project_id) === f.project);
    if (f.party) rows = rows.filter((t) => t.responsible_party === f.party);
    if (f.status) rows = rows.filter((t) => t.status === f.status);
    if (f.category) rows = rows.filter((t) => t.category === f.category);
    return rows;
  }

  // =====================================================================
  // RENDER
  // =====================================================================

  function render() {
    const root = document.getElementById('ca-root');
    if (!state.booted) {
      root.innerHTML = state.bootError ? renderBootError() : renderBootLoading();
      return;
    }
    root.innerHTML = `
      ${renderHeader()}
      <div class="ca-main">
        ${state.toast ? renderToast() : ''}
        ${renderTab()}
      </div>
      ${renderFolio()}
      ${state.modal ? renderModal() : ''}
    `;
  }

  function renderBootLoading() {
    return `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;">
      <div style="font-family:var(--serif);font-style:italic;font-size:20px;color:var(--ink-soft);">Loading the ledger…</div>
    </div>`;
  }

  function renderBootError() {
    return `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px;">
      <div style="max-width:480px;text-align:center;">
        <div style="font-family:var(--serif);font-style:italic;font-size:22px;color:var(--alert);margin-bottom:14px;">Couldn't load the database</div>
        <div style="font-family:var(--serif);font-size:15px;color:var(--ink-soft);">${escapeHtml(state.bootError)}</div>
        <button class="ca-btn ca-btn-primary" style="margin-top:22px;" onclick="App.retryBoot()">Retry</button>
      </div>
    </div>`;
  }

  function renderHeader() {
    const tabs = [['overview', 'Overview'], ['tasks', 'Tasks'], ['projects', 'Projects'], ['settings', 'Settings']];
    const dirtyBadge = state.dirty
      ? `<span style="font-family:var(--titling);font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);white-space:nowrap;">● unsaved</span>`
      : `<span style="font-family:var(--titling);font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-mute);white-space:nowrap;">${state.lastSyncedAt ? 'synced ' + timeAgo(state.lastSyncedAt) : 'not synced'}</span>`;
    return `
      <header class="ca-header">
        <div class="ca-header-inner">
          <img class="ca-logo" src="assets/logo-wordmark.png" alt="Carlisle Moore Architects" />
          <nav class="ca-nav">
            ${tabs.map(([id, label]) => `<button class="${state.tab === id ? 'active' : ''}" onclick="App.setTab('${id}')">${label}</button>`).join('')}
          </nav>
          <div style="display:flex;align-items:center;gap:14px;">
            ${dirtyBadge}
            <button class="ca-btn ca-btn-primary" onclick="App.pushToGitHub()" ${state.syncing ? 'disabled' : ''}>${state.syncing ? 'Saving…' : 'Save to GitHub'}</button>
          </div>
        </div>
      </header>`;
  }

  function renderToast() {
    const cls = state.toast.kind === 'error' ? 'warn' : (state.toast.kind === 'warn' ? 'warn' : 'ok');
    return `<div class="ca-banner ${cls}">${escapeHtml(state.toast.msg)}</div>`;
  }

  function renderFolio() {
    return `<div class="ca-main"><div class="ca-folio">
      <span>Carlisle Moore Architects</span>
      <span class="brand">Construction Administration<span class="fy">Task Ledger</span></span>
    </div></div>`;
  }

  function renderTab() {
    if (state.tab === 'overview') return renderOverview();
    if (state.tab === 'tasks') return renderTasksTab();
    if (state.tab === 'projects') return renderProjectsTab();
    if (state.tab === 'settings') return renderSettingsTab();
    return '';
  }

  // ---------------- Overview ----------------

  function renderOverview() {
    const tasks = enrichedTasks();
    const open = tasks.filter((t) => t.status !== 'Done');
    const overdue = open.filter((t) => t.daysOut !== null && t.daysOut < 0);
    const dueSoon = open.filter((t) => t.daysOut !== null && t.daysOut >= 0 && t.daysOut <= 7);
    const doneThisMonth = tasks.filter((t) => t.completed_date && t.completed_date.slice(0, 7) === todayISO().slice(0, 7));

    const kpis = [
      { of: 'On the board', v: open.length, label: 'Open Tasks', note: `${tasks.length} total tracked`, color: 'var(--ink)' },
      { of: 'Needs attention', v: overdue.length, label: 'Past Due', note: overdue.length ? 'sorted oldest first below' : 'nothing overdue', color: overdue.length ? 'var(--alert)' : 'var(--ink)' },
      { of: 'This week', v: dueSoon.length, label: 'Due Soon', note: 'within 7 days', color: 'var(--gold)' },
      { of: 'This month', v: doneThisMonth.length, label: 'Completed', note: 'closed out', color: 'var(--forest)' },
    ];

    const urgent = open.filter((t) => t.daysOut !== null).sort((a, b) => a.daysOut - b.daysOut).slice(0, 8);

    const partyRows = RESPONSIBLE_PARTIES.map((party) => {
      const rows = open.filter((t) => t.responsible_party === party);
      const od = rows.filter((t) => t.daysOut !== null && t.daysOut < 0).length;
      const nextDue = rows.filter((t) => t.due_date).sort((a, b) => a.daysOut - b.daysOut)[0];
      return { party, count: rows.length, overdue: od, next: nextDue ? fmtDateShort(nextDue.due_date) : '—' };
    });

    return `
      <div class="ca-kpis">
        ${kpis.map((k) => `
          <div class="ca-kpi">
            <div class="ca-kpi-of">${k.of}</div>
            <div class="ca-kpi-v tabular" style="color:${k.color};">${k.v}</div>
            <div class="ca-kpi-lab">${k.label}</div>
            <div class="ca-kpi-note">${k.note}</div>
          </div>`).join('')}
      </div>

      <div class="ca-plate">
        <div>
          <div class="ca-plate-num">01</div>
          <div class="ca-plate-kicker">Needs Action</div>
          <div class="ca-plate-rule"></div>
          <div class="ca-plate-label">Overdue &amp;<br/>Due Soon</div>
          <div class="ca-plate-note">${urgent.length} item${urgent.length === 1 ? '' : 's'} with a due date, soonest first.</div>
        </div>
        <div>
          <h2 class="ca-lede">${overdue.length ? (overdue.length === 1 ? 'One item is past due.' : overdue.length + ' items are past due.') : 'Nothing is overdue right now.'}</h2>
          ${urgent.length ? `
          <div class="ca-ledger-head" style="grid-template-columns:90px 1fr 140px 100px;">
            <span>Due</span><span>Task</span><span>Category</span><span style="text-align:right;">Party</span>
          </div>
          ${urgent.map((t) => renderUrgentRow(t)).join('')}
          ` : `<div class="ca-plate-note">Click "+ New Task" on the Tasks tab, or paste an email, to get started.</div>`}
        </div>
      </div>

      <div class="ca-plate">
        <div>
          <div class="ca-plate-num">02</div>
          <div class="ca-plate-kicker">Who Owes What</div>
          <div class="ca-plate-rule"></div>
          <div class="ca-plate-label">By Responsible<br/>Party</div>
          <div class="ca-plate-note">Open items currently sitting with each party.</div>
        </div>
        <div>
          <div class="ca-ledger-head" style="grid-template-columns:1fr 90px 90px 110px;">
            <span>Party</span><span style="text-align:right;">Open</span><span style="text-align:right;">Overdue</span><span style="text-align:right;">Next Due</span>
          </div>
          ${partyRows.map((r) => `
            <div class="ca-ledger-row" style="grid-template-columns:1fr 90px 90px 110px;cursor:pointer;" onclick="App.goToTasksFiltered({party:'${r.party}'})">
              <span class="ca-party" style="color:${RESPONSIBLE_COLORS[r.party]};"><span class="ca-dot" style="background:${RESPONSIBLE_COLORS[r.party]};"></span>${r.party}</span>
              <span class="ca-num tabular" style="text-align:right;">${r.count}</span>
              <span class="ca-num tabular" style="text-align:right;color:${r.overdue ? 'var(--alert)' : 'var(--ink-mute)'};">${r.overdue || '—'}</span>
              <span class="ca-num tabular" style="text-align:right;color:var(--ink-soft);">${r.next}</span>
            </div>`).join('')}
        </div>
      </div>
    `;
  }

  function renderUrgentRow(t) {
    const od = t.daysOut < 0;
    const label = od ? `${Math.abs(t.daysOut)}d overdue` : (t.daysOut === 0 ? 'Due today' : `in ${t.daysOut}d`);
    return `<div class="ca-ledger-row" style="grid-template-columns:90px 1fr 140px 100px;" onclick="App.openTaskModal(${t.id})">
      <span class="ca-num tabular" style="color:${od ? 'var(--alert)' : 'var(--rust)'};font-size:13px;">${fmtDateShort(t.due_date)}</span>
      <span>
        <span style="font-family:var(--display);font-weight:700;font-size:12.5px;letter-spacing:.03em;text-transform:uppercase;color:var(--ink);">${escapeHtml(t.title)}</span>
        <span style="font-family:var(--serif);font-style:italic;font-size:13px;color:var(--ink-mute);display:block;margin-top:2px;">${t.project ? escapeHtml(t.project.name) + ' · ' : ''}${escapeHtml(label)}</span>
      </span>
      <span style="font-family:var(--titling);font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-soft);">${escapeHtml(t.category)}</span>
      <span style="text-align:right;"><span class="ca-party" style="color:${RESPONSIBLE_COLORS[t.responsible_party]};font-size:10px;">${t.responsible_party}</span></span>
    </div>`;
  }

  // ---------------- Tasks tab ----------------

  function renderTasksTab() {
    const projects = CATask_DB.getProjects();
    const rows = filteredTasks();

    return `
      <div class="ca-filterbar ca-no-print">
        <div class="ca-field">
          <span class="ca-lab">Project</span>
          <select class="ca-select" onchange="App.setFilter('project', this.value)">
            <option value="">All projects</option>
            ${projects.map((p) => `<option value="${p.id}" ${state.filters.project === String(p.id) ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="ca-field">
          <span class="ca-lab">Responsible</span>
          <select class="ca-select" onchange="App.setFilter('party', this.value)">
            <option value="">All parties</option>
            ${RESPONSIBLE_PARTIES.map((p) => `<option value="${p}" ${state.filters.party === p ? 'selected' : ''}>${p}</option>`).join('')}
          </select>
        </div>
        <div class="ca-field">
          <span class="ca-lab">Status</span>
          <select class="ca-select" onchange="App.setFilter('status', this.value)">
            <option value="">All statuses</option>
            ${STATUSES.map((s) => `<option value="${s}" ${state.filters.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        ${state.view === 'category' ? `
        <div class="ca-field">
          <span class="ca-lab">Category</span>
          <select class="ca-select" onchange="App.setFilter('category', this.value)">
            <option value="">All categories</option>
            ${CATEGORIES.map((c) => `<option value="${c}" ${state.filters.category === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>` : ''}
        <div style="flex:1;"></div>
        <div class="ca-seg">
          <button class="${state.view === 'priority' ? 'active' : ''}" onclick="App.setView('priority')">Priority List</button>
          <button class="${state.view === 'category' ? 'active' : ''}" onclick="App.setView('category')">Category List</button>
        </div>
      </div>

      <div class="ca-no-print" style="display:flex;gap:12px;justify-content:flex-end;padding:16px 0 10px;">
        <button class="ca-btn ca-btn-secondary" onclick="App.openModal('exportpdf')">Export PDF</button>
        <button class="ca-btn ca-btn-secondary" onclick="App.openModal('parse')">Parse Email</button>
        <button class="ca-btn ca-btn-primary" onclick="App.openTaskModal(null)">+ New Task</button>
      </div>

      <div class="ca-print-only">
        <h2 style="font-family:var(--serif);font-style:italic;font-size:26px;margin:0 0 4px;">Construction Administration — Task List</h2>
        <div style="font-family:var(--titling);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:20px;">Printed ${fmtDateShort(todayISO())} · ${rows.length} item${rows.length === 1 ? '' : 's'}</div>
      </div>

      ${rows.length ? (state.view === 'priority' ? renderGroupedTasks(rows, groupByPriority) : renderGroupedTasks(rows, groupByCategory)) : renderEmptyTasks()}
    `;
  }

  function groupByPriority(rows) {
    return PRIORITIES.map((p) => ({ key: p, label: p + ' Priority', rows: rows.filter((t) => t.priority === p) })).filter((g) => g.rows.length);
  }

  function groupByCategory(rows) {
    return CATEGORIES.map((c) => ({ key: c, label: c, rows: rows.filter((t) => t.category === c) })).filter((g) => g.rows.length);
  }

  function renderGroupedTasks(rows, grouper) {
    const groups = grouper(rows);
    return groups.map((g) => `
      <div class="ca-group-head">
        <span class="ca-group-title">${escapeHtml(g.label)}</span>
        <span class="ca-group-count">${g.rows.length} item${g.rows.length === 1 ? '' : 's'}</span>
      </div>
      <div class="ca-ledger-head" style="grid-template-columns:32px 90px 1fr 140px 130px 90px;">
        <span></span><span>Due</span><span>Task</span><span>Category</span><span>Party</span><span style="text-align:right;">Status</span>
      </div>
      ${g.rows.sort((a, b) => (a.daysOut ?? 9999) - (b.daysOut ?? 9999)).map((t) => renderTaskRow(t)).join('')}
    `).join('');
  }

  function renderTaskRow(t) {
    const od = t.status !== 'Done' && t.daysOut !== null && t.daysOut < 0;
    const dateColor = t.status === 'Done' ? 'var(--ink-mute)' : (od ? 'var(--alert)' : 'var(--rust)');
    return `<div class="ca-ledger-row" style="grid-template-columns:32px 90px 1fr 140px 130px 90px;">
      <span onclick="event.stopPropagation();App.toggleDone(${t.id},'${t.status}')">
        <button class="ca-check ${t.status === 'Done' ? 'on' : ''}">${t.status === 'Done' ? '✓' : ''}</button>
      </span>
      <span onclick="App.openTaskModal(${t.id})" class="ca-num tabular" style="color:${dateColor};font-size:13px;">${t.due_date ? fmtDateShort(t.due_date) : '—'}</span>
      <span onclick="App.openTaskModal(${t.id})">
        <span style="font-family:var(--display);font-weight:700;font-size:12.5px;letter-spacing:.03em;text-transform:uppercase;color:var(--ink);${t.status === 'Done' ? 'text-decoration:line-through;color:var(--ink-mute);' : ''}">${escapeHtml(t.title)}</span>
        <span style="font-family:var(--serif);font-style:italic;font-size:13px;color:var(--ink-mute);display:block;margin-top:2px;">${t.project ? escapeHtml(t.project.name) + ' · ' : ''}${escapeHtml(t.task_type || 'General')}${t.assigned_name ? ' · ' + escapeHtml(t.assigned_name) : ''}</span>
      </span>
      <span onclick="App.openTaskModal(${t.id})" style="font-family:var(--titling);font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-soft);">${escapeHtml(t.category)}<span style="display:block;margin-top:4px;color:${PRIORITY_COLORS[t.priority]};">${t.priority}</span></span>
      <span onclick="App.openTaskModal(${t.id})" class="ca-party" style="color:${RESPONSIBLE_COLORS[t.responsible_party]};font-size:10.5px;"><span class="ca-dot" style="background:${RESPONSIBLE_COLORS[t.responsible_party]};"></span>${t.responsible_party}</span>
      <span onclick="App.openTaskModal(${t.id})" style="text-align:right;">
        <span class="ca-tag" style="color:${STATUS_COLORS[t.status]};"><span class="ca-dot" style="background:${STATUS_COLORS[t.status]};"></span>${t.status}</span>
      </span>
    </div>`;
  }

  function renderEmptyTasks() {
    return `<div class="ca-empty">
      <img src="assets/house-mark.png" alt="" />
      <div class="ca-empty-msg">Nothing here yet. Add a task, or paste an email and let Claude pull the action items out for you.</div>
    </div>`;
  }

  // ---------------- Projects tab ----------------

  function renderProjectsTab() {
    const projects = CATask_DB.getProjects();
    const tasks = enrichedTasks();
    return `
      <div style="display:flex;justify-content:flex-end;padding:30px 0 10px;">
        <button class="ca-btn ca-btn-primary" onclick="App.openProjectModal(null)">+ New Project</button>
      </div>
      ${projects.length ? `
      <div class="ca-ledger-head" style="grid-template-columns:1fr 90px 110px 90px 90px;">
        <span>Project</span><span>Phase</span><span>Status</span><span style="text-align:right;">Open</span><span style="text-align:right;">Overdue</span>
      </div>
      ${projects.map((p) => {
        const t = tasks.filter((x) => x.project_id === p.id);
        const open = t.filter((x) => x.status !== 'Done').length;
        const od = t.filter((x) => x.status !== 'Done' && x.daysOut !== null && x.daysOut < 0).length;
        return `<div class="ca-ledger-row" style="grid-template-columns:1fr 90px 110px 90px 90px;" onclick="App.openProjectModal(${p.id})">
          <span>
            <span style="font-family:var(--display);font-weight:700;font-size:13px;letter-spacing:.03em;text-transform:uppercase;color:var(--ink);">${escapeHtml(p.name)}</span>
            <span style="font-family:var(--serif);font-style:italic;font-size:13px;color:var(--ink-mute);display:block;margin-top:2px;">${escapeHtml(p.address || '')}</span>
          </span>
          <span class="ca-tag" style="color:var(--rust);">${p.phase}</span>
          <span class="ca-tag" style="color:${p.status === 'Active' ? 'var(--forest)' : (p.status === 'On Hold' ? 'var(--gold)' : 'var(--ink-mute)')};">${p.status}</span>
          <span class="ca-num tabular" style="text-align:right;">${open}</span>
          <span class="ca-num tabular" style="text-align:right;color:${od ? 'var(--alert)' : 'var(--ink-mute)'};">${od || '—'}</span>
        </div>`;
      }).join('')}
      ` : `<div class="ca-empty"><img src="assets/house-mark.png" alt=""/><div class="ca-empty-msg">No projects yet. Add one to start assigning tasks to it.</div></div>`}
    `;
  }

  // ---------------- Settings tab ----------------

  function renderSettingsTab() {
    const s = state.settings;
    return `
      <div class="ca-settings-block" style="padding:30px 0 60px;">
        <div class="ca-sec" style="margin-top:0;">GitHub Sync</div>
        <div class="ca-help">Data is stored as a SQLite file in your GitHub repo. Paste a fine-grained Personal Access Token scoped to this repo with <em>Contents: Read and write</em> permission. The token stays in this browser only — it is never written to a file.</div>
        <div class="ca-row ca-row-2" style="margin-top:16px;">
          <div class="ca-field"><span class="ca-lab">Owner</span><input class="ca-in" value="${escapeAttr(s.ghOwner)}" onchange="App.setSetting('ghOwner', this.value)"></div>
          <div class="ca-field"><span class="ca-lab">Repo</span><input class="ca-in" value="${escapeAttr(s.ghRepo)}" onchange="App.setSetting('ghRepo', this.value)"></div>
          <div class="ca-field"><span class="ca-lab">Branch</span><input class="ca-in" value="${escapeAttr(s.ghBranch)}" onchange="App.setSetting('ghBranch', this.value)"></div>
          <div class="ca-field"><span class="ca-lab">File Path</span><input class="ca-in" value="${escapeAttr(s.ghPath)}" onchange="App.setSetting('ghPath', this.value)"></div>
        </div>
        <div class="ca-field">
          <span class="ca-lab">Personal Access Token</span>
          <input class="ca-in" type="password" placeholder="github_pat_…" value="${escapeAttr(s.ghToken)}" onchange="App.setSetting('ghToken', this.value)">
        </div>
        <div style="display:flex;gap:12px;margin-top:6px;flex-wrap:wrap;">
          <button class="ca-btn ca-btn-secondary" onclick="App.testGitHubConnection()">Test Connection</button>
          <button class="ca-btn ca-btn-secondary" onclick="App.pullFromGitHub()">Pull Latest</button>
          <button class="ca-btn ca-btn-primary" onclick="App.pushToGitHub()">Save to GitHub</button>
        </div>

        <div class="ca-sec">Claude API (Email Parsing)</div>
        <div class="ca-help">Used only when you click "Parse Email" — pastes the email text to Claude's API to extract task, party, category and due date. Create a key at console.anthropic.com. It stays in this browser only.</div>
        <div class="ca-field" style="margin-top:16px;"><span class="ca-lab">API Key</span><input class="ca-in" type="password" placeholder="sk-ant-…" value="${escapeAttr(s.aiKey)}" onchange="App.setSetting('aiKey', this.value)"></div>
        <div class="ca-field"><span class="ca-lab">Model</span><input class="ca-in" value="${escapeAttr(s.aiModel)}" onchange="App.setSetting('aiModel', this.value)"></div>

        <div class="ca-sec">Local Backup</div>
        <div class="ca-help">A safety net independent of GitHub. Your edits are also auto-cached in this browser as you work.</div>
        <div style="display:flex;gap:12px;margin-top:16px;flex-wrap:wrap;align-items:center;">
          <button class="ca-btn ca-btn-secondary" onclick="App.downloadDbFile()">Download tasks.db</button>
          <label class="ca-btn ca-btn-secondary" style="cursor:pointer;">Import tasks.db<input type="file" accept=".db" style="display:none;" onchange="App.importDbFile(this.files[0])"></label>
          <button class="ca-btn ca-btn-cancel" onclick="App.resetLocalCache()">Clear Local Cache</button>
        </div>
        <div class="ca-help" style="margin-top:10px;">Last local save: ${state.lastLocalSaveAt ? timeAgo(state.lastLocalSaveAt) : '—'} · Last GitHub sync: ${state.lastSyncedAt ? timeAgo(state.lastSyncedAt) : 'never'}</div>
      </div>
    `;
  }

  // ---------------- Modals ----------------

  function renderModal() {
    const m = state.modal;
    if (m.type === 'task') return renderTaskModal(m.data);
    if (m.type === 'project') return renderProjectModal(m.data);
    if (m.type === 'parse') return renderParseModal();
    if (m.type === 'parseReview') return renderParseReviewModal(m.data);
    if (m.type === 'exportpdf') return renderExportPdfModal();
    return '';
  }

  function renderTaskModal(data) {
    const editing = !!(data && data.id);
    const t = data || { title: '', description: '', category: 'General', responsible_party: 'Architect', assigned_name: '', priority: 'Medium', status: 'Open', task_type: 'General', due_date: '', notes: '', project_id: '' };
    const projects = CATask_DB.getProjects();
    return `<div class="ca-modal-backdrop" onclick="if(event.target===this)App.closeModal()">
      <div class="ca-modal">
        <div class="ca-modal-head">
          <div class="ca-modal-title">${editing ? 'Edit Task' : 'New Task'}</div>
          <button class="ca-modal-close" onclick="App.closeModal()">×</button>
        </div>
        <div class="ca-modal-body">
          <div class="ca-field"><span class="ca-lab">Title</span><input class="ca-in" id="f-title" value="${escapeAttr(t.title)}" placeholder="e.g. Confirm exterior stone sample"></div>
          <div class="ca-field"><span class="ca-lab">Description</span><textarea class="ca-in" id="f-description" rows="3">${escapeHtml(t.description || '')}</textarea></div>
          <div class="ca-row ca-row-2">
            <div class="ca-field"><span class="ca-lab">Project</span>
              <select class="ca-select" id="f-project">
                <option value="">— None —</option>
                ${projects.map((p) => `<option value="${p.id}" ${String(t.project_id) === String(p.id) ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
              </select>
            </div>
            <div class="ca-field"><span class="ca-lab">Category</span>
              <select class="ca-select" id="f-category">${CATEGORIES.map((c) => `<option ${t.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
            </div>
          </div>
          <div class="ca-row ca-row-3">
            <div class="ca-field"><span class="ca-lab">Type</span>
              <select class="ca-select" id="f-type">${TASK_TYPES.map((c) => `<option ${t.task_type === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
            </div>
            <div class="ca-field"><span class="ca-lab">Priority</span>
              <select class="ca-select" id="f-priority">${PRIORITIES.map((c) => `<option ${t.priority === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
            </div>
            <div class="ca-field"><span class="ca-lab">Status</span>
              <select class="ca-select" id="f-status">${STATUSES.map((c) => `<option ${t.status === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
            </div>
          </div>
          <div class="ca-sec">Responsible Party</div>
          <div class="ca-radio-group" id="f-party-group">
            ${RESPONSIBLE_PARTIES.map((p) => `
              <button type="button" class="ca-radio ${t.responsible_party === p ? 'on' : ''}" data-party="${p}" onclick="App.pickPartyInForm('${p}')">
                <span class="ca-radio-ring"><span class="ca-radio-dot"></span></span>${p}
              </button>`).join('')}
          </div>
          <div class="ca-row ca-row-2" style="margin-top:20px;">
            <div class="ca-field"><span class="ca-lab">Assigned To (optional)</span><input class="ca-in" id="f-assigned" value="${escapeAttr(t.assigned_name || '')}" placeholder="A specific person"></div>
            <div class="ca-field"><span class="ca-lab">Due Date</span><input class="ca-in" type="date" id="f-due" value="${t.due_date || ''}"></div>
          </div>
          <div class="ca-field"><span class="ca-lab">Notes</span><textarea class="ca-in" id="f-notes" rows="2">${escapeHtml(t.notes || '')}</textarea></div>
          ${t.source === 'email' && t.source_text ? `<div class="ca-field"><span class="ca-lab">Source Email</span><div class="ca-banner" style="white-space:pre-wrap;font-size:12.5px;max-height:120px;overflow:auto;">${escapeHtml(t.source_text)}</div></div>` : ''}
        </div>
        <div class="ca-modal-foot">
          <div>${editing ? `<button class="ca-btn ca-btn-cancel" onclick="App.deleteTaskById(${t.id})">Delete</button>` : ''}</div>
          <div style="display:flex;gap:12px;">
            <button class="ca-btn ca-btn-secondary" onclick="App.closeModal()">Cancel</button>
            <button class="ca-btn ca-btn-save" onclick="App.submitTaskForm(${editing ? t.id : 'null'})">Save</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  function pickPartyInForm(party) {
    document.querySelectorAll('#f-party-group .ca-radio').forEach((b) => b.classList.toggle('on', b.dataset.party === party));
  }

  function submitTaskForm(id) {
    const activeParty = document.querySelector('#f-party-group .ca-radio.on');
    const draft = {
      title: document.getElementById('f-title').value.trim() || 'Untitled task',
      description: document.getElementById('f-description').value.trim(),
      project_id: document.getElementById('f-project').value || null,
      category: document.getElementById('f-category').value,
      task_type: document.getElementById('f-type').value,
      priority: document.getElementById('f-priority').value,
      status: document.getElementById('f-status').value,
      responsible_party: activeParty ? activeParty.dataset.party : 'Architect',
      assigned_name: document.getElementById('f-assigned').value.trim(),
      due_date: document.getElementById('f-due').value || null,
      notes: document.getElementById('f-notes').value.trim(),
    };
    if (draft.status === 'Done') draft.completed_date = todayISO();
    saveTaskDraft(draft, id);
    closeModal();
  }

  function renderProjectModal(data) {
    const editing = !!(data && data.id);
    const p = data || { name: '', address: '', phase: 'CA', status: 'Active', owner_name: '', contractor_name: '', interior_designer_name: '' };
    return `<div class="ca-modal-backdrop" onclick="if(event.target===this)App.closeModal()">
      <div class="ca-modal">
        <div class="ca-modal-head">
          <div class="ca-modal-title">${editing ? 'Edit Project' : 'New Project'}</div>
          <button class="ca-modal-close" onclick="App.closeModal()">×</button>
        </div>
        <div class="ca-modal-body">
          <div class="ca-field"><span class="ca-lab">Project Name</span><input class="ca-in" id="p-name" value="${escapeAttr(p.name)}" placeholder="e.g. Davis – Liberty Park"></div>
          <div class="ca-field"><span class="ca-lab">Address</span><input class="ca-in" id="p-address" value="${escapeAttr(p.address || '')}"></div>
          <div class="ca-row ca-row-2">
            <div class="ca-field"><span class="ca-lab">Phase</span><select class="ca-select" id="p-phase">${PROJECT_PHASES.map((ph) => `<option ${p.phase === ph ? 'selected' : ''}>${ph}</option>`).join('')}</select></div>
            <div class="ca-field"><span class="ca-lab">Status</span><select class="ca-select" id="p-status">${PROJECT_STATUSES.map((st) => `<option ${p.status === st ? 'selected' : ''}>${st}</option>`).join('')}</select></div>
          </div>
          <div class="ca-sec">Contacts (optional)</div>
          <div class="ca-row ca-row-3">
            <div class="ca-field"><span class="ca-lab">Owner</span><input class="ca-in" id="p-owner" value="${escapeAttr(p.owner_name || '')}"></div>
            <div class="ca-field"><span class="ca-lab">Contractor</span><input class="ca-in" id="p-contractor" value="${escapeAttr(p.contractor_name || '')}"></div>
            <div class="ca-field"><span class="ca-lab">Interior Designer</span><input class="ca-in" id="p-id" value="${escapeAttr(p.interior_designer_name || '')}"></div>
          </div>
        </div>
        <div class="ca-modal-foot">
          <div>${editing ? `<button class="ca-btn ca-btn-cancel" onclick="App.deleteProjectById(${p.id})">Delete</button>` : ''}</div>
          <div style="display:flex;gap:12px;">
            <button class="ca-btn ca-btn-secondary" onclick="App.closeModal()">Cancel</button>
            <button class="ca-btn ca-btn-save" onclick="App.submitProjectForm(${editing ? p.id : 'null'})">Save</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  function submitProjectForm(id) {
    const draft = {
      name: document.getElementById('p-name').value.trim() || 'Untitled project',
      address: document.getElementById('p-address').value.trim(),
      phase: document.getElementById('p-phase').value,
      status: document.getElementById('p-status').value,
      owner_name: document.getElementById('p-owner').value.trim(),
      contractor_name: document.getElementById('p-contractor').value.trim(),
      interior_designer_name: document.getElementById('p-id').value.trim(),
    };
    saveProjectDraft(draft, id);
    closeModal();
  }

  function renderParseModal() {
    return `<div class="ca-modal-backdrop" onclick="if(event.target===this)App.closeModal()">
      <div class="ca-modal">
        <div class="ca-modal-head">
          <div class="ca-modal-title">Parse Email</div>
          <button class="ca-modal-close" onclick="App.closeModal()">×</button>
        </div>
        <div class="ca-modal-body">
          <div class="ca-help" style="margin-bottom:14px;">Paste the email (or any note) below. Claude will pull out the action items and pre-fill new tasks for you to review before saving.</div>
          ${!state.settings.aiKey ? `<div class="ca-banner warn">No Claude API key set yet — add one in Settings first.</div>` : ''}
          <textarea class="ca-in" id="parse-text" rows="12" placeholder="Paste email text here…"></textarea>
        </div>
        <div class="ca-modal-foot">
          <div></div>
          <div style="display:flex;gap:12px;">
            <button class="ca-btn ca-btn-secondary" onclick="App.closeModal()">Cancel</button>
            <button class="ca-btn ca-btn-primary" id="parse-btn" onclick="App.submitParse()">Parse with Claude</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  async function submitParse() {
    const text = document.getElementById('parse-text').value;
    const btn = document.getElementById('parse-btn');
    btn.disabled = true; btn.textContent = 'Parsing…';
    await runParse(text);
  }

  function renderParseReviewModal(data) {
    const { drafts, index, total } = data;
    const d = drafts[index];
    const projects = CATask_DB.getProjects();
    const matchedProject = projects.find((p) => p.name.toLowerCase() === (d.project_guess || '').toLowerCase());
    return `<div class="ca-modal-backdrop" onclick="if(event.target===this)App.closeModal()">
      <div class="ca-modal">
        <div class="ca-modal-head">
          <div class="ca-modal-title">Review Task ${index + 1} of ${total}</div>
          <button class="ca-modal-close" onclick="App.closeModal()">×</button>
        </div>
        <div class="ca-modal-body">
          <div class="ca-field"><span class="ca-lab">Title</span><input class="ca-in" id="pr-title" value="${escapeAttr(d.title)}"></div>
          <div class="ca-field"><span class="ca-lab">Description</span><textarea class="ca-in" id="pr-description" rows="3">${escapeHtml(d.description)}</textarea></div>
          <div class="ca-row ca-row-2">
            <div class="ca-field"><span class="ca-lab">Project${d.project_guess ? ' (Claude guessed: ' + escapeHtml(d.project_guess) + ')' : ''}</span>
              <select class="ca-select" id="pr-project">
                <option value="">— None —</option>
                ${projects.map((p) => `<option value="${p.id}" ${matchedProject && matchedProject.id === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
              </select>
            </div>
            <div class="ca-field"><span class="ca-lab">Category</span><select class="ca-select" id="pr-category">${CATEGORIES.map((c) => `<option ${d.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          </div>
          <div class="ca-row ca-row-3">
            <div class="ca-field"><span class="ca-lab">Type</span><select class="ca-select" id="pr-type">${TASK_TYPES.map((c) => `<option ${d.task_type === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
            <div class="ca-field"><span class="ca-lab">Priority</span><select class="ca-select" id="pr-priority">${PRIORITIES.map((c) => `<option ${d.priority === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
            <div class="ca-field"><span class="ca-lab">Responsible</span><select class="ca-select" id="pr-party">${RESPONSIBLE_PARTIES.map((c) => `<option ${d.responsible_party === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          </div>
          <div class="ca-row ca-row-2">
            <div class="ca-field"><span class="ca-lab">Assigned To</span><input class="ca-in" id="pr-assigned" value="${escapeAttr(d.assigned_name || '')}"></div>
            <div class="ca-field"><span class="ca-lab">Due Date</span><input class="ca-in" type="date" id="pr-due" value="${d.due_date || ''}"></div>
          </div>
        </div>
        <div class="ca-modal-foot">
          <div><button class="ca-btn ca-btn-secondary" onclick="App.skipParseReview()">Skip This One</button></div>
          <div style="display:flex;gap:12px;">
            <button class="ca-btn ca-btn-secondary" onclick="App.closeModal()">Cancel All</button>
            <button class="ca-btn ca-btn-save" onclick="App.confirmParseReview()">${index === total - 1 ? 'Save & Finish' : 'Save & Next'}</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  function readParseReviewForm() {
    return {
      title: document.getElementById('pr-title').value.trim() || 'Untitled task',
      description: document.getElementById('pr-description').value.trim(),
      project_id: document.getElementById('pr-project').value || null,
      category: document.getElementById('pr-category').value,
      task_type: document.getElementById('pr-type').value,
      priority: document.getElementById('pr-priority').value,
      responsible_party: document.getElementById('pr-party').value,
      assigned_name: document.getElementById('pr-assigned').value.trim(),
      due_date: document.getElementById('pr-due').value || null,
      status: 'Open',
      source: 'email',
      source_text: state.modal.data.drafts[state.modal.data.index].source_text,
    };
  }

  function confirmParseReview() {
    const draft = readParseReviewForm();
    CATask_DB.insertTask(draft);
    advanceParseReview();
  }

  function skipParseReview() { advanceParseReview(); }

  function advanceParseReview() {
    const data = state.modal.data;
    if (data.index + 1 < data.total) {
      state.modal.data = { ...data, index: data.index + 1 };
      afterMutation();
    } else {
      closeModal();
      afterMutation();
      setToast('ok', 'Tasks added from email.');
    }
  }

  function renderExportPdfModal() {
    const projects = CATask_DB.getProjects();
    return `<div class="ca-modal-backdrop" onclick="if(event.target===this)App.closeModal()">
      <div class="ca-modal">
        <div class="ca-modal-head">
          <div class="ca-modal-title">Export PDF</div>
          <button class="ca-modal-close" onclick="App.closeModal()">×</button>
        </div>
        <div class="ca-modal-body">
          <div class="ca-help" style="margin-bottom:14px;">Builds a clean, printable list from the Tasks tab's current filters and view, then opens your browser's print dialog — choose "Save as PDF" there.</div>
          <div class="ca-field"><span class="ca-lab">Scope</span>
            <select class="ca-select" id="pdf-scope">
              <option value="filtered">Current filtered view (${filteredTasks().length} items)</option>
              <option value="open">All open items</option>
              <option value="all">Everything</option>
            </select>
          </div>
        </div>
        <div class="ca-modal-foot">
          <div></div>
          <div style="display:flex;gap:12px;">
            <button class="ca-btn ca-btn-secondary" onclick="App.closeModal()">Cancel</button>
            <button class="ca-btn ca-btn-primary" onclick="App.doExportPdf()">Open Print Dialog</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  function doExportPdf() {
    const scope = document.getElementById('pdf-scope').value;
    let rows = scope === 'filtered' ? filteredTasks() : enrichedTasks();
    if (scope === 'open') rows = rows.filter((t) => t.status !== 'Done');
    closeModal();
    state.tab = 'tasks';
    state.filters = scope === 'filtered' ? state.filters : { project: '', party: '', status: '', category: '' };
    render();
    // give the print stylesheet + freshly rendered rows a tick to paint, then print
    setTimeout(() => window.print(), 150);
  }

  // ---------------- misc helpers ----------------

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function timeAgo(iso) {
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  // ---------------- public API (bound to global App.*) ----------------

  return {
    boot,
    retryBoot: () => { state.bootError = null; boot(); },
    setTab: (id) => { state.tab = id; state.filters = { project: '', party: '', status: '', category: '' }; render(); },
    goToTasksFiltered: (f) => { state.tab = 'tasks'; state.filters = { project: '', party: '', status: '', category: '', ...f }; render(); },
    setFilter: (k, v) => { state.filters[k] = v; render(); },
    setView: (v) => { state.view = v; render(); },
    openModal: (type) => openModal(type, null),
    openTaskModal: (id) => openModal('task', id ? CATask_DB.getTask(id) : null),
    openProjectModal: (id) => openModal('project', id ? CATask_DB.getProject(id) : null),
    closeModal,
    pickPartyInForm,
    submitTaskForm,
    deleteTaskById,
    toggleDone,
    submitProjectForm,
    deleteProjectById,
    submitParse,
    confirmParseReview,
    skipParseReview,
    doExportPdf,
    setSetting: (k, v) => { state.settings[k] = v; saveSettings(); },
    testGitHubConnection,
    pullFromGitHub,
    pushToGitHub,
    downloadDbFile,
    importDbFile,
    resetLocalCache,
  };
})();

document.addEventListener('DOMContentLoaded', () => App.boot());
