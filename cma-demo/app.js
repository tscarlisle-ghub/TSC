/* ============================================================
   CMA Billing Dashboard
   Single-file vanilla JS, no build step.
   Persists to localStorage; syncs to GitHub via Contents API.
   ============================================================ */

'use strict';

// Session 18: single source of truth for the footer "build" stamp — update
// THIS line each session instead of hand-editing the <span class="build-stamp">
// text in index.html. It went stale for six weeks (stuck on 2026-06-30-POC7
// through sessions 13-17) because nothing wired the HTML text to anything;
// now updateSyncStatus() below writes it into the DOM on every render, so
// bumping this one constant is the only step needed.
const BUILD_STAMP = '2026-08-18-PHASEFIX2 (DEMO)';

// DEMO MODE — this is a standalone demo copy loaded with fictional sample
// clients. It must never read or write the real GitHub repo, whatever
// Settings values happen to be sitting in this browser's localStorage.
// Every GitHub-touching path below checks this flag first and no-ops.
const DEMO_MODE = true;

// ---------- Constants ----------
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const PHASE_NAMES = ['DEPOSIT','SD','DD','CD','CA'];
const STORAGE_KEY = 'cma-billing-demo-v1';
const SETTINGS_KEY = 'cma-billing-demo-settings-v1';

// ---------- State ----------
let DATA = null;
let SETTINGS = null;
let SHA = null;          // SHA of data.json on GitHub (for safe updates)
let DIRTY = false;       // unsaved local changes since last GitHub save
let AUTOSAVE_TIMER = null;
let DATA_FILE_MTIME = null;  // Last-Modified of data.json (string), refreshed via HEAD

// ----- Table sorting -----
const SORT_STATE = {
  outstanding: { col: 'daysOut',  dir: 'desc' },
  roster:      { col: 'totalFee', dir: 'desc' },
};

function compareSort(a, b, dir) {
  // null/undefined sort to the end regardless of direction
  if (a == null || a === '') return 1;
  if (b == null || b === '') return -1;
  let cmp;
  if (typeof a === 'string' && typeof b === 'string') cmp = a.localeCompare(b);
  else cmp = (a < b) ? -1 : (a > b) ? 1 : 0;
  return dir === 'asc' ? cmp : -cmp;
}

function updateSortIndicator(thead, state) {
  if (!thead) return;
  thead.querySelectorAll('th[data-sort]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === state.col) th.classList.add('sort-' + state.dir);
  });
}

function wireSortHeaders(theadSel, stateKey, rerenderFn) {
  const thead = document.querySelector(theadSel);
  if (!thead || thead.dataset.sortWired) return;
  thead.dataset.sortWired = '1';
  thead.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const col = th.dataset.sort;
    const state = SORT_STATE[stateKey];
    if (state.col === col) {
      state.dir = state.dir === 'asc' ? 'desc' : 'asc';
    } else {
      state.col = col;
      // Numeric columns default to desc (largest first); text columns default to asc
      state.dir = th.classList.contains('col-num') ? 'desc' : 'asc';
    }
    rerenderFn();
  });
}


// ---------- Utilities ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
// Session 27: `(Math.round(-0.001)).toLocaleString()` renders the string
// "-0" — a tiny negative float (leftover from a subtraction that should
// have landed on exactly zero, e.g. a fully-billed contract) displayed as
// "$-0", which reads as a real math error even though it isn't one. The
// `|| 0` normalizes negative zero to positive zero (`-0 || 0` === `0` in
// JS) before formatting.
const fmt0 = (n) => (n == null || n === '' || isNaN(n)) ? '—' : '$' + (Math.round(n) || 0).toLocaleString('en-US');
const fmt0bare = (n) => (n == null || n === '' || isNaN(n)) ? '0' : (Math.round(n) || 0).toLocaleString('en-US');

// ===== Editorial presentation helpers (build 2026-06-29-EDITORIAL2) =====
const esc = (x) => escapeHtml(x);
const titleCase = (x) => String(x||'').toLowerCase().replace(/\b([a-z])/g,(m,c)=>c.toUpperCase());
const fmtMD = (x) => { const d=new Date(x+'T12:00:00'); return isNaN(d)?x:d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); };
const edDaysOut = (x) => { const d=new Date(x+'T12:00:00'); return isNaN(d)?0:Math.round((Date.now()-d)/86400000); };
const edOverdue = (i) => i.sent && !i.paid && edDaysOut(i.date) > 45;
function edStatusOf(c,s){
  if(c.archived||c.closed_out) return 'done';
  const fee=s.contractFee||0;
  if((c.invoices||[]).some(edOverdue)) return 'alert';
  if(fee>0 && s.allBilled>=fee && (s.allBilled-s.allCollected)<=0) return 'done';
  if(fee===0 && (c.invoices||[]).length===0) return 'prospect';
  return 'active';
}
const edStatusWord = (s) => ({active:'in progress',alert:'past due',done:'paid in full',prospect:'prospect'}[s]||s);
const edDotColor = (s) => ({active:'var(--gold)',alert:'var(--alert)',done:'var(--forest)',prospect:'var(--ink-mute)'}[s]);
const edActiveClients = () => DATA.clients.filter(c => !c.archived);
let ED_EXPANDED_CLIENT = null;
let ED_PAID_TIMERS = {};

// Format a phase percentage for the client-card fields: up to 3 decimals,
// trailing zeros trimmed (e.g. 33.333, 20, 66.667). Stored value stays a
// decimal ratio; this is display/entry only.
function fmtPhasePct(n) {
  if (n == null || isNaN(n) || !isFinite(n)) return '0';
  return (Math.round(n * 1000) / 1000).toString();
}
const pct = (n) => (n == null || isNaN(n)) ? '—' : (n * 100).toFixed(1) + '%';
// Format ISO date "YYYY-MM-DD" as "DD/MM/YYYY" for display.
// Returns "—" for missing dates and falls back to the raw string if it's not a recognizable ISO date.
const fmtDate = (d) => {
  if (!d) return '—';
  const s = String(d);
  // Match ISO-like YYYY-MM-DD or full ISO datetime
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  // Try to parse as a Date and reformat
  const dt = new Date(s);
  if (!isNaN(dt)) {
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    const yyyy = dt.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  }
  return s;
};
// Format an ISO datetime as "MM/DD/YYYY h:mm AM/PM"
const fmtDateTime = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  const tz = 'America/Chicago';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, month: '2-digit', day: '2-digit', year: 'numeric',
    hour: 'numeric', minute: '2-digit'
  }).formatToParts(dt);
  const get = (type) => (parts.find(p => p.type === type) || {}).value || '';
  return `${get('month')}/${get('day')}/${get('year')} ${get('hour')}:${get('minute')} ${get('dayPeriod')}`;
};
const uuid = () => Math.random().toString(36).slice(2, 10);
const nowIso = () => new Date().toISOString();
const sum = (arr, fn = (x) => x) => arr.reduce((a, b) => a + (fn(b) || 0), 0);

// =====================================================================
// CURRENCY INPUT — formatted dollar text fields with thousands separators
// =====================================================================
// Display-only formatting; stored value is parsed as a plain number.
// Reads/writes the raw number through a uniform API:
//   currencyVal(input)          -> Number   (read parsed value)
//   setCurrencyVal(input, n)    -> void     (set value, formatted)
//   wireCurrencyInput(input)    -> void     (attach formatting handlers)
//   wireAllCurrencyInputs()     -> void     (rescans the DOM and wires any unwired)

// Parse a formatted string like "$190,000" or "190,000" into a Number, or NaN
function parseCurrency(str) {
  if (str == null) return NaN;
  const cleaned = String(str).replace(/[^\d.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return NaN;
  return parseFloat(cleaned);
}
// Format a Number as "$190,000" (no cents, with $ prefix and commas)
function formatCurrencyDisplay(n) {
  const num = (typeof n === 'number') ? n : parseCurrency(n);
  if (isNaN(num)) return '';
  return '$' + Math.round(num).toLocaleString('en-US');
}
// Read parsed numeric value from a currency-styled <input>
function currencyVal(input) {
  if (!input) return 0;
  const n = parseCurrency(input.value);
  return isNaN(n) ? 0 : n;
}
// Set the formatted value on a currency input
function setCurrencyVal(input, n) {
  if (!input) return;
  if (n == null || n === '' || isNaN(n) || Number(n) === 0) {
    input.value = '';
  } else {
    input.value = formatCurrencyDisplay(n);
  }
}
// Wire one currency input — formats on blur, accepts loose typing while focused
function wireCurrencyInput(input) {
  if (!input || input.dataset.currencyWired === '1') return;
  input.dataset.currencyWired = '1';
  input.setAttribute('inputmode', 'numeric');
  input.setAttribute('autocomplete', 'off');

  // Format the initial value once (in case it was set programmatically)
  if (input.value && !input.value.startsWith('$')) {
    const n = parseCurrency(input.value);
    if (!isNaN(n)) input.value = formatCurrencyDisplay(n);
  }

  // While typing — strip non-numeric characters but DON'T add the $/commas yet
  // (that would jump the cursor around). Format only on blur.
  input.addEventListener('focus', () => {
    // When focused, switch to comma-only (no $) so the cursor behaves naturally.
    const n = parseCurrency(input.value);
    input.value = isNaN(n) ? '' : Math.round(n).toLocaleString('en-US');
    // Select all on focus for easy overwrite
    setTimeout(() => input.select(), 0);
  });
  input.addEventListener('input', () => {
    // Re-format with commas live as they type, preserving cursor position
    const oldVal = input.value;
    const oldPos = input.selectionStart;
    const cleaned = oldVal.replace(/[^\d]/g, '');
    if (cleaned === '') { input.value = ''; return; }
    const formatted = parseInt(cleaned, 10).toLocaleString('en-US');
    input.value = formatted;
    // Try to keep the cursor in roughly the same spot
    const diff = formatted.length - oldVal.length;
    const newPos = Math.max(0, Math.min(formatted.length, oldPos + diff));
    try { input.setSelectionRange(newPos, newPos); } catch (_) {}
  });
  input.addEventListener('blur', () => {
    const n = parseCurrency(input.value);
    input.value = isNaN(n) ? '' : formatCurrencyDisplay(n);
  });
}
// Find and wire all elements with class "currency-input"
function wireAllCurrencyInputs() {
  document.querySelectorAll('input.currency-input').forEach(wireCurrencyInput);
}

function toast(msg, type) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ' ' + type : '');
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 3500);
}

// b64 helpers (UTF-8 safe)
function b64encode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64decode(b64) {
  return decodeURIComponent(escape(atob(b64.replace(/\s/g, ''))));
}

// ---------- Initial load ----------
async function init() {
  loadSettings();
  await loadData();
  refreshDataFileMtime();  // capture data.json file mtime for the header timestamp
  migrateData();
  // Modals must be direct children of <body> so they aren't hidden when their
  // tab-pane parent is display:none. Without this, clicking from the Overview
  // tab would silently fail to display the editor.
  ['clientEditor', 'invoiceEditor'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.parentElement !== document.body) {
      document.body.appendChild(el);
    }
  });
  bindUi();
  wireAllCurrencyInputs();
  renderAll();
  updateSyncStatus();
}

function loadSettings() {
  try {
    SETTINGS = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch { SETTINGS = {}; }
  // Fiscal year always defaults to the current calendar year on each load.
  // The Settings page lets you override it temporarily (e.g., to look at past invoices),
  // but the override doesn't persist across sessions — next load will snap back to now.
  SETTINGS.fiscal_year = new Date().getFullYear();
  SETTINGS.branch = SETTINGS.branch || 'main';
  SETTINGS.path = SETTINGS.path || 'data.json';
}
function saveSettings() {
  // Don't persist fiscal_year — it's session-only so each new session starts on the current year.
  const toSave = { ...SETTINGS };
  delete toSave.fiscal_year;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(toSave));
}


// ---------------------------------------------------------------
// File mtime tracking — keeps the timestamp under the version label
// in sync with the actual data.json file modification time, even when
// the file is changed outside the dashboard (e.g., a script edit).
// Uses a HEAD request and reads the Last-Modified response header.
// ---------------------------------------------------------------
async function refreshDataFileMtime() {
  try {
    const path = (SETTINGS && SETTINGS.path) || 'data.json';
    const res = await fetch(path, { method: 'HEAD', cache: 'no-store' });
    if (res.ok) {
      const lm = res.headers.get('Last-Modified') || res.headers.get('last-modified');
      if (lm) {
        DATA_FILE_MTIME = lm;
        try { updateSyncStatus(); } catch (e) { /* ignore */ }
      }
    }
  } catch (e) { /* file:// loads or CORS may block HEAD — silently fall back */ }
}

// Re-check on tab focus so reopening the dashboard after editing the file shows fresh mtime
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshDataFileMtime();
  });
}

async function loadData() {
  // 1. If GitHub is configured, try to load from there first.
  //    This ensures opening the dashboard on a new device gets the latest.
  //    DEMO_MODE always skips this — this copy never talks to GitHub.
  if (!DEMO_MODE && SETTINGS.token && SETTINGS.owner && SETTINGS.repo) {
    try {
      const json = await gh('GET', ghContentsUrl());
      const text = b64decode(json.content);
      DATA = JSON.parse(text);
      SHA = json.sha;
      DIRTY = false;
      saveLocal();  // cache for offline / refresh
      return;
    } catch (e) {
      console.warn('GitHub load failed, falling back to local cache:', e.message);
      // Fall through to localStorage cache
    }
  }
  // 2. localStorage cache (offline, GitHub failed, or GitHub not configured yet)
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      DATA = JSON.parse(raw);
      return;
    } catch (e) { console.warn('localStorage parse failed', e); }
  }
  // 3. Initial seed from bundled data.json
  try {
    const res = await fetch('data.json', { cache: 'no-store' });
    if (res.ok) {
      const lm = res.headers.get('Last-Modified') || res.headers.get('last-modified');
      if (lm) DATA_FILE_MTIME = lm;
      DATA = await res.json();
      saveLocal();
      return;
    }
  } catch (e) { /* no remote data file */ }
  // 4. Empty state
  DATA = newEmptyData();
  saveLocal();
}

function newEmptyData() {
  return {
    version: '1.0',
    updated_at: nowIso(),
    fiscal_year: new Date().getFullYear(),
    clients: [],
    invoice_counter: 1,
    firm: defaultFirm()
  };
}

function saveLocal() {
  DATA.updated_at = nowIso();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(DATA));
}

// Build O: re-migrate legacy fee_basis into the new fee_type / fee_estimate /
// estimate_revisions model with proper baseline. One-time per data file.
function migrateFeeBasisToBuildO() {
  if (DATA._build_O_migration) return;
  for (const c of DATA.clients) {
    const fb = c.fee_basis;
    if (!fb) continue;
    const pctRaw = fb.percentage;
    const isPctClient = (typeof pctRaw === 'number' && pctRaw > 0);
    const sf = parseFloat(fb.starting_fee) || 0;
    const cf = parseFloat(fb.current_fee)  || 0;
    const sb = parseFloat(fb.starting_budget) || 0;
    const ce = parseFloat(fb.current_estimate) || 0;
    if (isPctClient && (sb > 0 || ce > 0)) {
      // Genuine percentage client with usable construction-estimate data.
      c.fee_type = 'percentage';
      c.fee_percentage = pctRaw * 100;
      c.fee_estimate = sb > 0 ? sb : ce;
      c.original_estimate = c.fee_estimate;
      c.original_fee = sf > 0 ? sf : (c.fee_estimate * pctRaw);
      if (!Array.isArray(c.estimate_revisions)) c.estimate_revisions = [];
      if (c.estimate_revisions.length === 0 && cf > 0 && sf > 0 && cf > sf + 1) {
        const impliedEst = cf / pctRaw;
        c.estimate_revisions.push({ id: uuid(), estimate: Math.round(impliedEst), date: '' });
        c.revised_estimate = Math.round(impliedEst);
      }
    } else if (isPctClient) {
      // Percentage flagged but no usable estimate — treat as fixed.
      // Priority for fee_fixed_amount: starting_fee (explicit contract) >
      // total_fee_2026 (Scott-edited) > current_fee (legacy).
      c.fee_type = 'fixed';
      const tf = parseFloat(c.total_fee_2026) || 0;
      const ff = sf > 0 ? sf : (tf > 0 ? tf : cf);
      c.fee_fixed_amount = ff;
      c.original_fee = ff;
      c.original_estimate = 0;
      c.fee_estimate = 0;
      c.fee_percentage = 0;
    } else {
      c.fee_type = 'fixed';
      const ff = sf > 0 ? sf : (cf > 0 ? cf : (parseFloat(c.total_fee_2026) || 0));
      c.fee_fixed_amount = ff;
      c.original_fee = ff;
      c.original_estimate = 0;
      c.fee_estimate = 0;
      c.fee_percentage = 0;
    }
    if (!c.original_phases) c.original_phases = { ...(c.phases || { DEPOSIT: 0.05, SD: 0.20, DD: 0.20, CD: 0.50, CA: 0.05 }) };
    if (!c.original_set_at) c.original_set_at = '';
  }
  DATA._build_O_migration = true;
  console.log('[Build O] fee_basis re-migration applied to', DATA.clients.length, 'clients');
}

// Ensure all clients have the new fields (called after load)
function migrateData() {
  migrateFeeBasisToBuildO();
  // Normalize version to "X.Y" string form
  if (typeof DATA.version === 'number' || !DATA.version) {
    DATA.version = '1.0';
  }
  if (!DATA.invoice_counter) DATA.invoice_counter = computeNextInvoiceNumber();
  if (!DATA.firm) DATA.firm = defaultFirm();
  for (const c of DATA.clients) {
    if (!('address' in c)) c.address = '';
    if (!('phone' in c)) c.phone = '';
    if (!('email' in c)) c.email = '';
    if (!('project_address' in c)) c.project_address = '';
    // 2026-05-07 fix: use null/undefined check, not `'key' in c`. Previously a
    // saved data file with `fee_type: null` (Davis-Winfield, etc.) would skip
    // the migration and leave the client unable to compute a fee.
    if (c.fee_type == null) {
      // Infer fee type from existing data
      const fb = c.fee_basis || {};
      const computed_pct_fee = (fb.percentage || 0) * (fb.current_estimate || 0);
      // If the fee_basis percentage * estimate is meaningful, this is likely a
      // percentage-based contract. Otherwise treat as fixed using total_fee_2026.
      if (fb.percentage && fb.current_estimate && computed_pct_fee > 0) {
        c.fee_type = 'percentage';
      } else {
        c.fee_type = 'fixed';
      }
    }
    if (c.fee_fixed_amount == null) {
      c.fee_fixed_amount = c.total_fee_2026 || (c.fee_basis && c.fee_basis.current_fee) || 0;
    }
    if (c.fee_percentage == null) c.fee_percentage = ((c.fee_basis && c.fee_basis.percentage) || 0) * 100;
    if (c.fee_estimate == null) c.fee_estimate = (c.fee_basis && c.fee_basis.current_estimate) || 0;
    if (c.fee_tier1_pct == null) c.fee_tier1_pct = 0;
    if (c.fee_tier_threshold == null) c.fee_tier_threshold = 0;
    if (c.fee_tier2_pct == null) c.fee_tier2_pct = 0;
    // is_phased: re-derive from fee_basis if null. Most CMA contracts are phased.
    if (c.is_phased == null) {
      // Default to phased if there's any phase weight set, else true (CMA convention)
      const ph = c.phases || {};
      const phaseSum = ['DEPOSIT','SD','DD','CD','CA'].reduce((s,p) => s + (parseFloat(ph[p]) || 0), 0);
      c.is_phased = phaseSum > 0.5;  // any meaningful phase config means phased
    }

    // Original fee tracking — for fee revisions
    // 2026-05-07 fix: handle null/0 (Davis-Winfield, etc.) — `'key' in c` is
    // true even when original_fee=null, so the previous check skipped clients
    // who had a null on disk. Re-derive from the now-migrated fee fields.
    if (c.original_fee == null || c.original_fee === 0) {
      c.original_fee = computeClientFee(c) || 0;
    }
    if (!('current_fee' in c)) {
      c.current_fee = computeClientFee(c) || 0;
    }
    if (!('closed_out' in c)) c.closed_out = false;
    if (!('original_estimate' in c)) {
      c.original_estimate = c.fee_estimate || 0;
    }
    if (!('original_phases' in c)) {
      c.original_phases = { ...(c.phases || { DEPOSIT: 0.05, SD: 0.20, DD: 0.20, CD: 0.50, CA: 0.05 }) };
    }
    if (!('original_set_at' in c)) c.original_set_at = '';

    // Phase locks: per-phase frozen dollar amount once a phase is marked complete.
    // Future fee changes leave locked phases unchanged and redistribute across the rest.
    if (!('phase_locks' in c)) {
      c.phase_locks = { DEPOSIT: {locked:false, amount:0, locked_at:''},
                        SD:      {locked:false, amount:0, locked_at:''},
                        DD:      {locked:false, amount:0, locked_at:''},
                        CD:      {locked:false, amount:0, locked_at:''},
                        CA:      {locked:false, amount:0, locked_at:''} };
    } else {
      for (const p of ['DEPOSIT','SD','DD','CD','CA']) {
        if (!c.phase_locks[p]) c.phase_locks[p] = {locked:false, amount:0, locked_at:''};
      }
    }

    if (!c.invoices) c.invoices = [];
    // Ensure each invoice has fields
    c.invoices.forEach(inv => {
      if (!inv.id) inv.id = uuid();
      if (!('number' in inv)) inv.number = '';
      if (!('phase_progress' in inv)) inv.phase_progress = null;
      if (!('reimbursable' in inv)) inv.reimbursable = 0;
      if (!('outstanding_prior' in inv)) inv.outstanding_prior = 0;
    });

    // Auto-lock any phase already billed to 100% in past invoices, if not yet locked.
    // Estimate the locked dollar amount using original_fee*original_phases[p] when
    // available, else current computed fee*current phases[p].
    try {
      const __pp = (typeof priorPhaseProgress === 'function') ? priorPhaseProgress(c) : null;
      if (__pp) {
        const __origFee = parseFloat(c.original_fee) || 0;
        const __origPhases = c.original_phases || c.phases || {};
        const __curFee = (typeof computeClientFee === 'function') ? (computeClientFee(c) || 0) : 0;
        const __curPhases = c.phases || {};
        let __locksChanged = false;
        for (const p of ['DEPOSIT','SD','DD','CD','CA']) {
          if ((__pp[p] || 0) >= 100 && !c.phase_locks[p].locked) {
            const amt = __origFee > 0
              ? __origFee * (__origPhases[p] || __curPhases[p] || 0)
              : __curFee  * (__curPhases[p]  || 0);
            c.phase_locks[p] = { locked: true, amount: Math.round(amt), locked_at: c.original_set_at || '' };
            __locksChanged = true;
          }
        }
        // 2026-05-07 fix: persist auto-locked phases on disk. Previously this
        // ran every load but mutations were never saved, so phase_locks on disk
        // always lagged what runtime computed. Mark dirty so the next save
        // captures the locks. (Safe: only fires when a lock was actually added.)
        if (__locksChanged && typeof DIRTY !== 'undefined') {
          DIRTY = true;
        }
      }
    } catch (e) { /* migration is best-effort; never block load */ }
  }
}

function defaultFirm() {
  return {
    name: 'Carlisle Moore Architects',
    principal1_name: 'T Scott Carlisle',
    principal1_phone: '(205) 587-4868',
    principal2_name: 'Bill Moore',
    principal2_phone: '(205) 966-2554',
    address_line1: '2814 Petticoat Lane, 2nd Floor',
    address_line2: 'Mountain Brook, AL 35223',
    bank_name: 'Oakworth Capital Bank',
    bank_routing: '000000000',
    bank_account: '0000000000',
    beneficiary: 'Carlisle Moore Architects, Inc.',
    website: 'carlislemoorearchitects.com',
  };
}

function computeNextInvoiceNumber() {
  let max = 0;
  if (DATA && DATA.clients) {
    for (const c of DATA.clients) {
      for (const inv of (c.invoices || [])) {
        const n = parseInt(inv.number, 10);
        if (!isNaN(n) && n > max) max = n;
      }
    }
  }
  return max + 1;
}

function nextInvoiceNumber() {
  const n = DATA.invoice_counter || computeNextInvoiceNumber();
  return n;
}

// Format a counter integer as "YY-NNN" using the current year (e.g. 421 in 2026 -> "26-421")
function formatInvoiceNumber(counter, year) {
  const yy = String((year ?? new Date().getFullYear())).slice(-2);
  return `${yy}-${counter}`;
}

function consumeInvoiceNumber(year) {
  const n = nextInvoiceNumber();
  DATA.invoice_counter = n + 1;
  return formatInvoiceNumber(n, year);
}

// Compute the total fee for a client based on its fee_type
function computeClientFee(client) {
  if (!client) return 0;
  const t = client.fee_type || 'fixed';
  if (t === 'fixed') {
    return parseFloat(client.fee_fixed_amount) || 0;
  }
  if (t === 'percentage') {
    const est = parseFloat(client.fee_estimate) || 0;
    const pct = parseFloat(client.fee_percentage) || 0;
    return est * (pct / 100);
  }
  if (t === 'tiered_percentage') {
    const est = parseFloat(client.fee_estimate) || 0;
    const t1 = parseFloat(client.fee_tier1_pct) || 0;
    const thr = parseFloat(client.fee_tier_threshold) || 0;
    const t2 = parseFloat(client.fee_tier2_pct) || 0;
    if (est <= thr || thr <= 0) {
      return est * (t1 / 100);
    }
    return thr * (t1 / 100) + (est - thr) * (t2 / 100);
  }
  return 0;
}

// Current contract fee, honoring the latest estimate/fee revision when present.
// For percentage / tiered clients with estimate_revisions, returns latest
// revision's estimate × the configured percentage(s).
// 2026-05-07: For fixed-fee clients, the latest revision's `estimate` field is
// interpreted as the new fee directly (revision = fee revision for fixed-fee).
function currentClientFee(client) {
  if (!client) return 0;
  const ft = client.fee_type || 'fixed';
  const revs = Array.isArray(client.estimate_revisions) ? client.estimate_revisions : [];
  if (ft === 'fixed') {
    if (revs.length > 0) {
      const latestFee = parseFloat(revs[revs.length - 1].estimate) || 0;
      if (latestFee > 0) return latestFee;
    }
    return parseFloat(client.fee_fixed_amount) || 0;
  }
  if (revs.length > 0) {
    const latestEst = parseFloat(revs[revs.length - 1].estimate) || 0;
    if (latestEst > 0) {
      const tempC = Object.assign({}, client, { fee_estimate: latestEst });
      return computeClientFee(tempC) || 0;
    }
  }
  return computeClientFee(client) || 0;
}

// Describe fee in plain language for display
function describeFee(client) {
  if (!client) return '';
  const t = client.fee_type || 'fixed';
  if (t === 'fixed') return `Fixed fee · ${fmt0(computeClientFee(client))}`;
  if (t === 'percentage') {
    const pct = parseFloat(client.fee_percentage) || 0;
    return `${pct.toFixed(2)}% of construction · ${fmt0(computeClientFee(client))}`;
  }
  if (t === 'tiered_percentage') {
    const t1 = parseFloat(client.fee_tier1_pct) || 0;
    const t2 = parseFloat(client.fee_tier2_pct) || 0;
    const thr = parseFloat(client.fee_tier_threshold) || 0;
    return `${t1}% up to ${fmt0(thr)}, then ${t2}% · ${fmt0(computeClientFee(client))}`;
  }
  return '';
}

// Idle-save: when the user changes something, schedule a single save 90s after
// their last change. If they keep changing things, the timer resets. After 90s
// of quiet, save once. Don't reschedule until something else changes — so we
// don't keep hitting GitHub if the user just keeps clicking around.
const IDLE_SAVE_DELAY_MS = 90000;
let AUTOSAVE_PENDING = false;     // true between markDirty() and the actual save firing

function markDirty() {
  DIRTY = true;
  bumpVersion();
  saveLocal();
  updateSyncStatus();

  // Schedule (or reschedule) the idle save if GitHub is configured.
  // DEMO_MODE never schedules this — changes stay local to the browser.
  if (!DEMO_MODE && SETTINGS.token && SETTINGS.owner && SETTINGS.repo) {
    if (AUTOSAVE_TIMER) clearTimeout(AUTOSAVE_TIMER);
    AUTOSAVE_PENDING = true;
    AUTOSAVE_TIMER = setTimeout(() => {
      AUTOSAVE_TIMER = null;
      AUTOSAVE_PENDING = false;
      // Only save if still dirty (a manual save during the wait would have cleared DIRTY)
      if (DIRTY) saveToGithub(true);
    }, IDLE_SAVE_DELAY_MS);
  }
}

// Bump version on every change: 1.4 -> 1.41 -> 1.42 -> ...
// Single-digit minors (legacy) are multiplied by 10 on first bump.
function bumpVersion() {
  const cur = String(DATA.version || '1.0');
  const m = cur.match(/^(\d+)\.(\d+)$/);
  let major = 1, minor = 0;
  if (m) {
    major = parseInt(m[1], 10);
    minor = parseInt(m[2], 10);
    if (minor < 10) minor = minor * 10; // transition 1.4 → 1.41
    minor += 1;
  } else {
    minor = 1;
  }
  DATA.version = `${major}.${minor}`;
}

function updateSyncStatus() {
  const el = $('#syncStatus');
  if (!SETTINGS.token || !SETTINGS.owner || !SETTINGS.repo) {
    el.textContent = 'local only';
    el.className = 'sync-status';
  } else if (DIRTY && AUTOSAVE_PENDING) {
    el.textContent = 'will save soon';
    el.className = 'sync-status dirty';
  } else if (DIRTY) {
    el.textContent = 'unsaved changes';
    el.className = 'sync-status dirty';
  } else {
    el.textContent = 'synced with GitHub';
    el.className = 'sync-status synced';
  }
  // Top status row — version + sync state
  // Display version with at least 2 digits after the decimal (1.4 → v1.40)
  const _vraw = String(DATA.version || '');
  const _vparts = _vraw.split('.');
  const _vminor = _vparts[1] || '0';
  const _vdisp = _vraw ? `v${_vparts[0]}.${_vminor.length < 2 ? _vminor.padEnd(2, '0') : _vminor}` : '';
  const v = _vdisp;
  const versionEl = $('#versionLabel');
  if (versionEl) versionEl.textContent = v || '—';

  // Footer build stamp — driven by the BUILD_STAMP constant at the top of
  // this file so it can't go stale independent of the code the way the old
  // hardcoded HTML text did.
  const buildStampEl = document.querySelector('.build-stamp');
  if (buildStampEl) buildStampEl.textContent = 'build ' + BUILD_STAMP;

  // Caption beneath Save button — date + time of last save
  const captionEl = $('#lastSaved');
  if (captionEl) {
    if (DATA.updated_at) {
      captionEl.textContent = `Last saved ${fmtDateTime(DATA.updated_at)}`;
    } else {
      captionEl.textContent = 'Never saved';
    }
  }
  // Date + time of last system update, shown directly under the version label.
  // Prefer the actual data.json file modification time (HEAD Last-Modified) when
  // available, since the user wants this stamp to track when the file was changed
  // — even if changes happened outside the dashboard. Fall back to DATA.updated_at.
  const updateEl = $('#lastUpdate');
  if (updateEl) {
    let stamp = '';
    if (DATA_FILE_MTIME) {
      try { stamp = fmtDateTime(DATA_FILE_MTIME); } catch(e) { stamp = ''; }
    }
    if (!stamp && DATA.updated_at) stamp = fmtDateTime(DATA.updated_at);
    updateEl.textContent = stamp || '—';
  }
  const _fyv = $('#fyValue'); if (_fyv) _fyv.textContent = SETTINGS.fiscal_year;
  const _ovy = $('#overviewYear'); if (_ovy) _ovy.textContent = SETTINGS.fiscal_year;
  // Session 11: any element marked .dyn-fy inherits the current fiscal year
  // (e.g. "Total {year} Fee" labels on the roster column header + Fee Summary card).
  document.querySelectorAll('.dyn-fy').forEach(el => {
    el.textContent = SETTINGS.fiscal_year;
  });
}

// ===============================================================
// CALCULATIONS
// ===============================================================

// All invoices for a given fiscal year (calendar year)
function invoicesInYear(client, year) {
  return (client.invoices || []).filter(inv => {
    if (!inv.date) return false;
    return new Date(inv.date).getUTCFullYear() === year;
  });
}

// All "billing events" for a year — combines real invoices with monthly_planned entries
// that have been marked as sent. The monthly_planned array doubles as both the plan
// AND the record of which months had invoices sent (matching the original spreadsheet).
function billingEventsInYear(client, year) {
  const events = [];
  // Synthetic deposit event when the user has marked the deposit as paid.
  if (client.deposit_paid && client.deposit_paid_at) {
    const dpY = new Date(client.deposit_paid_at + 'T12:00:00').getUTCFullYear();
    if (dpY === year) {
      const dpAmt = parseFloat(client.deposit_paid_amount) || 0;
      events.push({
        kind: 'deposit', id: 'deposit-' + client.id, date: client.deposit_paid_at,
        month: new Date(client.deposit_paid_at + 'T12:00:00').getUTCMonth(),
        amount: dpAmt, sent: true, paid: true,
        note: 'Deposit (received outside of invoicing)'
      });
    }
  }
  // Real invoices (with full date)
  (client.invoices || []).forEach(inv => {
    if (!inv.date) return;
    if (new Date(inv.date).getUTCFullYear() === year) {
      events.push({
        kind: 'invoice', id: inv.id, date: inv.date,
        month: new Date(inv.date).getUTCMonth(),
        amount: inv.amount || 0, sent: !!inv.sent, paid: !!inv.paid,
        note: inv.note || ''
      });
    }
  });
  // Planned monthly entries that have been marked sent (they're effectively invoices)
  if (year === 2026) {  // monthly_planned_2026 is year-specific
    (client.monthly_planned_2026 || []).forEach(m => {
      if (m.sent) {
        const idx = MONTHS.indexOf(m.month);
        events.push({
          kind: 'planned', id: 'plan-' + m.month, date: `${year}-${String(idx + 1).padStart(2, '0')}-01`,
          month: idx, amount: m.amount || 0, sent: !!m.sent, paid: !!m.paid,
          note: '(from monthly plan)'
        });
      }
    });
  }
  return events;
}

// Build P: year fee is currentClientFee minus invoices billed in prior years,
// clamped at 0. (Scott: "the 2026 fee should equal the fee amount shown under
// fee type minus any invoices from prior years.") No legacy fallback — the
// formula is the source of truth.
function clientYearFee(client, year) {
  if (!client) return 0;
  // Session 9: closed-out and archived jobs contribute 0 to fee totals
  if (client.closed_out || client.archived) return 0;
  const billedPrior = (client.invoices || []).reduce((s, inv) => {
    if (!inv.sent || !inv.date) return s;
    const y = new Date(inv.date + 'T12:00:00').getUTCFullYear();
    return (y < year) ? s + (parseFloat(inv.amount) || 0) : s;
  }, 0);
  const cur = (typeof currentClientFee === 'function')
    ? (currentClientFee(client) || 0)
    : (computeClientFee(client) || 0);
  return Math.max(0, cur - billedPrior);
}

function setClientYearFee(client, year, value) {
  client[`total_fee_${year}`] = (typeof value === 'string') ? (parseCurrency(value) || 0) : (parseFloat(value) || 0);
}

// Proof-of-Concept credit: an amount received as a PoC, credited toward the
// deposit phase and counted as billed+collected. Capped against the deposit
// (phased) or the full fee (non-phased) AND against any deposit_paid already
// recorded, so PoC + deposit_paid can never exceed the deposit / double-count.
function pocCreditFor(client) {
  if (!client) return 0;
  const amt = parseFloat(client.poc_amount) || 0;
  if (amt <= 0) return 0;
  const phases = client.phases || {};
  const depW = parseFloat(phases.DEPOSIT) || 0;
  const fee = (typeof currentClientFee === 'function') ? (currentClientFee(client) || 0) : (computeClientFee(client) || 0);
  const capBase = (client.is_phased && depW > 0) ? (fee * depW) : fee;
  const depPaid = client.deposit_paid ? (parseFloat(client.deposit_paid_amount) || 0) : 0;
  const room = Math.max(0, capBase - depPaid);
  return Math.max(0, Math.min(amt, room));
}

function clientStats(client, year) {
  // YTD billed/collected/outstanding are sourced from client.invoices ONLY,
  // filtered to the current fiscal year. monthly_planned_2026 entries are
  // *plans*, not billing records — they must not inflate Billed/Collected on
  // the roster (Session 11 fix: the planned-as-record pattern was double-
  // counting any month that had both a planned entry and a real invoice).
  // The deposit, when marked paid-outside-of-invoicing, is still counted.
  const invs = (client.invoices || []).filter(inv => {
    if (!inv.date) return false;
    return new Date(inv.date + 'T12:00:00').getUTCFullYear() === year;
  });
  let yearBilled    = sum(invs.filter(i => i.sent), i => parseFloat(i.amount) || 0);
  let yearCollected = sum(invs.filter(i => i.paid), i => parseFloat(i.amount) || 0);
  let yearOutstanding = sum(invs.filter(i => i.sent && !i.paid), i => parseFloat(i.amount) || 0);
  if (client.deposit_paid && client.deposit_paid_at) {
    const dpY = new Date(client.deposit_paid_at + 'T12:00:00').getUTCFullYear();
    if (dpY === year) {
      const dpAmt = parseFloat(client.deposit_paid_amount) || 0;
      yearBilled    += dpAmt;
      yearCollected += dpAmt;
    }
  }
  const _pocCredit = pocCreditFor(client);
  if (_pocCredit > 0) {
    const _pocY = client.poc_at ? new Date(client.poc_at + 'T12:00:00').getUTCFullYear() : year;
    if (_pocY === year) { yearBilled += _pocCredit; yearCollected += _pocCredit; }
  }

  // Contract-level totals (all years, all invoices). These are what the
  // user reads as "the truth" on the overview — closing the gap between the
  // roster and the client detail panel.
  const allInvs = client.invoices || [];
  let allBilled    = sum(allInvs.filter(i => i.sent), i => parseFloat(i.amount) || 0);
  let allCollected = sum(allInvs.filter(i => i.paid), i => parseFloat(i.amount) || 0);
  if (client.deposit_paid) {
    const dpAmt = parseFloat(client.deposit_paid_amount) || 0;
    allBilled    += dpAmt;
    allCollected += dpAmt;
  }
  if (_pocCredit > 0) { allBilled += _pocCredit; allCollected += _pocCredit; }

  // Closed-out / archived jobs contribute 0 to fee totals (Session 9).
  const contractFee = (client.closed_out || client.archived)
    ? 0
    : (currentClientFee(client) || 0);
  const contractRemaining = Math.max(0, contractFee - allBilled);

  // Year-scoped fee retained for any caller that still wants it.
  const yearFee = clientYearFee(client, year);
  const planned = sum(client.monthly_planned_2026 || [], m => m.amount);

  return {
    // New canonical fields
    contractFee,
    contractRemaining,
    yearBilled,
    yearCollected,
    yearOutstanding,
    allBilled,
    allCollected,
    yearFee,
    planned,
    // Backward-compatible aliases. Scope per the column on the overview:
    //   totalFee   → YEAR fee (Total {year} Fee)
    //   billed     → YTD (year invoices only)
    //   collected  → YTD
    //   outstanding→ YTD
    //   remaining  → CONTRACT (cross-year escape hatch)
    totalFee:    yearFee,
    remaining:   contractRemaining,
    billed:      yearBilled,
    collected:   yearCollected,
    outstanding: yearOutstanding,
  };
}

function totals(year) {
  const active = DATA.clients.filter(c => !c.archived);
  const t = { totalFee: 0, billed: 0, collected: 0, outstanding: 0, remaining: 0, count: active.length };
  active.forEach(c => {
    const s = clientStats(c, year);
    t.totalFee += s.totalFee;
    t.billed += s.billed;
    t.collected += s.collected;
    t.outstanding += s.outstanding;
    t.remaining += s.remaining;
  });
  return t;
}

// ============================================================
// EOY PROJECTION (Session 11)
// "How much of the remaining fee do I think I'll capture before
// Dec 31?" — used at end of year for the accountant's tax model.
// Each client has two optional fields:
//   projection_collect_pct : 0..100 in 10-pt steps — "% of the
//                            projected fee I think I can collect"
//                            (default 100)
//   projected_eoy_capture : number override (defaults to remaining
//                            year fee, i.e. yearFee - yearBilled)
// ============================================================
// % of the projected fee the user thinks they'll collect, snapped to
// 10-pt increments. Legacy clients carrying the old H/M/L confidence
// field are mapped forward (high->100, medium->70, low->30).
function clientCollectPct(client) {
  if (client && Number.isFinite(parseFloat(client.projection_collect_pct))) {
    const v = Math.round(parseFloat(client.projection_collect_pct) / 10) * 10;
    return Math.max(0, Math.min(100, v));
  }
  const legacy = client && client.projection_confidence;
  if (legacy === 'low')    return 30;
  if (legacy === 'medium') return 70;
  return 100;  // default / 'high'
}

function clientProjection(client, year) {
  if (!client || client.archived || client.closed_out) {
    return { ytdBilled: 0, remainingYearFee: 0, projectedEoy: 0,
             collectPct: 100, confidenceMult: 1, weighted: 0,
             projectedYearTotal: 0, isOverride: false };
  }
  const s = clientStats(client, year);
  const ytdBilled = s.yearBilled;
  const remainingYearFee = Math.max(0, s.yearFee - ytdBilled);
  const override = parseFloat(client.projected_eoy_capture);
  const isOverride = Number.isFinite(override) && override >= 0;
  const projectedEoy = isOverride ? override : remainingYearFee;
  const collectPct = clientCollectPct(client);
  const confidenceMult = collectPct / 100;
  const weighted = projectedEoy * confidenceMult;
  const projectedYearTotal = ytdBilled + weighted;
  return { ytdBilled, remainingYearFee, projectedEoy, collectPct,
           confidenceMult, weighted, projectedYearTotal, isOverride };
}

function projectionTotals(year) {
  const active = DATA.clients.filter(c => !c.archived && !c.closed_out);
  const t = { ytdBilled: 0, remainingYearFee: 0, projectedEoy: 0,
              weighted: 0, projectedYearTotal: 0 };
  active.forEach(c => {
    const p = clientProjection(c, year);
    t.ytdBilled         += p.ytdBilled;
    t.remainingYearFee  += p.remainingYearFee;
    t.projectedEoy      += p.projectedEoy;
    t.weighted          += p.weighted;
    t.projectedYearTotal+= p.projectedYearTotal;
  });
  return t;
}

// Monthly aggregates: planned, invoiced (sent), collected (paid)
function monthlyAggregates(year) {
  const active = DATA.clients.filter(c => !c.archived);
  const planned = new Array(12).fill(0);
  const invoiced = new Array(12).fill(0);
  const collected = new Array(12).fill(0);

  active.forEach(c => {
    (c.monthly_planned_2026 || []).forEach(m => {
      const idx = MONTHS.indexOf(m.month);
      if (idx >= 0) planned[idx] += (m.amount || 0);
    });
    billingEventsInYear(c, year).forEach(e => {
      if (e.sent) invoiced[e.month] += e.amount;
      if (e.paid) collected[e.month] += e.amount;
    });
  });
  return { planned, invoiced, collected };
}

// Per-client per-month invoiced (for matrix and small multiples)
function clientMonthlyInvoiced(client, year) {
  const arr = new Array(12).fill(0);
  billingEventsInYear(client, year).forEach(e => {
    if (e.sent) arr[e.month] += e.amount;
  });
  return arr;
}
function clientMonthlyCollected(client, year) {
  const arr = new Array(12).fill(0);
  billingEventsInYear(client, year).forEach(e => {
    if (e.paid) arr[e.month] += e.amount;
  });
  return arr;
}
function clientMonthlyPlanned(client) {
  const arr = new Array(12).fill(0);
  (client.monthly_planned_2026 || []).forEach(m => {
    const idx = MONTHS.indexOf(m.month);
    if (idx >= 0) arr[idx] += (m.amount || 0);
  });
  return arr;
}

// ===============================================================
// TAB NAVIGATION HELPER
// ===============================================================
function activateTab(tabName) {
  $$('.tab').forEach(x => x.classList.remove('active'));
  $$('.tab-pane').forEach(x => x.classList.remove('active'));
  const btn = document.querySelector(`.tab[data-tab="${tabName}"]`);
  const pane = document.getElementById('tab-' + tabName);
  if (btn) btn.classList.add('active');
  if (pane) pane.classList.add('active');
}

// ===============================================================
// INVOICE BUILDER
// ===============================================================
let IB_STATE = {
  clientId: null,
  phaseProgress: { DEPOSIT: 0, SD: 0, DD: 0, CD: 0, CA: 0 },
  manualDescription: false,
  otherItems: [],   // [{label, amount}]
  billFeeRemaining: false,  // Session 27: "Bill for Fee Remaining" checkbox
};
let IB_PREV_TAB = 'overview';

// What percent of each phase has been billed in past invoices?
// We approximate this by: prior phase_progress values from past invoices for this client.
// For invoices without phase_progress (manual or imported), we attribute their amount
// to phases proportionally to phase weights (best-effort fallback).
function priorPhaseProgress(client) {
  const result = { DEPOSIT: 0, SD: 0, DD: 0, CD: 0, CA: 0 };
  // Deposit Paid checkbox forces DEPOSIT phase to 100%.
  if (client.deposit_paid) result.DEPOSIT = 100;
  const totalFee = computeClientFee(client) || 0;
  if (!totalFee) return result;
  const phases = client.phases || { DEPOSIT: 0.05, SD: 0.20, DD: 0.20, CD: 0.50, CA: 0.05 };

  for (const inv of (client.invoices || [])) {
    if (!inv.sent && !inv.paid) continue;  // Only count actually-billed invoices
    if (inv.phase_progress && typeof inv.phase_progress === 'object') {
      // Saved phase progress on this invoice tells us where we were AFTER this invoice.
      // We want the cumulative max (since progress is monotonic).
      for (const p of PHASE_NAMES) {
        const v = parseFloat(inv.phase_progress[p]) || 0;
        if (v > result[p]) result[p] = v;
      }
    } else {
      // 2026-05-07 fix: NEVER distribute proportionally. The old fallback
      // silently inflated EVERY phase's "prior" by amt/totalFee, which
      // poisoned phases that were never started (e.g. Young: a $24k
      // untagged sent invoice injected ~19% phantom prior into SD/DD/CD/CA).
      // We now leave result[p] alone for untagged invoices — the user sees
      // a sent invoice that simply doesn't move any sliders. Tag the
      // invoice's phase_progress to attribute it correctly.
    }
  }
  // Clamp 0..100
  for (const p of PHASE_NAMES) result[p] = Math.max(0, Math.min(100, result[p]));
  return result;
}


// ---- Other / Misc Items ----
function renderOtherItems() {
  const container = $('#ib_other_items');
  if (!container) return;
  if (IB_STATE.otherItems.length === 0) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = IB_STATE.otherItems.map((item, i) => `
    <div class="ib-other-row" data-idx="${i}">
      <input type="text" class="ib-other-label" placeholder="Description" value="${item.label.replace(/"/g,'&quot;')}">
      <input type="text" class="ib-other-amount currency-input" value="${item.amount || ''}">
      <button class="ib-other-remove" data-idx="${i}" title="Remove">×</button>
    </div>
  `).join('');

  container.querySelectorAll('.ib-other-label').forEach((inp, i) => {
    inp.addEventListener('input', () => {
      IB_STATE.otherItems[i].label = inp.value;
      updateInvoiceBuilderSummary();
    });
  });
  container.querySelectorAll('.ib-other-amount').forEach((inp, i) => {
    wireCurrencyInput(inp);
    inp.addEventListener('input', () => {
      IB_STATE.otherItems[i].amount = currencyVal(inp);
      updateInvoiceBuilderSummary();
    });
  });
  container.querySelectorAll('.ib-other-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      IB_STATE.otherItems.splice(parseInt(btn.dataset.idx), 1);
      renderOtherItems();
      updateInvoiceBuilderSummary();
    });
  });
}

// Session 9: standalone phase-fee resolver — top-level so updateInvoiceBuilderSummary can call it.
// Priority: manual override (IB_STATE.phaseFeeOverrides) > formula.
//
// Session 17 rethink: a manually-overridden phase fee counts the same as a
// fixed amount when computing every OTHER phase's formula share — its dollar
// amount is subtracted from totalFee (fixedSum) before the remaining phases
// split what's left, and its weight is excluded from the pool. This restores
// the invariant that the sum of all 5 resolveIbPhaseFee() values always
// equals currentClientFee(c).
//
// Session 20 rethink #2: this used to ALSO treat a genuinely locked phase
// (one billed to 100% in a past invoice) the same way — subtracting its
// frozen historical dollar amount from the pool and excluding its weight,
// so every other phase split only what was "left over" after locks. That's
// what caused Create Invoice to disagree with the client card: a locked
// phase's dollar amount never grows with the contract, so 100% of any fee
// growth got dumped onto whichever phases weren't locked yet (Davis -
// Liberty Park's CD was showing $385,455 vs the client card's $307,368 for
// the exact same phase). Locks no longer shrink the pool here — a phase's
// Phase Fee (its fair share of the CURRENT total fee) is always its weight
// share among every non-overridden phase, locked or not, which is exactly
// what the client card's Phase Amounts table already computes
// (feeWithRevisions * phases[p] in recomputeClientForm). What a locked phase
// actually GOT BILLED historically lives separately in phase_locks[p].amount
// — see the Prior column and computeTrueupEntries() below, which use that
// figure directly instead of assuming "100% prior" means "100% of today's
// fee already collected."
function resolveIbPhaseFee(c, p) {
  const overrides = (IB_STATE && IB_STATE.clientId === c.id && IB_STATE.phaseFeeOverrides) || {};
  if (overrides[p] != null) return parseFloat(overrides[p]) || 0;
  const totalFee = currentClientFee(c) || 0;
  const phaseWeights = c.phases || { DEPOSIT: 0.05, SD: 0.20, DD: 0.20, CD: 0.50, CA: 0.05 };
  let fixedSum = 0, poolWeightSum = 0;
  for (const pp of PHASE_NAMES) {
    if (overrides[pp] != null) {
      fixedSum += parseFloat(overrides[pp]) || 0;
    } else {
      poolWeightSum += (phaseWeights[pp] || 0);
    }
  }
  const adjustableFee = Math.max(0, totalFee - fixedSum);
  if (poolWeightSum <= 0) return 0;
  return adjustableFee * ((phaseWeights[p] || 0) / poolWeightSum);
}

// ============================================================
// Session 26 (2026-08-15) — CONCEPT A: contract true-up.
//
// Replaces Session 20's two-kind ('open' / 'locked') catch-up. That model
// answered the wrong question for an in-progress phase: it treated catch-up
// as "bill the rest of this phase", which is just the slider's job, and left
// the real problem invisible. The real problem is that work ALREADY BILLED
// was billed under a SMALLER contract fee.
//
// One definition now, applied to every phase the same way:
//
//     shortfall = (what this phase's completed work is worth at TODAY's fee)
//                 - (dollars actually invoiced against this phase)
//
// For a locked phase the second term is phase_locks[p].amount — the real
// historical dollars. For an in-progress phase there is no stored per-phase
// figure, so it is derived: total invoiced minus the locked amounts, split
// across the in-progress phases in proportion to work done (weight x prior%).
//
// Worked example, Davis - Liberty Park at the 2026-08-08 revision to
// $6,400,000 (fee $604,000, was $400,000), $360,119 invoiced across 6
// invoices, CD at 90%:
//
//   SD   0.20 x 604,000 x 100%  = 120,800  - 80,000 locked  =  40,800
//   DD   0.20 x 604,000 x 100%  = 120,800  - 80,000 locked  =  40,800
//   CD   0.50 x 604,000 x  90%  = 271,800  - 180,119 derived=  91,681
//                                                     total = 173,281
//
// Under the old model CD would have shown 30,200 ("bill the last 10%") and
// the other 61,481 would have quietly vanished.
//
// DEPOSIT is excluded — it is a fixed retainer, never trued up (Scott
// 2026-08-09, reconfirmed 2026-08-15).
//
// Selection is per-phase and continuous: IB_STATE.trueupPct[p] holds what
// percentage of that phase's shortfall goes on THIS invoice, driven by the
// slider in the Contract True-Up ledger. It never touches phaseProgress —
// a true-up is not progress, it is a price correction on work already done.
// ============================================================

// Dollars actually invoiced against phase p, to date.
//   locked phase      -> the stored lock amount (real historical dollars)
//   in-progress phase -> derived: everything invoiced that is not accounted
//                        for by the locked phases, shared out among the
//                        in-progress phases by weight x prior%.
function phaseBilledToDate(c, p) {
  const locks = c.phase_locks || {};
  if (locks[p] && locks[p].locked) return parseFloat(locks[p].amount) || 0;

  const phaseWeights = c.phases || { DEPOSIT: 0.05, SD: 0.20, DD: 0.20, CD: 0.50, CA: 0.05 };
  const prior = priorPhaseProgress(c);
  const billedTotal = sum((c.invoices || []).filter(i => i.sent), i => i.amount || 0);
  let lockedTotal = 0;
  for (const q of PHASE_NAMES) {
    if (locks[q] && locks[q].locked) lockedTotal += parseFloat(locks[q].amount) || 0;
  }
  const leftover = Math.max(0, billedTotal - lockedTotal);

  let denom = 0;
  for (const q of PHASE_NAMES) {
    if (locks[q] && locks[q].locked) continue;
    denom += (phaseWeights[q] || 0) * (prior[q] || 0);
  }
  if (denom > 0) {
    return leftover * ((phaseWeights[p] || 0) * (prior[p] || 0)) / denom;
  }
  // Session 27: denom === 0 means NONE of the unlocked phases have any
  // recorded historical percent (weight x prior% is 0 for every one of
  // them) — typically invoices from before this app tracked phases, or a
  // legacy client billed as a lump sum with no per-phase breakdown at all.
  // The old behavior returned $0 "billed" for every unlocked phase in this
  // case, silently discarding a real `leftover` amount instead of just
  // failing to attribute it. That made every unlocked phase's dollar
  // headroom come back uncapped (its full weight-share), which is a
  // double-billing risk: a fully-paid legacy client (e.g. Ballagas — fee
  // and billed both $20,000, remaining $0) would still show every phase
  // free to bill its full weight-share again. Auditing the live data on
  // 2026-08-18 found this shape on 32 of 41 clients.
  //
  // Fallback: when we can't tell which unlocked phase the money belongs to,
  // spread `leftover` across the unlocked phases by weight alone (instead
  // of weight x prior%, which is exactly 0 here for all of them). This
  // can't ever create a false "overpaid" warning for a phase with genuine
  // 0% progress — phaseEarnedToDate is 0 for an unstarted phase regardless
  // of phaseBilledToDate, and phaseShortfall floors at 0 — it only shrinks
  // an unstarted phase's billing headroom to reflect that some of its share
  // of the money already came in through a lump-sum/legacy invoice.
  let weightDenom = 0;
  for (const q of PHASE_NAMES) {
    if (locks[q] && locks[q].locked) continue;
    weightDenom += (phaseWeights[q] || 0);
  }
  if (weightDenom <= 0) return 0;
  return leftover * ((phaseWeights[p] || 0) / weightDenom);
}

// What phase p's already-completed work is worth at today's contract fee.
function phaseEarnedToDate(c, p) {
  const prior = priorPhaseProgress(c);
  return resolveIbPhaseFee(c, p) * (prior[p] || 0) / 100;
}

// ---- Session 27: dollar-true "this invoice" / "remaining" for a phase ----
// The phase table used to compute "this invoice $" and "Remaining $" purely
// from percent (phaseFee * pct/100). That's correct ONLY when a phase's real
// invoiced-to-date dollars (phaseBilledToDate) track cleanly with its percent
// complete. For clients billed by hand over years (e.g. LePere), the two can
// drift apart — CA showed 85.87% complete but had ALREADY been invoiced
// $8,475 against a $8,474 total phase-fee share (a rounding-era mismatch
// from years of ad hoc dollar invoicing, not a slider bug). The old formula
// still offered ~$1,197 more to bill on CA even though the contract's real
// Fee Remaining was $0 — "the 100% CA phase is more than the fee remaining."
//
// Fix: cap what a phase can bill THIS invoice at its true dollar headroom
// (phaseFee minus what's actually been invoiced against it already), not
// just at the percent-implied amount. For clients whose history tracks
// cleanly with percent (the common case), billedSoFar ≈ phaseFee * priorPct
// / 100, so the headroom cap and the old percent-based amount agree and
// nothing changes. It only bites when a phase has already collected more
// than its formula share, which is exactly the bug being fixed.
function phaseThisInvoiceAmt(c, p, priorPct, curPct) {
  const phaseFee = resolveIbPhaseFee(c, p);
  const thisPct = Math.max(0, curPct - priorPct);
  const pctBasedAmt = phaseFee * (thisPct / 100);
  const headroom = Math.max(0, phaseFee - phaseBilledToDate(c, p));
  return Math.min(pctBasedAmt, headroom);
}

// True dollars left to bill on phase p after accounting for this invoice's
// selection — used for the "Remaining" column and as the effective slider
// ceiling.
function phaseRemainingAmt(c, p, priorPct, curPct) {
  const phaseFee = resolveIbPhaseFee(c, p);
  const headroom = Math.max(0, phaseFee - phaseBilledToDate(c, p));
  const thisAmt = phaseThisInvoiceAmt(c, p, priorPct, curPct);
  return Math.max(0, headroom - thisAmt);
}

// Raw arithmetic shortfall, ignoring policy. Kept separate from the billable
// gap so the Fee Calculation panel can show DEPOSIT's excluded shortfall.
function phaseShortfall(c, p) {
  return Math.max(0, phaseEarnedToDate(c, p) - phaseBilledToDate(c, p));
}

// Phases never eligible for a true-up, whatever the arithmetic says.
const TRUEUP_EXCLUDED = ['DEPOSIT'];

// The billable true-up ledger: one entry per phase that is genuinely owed
// money on work already done.
function computeTrueupEntries(c) {
  const entries = [];
  for (const p of PHASE_NAMES) {
    if (TRUEUP_EXCLUDED.includes(p)) continue;
    const gap = phaseShortfall(c, p);
    if (gap <= 0.5) continue;
    const locks = c.phase_locks || {};
    entries.push({
      p,
      gap,
      billed: phaseBilledToDate(c, p),
      earned: phaseEarnedToDate(c, p),
      locked: !!(locks[p] && locks[p].locked)
    });
  }
  return entries;
}

// Total shortfall on excluded phases — shown for reference, never billable.
function excludedShortfallTotal(c) {
  return TRUEUP_EXCLUDED.reduce((s, p) => s + phaseShortfall(c, p), 0);
}

// Dollars of true-up selected on this invoice, in total.
function trueupSelectedTotal(c) {
  if (!c || !c.is_phased || !IB_STATE.trueupPct) return 0;
  return computeTrueupEntries(c).reduce(
    (s, e) => s + e.gap * ((parseFloat(IB_STATE.trueupPct[e.p]) || 0) / 100), 0);
}

// Per-phase true-up dollars, for the durable invoice record. Same shape the
// save/generate paths already expected from the old catch-up picker, so
// invoice history stays readable across the model change.
function selectedCatchupByPhase(c) {
  const out = {};
  if (!c || !IB_STATE.trueupPct) return out;
  computeTrueupEntries(c).forEach(e => {
    const pct = parseFloat(IB_STATE.trueupPct[e.p]) || 0;
    if (pct > 0) out[e.p] = Math.round(e.gap * pct / 100);
  });
  return out;
}

// ============================================================
// Session 26 — Fee Calculation reference panel.
// Scott asked to see the fee math, including true-ups, laid out somewhere.
// Renders into #ib_feecalc and recomputes on every summary update, so it is
// always in step with the sliders. Read-only: it explains, it never inputs.
// ============================================================
function renderFeeCalcPanel(c, s) {
  const wrap = $('#ib_feecalc');
  if (!wrap) return;
  if (!c) { wrap.hidden = true; wrap.innerHTML = ''; return; }
  wrap.hidden = false;

  const row = (lbl, op, num, cls) =>
    `<tr class="${cls || ''}"><td class="lbl">${lbl}</td><td class="op">${op || ''}</td><td class="num">${num}</td></tr>`;

  // ---- 1. contract fee from the estimate ----
  const revs = Array.isArray(c.estimate_revisions) ? c.estimate_revisions : [];
  const ft = c.fee_type || 'fixed';
  const baseFee = computeClientFee(c) || 0;
  const feeNow = currentClientFee(c) || 0;
  let h = '';
  if (ft === 'tiered_percentage' || ft === 'percentage') {
    const origEst = parseFloat(c.fee_estimate) || 0;
    const est = revs.length ? (parseFloat(revs[revs.length - 1].estimate) || origEst) : origEst;
    h += row('Original construction estimate', '', fmt0(origEst));
    if (revs.length) {
      const last = revs[revs.length - 1];
      h += row(`Revised estimate <span class="fc-when">${escapeHtml(last.date || '')}</span>`, '', fmt0(est));
    }
    if (ft === 'tiered_percentage') {
      const t1 = parseFloat(c.fee_tier1_pct) || 0;
      const t2 = parseFloat(c.fee_tier2_pct) || 0;
      const thr = parseFloat(c.fee_tier_threshold) || 0;
      const lower = Math.min(est, thr), upper = Math.max(0, est - thr);
      h += row(`First ${fmt0(thr)}`, `&times; ${t1}%`, fmt0(lower * t1 / 100), 'rule');
      if (upper > 0) h += row(`Balance ${fmt0(upper)}`, `&times; ${t2}%`, fmt0(upper * t2 / 100));
    } else {
      const pct = parseFloat(c.fee_percentage) || 0;
      h += row(`${fmt0(est)}`, `&times; ${pct}%`, fmt0(est * pct / 100), 'rule');
    }
    h += row('<b>Contract fee today</b>', '', `<b>${fmt0(feeNow)}</b>`, 'rule sum');
    if (Math.abs(feeNow - baseFee) > 0.5) {
      h += row('Fee under the original estimate', '', fmt0(baseFee));
      h += row('Fee growth', '', fmt0(feeNow - baseFee));
    }
  } else {
    h += row('Fixed fee', '', fmt0(baseFee));
    if (revs.length) h += row('Revised fee', '', fmt0(feeNow), 'rule');
    h += row('<b>Contract fee today</b>', '', `<b>${fmt0(feeNow)}</b>`, 'rule sum');
  }
  const fcFee = $('#fc_fee'); if (fcFee) fcFee.innerHTML = h;

  // ---- 2. fee split by phase ----
  h = '';
  if (c.is_phased) {
    const w = c.phases || {};
    let splitSum = 0;
    for (const p of PHASE_NAMES) {
      const amt = resolveIbPhaseFee(c, p);
      splitSum += amt;
      const ov = IB_STATE.phaseFeeOverrides && IB_STATE.phaseFeeOverrides[p] != null;
      h += row(p + (ov ? ' <span class="fc-when">override</span>' : ''),
               ov ? '' : `${fmt0(feeNow)} &times; ${Math.round((w[p] || 0) * 100)}%`, fmt0(amt));
    }
    h += row('<b>Total</b>', '', `<b>${fmt0(splitSum)}</b>`, 'rule sum');
  } else {
    h = row('Not a phased client', '', '&mdash;', 'muted');
  }
  const fcPhases = $('#fc_phases'); if (fcPhases) fcPhases.innerHTML = h;

  // ---- 3. true-up derivation ----
  h = '';
  if (c.is_phased) {
    const prior = priorPhaseProgress(c);
    let any = false;
    for (const p of PHASE_NAMES) {
      const sf = phaseShortfall(c, p);
      if (sf <= 0.5 && (prior[p] || 0) <= 0) continue;
      any = true;
      const excluded = TRUEUP_EXCLUDED.includes(p);
      h += row(`${p} @ ${(prior[p] || 0).toFixed(0)}%` + (excluded ? ' <span class="fc-when">excluded</span>' : ''),
               `${fmt0(phaseEarnedToDate(c, p))} &minus; ${fmt0(phaseBilledToDate(c, p))}`,
               fmt0(sf), excluded ? 'muted' : '');
    }
    if (!any) h = row('No completed work is short', '', fmt0(0), 'muted');
    const gapTotal = computeTrueupEntries(c).reduce((x, e) => x + e.gap, 0);
    h += row('<b>True-up available</b>', '', `<b>${fmt0(gapTotal)}</b>`, 'rule sum');
    const exc = excludedShortfallTotal(c);
    if (exc > 0.5) h += row('Deposit shortfall, not billed', '', fmt0(exc), 'muted');
    h += row('Selected on this invoice', '', fmt0(s.trueupAmt));
  } else {
    h = row('Not a phased client', '', '&mdash;', 'muted');
  }
  const fcCatch = $('#fc_catchup'); if (fcCatch) fcCatch.innerHTML = h;

  // ---- 4. this invoice and where it leaves the contract ----
  h = '';
  if (c.is_phased) {
    const prior = priorPhaseProgress(c);
    for (const p of PHASE_NAMES) {
      const d = Math.max(0, (IB_STATE.phaseProgress[p] || 0) - (prior[p] || 0));
      if (d <= 0) continue;
      h += row(`${p} ${(prior[p] || 0).toFixed(0)}% &rarr; ${(IB_STATE.phaseProgress[p] || 0).toFixed(0)}%`,
               `${fmt0(resolveIbPhaseFee(c, p))} &times; ${d.toFixed(0)}%`,
               fmt0(resolveIbPhaseFee(c, p) * d / 100));
    }
  }
  if (s.progressFee <= 0.5) h += row('No new phase progress', '', fmt0(0), 'muted');
  h += row('Progress billed this invoice', '', fmt0(s.progressFee), 'rule');
  if (s.lumpSumCatchup > 0.5) h += row('Lump-sum catch-up', '', fmt0(s.lumpSumCatchup));
  h += row('Contract true-up this invoice', '', fmt0(s.trueupAmt));
  if (s.reimb > 0.5) h += row('Reimbursable expenses', '', fmt0(s.reimb));
  if (s.outstanding > 0.5) h += row('Outstanding from prior', '', fmt0(s.outstanding));
  if (Math.abs(s.otherTotal) > 0.5) h += row('Other items', '', fmt0(s.otherTotal));
  h += row('<b>Invoice total</b>', '', `<b>${fmt0(s.total)}</b>`, 'rule sum');
  const againstContract = s.progressFee + s.lumpSumCatchup + s.trueupAmt;
  const nInv = (c.invoices || []).filter(i => i.sent).length;
  h += row(`Billed to date (${nInv} invoice${nInv === 1 ? '' : 's'})`, '', fmt0(s.billedToDate), 'rule');
  h += row('Billed after this invoice', `${fmt0(s.billedToDate)} + ${fmt0(againstContract)}`,
           fmt0(s.billedToDate + againstContract));
  h += row('<b>Fee remaining</b>', `${fmt0(s.contractFee)} &minus; ${fmt0(s.billedToDate + againstContract)}`,
           `<b>${fmt0(s.contractFee - s.billedToDate - againstContract)}</b>`, 'sum');
  const fcInv = $('#fc_invoice'); if (fcInv) fcInv.innerHTML = h;

  // ---- footnote ----
  const note = $('#fc_note');
  if (note) {
    if (!c.is_phased) { note.innerHTML = ''; }
    else {
      const locks = c.phase_locks || {};
      const lockedBits = PHASE_NAMES.filter(p => locks[p] && locks[p].locked)
        .map(p => `${p} ${fmt0(parseFloat(locks[p].amount) || 0)}`);
      const lockedTotal = PHASE_NAMES.reduce((x, p) =>
        x + ((locks[p] && locks[p].locked) ? (parseFloat(locks[p].amount) || 0) : 0), 0);
      note.innerHTML =
        `<b>Where &ldquo;billed to date&rdquo; per phase comes from.</b> Locked phases use their stored lock amount` +
        (lockedBits.length ? ` (${lockedBits.join(', ')} &mdash; ${fmt0(lockedTotal)} total)` : '') +
        `. The remainder of the ${fmt0(s.billedToDate)} invoiced (${fmt0(Math.max(0, s.billedToDate - lockedTotal))}) is assigned to the ` +
        `in-progress phases in proportion to work done. <b>Deposit is excluded from true-up</b> &mdash; it is a fixed retainer, ` +
        `so any arithmetic shortfall on it is shown greyed above but is never offered on an invoice.`;
    }
  }
}

function renderInvoiceBuilder() {
  // Client dropdown
  const sel = $('#ib_client');
  const currentVal = sel.value || IB_STATE.clientId || '';
  sel.innerHTML = '<option value="">— select a client —</option>' +
    DATA.clients.filter(c => !c.archived)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  sel.value = currentVal;

  // Default date = today
  if (!$('#ib_date').value) {
    $('#ib_date').value = new Date().toISOString().slice(0, 10);
  }
  // Default invoice number suggestion (uses date's year if set, else current year)
  if (!$('#ib_number').value) {
    const dateVal = $('#ib_date').value;
    const yr = dateVal ? new Date(dateVal + 'T12:00:00').getFullYear() : new Date().getFullYear();
    $('#ib_number').placeholder = formatInvoiceNumber(nextInvoiceNumber(), yr);
  }

  renderInvoiceBuilderClient();
}

function renderInvoiceBuilderClient() {
  const c = DATA.clients.find(x => x.id === IB_STATE.clientId);
  const info = $('#ib_clientInfo');
  const phases = $('#ib_phases');

  if (!c) {
    info.className = 'ib-client-info empty';
    info.innerHTML = 'Select a client above to begin.';
    phases.innerHTML = '';
    const wrap0 = $('#ib_pastInvoicesWrap'); if (wrap0) wrap0.hidden = true;
    updateInvoiceBuilderSummary();
    return;
  }

  info.className = 'ib-client-info';
  renderInvoiceBuilderPastInvoices(c);
  info.innerHTML = `
    <span class="ib-line"><strong>Project</strong> ${escapeHtml(c.full_name || c.name)}</span>
    <span class="ib-line"><strong>Project Address</strong> ${escapeHtml(c.project_address || c.address || '—')}</span>
    <span class="ib-line"><strong>Fee Basis</strong> ${escapeHtml(describeFee(c))}</span>
    <span class="ib-line"><strong>Current Fee</strong> ${fmt0(currentClientFee(c) || 0)}</span>
    <span class="ib-line"><strong>Billed to date</strong> ${fmt0(sum((c.invoices || []).filter(i => i.sent), i => i.amount || 0))}</span>
  `;

  const totalFee = currentClientFee(c) || 0;
  const isPhased = !!c.is_phased;

  // ----- Non-phased clients: simple "this invoice amount" entry -----
  if (!isPhased) {
    if (!IB_STATE.initializedFor || IB_STATE.initializedFor !== c.id) {
      IB_STATE.phaseProgress = { DEPOSIT: 0, SD: 0, DD: 0, CD: 0, CA: 0 };
      // Session 27: this used to default to the amount ALREADY invoiced
      // (sum of past sent invoices), on the theory that it should "mirror"
      // how phased clients pre-load prior progress. But a phased client's
      // slider pre-loads a PERCENT, and the dollar amount billed is the
      // DELTA from that percent — never the full prior total. This field
      // has no such delta: whatever it holds IS the dollar amount of THIS
      // invoice. Defaulting it to billedToDate meant a brand-new invoice
      // started pre-loaded to re-bill the client's entire history, and the
      // Fee Remaining at the bottom (contractFee - billedToDate - thisAmt)
      // came out double-counted and falsely negative unless you noticed
      // and cleared the field first. Swept every client on 2026-08-18 —
      // this hit Casadaban - Magnolia, Casadaban - Payne Street, and
      // Clikas at minimum. Starts at 0 now, same as every phased client's
      // "this invoice" amount for a phase with no new progress.
      IB_STATE.flatAmount = 0;
      IB_STATE.initializedFor = c.id;
      IB_STATE.manualDescription = false;
    }

    const contractFee = currentClientFee(c) || 0;
    const billedToDate = sum((c.invoices || []).filter(i => i.sent), i => i.amount || 0);
    const contractRemaining = contractFee - billedToDate;

    // Show the 5%-increment slider only when there's a known total fee to take a
    // percentage of (fixed / non-phased clients with a contract fee). Placeholder
    // $0-fee clients fall back to plain amount entry.
    const showFlatSlider = contractFee > 0;

    $('#ib_section_h3').textContent = 'Amount';
    $('#ib_section_help').textContent = showFlatSlider
      ? 'Drag the slider to bill in 5% increments of the total fee, or type an exact amount.'
      : 'Enter the amount to bill on this invoice.';

    const initPct = showFlatSlider
      ? Math.round(Math.max(0, Math.min(100, ((IB_STATE.flatAmount || 0) / contractFee) * 100)) / 5) * 5
      : 0;
    const curPctLabel = showFlatSlider
      ? (((IB_STATE.flatAmount || 0) / contractFee) * 100).toFixed(0)
      : '0';

    phases.innerHTML = `
      <div class="ib-flat-row">
        <label class="form-row inline-label">
          <span class="lbl-text">Amount to bill this invoice</span>
          <input type="text" id="ib_flat_amount" class="currency-input" value="${IB_STATE.flatAmount || ''}" placeholder="0">
        </label>
      </div>
      ${showFlatSlider ? `
      <div class="ib-flat-slider-row">
        <input type="range" id="ib_flat_slider" class="ib-phase-slider ib-flat-slider" min="0" max="100" step="5" value="${initPct}" title="Drag in 5% steps of the total fee — the amount field follows">
        <div class="ib-flat-slider-meta">
          <span class="ib-flat-slider-pct" id="ib_flat_pct">${curPctLabel}%</span>
          <span class="ib-flat-slider-hint">of total fee</span>
        </div>
      </div>` : ''}
      <div class="ib-flat-summary">
        <div><span class="ib-flat-label">Total fee</span><span class="ib-flat-val">${fmt0(contractFee)}</span></div>
        <div><span class="ib-flat-label">Billed to date</span><span class="ib-flat-val">${fmt0(billedToDate)}</span></div>
        <div><span class="ib-flat-label">Remaining</span><span class="ib-flat-val">${fmt0(contractRemaining)}</span></div>
      </div>
    `;

    const flatInput = $('#ib_flat_amount');
    const flatSlider = $('#ib_flat_slider');
    const flatPct = $('#ib_flat_pct');

    function syncFlatPctLabel(amt) {
      if (flatPct && contractFee > 0) flatPct.textContent = ((amt / contractFee) * 100).toFixed(0) + '%';
    }

    wireCurrencyInput(flatInput);
    flatInput.addEventListener('input', () => {
      IB_STATE.flatAmount = currencyVal(flatInput);
      // Typing an amount snaps the slider to the nearest 5% of the total fee,
      // but the dollar field keeps whatever exact amount was typed.
      if (flatSlider && contractFee > 0) {
        const pct = Math.max(0, Math.min(100, Math.round((IB_STATE.flatAmount / contractFee * 100) / 5) * 5));
        flatSlider.value = pct;
      }
      syncFlatPctLabel(IB_STATE.flatAmount);
      updateInvoiceBuilderSummary();
    });

    if (flatSlider) {
      flatSlider.addEventListener('input', () => {
        // Constrain the slider to 5% steps, then drive the dollar amount from it.
        const pct = Math.round(flatSlider.value / 5) * 5;
        flatSlider.value = pct;
        const amt = Math.round(contractFee * pct / 100);
        IB_STATE.flatAmount = amt;
        setCurrencyVal(flatInput, amt);
        syncFlatPctLabel(amt);
        updateInvoiceBuilderSummary();
      });
    }

    if (!IB_STATE.manualDescription) {
      $('#ib_description').value = 'Architectural services';
    }
    updateInvoiceBuilderSummary();
    return;
  }

  // ----- Phased clients: phase sliders -----
  $('#ib_section_h3').textContent = 'Phase Progress';
  $('#ib_section_help').textContent = 'Set the percent complete for each phase. Each slider shows the dollar amount that phase will contribute to this invoice.';
  const phaseWeights = c.phases || { DEPOSIT: 0.05, SD: 0.20, DD: 0.20, CD: 0.50, CA: 0.05 };
  const prior = priorPhaseProgress(c);

  if (!IB_STATE.initializedFor || IB_STATE.initializedFor !== c.id) {
    IB_STATE.phaseProgress = { ...prior };
    IB_STATE.flatAmount = 0;
    IB_STATE.initializedFor = c.id;
    IB_STATE.manualDescription = false;
    IB_STATE.phaseFeeOverrides = {};
    IB_STATE.lumpSumCatchup = 0;  // 2026-05-07: lump-sum catchup, resets per client
    IB_STATE.trueupPct = {};      // Session 26: per-phase contract true-up %, resets per client
    IB_STATE.billFeeRemaining = false;  // Session 27: resets per client
  }

  // Generalized phase locks: any phase the user has marked Complete (or that has been
  // billed to 100% in a past invoice) is frozen at its locked dollar amount. The
  // remaining (unlocked) phases share whatever fee is left, in proportion to their
  // current weights.
  const locks = c.phase_locks || {};
  function isPhaseLocked(p) {
    return !!(locks[p] && locks[p].locked);
  }
  // (Session 17: removed a dead local lockedSum/unlockedWeightSum/adjustableFee
  // calculation here — it was never used past this point, and it duplicated
  // logic that now lives, correctly and override-aware, inside
  // resolveIbPhaseFee. Compute phase dollar amounts through ibPhaseFee()/
  // resolveIbPhaseFee() below, not by hand, so every call site stays in sync.)

  // ibPhaseFee now delegates to the standalone resolveIbPhaseFee (supports manual overrides)
  function ibPhaseFee(p) { return resolveIbPhaseFee(c, p); }
  // Backwards-compat: the old depositDone flag is still used by the row classes below.
  const depositDone = isPhaseLocked('DEPOSIT');

  // Session 26: the true-up ledger below the table replaces the old in-table
  // catch-up column. See computeTrueupEntries() for the model.
  const trueupEntries = computeTrueupEntries(c);
  if (!IB_STATE.trueupPct) IB_STATE.trueupPct = {};
  trueupEntries.forEach(e => { if (IB_STATE.trueupPct[e.p] == null) IB_STATE.trueupPct[e.p] = 0; });
  // Prior $ for the phase table is now REAL invoiced dollars for every phase,
  // locked or not (Session 26). It used to show phaseFee x prior% for
  // in-progress phases, which asserted dollars that were never invoiced once
  // the contract fee grew — that overstatement is exactly what the true-up
  // ledger now surfaces instead of hiding.
  function priorBilledAmt(p) { return phaseBilledToDate(c, p); }

  let html = '';

  // Session 19 (B1 ledger rethink): catch-up used to live in its own box
  // above the phase table, with its own checkbox AND its own typed-amount
  // input — a second, separately-synced control for the exact same number
  // the slider and "this invoice" field already tracked. That three-way
  // sync (plus a fourth on the row itself) was the actual source of "the
  // slider doesn't match the fee calculations" — not a math bug, a UI with
  // too many places to disagree. Catch-up now lives INSIDE the phase table
  // as its own column: a checkbox that's just a shortcut into the SAME
  // IB_STATE.phaseProgress value the slider and this-invoice $ field use.
  // Lump-sum catchup (not attributed to any phase — e.g. a negotiated
  // partial payment) is kept as its own single line below the table, since
  // it's a genuinely different mechanism, not a duplicate of the per-phase
  // controls.

  // Session 17: safety-net check. Sum of all 5 resolveIbPhaseFee() values
  // should always equal the contract fee — that's the invariant this rethink
  // restores. It can only fail when EVERY phase is already fixed (locked
  // from a past invoice and/or manually overridden in this draft) and those
  // fixed dollar amounts don't themselves add up to the contract, leaving no
  // unlocked phase free to absorb the difference. Surface that honestly
  // instead of letting the numbers silently drift.
  const _phaseFeeSum = PHASE_NAMES.reduce((s, p) => s + ibPhaseFee(p), 0);
  const _phaseFeeDiff = _phaseFeeSum - totalFee;
  if (Math.abs(_phaseFeeDiff) > 1) {
    html += `<div class="ib-phase-sum-warning" style="background:#fdecea;border:1px solid #e0a8a0;color:#8a2e22;padding:0.5rem 0.75rem;margin:0 0 0.6rem;font-size:0.85rem;">
      &#9888; Phase fees add up to ${fmt0(_phaseFeeSum)}, but the contract fee is ${fmt0(totalFee)} (${_phaseFeeDiff > 0 ? 'over' : 'under'} by ${fmt0(Math.abs(_phaseFeeDiff))}). Every phase is either locked from a past invoice or manually overridden, so there's no phase left to balance the rest — check the Phase Fee boxes in the table below, or clear an override.
    </div>`;
  }

  // Session 27: surface phases that have already been invoiced their full
  // dollar share even though progress shows under 100% — the exact
  // LePere/CA situation ("the 100% CA phase is more than the fee
  // remaining"). Years of ad hoc dollar invoicing can leave a phase's real
  // billed-to-date slightly ahead of what its percent implies; without this
  // note the phase table looked like it still had room to bill when the
  // contract's actual Fee Remaining was already $0.
  const _overpaidPhases = PHASE_NAMES.filter(p => {
    if (isPhaseLocked(p)) return false;
    const pf = ibPhaseFee(p);
    if (pf <= 0) return false;
    return phaseBilledToDate(c, p) >= pf - 0.5 && (prior[p] || 0) < 100;
  });
  if (_overpaidPhases.length) {
    html += `<div class="ib-phase-sum-warning" style="background:#fdecea;border:1px solid #e0a8a0;color:#8a2e22;padding:0.5rem 0.75rem;margin:0 0 0.6rem;font-size:0.85rem;">
      &#9888; ${_overpaidPhases.join(', ')} ${_overpaidPhases.length === 1 ? 'has' : 'have'} already been invoiced its full phase-fee share, even though progress shows under 100% — that can happen after years of hand-entered invoices. Nothing more can be billed against ${_overpaidPhases.length === 1 ? 'it' : 'them'} until the contract fee grows (an estimate revision) or you mark it Complete to close it out.
    </div>`;
  }

  html += `<div class="ib-phase-headers">
    <span>Phase</span><span>%</span><span>Phase Fee</span><span>Prior billed</span><span>This invoice</span><span>Remaining</span><span>Complete</span>
  </div>`;

  for (const p of PHASE_NAMES) {
    const phaseFee = ibPhaseFee(p);
    const priorPct = prior[p];
    const curPct = IB_STATE.phaseProgress[p];
    // Session 27: capped at the phase's true dollar headroom, not just what
    // percent implies — see phaseThisInvoiceAmt/phaseRemainingAmt above.
    const thisAmt = phaseThisInvoiceAmt(c, p, priorPct, curPct);
    const remainingAmt = phaseRemainingAmt(c, p, priorPct, curPct);
    const noProgress = phaseFee === 0;
    const phaseLocked = isPhaseLocked(p);
    const rowCls = [noProgress ? 'no-progress' : '', phaseLocked ? 'deposit-done phase-locked' : ''].filter(Boolean).join(' ');
    const disabledAttr = (noProgress || phaseLocked) ? 'disabled' : '';
    // Session 17: the Complete checkbox is checked whenever this phase is
    // locked from a genuinely-saved past invoice (phaseLocked) OR the slider
    // for THIS draft is sitting at 100% — it's just a shortcut for "drag to
    // 100%", not a separate state.
    // Session 27: a locked phase's checkbox is no longer disabled — Scott
    // needs to be able to correct a phase that was marked Complete by
    // mistake. Unchecking a LOCKED phase now unlocks it (with a confirm,
    // since it reverses data from a genuinely saved past invoice); unchecking
    // an unlocked, session-only "at 100%" phase just drops the slider back
    // down, same as before.
    const sessionComplete = (curPct || 0) >= 100;
    const checkedAttr = (phaseLocked || sessionComplete) ? 'checked' : '';
    const completeDisabledAttr = noProgress ? 'disabled' : '';

    html += `<div class="ib-phase-row ${rowCls}" data-phase="${p}">
      <div class="ib-phase-name">${p}</div>
      <div class="ib-phase-pct">${Math.round(phaseWeights[p] * 100)}%</div>
      <input type="text" class="ib-phase-fee-input" value="${fmt0(phaseFee)}" data-phase="${p}" ${disabledAttr} title="${phaseLocked ? 'Locked from a past invoice — edit that invoice to change it' : 'Type a dollar amount to override this phase for this invoice'}">
      <div class="ib-phase-prior">${priorPct.toFixed(0)}% · ${fmt0(priorBilledAmt(p))}</div>
      <div class="ib-phase-this">
        <input type="range" class="ib-phase-slider${priorPct > 0 ? ' has-prior' : ''}" style="--prior:${priorPct}%" min="0" max="100" step="5" value="${Math.round(curPct/5)*5}" data-phase="${p}" ${disabledAttr}>
        <div class="ib-phase-this-row">
          <input type="text" class="ib-phase-this-input" value="${fmt0(thisAmt)}" data-phase="${p}" ${disabledAttr} title="Type a dollar amount to bill on this invoice — slider and catch-up box will follow">
          <span class="ib-phase-this-pct">${curPct.toFixed(0)}%</span>
        </div>
      </div>
      <div class="ib-phase-remaining">${fmt0(remainingAmt)}</div>
      <div class="ib-phase-complete"><label class="phase-complete-lbl"><input type="checkbox" class="ib-phase-complete-cb" data-phase="${p}" ${checkedAttr} ${completeDisabledAttr}><span></span></label></div>
    </div>`;
  }

  // Lump-sum catchup — see note above: kept as its own mechanism, just
  // trimmed down to a single line instead of a whole box.
  // Session 27: when "Bill for Fee Remaining" is checked, this field becomes
  // a read-only mirror of whatever's left on the contract after everything
  // else selected on this invoice (phase progress + true-up) — so checking
  // the box always brings the invoice up to exactly fully-billed, however
  // the rest of the form is set.
  let lumpSum = parseFloat(IB_STATE.lumpSumCatchup || 0) || 0;
  if (IB_STATE.billFeeRemaining) {
    const _progressSoFar = PHASE_NAMES.reduce(
      (s, p) => s + phaseThisInvoiceAmt(c, p, prior[p], IB_STATE.phaseProgress[p]), 0);
    const _trueupSoFar = trueupSelectedTotal(c);
    const _billedToDate = sum((c.invoices || []).filter(i => i.sent), i => i.amount || 0);
    lumpSum = Math.max(0, totalFee - _billedToDate - _progressSoFar - _trueupSoFar);
    IB_STATE.lumpSumCatchup = lumpSum;
  }
  html += `<div class="ib-lumpsum-line">
    <span class="ib-lumpsum-label">Lump-sum catch-up</span>
    <span class="ib-lumpsum-help">a flat amount applied to the invoice total &amp; contract remaining, not attributed to any one phase</span>
    <input type="text" id="ib_catchup_lumpsum" value="${fmt0(lumpSum)}" ${IB_STATE.billFeeRemaining ? 'disabled title="Auto-calculated by Bill for Fee Remaining"' : ''}>
  </div>
  <div class="ib-lumpsum-line ib-billremaining-line">
    <label class="phase-complete-lbl" style="flex:0 0 auto;">
      <input type="checkbox" id="ib_bill_fee_remaining" ${IB_STATE.billFeeRemaining ? 'checked' : ''}>
      <span class="ib-lumpsum-label" style="margin-left:0.4rem;">Bill for Fee Remaining</span>
    </label>
    <span class="ib-lumpsum-help">bills exactly what's left on the contract (${fmt0(Math.max(0, totalFee - sum((c.invoices || []).filter(i => i.sent), i => i.amount || 0)))} right now) on top of anything else selected above — use for a final/closing invoice.</span>
  </div>`;

  // ---- Session 26: Contract True-Up ledger ----
  // Its own card below the phase table. One row per phase that is owed money
  // on work already done, each with a slider choosing what share of that
  // shortfall goes on this invoice.
  const gapTotal = trueupEntries.reduce((s, e) => s + e.gap, 0);
  const excludedGap = excludedShortfallTotal(c);
  let ledgerHtml = '';
  if (trueupEntries.length > 0) {
    ledgerHtml = `<div class="cu-ledger-card">
      <div class="cu-ledger-head">
        <div class="cu-ledger-title">Contract True-Up <span class="amt">${fmt0(gapTotal)} available</span></div>
        <div class="cu-ledger-sub">Work already completed on the phases below was invoiced under a smaller contract fee. &ldquo;Gap&rdquo; is what each phase is still owed at today&rsquo;s fee of ${fmt0(totalFee)}. Drag a slider to choose how much of that gap goes on this invoice.${excludedGap > 0.5 ? ` Deposit is excluded from true-up by policy (${fmt0(excludedGap)} not billed).` : ''}</div>
      </div>
      <div class="cu-ledger-table">
        <div class="lh">Phase</div><div class="lh">Worth today</div><div class="lh">Billed to date</div><div class="lh">Gap</div><div class="lh">Include on this invoice</div>` +
      trueupEntries.map(e => {
        const pct = parseFloat(IB_STATE.trueupPct[e.p]) || 0;
        return `<div class="lr" data-trueup-row="${e.p}">
          <div class="lname">${e.p}${e.locked ? '' : ' <span class="lnote">(in progress)</span>'}</div>
          <div class="lfee">${fmt0(e.earned)}</div>
          <div class="lbilled">${fmt0(e.billed)}</div>
          <div class="lgap">${fmt0(e.gap)}</div>
          <div class="lslide">
            <input type="range" class="ib-trueup-slider" min="0" max="100" step="5" value="${pct}" data-trueup="${e.p}">
            <span class="lamt" data-trueup-amt="${e.p}">${fmt0(e.gap * pct / 100)}</span>
            <span class="lpct" data-trueup-pct="${e.p}">${pct}%</span>
          </div>
        </div>`;
      }).join('') +
      `</div>
      <div class="cu-ledger-foot">
        <span class="lbl">Selected for this invoice</span>
        <span class="val" id="ib_trueup_selected">${fmt0(trueupSelectedTotal(c))}</span>
        <button type="button" class="action ghost small" id="ib_trueup_all">Include all</button>
        <button type="button" class="action ghost small" id="ib_trueup_none">Clear</button>
      </div>
    </div>`;
  }
  html += ledgerHtml;

  phases.innerHTML = html;

  // Shared updater: given a phase and a new cumulative percent, updates
  // IB_STATE plus every control that reflects it (slider, this-invoice $
  // field + %, catch-up checkbox, remaining) without a full re-render. Used
  // by the catch-up checkbox/toolbar buttons and the slider/this-invoice
  // handlers below, so all of a phase's controls always agree — there is
  // exactly one place this update logic lives now, not four.
  function applyPhasePct(p, newPct) {
    newPct = Math.max(prior[p], Math.min(100, newPct));
    IB_STATE.phaseProgress[p] = newPct;
    const row = phases.querySelector(`.ib-phase-row[data-phase="${p}"]`);
    if (row) {
      // Session 27: same dollar-headroom cap as the initial render — see
      // phaseThisInvoiceAmt/phaseRemainingAmt.
      const thisAmt = phaseThisInvoiceAmt(c, p, prior[p], newPct);
      const remainingAmt = phaseRemainingAmt(c, p, prior[p], newPct);
      const slider = row.querySelector('.ib-phase-slider');
      if (slider) slider.value = Math.round(newPct);
      const thisInput = row.querySelector('.ib-phase-this-input');
      if (thisInput && document.activeElement !== thisInput) thisInput.value = fmt0(thisAmt);
      const thisPctEl = row.querySelector('.ib-phase-this-pct');
      if (thisPctEl) thisPctEl.textContent = `${newPct.toFixed(0)}%`;
      const remCell = row.querySelector('.ib-phase-remaining');
      if (remCell) remCell.textContent = fmt0(remainingAmt);
    }
    if (!IB_STATE.manualDescription) {
      $('#ib_description').value = autoGenerateDescription(c, prior, IB_STATE.phaseProgress);
    }
    updateInvoiceBuilderSummary();
  }
  // Dollar-amount convenience wrapper — converts to a percent via the
  // phase's current fee, then goes through the same path as everything
  // else. Used for 'open'-kind catch-up so it bills exactly the corrected
  // catchupAmt (which may differ slightly from a plain "jump to 100%" if
  // rounding is involved) via the normal slider/phaseProgress mechanism.
  function applyPhaseAmt(p, amt) {
    const phaseFee = ibPhaseFee(p);
    const newPct = phaseFee > 0 ? prior[p] + (amt / phaseFee) * 100 : prior[p];
    applyPhasePct(p, newPct);
  }

  // ---- Session 26: true-up ledger wiring ----
  // Patches text in place on input; never re-renders mid-drag (a re-render
  // destroys the <input type=range> under the pointer and kills the drag).
  function paintTrueupRow(p) {
    const e = trueupEntries.find(x => x.p === p);
    if (!e) return;
    const pct = parseFloat(IB_STATE.trueupPct[p]) || 0;
    const amtEl = phases.querySelector(`[data-trueup-amt="${p}"]`);
    const pctEl = phases.querySelector(`[data-trueup-pct="${p}"]`);
    if (amtEl) amtEl.textContent = fmt0(e.gap * pct / 100);
    if (pctEl) pctEl.textContent = `${pct}%`;
    const selEl = phases.querySelector('#ib_trueup_selected');
    if (selEl) selEl.textContent = fmt0(trueupSelectedTotal(c));
  }
  function setTrueupPct(p, pct) {
    IB_STATE.trueupPct[p] = Math.max(0, Math.min(100, Math.round(pct / 5) * 5));
    const sl = phases.querySelector(`.ib-trueup-slider[data-trueup="${p}"]`);
    if (sl && parseFloat(sl.value) !== IB_STATE.trueupPct[p]) sl.value = IB_STATE.trueupPct[p];
    paintTrueupRow(p);
    if (!IB_STATE.manualDescription) {
      $('#ib_description').value = autoGenerateDescription(c, prior, IB_STATE.phaseProgress);
    }
    updateInvoiceBuilderSummary();
  }
  phases.querySelectorAll('.ib-trueup-slider').forEach(sl => {
    sl.addEventListener('input', () => setTrueupPct(sl.dataset.trueup, parseFloat(sl.value) || 0));
  });
  const tuAll = $('#ib_trueup_all');
  if (tuAll) tuAll.addEventListener('click', () => trueupEntries.forEach(e => setTrueupPct(e.p, 100)));
  const tuNone = $('#ib_trueup_none');
  if (tuNone) tuNone.addEventListener('click', () => trueupEntries.forEach(e => setTrueupPct(e.p, 0)));

  // 2026-05-07: lump-sum catchup input — adds to invoice total and reduces
  // contract remaining without being attributed to any phase.
  const lumpInp = $('#ib_catchup_lumpsum');
  if (lumpInp) {
    lumpInp.addEventListener('focus', () => lumpInp.select());
    lumpInp.addEventListener('change', () => {
      const raw = (lumpInp.value || '').replace(/[^0-9.]/g, '');
      let amt = parseFloat(raw);
      if (isNaN(amt) || amt < 0) amt = 0;
      IB_STATE.lumpSumCatchup = amt;
      lumpInp.value = fmt0(amt);
      updateInvoiceBuilderSummary();
    });
  }

  // Session 27: "Bill for Fee Remaining" — bills exactly what's left on the
  // contract as of this invoice. Drives the lump-sum field (auto-calculated,
  // read-only while checked) rather than introducing a second total-override
  // mechanism, so it flows through the same, already-tested invoice-total /
  // contract-remaining math everything else uses.
  const bfrCb = $('#ib_bill_fee_remaining');
  if (bfrCb) {
    bfrCb.addEventListener('change', () => {
      IB_STATE.billFeeRemaining = bfrCb.checked;
      if (!bfrCb.checked) {
        // Leave whatever dollar figure was showing as a plain, editable
        // lump-sum amount rather than snapping back to 0 — Scott may still
        // want part of it.
      }
      renderInvoiceBuilderClient();
    });
  }

  // Bind slider changes — update display in-place to avoid destroying slider mid-drag.
  // 2026-06-22: re-enabled 5% snap on the slider per Scott (HTML step="5" plus
  // the round-to-5 below). The ib-phase-this-input dollar field still takes any amount.
  phases.querySelectorAll('.ib-phase-slider').forEach(slider => {
    slider.addEventListener('input', () => {
      const p = slider.dataset.phase;
      let newPct = parseFloat(slider.value) || 0;
      newPct = Math.round(newPct / 5) * 5;  // snap to 5% increments
      if (newPct < prior[p]) {
        newPct = Math.ceil(prior[p] / 5) * 5;  // never below already-billed, snapped to 5%
      }
      applyPhasePct(p, newPct);
    });
  });

  // 2026-05-07: bind editable "this invoice" amount inputs.
  // User types a dollar amount → compute percent, move slider, update displays.
  // Bidirectional with the slider: typing here moves the slider; sliding moves this.
  phases.querySelectorAll('.ib-phase-this-input').forEach(inp => {
    inp.addEventListener('focus', () => inp.select());
    inp.addEventListener('change', () => {
      const p = inp.dataset.phase;
      const raw = (inp.value || '').replace(/[^0-9.]/g, '');
      const amt = parseFloat(raw);
      const phaseFee = ibPhaseFee(p);
      if (phaseFee <= 0 || isNaN(amt) || amt < 0) {
        // Bad input — restore current display
        const cp = IB_STATE.phaseProgress[p];
        const tp = Math.max(0, cp - prior[p]);
        inp.value = fmt0(phaseFee * tp / 100);
        return;
      }
      // amt is the amount BILLED ON THIS INVOICE for this phase.
      // newPct = priorPct + (amt / phaseFee) × 100, clamped to [priorPct, 100].
      const newPct = prior[p] + (amt / phaseFee) * 100;
      applyPhasePct(p, newPct);
      // applyPhasePct skips the focused input so it doesn't clobber typing —
      // but this IS that input, so reformat it to the resolved amount now.
      const resolvedPct = IB_STATE.phaseProgress[p];
      inp.value = fmt0(phaseFee * Math.max(0, resolvedPct - prior[p]) / 100);
    });
  });

  // Wire phase Complete checkbox.
  // Session 17 rethink: this used to write directly into c.phase_locks and
  // call markDirty() the instant the box was clicked — a phase could get
  // PERMANENTLY locked (and the client record saved to localStorage /
  // scheduled for a GitHub push) just from exploring the form, even if the
  // invoice was never generated or saved. Now it only moves this phase's
  // slider to 100% (or back down to where it was billed through before) in
  // local IB_STATE, exactly like dragging the slider all the way over — no
  // client mutation, no save. The actual lock — capturing today's dollar
  // amount and freezing it — happens once, at Generate/Save time, in
  // autoLockCompletedPhases(), which already runs for slider-driven
  // completions and now handles checkbox-driven ones the same way.
  //
  // Session 27: unchecking a phase that's LOCKED (from a genuinely saved
  // past invoice) is now allowed — Scott needs a way to correct a phase
  // that got marked Complete by mistake. This DOES mutate saved client data
  // immediately (unlike the session-only checked/unchecked toggle above), so
  // it's gated behind a confirm(), same pattern as deleting an invoice or a
  // client. Re-checking it afterward does not restore the old lock amount —
  // it goes back through the normal formula/derived-split math, same as any
  // other phase.
  phases.querySelectorAll('.ib-phase-complete-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const p = cb.dataset.phase;
      if (isPhaseLocked(p) && !cb.checked) {
        const lockAmt = fmt0((c.phase_locks[p] && c.phase_locks[p].amount) || 0);
        const ok = confirm(
          `${p} is locked at ${lockAmt} from a past invoice.\n\n` +
          `Unchecking it will unlock the phase — future invoices will recompute its share ` +
          `from scratch instead of using that frozen amount. This does NOT undo or change ` +
          `any money already billed on past invoices; it only affects how new invoices split ` +
          `the current contract fee.\n\nUnlock ${p}?`
        );
        if (!ok) { cb.checked = true; return; }
        c.phase_locks[p] = { locked: false, amount: 0, locked_at: '' };
        // Pull the slider back down to whatever real invoice history shows,
        // same as unchecking a session-only 100% phase.
        IB_STATE.phaseProgress[p] = prior[p];
        if (IB_STATE.phaseFeeOverrides) delete IB_STATE.phaseFeeOverrides[p];
        markDirty();
        if (!IB_STATE.manualDescription) {
          $('#ib_description').value = autoGenerateDescription(c, prior, IB_STATE.phaseProgress);
        }
        renderInvoiceBuilderClient();
        return;
      }
      if (isPhaseLocked(p)) { cb.checked = true; return; }  // already locked + checked: no-op
      IB_STATE.phaseProgress[p] = cb.checked ? 100 : prior[p];
      // Unchecking releases this phase back to the formula/lock-based amount —
      // clear any manual override so it stops pinning the dollar figure.
      // Checking does NOT touch an existing override: resolveIbPhaseFee already
      // honors the override first, so checking Complete after typing a custom
      // dollar amount locks in THAT amount (e.g. "actual deposit collected was
      // $19,250, not the formula $4,250 — mark it complete at the real number").
      if (!cb.checked && IB_STATE.phaseFeeOverrides) delete IB_STATE.phaseFeeOverrides[p];
      if (!IB_STATE.manualDescription) {
        $('#ib_description').value = autoGenerateDescription(c, prior, IB_STATE.phaseProgress);
      }
      // Full re-render so dollar amounts redistribute and disabled state updates.
      renderInvoiceBuilderClient();
    });
  });

  // Session 9: wire phase fee inputs — direct dollar override for this invoice session.
  // Session 17: overriding ONE phase's fee now changes every OTHER unlocked
  // phase's formula share too (resolveIbPhaseFee folds overrides into the
  // same redistribution math as locks), so a partial DOM patch of just this
  // row is no longer enough — do a full re-render, same as the Complete
  // checkbox already does, so every row + the catchup panel + the summary
  // total all recompute together and stay consistent.
  phases.querySelectorAll('.ib-phase-fee-input').forEach(input => {
    input.addEventListener('focus', () => input.select());
    input.addEventListener('change', () => {
      const p = input.dataset.phase;
      const raw = (input.value || '').replace(/[^0-9.]/g, '');
      const val = parseFloat(raw);
      if (!isNaN(val) && val >= 0) {
        IB_STATE.phaseFeeOverrides[p] = val;
      } else {
        delete IB_STATE.phaseFeeOverrides[p];
      }
      renderInvoiceBuilderClient();
    });
  });

  if (!IB_STATE.manualDescription) {
    $('#ib_description').value = autoGenerateDescription(c, prior, IB_STATE.phaseProgress);
  }
  updateInvoiceBuilderSummary();
}

function renderInvoiceBuilderPastInvoices(client) {
  const wrap  = $('#ib_pastInvoicesWrap');
  const tbody = $('#ib_pastInvoicesBody');
  const tfoot = $('#ib_pastInvoicesFoot');
  const countEl = $('#ib_pastInvoicesCount');
  if (!wrap || !tbody || !tfoot) return;
  const realInvs = (client.invoices || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const invoices = [];
  if (client.deposit_paid) {
    invoices.push({
      id: 'deposit-' + client.id,
      _deposit: true,
      date: client.deposit_paid_at || '',
      amount: parseFloat(client.deposit_paid_amount) || 0,
      note: 'Deposit (received outside of invoicing)',
      sent: true, paid: true,
    });
  }
  const _pocCredit = (typeof pocCreditFor === 'function') ? pocCreditFor(client) : 0;
  if (_pocCredit > 0) {
    invoices.push({
      id: 'poc-' + client.id,
      _poc: true,
      date: client.poc_at || '',
      amount: _pocCredit,
      note: 'Proof of Concept (credited to deposit)',
      sent: true, paid: true,
    });
  }
  for (const i of realInvs) invoices.push(i);
  // Invoice count badge shown next to the Past Invoices h3 title.
  if (countEl) {
    countEl.textContent = invoices.length
      ? `${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`
      : '0 invoices';
  }
  if (invoices.length === 0) {
    wrap.hidden = false;
    tbody.innerHTML = `<tr><td colspan="5" class="client-invoices-empty">No invoices yet for this client — this will be the first.</td></tr>`;
    tfoot.innerHTML = '';
    return;
  }
  wrap.hidden = false;
  tbody.innerHTML = invoices.map(inv => {
    const sentDot = inv.sent ? '<span class="dot on" title="sent"></span>' : '<span class="dot" title="drafted"></span>';
    const paidDot = inv.paid ? '<span class="dot paid" title="paid"></span>' : '<span class="dot" title="not paid yet"></span>';
    const rowCls = inv.paid ? 'inv-paid' : (inv.sent ? 'inv-outstanding' : '');
    return `<tr data-invoice-id="${inv.id}" class="${rowCls}">
      <td class="col-date">${fmtDate(inv.date)}</td>
      <td class="col-num">${fmt0(inv.amount)}</td>
      <td class="col-note">${escapeHtml(inv.note || '')}</td>
      <td class="col-status">${sentDot}</td>
      <td class="col-status">${paidDot}</td>
    </tr>`;
  }).join('');
  const totalSent = sum(invoices.filter(i => i.sent), i => i.amount);
  const totalPaid = sum(invoices.filter(i => i.paid), i => i.amount);
  const outstanding = totalSent - totalPaid;
  const outClass = outstanding > 0 ? 'has-outstanding' : '';
  // Contract fee remaining = current contract fee minus everything billed (sent)
  // to date. Previously this was referenced in the totals row below but never
  // defined, throwing a ReferenceError that aborted the whole invoice-builder
  // render (info panel + phase sliders) for any client with >=1 past invoice.
  const feeRemaining = (currentClientFee(client) || 0) - totalSent;
  // 2026-05-23: invoice count moved into the h3 (#ib_pastInvoicesCount) so the
  // totals row only shows Sent / Paid / Outstanding now.
  tfoot.innerHTML = `<div style="display:grid;grid-template-columns:1fr auto;gap:6px 18px;padding:16px 0 0;border-top:2px solid var(--ink);align-items:baseline;">
    <span style="font-family:var(--titling);font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--ink-mute);">Sent</span><span class="cc-num-tab" style="font-family:var(--sans-cond);font-size:16px;text-align:right;color:var(--ink);">${fmt0(totalSent)}</span>
    <span style="font-family:var(--titling);font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--ink-mute);">Paid</span><span class="cc-num-tab" style="font-family:var(--sans-cond);font-size:16px;text-align:right;color:var(--forest);">${fmt0(totalPaid)}</span>
    <span style="font-family:var(--titling);font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--ink-mute);">Outstanding</span><span class="cc-num-tab" style="font-family:var(--sans-cond);font-size:16px;text-align:right;color:${outstanding>0?'var(--alert)':'var(--ink)'};">${fmt0(outstanding)}</span>
    <span style="font-family:var(--display);font-weight:700;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--rust);border-top:1px solid var(--hairline);padding-top:10px;">${invoices.length} invoices &middot; Fee Remaining</span><span class="cc-num-tab" style="font-family:var(--sans-comp);font-size:22px;text-align:right;color:var(--rust);border-top:1px solid var(--hairline);padding-top:8px;">${fmt0(feeRemaining)}</span>
  </div>`;
  tbody.querySelectorAll('tr[data-invoice-id]').forEach(tr => {
    tr.addEventListener('click', () => {
      const invId = tr.dataset.invoiceId;
      if (invId && invId.startsWith('deposit-')) return;  // Synthetic deposit row.
      openInvoiceEditor(client.id, invId);
    });
  });
}

function autoGenerateDescription(client, prior, current) {
  const parts = [];
  const phaseLabels = {
    DEPOSIT: 'Deposit',
    SD: 'Schematic Design',
    DD: 'Design Development',
    CD: 'Construction Documents',
    CA: 'Construction Administration'
  };
  for (const p of PHASE_NAMES) {
    const cur = current[p];
    const pri = prior[p];
    const delta = cur - pri;
    if (delta < 1) continue;  // Skip phases with no new work
    if (cur >= 100 && pri < 100) {
      parts.push(`${phaseLabels[p]} complete`);
    } else if (pri === 0 && cur > 0) {
      parts.push(`${phaseLabels[p]} ${cur.toFixed(0)}% complete`);
    } else {
      parts.push(`${phaseLabels[p]} progressed from ${pri.toFixed(0)}% to ${cur.toFixed(0)}%`);
    }
  }
  // Session 26: mention any contract true-up on the invoice description, in
  // client-facing language. A true-up is a price correction on completed
  // work, so it reads separately from phase progress.
  const c2 = client;
  if (c2 && c2.is_phased && IB_STATE.trueupPct) {
    const tuPhases = computeTrueupEntries(c2)
      .filter(e => (parseFloat(IB_STATE.trueupPct[e.p]) || 0) > 0)
      .map(e => phaseLabels[e.p] || e.p);
    if (tuPhases.length) {
      parts.push(`${tuPhases.join(', ')} adjusted to the revised contract fee`);
    }
  }
  return parts.join('; ') || 'Architectural services';
}

function updateInvoiceBuilderSummary() {
  const c = DATA.clients.find(x => x.id === IB_STATE.clientId);
  if (!c) {
    ['ib_sum_fee','ib_sum_reimb','ib_sum_outstanding','ib_sum_total','ib_sum_paid_to_date','ib_sum_remaining']
      .forEach(id => $('#' + id).textContent = '—');
    return;
  }

  let feeForWork;
  if (c.is_phased) {
    const prior = priorPhaseProgress(c);
    feeForWork = 0;
    for (const p of PHASE_NAMES) {
      // Session 27: capped at each phase's true dollar headroom (not just
      // what percent implies) — see phaseThisInvoiceAmt. This is the number
      // that actually gets billed, so it has to agree with the phase table.
      feeForWork += phaseThisInvoiceAmt(c, p, prior[p], IB_STATE.phaseProgress[p]);
    }
  } else {
    feeForWork = parseFloat(IB_STATE.flatAmount) || 0;
  }

  const reimb = currencyVal($('#ib_reimb'));
  const outstanding = currencyVal($('#ib_outstanding'));
  const otherTotal = (IB_STATE.otherItems || []).reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);
  // Session 20: catch-up picker for LOCKED phases only — recomputed
  // independently here (not read from a render-time closure, since this
  // function is called from many places that don't have one) via the same
  // computeTrueupEntries() the phase table uses, so the two never disagree.
  // 'open'-kind catch-up isn't added here: it's a slider position (drives
  // IB_STATE.phaseProgress), already counted in the per-phase loop above.
  // Same treatment as lump-sum: flows into the invoice total and counts as
  // billed against the contract.
  // Session 26: contract true-up selected in the ledger. Recomputed here
  // rather than read from a render closure, since this function is called
  // from many places that don't have one. Like lump-sum, it flows into the
  // invoice total AND counts as billed against the contract.
  const trueupAmt = trueupSelectedTotal(c);
  const progressFee = feeForWork;

  // Full-contract math: paid-to-date and remaining run against the full contract
  // fee, not the year-scoped value (which is reserved for year-end reporting).
  const contractFee = currentClientFee(c) || 0;
  const billedToDate = sum((c.invoices || []).filter(i => i.sent), i => i.amount || 0);

  // Session 27: "Bill for Fee Remaining" — keep the lump-sum figure live
  // against whatever's currently selected (phase progress + true-up), not
  // just what it was at the last full render. This is the function every
  // slider/checkbox handler calls, so recomputing it here is what makes the
  // box track live drags, not just re-renders.
  let lumpSumCatchup = parseFloat(IB_STATE.lumpSumCatchup) || 0;
  if (IB_STATE.billFeeRemaining) {
    lumpSumCatchup = Math.max(0, contractFee - billedToDate - progressFee - trueupAmt);
    IB_STATE.lumpSumCatchup = lumpSumCatchup;
    const lumpInp = $('#ib_catchup_lumpsum');
    if (lumpInp && document.activeElement !== lumpInp) lumpInp.value = fmt0(lumpSumCatchup);
  }
  // 2026-05-07: lump-sum catchup is added to feeForWork so it both flows into
  // the invoice total AND reduces the contract remaining (counts as billed
  // against the contract, not as a reimbursable/extra).
  feeForWork = feeForWork + lumpSumCatchup + trueupAmt;
  const total = feeForWork + reimb + outstanding + otherTotal;

  const paidToDate = billedToDate + feeForWork;
  const remaining = contractFee - paidToDate;

  $('#ib_sum_fee').textContent = fmt0(progressFee + lumpSumCatchup);
  const tuRow = $('#ib_sum_trueup_row');
  const tuCell = $('#ib_sum_trueup');
  if (tuRow) tuRow.style.display = (trueupAmt > 0.5 || (c.is_phased && computeTrueupEntries(c).length > 0)) ? '' : 'none';
  if (tuCell) tuCell.textContent = fmt0(trueupAmt);
  $('#ib_sum_reimb').textContent = fmt0(reimb);
  $('#ib_sum_outstanding').textContent = fmt0(outstanding);

  // Other items summary row
  const otherRow = $('#ib_sum_other_row');
  const otherCell = $('#ib_sum_other');
  const otherLabel = $('#ib_sum_other_label');
  if (otherRow) {
    if (otherTotal !== 0) {
      otherRow.style.display = '';
      const labels = (IB_STATE.otherItems || []).filter(it => it.label).map(it => it.label).join(', ');
      if (otherLabel) otherLabel.textContent = labels || 'Other items';
      if (otherCell) otherCell.textContent = fmt0(otherTotal);
    } else {
      otherRow.style.display = 'none';
    }
  }

  $('#ib_sum_total').textContent = fmt0(total);
  $('#ib_sum_paid_to_date').textContent = fmt0(paidToDate);
  $('#ib_sum_remaining').textContent = fmt0(remaining);

  renderFeeCalcPanel(c, { progressFee, lumpSumCatchup, trueupAmt, reimb, outstanding, otherTotal, total, billedToDate, contractFee });

  return { feeForWork, reimb, outstanding, otherTotal, otherItems: IB_STATE.otherItems || [], total, paidToDate, remaining, trueupAmt };
}

function onInvoiceClientChange() {
  IB_STATE.clientId = $('#ib_client').value;
  IB_STATE.initializedFor = null;  // Force re-init of progress
  // Other/misc line items are per-invoice, not global. Clear them when the user
  // switches clients so one client's items don't leak onto every other client.
  IB_STATE.otherItems = [];
  IB_STATE.phaseFeeOverrides = {};
  IB_STATE.lumpSumCatchup = 0;
  IB_STATE.trueupPct = {};
  IB_STATE.billFeeRemaining = false;
  renderInvoiceBuilderClient();
  if (typeof renderOtherItems === 'function') renderOtherItems();
}

function resetInvoiceBuilder() {
  IB_STATE = {
    clientId: $('#ib_client').value,
    phaseProgress: { DEPOSIT: 0, SD: 0, DD: 0, CD: 0, CA: 0 },
    manualDescription: false,
    initializedFor: null,
    otherItems: [],
    lumpSumCatchup: 0,
    trueupPct: {},
    billFeeRemaining: false,
  };
  $('#ib_date').value = new Date().toISOString().slice(0, 10);
  $('#ib_number').value = '';
  setCurrencyVal($('#ib_reimb'), 0);
  setCurrencyVal($('#ib_outstanding'), 0);
  renderOtherItems();
  renderInvoiceBuilderClient();
}

// After an invoice that drives a phase to 100%, lock that phase's dollar amount
// on the client so future fee changes don't move it.
// Toggle the "Deposit Paid" state on a client. When on, lock DEPOSIT phase
// at the deposit dollar amount; when off, release it.
function setDepositPaid(client, paid, explicitAmount) {
  // Session 13: explicitAmount is optional. If provided (>0) we use it as the
  // amount actually collected. Otherwise we fall back to the calculated
  // deposit (fee × deposit %). When the explicit amount is LESS than the
  // calculated deposit, recomputePhaseAmounts() rolls the shortfall into the
  // SD phase (or next non-zero phase) so the contract still bills the full fee.
  const phases = client.phases || { DEPOSIT: 0.05, SD: 0.20, DD: 0.20, CD: 0.50, CA: 0.05 };
  const depWeight = parseFloat(phases.DEPOSIT) || 0;
  const fee = (typeof currentClientFee === 'function') ? (currentClientFee(client) || 0) : (computeClientFee(client) || 0);
  const computedDep = Math.round(fee * depWeight);
  const explicit = (explicitAmount != null && !isNaN(explicitAmount) && Number(explicitAmount) > 0)
    ? Math.round(Number(explicitAmount))
    : null;
  const depAmt = explicit != null ? explicit : computedDep;
  if (!client.phase_locks) client.phase_locks = {};
  if (paid) {
    client.deposit_paid = true;
    if (!client.deposit_paid_at) client.deposit_paid_at = nowIsoDate();
    client.deposit_paid_amount = depAmt;
    client.phase_locks.DEPOSIT = { locked: true, amount: depAmt, locked_at: client.deposit_paid_at };
  } else {
    client.deposit_paid = false;
    client.deposit_paid_at = '';
    client.deposit_paid_amount = 0;
    client.phase_locks.DEPOSIT = { locked: false, amount: 0, locked_at: '' };
  }
}

// Session 17 rethink: this used to reimplement the lock/redistribute formula
// itself (a second copy of what's now in resolveIbPhaseFee), which meant it
// didn't know about IB_STATE.phaseFeeOverrides — a phase completing in the
// same invoice as an override on another phase got locked at the WRONG
// dollar amount (the pre-Fix-A share), permanently baking the "doesn't add
// up" bug into saved data. It now just calls resolveIbPhaseFee(client, p),
// so it inherits the exact same override-aware, invariant-preserving
// calculation used everywhere else in the builder. totalFee/phaseWeights are
// kept as params for call-site compatibility but are no longer used here —
// resolveIbPhaseFee derives them itself from `client`.
// Locking phases one at a time (in PHASE_NAMES order) as each is found
// complete is mathematically equivalent to computing them all from a single
// upfront snapshot: locking phase A removes it from the pool, but phase B's
// share of what's left, at B's original weight, works out to the exact same
// dollar figure as if both had been split from the full pool at once — the
// proportional math telescopes cleanly regardless of order.
// Session 26: when a contract true-up is billed on a LOCKED phase, that
// phase's stored lock amount has to grow by the amount billed. The lock
// amount IS "dollars invoiced against this phase" — it's the second term in
// the shortfall calculation — so leaving it stale would re-offer the same
// true-up on every subsequent invoice, forever.
//
// In-progress phases need no equivalent: their billed-to-date is derived as
// (total invoiced - sum of locked amounts), so once the locked phases are
// bumped correctly the leftover lands on them automatically and the whole
// ledger reconciles back to zero.
//
// Called from generateInvoice() and saveDraftInvoice() with the SAME
// per-phase amounts written into the invoice record, so the record and the
// locks can never disagree.
function applyTrueupToLocks(client, catchupByPhase) {
  if (!catchupByPhase) return;
  if (!client.phase_locks) client.phase_locks = {};
  for (const p of Object.keys(catchupByPhase)) {
    const amt = parseFloat(catchupByPhase[p]) || 0;
    if (amt <= 0) continue;
    const lk = client.phase_locks[p];
    if (lk && lk.locked) {
      lk.amount = Math.round((parseFloat(lk.amount) || 0) + amt);
      lk.trued_up_at = nowIsoDate();
    }
    // Not locked: nothing to bump. The derived split picks it up.
  }
}

function autoLockCompletedPhases(client, prevProgress, newProgress, totalFee, phaseWeights) {
  if (!client.phase_locks) client.phase_locks = {};
  for (const p of PHASE_NAMES) {
    const wasComplete = (prevProgress[p] || 0) >= 100;
    const isComplete  = (newProgress[p]  || 0) >= 100;
    if (isComplete && !wasComplete) {
      if (!client.phase_locks[p]) client.phase_locks[p] = { locked:false, amount:0, locked_at:'' };
      if (!client.phase_locks[p].locked) {
        const amt = resolveIbPhaseFee(client, p);
        client.phase_locks[p] = { locked: true, amount: Math.round(amt), locked_at: nowIsoDate() };
      }
    }
  }
}

async function generateInvoice() {
  console.log('[generateInvoice] click registered, IB_STATE=', IB_STATE);
  try {
    const c = DATA.clients.find(x => x.id === IB_STATE.clientId);
    if (!c) { toast('Pick a client first', 'error'); return; }

    // Defensive: phase_progress may not be initialized yet
    if (!IB_STATE.phaseProgress) {
      IB_STATE.phaseProgress = { DEPOSIT: 0, SD: 0, DD: 0, CD: 0, CA: 0 };
    }

    const summary = updateInvoiceBuilderSummary();
    if (!summary || summary.total <= 0) {
      toast('Total is zero — adjust the sliders or enter expenses', 'error');
      return;
    }

    const date = $('#ib_date').value || new Date().toISOString().slice(0, 10);
    const invoiceYear = new Date(date + 'T12:00:00').getFullYear();
    let invoiceNumber = $('#ib_number').value.trim();
    if (!invoiceNumber) {
      invoiceNumber = consumeInvoiceNumber(invoiceYear);
    } else {
      // If user typed a number, try to extract the numeric part (handles "26-421", "421", "0421")
      const m = invoiceNumber.match(/(\d+)\s*$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n) && n >= (DATA.invoice_counter || 0)) {
          DATA.invoice_counter = n + 1;
        }
      }
    }

    const description = $('#ib_description').value.trim() || 'Architectural services';

    // Save the invoice record
    const invRecord = {
      id: uuid(),
      number: invoiceNumber,
      date: date,
      amount: summary.total,
      note: description,
      sent: true,
      paid: false,
      reimbursable: summary.reimb,
      outstanding_prior: summary.outstanding,
      other_items: (IB_STATE.otherItems || []).filter(it => it.amount),
      phase_progress: { ...IB_STATE.phaseProgress },
      lump_sum_catchup: parseFloat(IB_STATE.lumpSumCatchup) || 0,
      catchup_by_phase: selectedCatchupByPhase(c),
    };
    c.invoices.push(invRecord);
    // Auto-lock any phase that just reached 100% so future fee changes don't move it.
    try {
      const __prevProg = priorPhaseProgress(c);
      const __pw = c.phases || { DEPOSIT:0.05, SD:0.20, DD:0.20, CD:0.50, CA:0.05 };
      const __tf = currentClientFee(c) || 0;
      autoLockCompletedPhases(c, __prevProg, IB_STATE.phaseProgress || {}, __tf, __pw);
      // Session 26: roll this invoice's true-up into the phase locks so it is
      // not offered again next time. Order matters — after autoLock, so a
      // phase completing on THIS invoice locks at its fee first, then takes
      // its true-up on top.
      applyTrueupToLocks(c, invRecord.catchup_by_phase);
    } catch (e) { console.warn('autoLock failed', e); }
    markDirty();

    // Generate Word doc + HTML preview
    try {
      await buildAndDownloadInvoiceDoc(c, invRecord, summary, description);
      buildAndOpenInvoiceHTML(c, invRecord, summary, description);
      toast('Invoice saved — Word doc downloaded, preview opened', 'success');
    } catch (e) {
      console.error('[generateInvoice] doc generation failed:', e);
      toast('Doc generation failed: ' + (e && e.message ? e.message : e), 'error');
      // Roll back the saved invoice record so it does not persist on a failed build
      c.invoices.pop();
      return;
    }

    // Reset for next invoice
    IB_STATE.initializedFor = null;  // Force prior recompute (this invoice now counts)
    renderAll();
    activateTab('invoices');
  } catch (err) {
    console.error('[generateInvoice] uncaught error:', err);
    const msg = err && err.message ? err.message : String(err);
    toast('Generate failed: ' + msg, 'error');
    alert('Generate Invoice failed:\n\n' + msg + '\n\nOpen the browser console (Cmd+Opt+J in Chrome, Cmd+Opt+I -> Console in Safari) for the full stack trace.');
  }
}


// 2026-05-23: Preview & Print to PDF — opens the existing HTML preview window
// using the current Create Invoice state, but does NOT generate a .docx, does
// NOT save an invoice record, and does NOT mutate state. The preview window's
// own "Print / Save as PDF" button (window.print()) is what converts to PDF —
// the browser uses the user's installed Mac fonts (Goudy Old Style, Warnock
// Pro, Columbia Titling Standard via Adobe Fonts/Typekit), giving a true-fonts
// PDF that the sandbox can't produce on its own.
function previewInvoiceForPrint() {
  try {
    const c = DATA.clients.find(x => x.id === IB_STATE.clientId);
    if (!c) { toast('Pick a client first', 'error'); return; }
    if (!IB_STATE.phaseProgress) {
      IB_STATE.phaseProgress = { DEPOSIT: 0, SD: 0, DD: 0, CD: 0, CA: 0 };
    }
    const summary = updateInvoiceBuilderSummary();
    if (!summary || summary.total <= 0) {
      toast('Total is zero — adjust the sliders or enter expenses', 'error');
      return;
    }
    const date = $('#ib_date').value || new Date().toISOString().slice(0, 10);
    const description = $('#ib_description').value.trim() || 'Architectural services';
    // Synthetic invRecord — never persisted; only used to drive the preview HTML.
    const invRecord = {
      id: 'preview',
      number: $('#ib_number').value.trim() || 'PREVIEW',
      date: date,
      amount: summary.total,
      note: description,
      sent: false,
      paid: false,
    };
    buildAndOpenInvoiceHTML(c, invRecord, summary, description);
  } catch (err) {
    console.error('[previewInvoiceForPrint] failed:', err);
    toast('Preview failed: ' + (err && err.message ? err.message : err), 'error');
  }
}

async function saveDraftInvoice() {
  const c = DATA.clients.find(x => x.id === IB_STATE.clientId);
  if (!c) { toast('Pick a client first', 'error'); return; }

  const summary = updateInvoiceBuilderSummary();
  if (!summary || summary.total <= 0) {
    toast('Total is zero — adjust the sliders or enter expenses', 'error');
    return;
  }

  const date = $('#ib_date').value || new Date().toISOString().slice(0, 10);
  const invoiceYear = new Date(date + 'T12:00:00').getFullYear();
  let invoiceNumber = $('#ib_number').value.trim();
  if (!invoiceNumber) {
    invoiceNumber = consumeInvoiceNumber(invoiceYear);
  } else {
    const m = invoiceNumber.match(/(\d+)\s*$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n >= (DATA.invoice_counter || 0)) {
        DATA.invoice_counter = n + 1;
      }
    }
  }

  const description = $('#ib_description').value.trim() || 'Architectural services';

  const invRecord = {
    id: uuid(),
    number: invoiceNumber,
    date: date,
    amount: summary.total,
    note: description,
    sent: false,
    paid: false,
    reimbursable: summary.reimb,
    outstanding_prior: summary.outstanding,
    other_items: (IB_STATE.otherItems || []).filter(it => it.amount),
    phase_progress: { ...IB_STATE.phaseProgress },
    lump_sum_catchup: parseFloat(IB_STATE.lumpSumCatchup) || 0,
    catchup_by_phase: selectedCatchupByPhase(c),
  };
  c.invoices.push(invRecord);
  // Auto-lock any phase that just reached 100% so future fee changes don't move it.
  try {
    const __prevProg2 = priorPhaseProgress(c);
    const __pw2 = c.phases || { DEPOSIT:0.05, SD:0.20, DD:0.20, CD:0.50, CA:0.05 };
    const __tf2 = currentClientFee(c) || 0;
    autoLockCompletedPhases(c, __prevProg2, IB_STATE.phaseProgress || {}, __tf2, __pw2);
    applyTrueupToLocks(c, invRecord.catchup_by_phase);
  } catch (e) { console.warn('autoLock(draft) failed', e); }
  markDirty();

  IB_STATE.initializedFor = null;
  renderAll();
  toast('Draft saved — invoice not yet sent', 'success');
  activateTab('invoices');
}


// ===============================================================
// PDF GENERATION (jsPDF)
// ===============================================================
function buildAndOpenInvoiceHTML(client, invRecord, summary, description) {
  // HTML preview that mirrors the .docx layout produced by
  // buildAndDownloadInvoiceDoc — same letterhead images, same rust/peach
  // palette, same section order, same wording.
  const firm = DATA.firm || defaultFirm();
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const $fmt = n => '$' + Math.round(Number(n)||0).toLocaleString('en-US');
  const $fmtPlain = n => Math.round(Number(n)||0).toLocaleString('en-US');

  const dateStrLong = invRecord.date
    ? new Date(invRecord.date + 'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})
    : invRecord.date;

  // Bold phase prefix detection (mirrors the .docx)
  const phaseLabels = ['Schematic Design','Design Development','Construction Documents','Construction Administration','Deposit'];
  const descTrim = (description || '').trim();
  let matchedPhase = null;
  for (const ph of phaseLabels) {
    if (descTrim.toLowerCase().startsWith(ph.toLowerCase())) { matchedPhase = ph; break; }
  }
  let workCompletedHTML;
  if (matchedPhase) {
    const rest = descTrim.slice(matchedPhase.length).trim();
    workCompletedHTML = `<strong>${esc(matchedPhase)}</strong>${rest ? ' <em>' + esc(rest) + '</em>' : ''}`;
  } else if (descTrim) {
    workCompletedHTML = `<em>${esc(descTrim)}</em>`;
  } else {
    workCompletedHTML = `<em>Architectural services</em>`;
  }
  const feeWorkDescText = matchedPhase
    ? `${matchedPhase} phase, this invoice`
    : 'Architectural services, this invoice';

  // "To" lines — same heuristic as the .docx
  const toLines = [];
  const fullName = (client.full_name || client.name || '').trim();
  if (fullName) toLines.push(fullName);
  const projAddr = (client.project_address || client.address || '').trim();
  if (projAddr) {
    const parts = projAddr.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 3) {
      toLines.push(parts[0]);
      toLines.push(parts.slice(1).join(', '));
    } else if (parts.length === 2) {
      toLines.push(parts[0]); toLines.push(parts[1]);
    } else {
      toLines.push(projAddr);
    }
  }
  const toHTML = toLines.map(esc).join('<br>');

  // Detail rows below the To / Work Completed pair
  const reimbHTML = summary.reimb > 0
    ? `<tr>
         <td class="lbl small">Reimbursable Expenses</td>
         <td class="desc"><em>Reimbursable expenses, this invoice</em></td>
         <td class="amt">${esc($fmt(summary.reimb))}</td>
       </tr>`
    : `<tr>
         <td class="lbl small">Reimbursable Expenses</td>
         <td class="desc" colspan="2"><em>None this invoice</em></td>
       </tr>`;

  const outstandingHTML = summary.outstanding > 0
    ? `<tr>
         <td class="lbl small">Outstanding Invoices</td>
         <td class="desc"><em>Outstanding from prior invoices</em></td>
         <td class="amt">${esc($fmt(summary.outstanding))}</td>
       </tr>`
    : `<tr>
         <td class="lbl small">Outstanding Invoices</td>
         <td class="desc" colspan="2"><em>None</em></td>
       </tr>`;

  const otherItemsHTML = (summary.otherItems || [])
    .filter(it => it && it.amount)
    .map(it => `
       <tr>
         <td class="lbl">${esc((it.label||'Other').toUpperCase())}</td>
         <td class="desc"><em>${esc(it.label || 'Other item')}</em></td>
         <td class="amt">${esc($fmt(it.amount))}</td>
       </tr>`).join('');

  const yearFee = (summary.paidToDate || 0) + (summary.remaining || 0);

  const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<title>Invoice — ${esc(client.name)}</title>
<link rel="stylesheet" href="https://use.typekit.net/ikf0hkb.css">
<link rel="stylesheet" href="https://use.typekit.net/tlj7yvl.css">
<link rel="stylesheet" href="https://use.typekit.net/wup0iix.css">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: letter; margin: 0; }
  :root {
    --rust:  #C7997C;
    --ink:   #2A2520;
    --peach: #F4DDCF;
    --muted: #747474;
  }
  body {
    font-family: "miller-text","Goudy Old Style", Georgia, serif;
    color: var(--ink);
    background: white;
    font-size: 11pt;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: 8.5in;
    min-height: 11in;
    padding: 0.75in;
    margin: 0 auto;
  }
  /* --- Letterhead header image — 15% smaller than original 2.9in (matches docx) --- */
  .letterhead-header {
    text-align: center;
    margin-bottom: 0.3in;
  }
  .letterhead-header img { width: 2.48in; height: auto; }

  /* --- Title row: italic "Invoice" left, ISSUED + date right --- */
  .title-row {
    display: flex; align-items: flex-end; justify-content: space-between;
    margin-bottom: 0.15in;
  }
  .title-row .title {
    font-family: "warnock-pro","Goudy Old Style", Georgia, serif;
    font-style: italic;
    font-weight: 400;
    font-size: 42pt;
    color: var(--ink);
    line-height: 1;
  }
  .title-row .issued {
    text-align: right;
  }
  .title-row .issued-label {
    font-family: "columbia-titling","Trajan Pro 3", serif;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 8pt;
    color: var(--rust);
    margin-bottom: 0.04in;
  }
  .title-row .issued-date {
    font-style: italic;
    font-size: 11pt;
  }

  /* --- Detail table: rust top-borders per row --- */
  table.detail {
    width: 100%;
    border-collapse: collapse;
    margin-top: 0.05in;
  }
  table.detail td {
    padding: 0.13in 0.07in 0.12in 0;
    vertical-align: top;
  }
  table.detail tr td {
    border-top: 1pt solid var(--rust);
  }
  table.detail td.lbl {
    width: 1.95in;
    font-family: "columbia-titling","Trajan Pro 3", serif;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 8pt;
    color: var(--rust);
  }
  /* 2026-05-23: 6.5pt for the four interior row labels (matches docx) */
  table.detail td.lbl.small { font-size: 6.5pt; }
  table.detail td.desc { font-size: 11pt; }
  table.detail td.desc em { font-style: italic; }
  table.detail td.desc strong { font-weight: 700; }
  table.detail td.amt {
    width: 1.6in;
    text-align: right;
    font-size: 11pt;
    padding-right: 0;
  }
  /* Total row */
  table.detail tr.total-row td {
    background: var(--peach);
    border-top: none;
    padding-top: 0.2in;
    padding-bottom: 0.2in;
    vertical-align: middle;
  }
  /* 2026-05-23: 1/8" insets on the Total Due band — matches docx */
  table.detail tr.total-row td.lbl { color: var(--rust); padding-left: 0.125in; }
  table.detail tr.total-row td.desc { font-style: italic; }
  table.detail tr.total-row td.amt {
    font-size: 20pt;
    color: var(--ink);
    font-weight: 400;
    padding-right: 0.125in;
  }

  /* --- Fee breakdown: dotted leaders. 2026-05-23: tighter top margin --- */
  .fee-breakdown { margin-top: 0.18in; }
  .fee-breakdown h3 {
    font-family: "columbia-titling","Trajan Pro 3", serif;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 8pt;
    color: var(--rust);
    margin-bottom: 0.1in;
    font-weight: 400;
  }
  .leader-row {
    display: flex; align-items: flex-end;
    color: var(--muted);
    font-size: 9pt;
    margin-bottom: 0.04in;
  }
  .leader-row .l { white-space: nowrap; }
  .leader-row .dots {
    flex: 1;
    border-bottom: 0.75pt dotted var(--muted);
    margin: 0 0.07in 2pt;
  }
  .leader-row .v { white-space: nowrap; }

  /* --- By Check / By ACH-Wire two columns --- */
  .payment-cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 0.3in;
    margin-top: 0.18in;
  }
  .payment-cols h3 {
    font-family: "columbia-titling","Trajan Pro 3", serif;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 8pt;
    color: var(--rust);
    margin-bottom: 0.08in;
    font-weight: 400;
  }
  .by-check div { font-size: 11pt; margin-bottom: 0.03in; }
  table.ach { border-collapse: collapse; font-size: 11pt; }
  table.ach td { padding: 0.015in 0; vertical-align: top; }
  table.ach td.ach-lbl { width: 1in; padding-right: 0.1in; }

  /* --- Due-on-receipt italic line --- */
  .due-receipt {
    text-align: center;
    font-style: italic;
    font-size: 11pt;
    margin: 0.24in 0;
  }

  /* --- Letterhead footer image: centered, ~7" wide --- */
  .letterhead-footer {
    text-align: center;
    margin-top: 0.2in;
  }
  /* Footer — 20% smaller than original 7in (matches docx) */
  .letterhead-footer img { width: 5.6in; max-width: 100%; height: auto; }

  /* --- Print bar (not shown on print) --- */
  .print-bar {
    position: fixed; top: 0; left: 0; right: 0;
    background: var(--ink); color: white;
    padding: 0.5rem 1rem; display: flex; align-items: center; gap: 1rem;
    font-family: sans-serif; font-size: 13px; z-index: 999;
  }
  .print-bar button {
    background: #2d5d3a; color: white; border: none;
    padding: 0.55rem 1.6rem; font-size: 14px; font-weight: 700; cursor: pointer;
    border-radius: 4px; letter-spacing: 0.04em;
  }
  .print-bar button:hover { background: #234a2e; }
  .print-bar .hint {
    color: #d9d4c6; font-size: 11px; font-style: italic;
  }
  @media print {
    .print-bar { display: none; }
    body { background: white; }
    .page { padding: 0.75in; }
  }
</style>
</head>
<body>
<div class="print-bar">
  <span>Invoice — ${esc(client.full_name||client.name)} &nbsp;·&nbsp; ${esc(dateStrLong)}</span>
  <span class="hint">Uses your installed fonts</span>
  <span style="flex:1;"></span>
  <button onclick="window.print()">Print / Save as PDF ⌘P</button>
</div>
<div class="page">

  <header class="letterhead-header">
    <img src="invoice_header.jpg" alt="Carlisle Moore Architects">
  </header>

  <div class="title-row">
    <div class="title">Invoice</div>
    <div class="issued">
      <div class="issued-label">Issued</div>
      <div class="issued-date">${esc(dateStrLong)}</div>
    </div>
  </div>

  <table class="detail">
    <tr>
      <td class="lbl">To</td>
      <td class="desc" colspan="2">${toHTML}</td>
    </tr>
    <tr>
      <td class="lbl small">Work Completed This Invoice</td>
      <td class="desc" colspan="2">${workCompletedHTML}</td>
    </tr>
    <tr>
      <td class="lbl small">Fee For Work</td>
      <td class="desc"><em>${esc(feeWorkDescText)}</em></td>
      <td class="amt">${esc($fmt(summary.feeForWork))}</td>
    </tr>
    ${reimbHTML}
    ${outstandingHTML}
    ${otherItemsHTML}
    <tr class="total-row">
      <td class="lbl">Total Due</td>
      <td class="desc"><em>Including any outstanding balance</em></td>
      <td class="amt">${esc($fmt(summary.total))}</td>
    </tr>
  </table>

  <section class="fee-breakdown">
    <h3>Fee Breakdown</h3>
    <div class="leader-row"><span class="l">Total Fee</span><span class="dots"></span><span class="v">${esc($fmt(yearFee))}</span></div>
    <div class="leader-row"><span class="l">Previously paid + this invoice</span><span class="dots"></span><span class="v">${esc($fmt(summary.paidToDate))}</span></div>
    <div class="leader-row"><span class="l">Fee Remaining</span><span class="dots"></span><span class="v">${esc($fmtPlain(summary.remaining))}</span></div>
  </section>

  <div class="payment-cols">
    <div class="by-check">
      <h3>By Check</h3>
      <div>${esc(firm.name||'')}</div>
      <div>${esc(firm.address_line1||'')}</div>
      <div>${esc(firm.address_line2||'')}</div>
    </div>
    <div class="by-ach">
      <h3>By ACH/Wire</h3>
      <table class="ach">
        <tr><td class="ach-lbl">Bank:</td><td>${esc(firm.bank_name||'')}</td></tr>
        <tr><td class="ach-lbl">Beneficiary:</td><td>${esc(firm.beneficiary||'')}</td></tr>
        <tr><td class="ach-lbl">Routing:</td><td>${esc(firm.bank_routing||'')}</td></tr>
        <tr><td class="ach-lbl">Account:</td><td>${esc(firm.bank_account||'')}</td></tr>
      </table>
    </div>
  </div>

  <p class="due-receipt">Invoices are due upon receipt unless previous arrangements have been made.</p>

  <footer class="letterhead-footer">
    <img src="invoice_footer.jpg" alt="">
  </footer>

</div>
</body></html>`;

  // Open the window synchronously (required for iOS Safari pop-up rules),
  // then write the content in. No logo pre-fetch needed — the letterhead
  // images are <img> tags that load from the same origin.
  const win = window.open('', '_blank', 'width=900,height=1100');
  if (!win) {
    toast('Pop-up blocked — please allow pop-ups for this site', 'error');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}


// ===============================================================
// WORD DOC GENERATION (docx.js)
// ===============================================================
async function buildAndDownloadInvoiceDoc(client, invRecord, summary, description) {
  const D = window.docx;
  if (!D) {
    throw new Error(
      'docx library not loaded — make sure lib/docx.umd.js exists in your repository. ' +
      'Check that the lib/ folder was pushed to GitHub alongside index.html.'
    );
  }
  if (!window.saveAs) {
    throw new Error(
      'FileSaver library not loaded — make sure lib/FileSaver.min.js exists in your repository.'
    );
  }

  const firm = DATA.firm || defaultFirm();

  // ---- Palette pulled from the reference template (invoice template 1.docx) ----
  const COLOR_RUST  = 'C7997C';
  const COLOR_INK   = '2A2520';
  const COLOR_PEACH = 'F4DDCF';
  const COLOR_MUTED = '747474';

  // ---- Fonts. Goudy/Warnock/Columbia, with broad fallbacks via Word substitution. ----
  const FONT_BODY    = 'Goudy Old Style';
  const FONT_DISPLAY = 'Warnock Pro';
  const FONT_LABEL   = 'Columbia Titling Standard';

  // ---- Currency formatter (always with $ and thousands separator) ----
  const $fmt = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const $fmtPlain = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');  // no $ for last fee-breakdown row

  // ---- Date formatting: "March 2, 2026" ----
  const dateStrLong = invRecord.date
    ? new Date(invRecord.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : (invRecord.date || '');

  // ---- Helpers ----
  const noBorder  = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder };

  // Plain body text run
  const body = (text, opts = {}) => new D.TextRun({
    font: FONT_BODY,
    color: COLOR_INK,
    size: 22,
    ...opts,
    text,
  });

  // Rust small-caps section label (used heavily on the left labels)
  const labelRun = (text, opts = {}) => new D.TextRun({
    font: FONT_LABEL,
    color: COLOR_RUST,
    size: 16,            // 8pt
    characterSpacing: 30, // ~0.18em tracking
    ...opts,
    text: (text || '').toUpperCase(),
  });

  const para = (children, opts = {}) => new D.Paragraph({ children, ...opts });
  const blank = () => para([body('', { size: 16 })], { spacing: { after: 0 } });

  // ---- Image loader helper (auto-detects .png / .jpg / .jpeg next to index.html) ----
  // Returns an ImageRun sized to `targetWidthPx` while preserving the source's aspect
  // ratio. Returns null if no matching file is found (in which case the corresponding
  // header/footer block is simply omitted — the rest of the invoice still renders).
  async function loadInvoiceImage(stem, targetWidthPx) {
    let buf = null, type = 'png', triedUrls = [];
    for (const ext of ['png', 'jpg', 'jpeg']) {
      const url = encodeURI(`${stem}.${ext}`);
      triedUrls.push(url);
      try {
        const r = await fetch(url);
        console.log(`[invoice letterhead] fetch ${url} -> ${r.status} ${r.statusText}`);
        if (r.ok) {
          buf = await r.arrayBuffer();
          type = (ext === 'jpeg') ? 'jpg' : ext;
          console.log(`[invoice letterhead]   matched ${url} (${buf.byteLength} bytes, type=${type})`);
          break;
        }
      } catch (e) {
        console.warn(`[invoice letterhead] fetch ${url} threw:`, e);
      }
    }
    if (!buf) {
      console.warn(`[invoice letterhead] no file matched for stem '${stem}'. Tried: ${triedUrls.join(', ')}`);
      return null;
    }
    let h = Math.round(targetWidthPx * 0.25);
    try {
      const bmp = await createImageBitmap(new Blob([buf]));
      if (bmp.width > 0) h = Math.round(targetWidthPx * (bmp.height / bmp.width));
      bmp.close?.();
      console.log(`[invoice letterhead]   sized ${targetWidthPx}x${h} for stem '${stem}'`);
    } catch (e) {
      console.warn(`[invoice letterhead] createImageBitmap failed for stem '${stem}', using fallback height:`, e);
    }
    return new D.ImageRun({
      data: buf,
      transformation: { width: targetWidthPx, height: h },
      type,
    });
  }

  // ---- HEADER IMAGE — Invoice_Header.jpg (CMA logo + 'Residential Architecture') ----
  // Loaded here so it can be placed into the Word document HEADER region below.
  // Scaled down 15% from prior 280px → 238px (~2.48" wide).
  const headerImageRun = await loadInvoiceImage('invoice_header', 238);

  // ---- TITLE ROW: italic "Invoice" left, ISSUED + date right ----
  const titleTable = new D.Table({
    width: { size: 10080, type: D.WidthType.DXA },
    columnWidths: [6000, 4080],
    borders: noBorders,
    rows: [new D.TableRow({
      children: [
        new D.TableCell({
          borders: noBorders,
          width: { size: 6000, type: D.WidthType.DXA },
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
          verticalAlign: D.VerticalAlign.BOTTOM,
          children: [para([new D.TextRun({
            font: FONT_DISPLAY,
            color: COLOR_INK,
            italics: true,
            size: 84,
            text: 'Invoice',
          })], { spacing: { after: 0 } })],
        }),
        new D.TableCell({
          borders: noBorders,
          width: { size: 4080, type: D.WidthType.DXA },
          margins: { top: 0, bottom: 80, left: 0, right: 0 },
          verticalAlign: D.VerticalAlign.BOTTOM,
          children: [
            para([labelRun('Issued')], { alignment: D.AlignmentType.RIGHT, spacing: { after: 40 } }),
            para([new D.TextRun({
              font: FONT_BODY,
              color: COLOR_INK,
              italics: true,
              size: 22,
              text: dateStrLong,
            })], { alignment: D.AlignmentType.RIGHT, spacing: { after: 0 } }),
          ],
        }),
      ],
    })],
  });

  // ---- DETAIL TABLE: 3 columns (label | description | amount) ----
  // Each row gets a single rust top-border, no other borders. Total row = peach shading.
  const LABEL_W = 2600;
  const DESC_W  = 5320;
  const AMT_W   = 2160;
  const rowTopRust = { top: { style: D.BorderStyle.SINGLE, size: 4, color: COLOR_RUST, space: 4 }, bottom: noBorder, left: noBorder, right: noBorder };
  const noTopBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

  // Bold-prefix detection — if the description starts with a known phase name,
  // bold that prefix and italicize the rest, mirroring the template's "Schematic Design *…*" run.
  const phaseLabels = ['Schematic Design', 'Design Development', 'Construction Documents', 'Construction Administration', 'Deposit'];
  const descTrim = (description || '').trim();
  let matchedPhase = null;
  for (const ph of phaseLabels) {
    if (descTrim.toLowerCase().startsWith(ph.toLowerCase())) { matchedPhase = ph; break; }
  }
  const workCompletedRuns = [];
  if (matchedPhase) {
    workCompletedRuns.push(body(matchedPhase + ' ', { bold: true }));
    const rest = descTrim.slice(matchedPhase.length).trim();
    if (rest) workCompletedRuns.push(body(rest, { italics: true }));
  } else if (descTrim) {
    workCompletedRuns.push(body(descTrim, { italics: true }));
  } else {
    workCompletedRuns.push(body('Architectural services', { italics: true }));
  }
  const feeWorkDescText = matchedPhase
    ? `${matchedPhase} phase, this invoice`
    : 'Architectural services, this invoice';

  // ---- TO row (multi-line value, no amount column) ----
  const toLines = [];
  const fullName = (client.full_name || client.name || '').trim();
  if (fullName) toLines.push(fullName);
  const projAddr = (client.project_address || client.address || '').trim();
  if (projAddr) {
    // Split on commas if user wrote it as one line; otherwise leave as-is
    const parts = projAddr.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 3) {
      // Street, City, State+Zip
      toLines.push(parts[0]);
      toLines.push(parts.slice(1).join(', '));
    } else if (parts.length === 2) {
      toLines.push(parts[0]);
      toLines.push(parts[1]);
    } else {
      toLines.push(projAddr);
    }
  }
  const toParas = toLines.map((ln, i) =>
    para([body(ln)], { spacing: { after: i === toLines.length - 1 ? 0 : 40 } })
  );

  // ---- Helpers for the 3-col table ----
  const cellPad = { top: 200, bottom: 180, left: 0, right: 100 };
  function labelCell(text, opts = {}) {
    return new D.TableCell({
      borders: opts.borders || rowTopRust,
      shading: opts.shading,
      width: { size: LABEL_W, type: D.WidthType.DXA },
      margins: { top: cellPad.top, bottom: cellPad.bottom, left: 0, right: 100 },
      verticalAlign: D.VerticalAlign.TOP,
      children: [para([labelRun(text, opts.labelOpts || {})], { spacing: { after: 0 } })],
    });
  }
  function descCell(children, opts = {}) {
    const paragraphs = (Array.isArray(children) && children[0] instanceof D.Paragraph)
      ? children
      : [para(children, { spacing: { after: 0 } })];
    return new D.TableCell({
      borders: opts.borders || rowTopRust,
      shading: opts.shading,
      width: { size: opts.wide ? (DESC_W + AMT_W) : DESC_W, type: D.WidthType.DXA },
      columnSpan: opts.wide ? 2 : undefined,
      margins: { top: cellPad.top, bottom: cellPad.bottom, left: 0, right: 100 },
      verticalAlign: D.VerticalAlign.TOP,
      children: paragraphs,
    });
  }
  function amtCell(text, opts = {}) {
    return new D.TableCell({
      borders: opts.borders || rowTopRust,
      shading: opts.shading,
      width: { size: AMT_W, type: D.WidthType.DXA },
      margins: { top: cellPad.top, bottom: cellPad.bottom, left: 100, right: 0 },
      verticalAlign: D.VerticalAlign.TOP,
      children: [para([body(text || '', {
        size: opts.size || 22,
        color: opts.color || COLOR_INK,
        bold: !!opts.bold,
      })], { alignment: D.AlignmentType.RIGHT, spacing: { after: 0 } })],
    });
  }

  const detailRows = [
    // TO
    new D.TableRow({
      children: [
        labelCell('To'),
        descCell(toParas, { wide: true }),
      ],
    }),
    // WORK COMPLETED THIS INVOICE
    new D.TableRow({
      children: [
        labelCell('Work Completed This Invoice', { labelOpts: { size: 13 } }), // 6.5pt
        descCell(workCompletedRuns, { wide: true }),
      ],
    }),
    // FEE FOR WORK
    new D.TableRow({
      children: [
        labelCell('Fee For Work', { labelOpts: { size: 13 } }), // 6.5pt
        descCell([body(feeWorkDescText, { italics: true })]),
        amtCell($fmt(summary.feeForWork)),
      ],
    }),
    // REIMBURSABLE EXPENSES
    new D.TableRow({
      children: [
        labelCell('Reimbursable Expenses', { labelOpts: { size: 13 } }), // 6.5pt
        (summary.reimb > 0)
          ? descCell([body('Reimbursable expenses, this invoice', { italics: true })])
          : descCell([body('None this invoice', { italics: true })], { wide: true }),
        ...(summary.reimb > 0 ? [amtCell($fmt(summary.reimb))] : []),
      ],
    }),
    // OUTSTANDING INVOICES
    new D.TableRow({
      children: [
        labelCell('Outstanding Invoices', { labelOpts: { size: 13 } }), // 6.5pt
        (summary.outstanding > 0)
          ? descCell([body('Outstanding from prior invoices', { italics: true })])
          : descCell([body('None', { italics: true })], { wide: true }),
        ...(summary.outstanding > 0 ? [amtCell($fmt(summary.outstanding))] : []),
      ],
    }),
  ];

  // Optional "OTHER ITEMS" rows (label = user-provided label uppercased, amount on the right)
  for (const it of (summary.otherItems || [])) {
    if (!it || !it.amount) continue;
    detailRows.push(new D.TableRow({
      children: [
        labelCell(it.label || 'Other'),
        descCell([body(it.label || 'Other item', { italics: true })]),
        amtCell($fmt(it.amount)),
      ],
    }));
  }

  // ---- TOTAL DUE row (peach background, big rust amount) ----
  const totalShading = { fill: COLOR_PEACH, type: D.ShadingType.CLEAR, color: 'auto' };
  detailRows.push(new D.TableRow({
    children: [
      new D.TableCell({
        borders: noTopBorders,
        shading: totalShading,
        width: { size: LABEL_W, type: D.WidthType.DXA },
        // Left margin 1/8" (180 twips) inside the peach Total Due band.
        margins: { top: 240, bottom: 240, left: 180, right: 100 },
        verticalAlign: D.VerticalAlign.CENTER,
        children: [para([labelRun('Total Due')], { spacing: { after: 0 } })],
      }),
      new D.TableCell({
        borders: noTopBorders,
        shading: totalShading,
        width: { size: DESC_W, type: D.WidthType.DXA },
        margins: { top: 240, bottom: 240, left: 0, right: 100 },
        verticalAlign: D.VerticalAlign.CENTER,
        children: [para([body('Including any outstanding balance', { italics: true })],
          { alignment: D.AlignmentType.LEFT, spacing: { after: 0 } })],
      }),
      new D.TableCell({
        borders: noTopBorders,
        shading: totalShading,
        width: { size: AMT_W, type: D.WidthType.DXA },
        // Right margin 1/8" (180 twips) on the total $ amount cell.
        margins: { top: 240, bottom: 240, left: 100, right: 180 },
        verticalAlign: D.VerticalAlign.CENTER,
        children: [para([body($fmt(summary.total), { size: 40, color: COLOR_INK })],
          { alignment: D.AlignmentType.RIGHT, spacing: { after: 0 } })],
      }),
    ],
  }));

  const detailTable = new D.Table({
    width: { size: LABEL_W + DESC_W + AMT_W, type: D.WidthType.DXA },
    columnWidths: [LABEL_W, DESC_W, AMT_W],
    borders: noBorders,
    rows: detailRows,
  });

  // ---- FEE BREAKDOWN: small rust caps heading + dotted leader rows ----
  const yearFee = (summary.paidToDate || 0) + (summary.remaining || 0);
  // 2026-05-23: tightened from before:480/after:160 — fits one page.
  const feeBreakdownHeading = para([labelRun('Fee breakdown')], {
    spacing: { before: 200, after: 80 },
  });

  // Tab stop positioned at the right edge of the content area, with DOT leader
  const FEE_BREAK_RIGHT = 10080;
  const feeBreakRow = (label, value) => para([
    body(label, { size: 18, color: COLOR_MUTED }),
    new D.TextRun({ font: FONT_BODY, size: 18, color: COLOR_MUTED, text: '\t' }),
    body(value, { size: 18, color: COLOR_MUTED }),
  ], {
    tabStops: [{ type: D.TabStopType.RIGHT, position: FEE_BREAK_RIGHT, leader: D.LeaderType.DOT }],
    spacing: { after: 60 },
  });
  const feeBreakBlocks = [
    feeBreakdownHeading,
    feeBreakRow('Total Fee', $fmt(yearFee)),
    feeBreakRow('Previously paid + this invoice', $fmt(summary.paidToDate)),
    feeBreakRow('Fee Remaining', $fmtPlain(summary.remaining)),
  ];

  // ---- BY CHECK / BY ACH-WIRE — 2-column table ----
  const payCol1 = 5040, payCol2 = 5040;
  const byCheckLines = [
    // 2026-05-23: tightened from before:480 — Fee Breakdown → By Check gap.
    para([labelRun('By Check')], { spacing: { before: 200, after: 80 } }),
    para([body(firm.name || '')], { spacing: { after: 20 } }),
    para([body(firm.address_line1 || '')], { spacing: { after: 20 } }),
    para([body(firm.address_line2 || '')], { spacing: { after: 0 } }),
  ];
  // ACH info: 2-column inner table (label / value)
  const achInnerLabelW = 1600, achInnerValueW = 3440;
  const achRow = (label, value) => new D.TableRow({
    children: [
      new D.TableCell({
        borders: noBorders,
        width: { size: achInnerLabelW, type: D.WidthType.DXA },
        margins: { top: 10, bottom: 10, left: 0, right: 80 },
        children: [para([body(label)], { spacing: { after: 0 } })],
      }),
      new D.TableCell({
        borders: noBorders,
        width: { size: achInnerValueW, type: D.WidthType.DXA },
        margins: { top: 10, bottom: 10, left: 0, right: 0 },
        children: [para([body(value || '')], { spacing: { after: 0 } })],
      }),
    ],
  });
  const achInnerTable = new D.Table({
    width: { size: achInnerLabelW + achInnerValueW, type: D.WidthType.DXA },
    columnWidths: [achInnerLabelW, achInnerValueW],
    borders: noBorders,
    rows: [
      achRow('Bank:', firm.bank_name || ''),
      achRow('Beneficiary:', firm.beneficiary || ''),
      achRow('Routing:', firm.bank_routing || ''),
      achRow('Account:', firm.bank_account || ''),
    ],
  });
  const byAchLines = [
    para([labelRun('By ach/wire')], { spacing: { before: 200, after: 80 } }),
    achInnerTable,
  ];
  const payTable = new D.Table({
    width: { size: payCol1 + payCol2, type: D.WidthType.DXA },
    columnWidths: [payCol1, payCol2],
    borders: noBorders,
    rows: [new D.TableRow({
      children: [
        new D.TableCell({
          borders: noBorders,
          width: { size: payCol1, type: D.WidthType.DXA },
          margins: { top: 0, bottom: 0, left: 0, right: 200 },
          verticalAlign: D.VerticalAlign.TOP,
          children: byCheckLines,
        }),
        new D.TableCell({
          borders: noBorders,
          width: { size: payCol2, type: D.WidthType.DXA },
          margins: { top: 0, bottom: 0, left: 200, right: 0 },
          verticalAlign: D.VerticalAlign.TOP,
          children: byAchLines,
        }),
      ],
    })],
  });

  // ---- "Invoices are due upon receipt..." centered italic ----
  // 2026-05-23: tightened from before:720/after:720 — keeps everything on page 1.
  const dueLine = para([body('Invoices are due upon receipt unless previous arrangements have been made.', { italics: true })], {
    alignment: D.AlignmentType.CENTER,
    spacing: { before: 280, after: 280 },
  });

  // ---- FOOTER IMAGE — Invoice_Footer.jpg (names + phones + address + website) ----
  // Loaded here so it can be placed into the Word document FOOTER region below.
  // Scaled down 20% from prior 672px → 538px (~5.6" wide).
  const footerImageRun = await loadInvoiceImage('invoice_footer', 538);

  // ---- Compose the document body (no in-body header/footer; those live
  //      in the Word document header/footer regions defined below). ----
  const bodyChildren = [
    titleTable,
    detailTable,
    ...feeBreakBlocks,
    payTable,
    dueLine,
  ];

  // Word document HEADER — repeats on every page.
  const docHeader = headerImageRun
    ? new D.Header({
        children: [new D.Paragraph({
          alignment: D.AlignmentType.CENTER,
          spacing: { before: 0, after: 0 },
          children: [headerImageRun],
        })],
      })
    : undefined;

  // Word document FOOTER — repeats on every page.
  const docFooter = footerImageRun
    ? new D.Footer({
        children: [new D.Paragraph({
          alignment: D.AlignmentType.CENTER,
          spacing: { before: 0, after: 0 },
          children: [footerImageRun],
        })],
      })
    : undefined;

  // Page margins:
  //   header image is ~1.22" tall, footer image is ~1.20" tall.
  //   Top and bottom margins are sized so the body content begins below the
  //   header (and ends above the footer) with a small breathing margin.
  //   These tighter top/bottom values (vs. the previous 0.75") plus removing
  //   the in-body header/footer regain enough vertical room for everything
  //   to fit on one page.
  const doc = new D.Document({
    styles: {
      default: { document: { run: { font: FONT_BODY, size: 22, color: COLOR_INK } } },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: {
            top:    2160,   // 1.5"  — leaves ~1.22" for header image + small gap
            bottom: 2160,   // 1.5"  — leaves ~1.20" for footer image + small gap
            left:   1080,   // 0.75"
            right:  1080,   // 0.75"
            header:  360,   // 0.25" from top of page to top of header content
            footer:  360,   // 0.25" from bottom of page to bottom of footer content
          },
        },
      },
      headers: docHeader ? { default: docHeader } : undefined,
      footers: docFooter ? { default: docFooter } : undefined,
      children: bodyChildren,
    }],
  });

  const blob = await D.Packer.toBlob(doc);
  const safeName = (client.name || 'invoice').replace(/[^a-z0-9]+/ig, '_');
  const safeDate = invRecord.date || new Date().toISOString().slice(0, 10);
  const filename = `${safeName}_Invoice_${safeDate.replace(/-/g, '_')}.docx`;
  if (window.saveAs) {
    window.saveAs(blob, filename);
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}



// ===============================================================
// RENDERING
// ===============================================================

function renderAll() {
  renderOverview();
  renderClients();
  renderCashFlow();
  renderInvoices();
  renderInvoiceBuilder();
  renderSettings();
  updateSyncStatus();
}

// ----- Overview -----
let ED_ROSTER_SORT = { col: 'name', dir: 'asc' };
let PROJ_SORT = { col: 'name', dir: 'asc' };

function renderOverview() {
  const YEAR = SETTINGS.fiscal_year;
  const root = document.getElementById('tab-overview');
  if (!root) return;
  const t = totals(YEAR);

  const kpis=[
    {of:'Under Contract',v:fmt0(t.totalFee),label:'Total '+YEAR+' Fee',note:t.count+' active engagements',color:'var(--ink)',fs:'border-left:none;'},
    {of:'Invoiced',v:fmt0(t.billed),label:'Billed to Date',note:(t.totalFee?Math.round(t.billed/t.totalFee*100):0)+'% of fee',color:'var(--ink)',fs:''},
    {of:'Received',v:fmt0(t.collected),label:'Collected',note:(t.billed?Math.round(t.collected/t.billed*100):0)+'% of billed',color:'var(--forest)',fs:''},
    {of:'Awaiting',v:fmt0(t.outstanding),label:'Outstanding A/R',note:'across open invoices',color:'var(--rust)',fs:''},
    {of:'Still to Bill',v:fmt0(t.remaining),label:'Remaining Fee',note:'on active work',color:'var(--ink)',fs:''},
  ];
  const kpiCells=kpis.map(k=>`<div style="padding:24px 26px 22px;border-left:1px solid var(--hairline);${k.fs}">
    <div style="font-family:var(--titling);font-size:9px;letter-spacing:.34em;text-transform:uppercase;color:var(--ink-mute);">${k.of}</div>
    <div class="ed-num-tab" style="font-family:var(--sans-comp);font-size:30px;line-height:.96;color:${k.color};margin-top:14px;letter-spacing:.01em;">${k.v}</div>
    <div style="font-family:var(--display);font-weight:700;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink);margin-top:12px;">${k.label}</div>
    <div style="font-family:var(--serif);font-style:italic;font-size:13.5px;color:var(--ink-soft);margin-top:5px;line-height:1.3;">${k.note}</div></div>`).join('');

  // Plate 01 - outstanding receivables
  const allOut=[];
  edActiveClients().forEach(c=>(c.invoices||[]).forEach(i=>{if(i.sent&&!i.paid)allOut.push({c,i,d:edDaysOut(i.date)});}));
  allOut.sort((a,b)=>b.d-a.d);
  const outTotal=fmt0(sum(allOut,o=>o.i.amount));
  const outCount=allOut.length+(allOut.length===1?' invoice':' invoices');
  const outRows=allOut.map(o=>`<div class="hov-row ed-out-row" data-client-id="${o.c.id}" data-invoice-id="${o.i.id}" style="display:grid;grid-template-columns:80px 1fr auto;gap:18px;align-items:baseline;padding:15px 0;border-bottom:1px solid var(--hairline);cursor:pointer;">
    <span class="ed-num-tab" style="font-family:var(--sans-cond);font-size:14px;letter-spacing:.04em;color:var(--rust);">${fmtMD(o.i.date)}</span>
    <span><span style="font-family:var(--display);font-weight:700;font-size:16.6px;letter-spacing:.05em;text-transform:uppercase;color:var(--ink);">${esc(o.c.name)}</span>
      <span style="font-family:var(--serif);font-style:italic;font-size:14.5px;color:var(--ink-soft);display:block;margin-top:3px;">${esc(o.i.note||'Invoice')} &middot; #${esc(o.i.number||'')}</span></span>
    <span style="text-align:right;"><span class="ed-num-tab ed-out-amt" style="font-family:var(--sans-comp);font-size:24px;color:var(--ink);display:block;line-height:1;">${fmt0(o.i.amount)}</span>
      <span style="font-family:var(--titling);font-size:9px;letter-spacing:.16em;text-transform:uppercase;display:block;margin-top:5px;color:var(--ink-mute);">${o.d} days</span><button class="ed-paid-toggle" data-client-id="${o.c.id}" data-invoice-id="${o.i.id}">Mark paid</button></span>
  </div>`).join('') || '<div style="font-family:var(--serif);font-style:italic;color:var(--ink-soft);padding:16px 0;">Every invoice is paid - nothing outstanding.</div>';
  const plate01=`<div class="plate" style="padding:60px 0 8px;">
    <div class="side"><div class="bignum" style="font-family:var(--sans-comp);font-size:84px;color:var(--rust);line-height:.82;">01</div>
      <div><div style="font-family:var(--titling);font-size:10px;letter-spacing:.42em;text-transform:uppercase;color:var(--ink-mute);margin-top:12px;">Accounts</div>
      <div class="rule" style="width:40px;height:2px;background:var(--rust);margin:16px 0;"></div>
      <div style="font-family:var(--display);font-weight:700;font-size:15px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink);line-height:1.25;">Outstanding Receivables</div>
      <div style="font-family:var(--serif);font-style:italic;font-size:14px;color:var(--ink-soft);margin-top:18px;line-height:1.5;">${outTotal} across ${outCount}, oldest first.</div></div></div>
    <div class="scrollx"><div class="scrollx-in" style="border-top:1px solid var(--hairline-strong);">${outRows}
      <div style="display:grid;grid-template-columns:80px 1fr auto;gap:18px;align-items:baseline;padding:16px 0 0;border-top:2px solid var(--ink);"><span></span>
        <span style="font-family:var(--titling);font-size:10px;letter-spacing:.34em;text-transform:uppercase;color:var(--ink-mute);">Total Outstanding</span>
        <span class="ed-num-tab" style="font-family:var(--sans-comp);font-size:28px;color:var(--rust);text-align:right;">${outTotal}</span></div>
    </div></div></div>`;

  // Plate 02 - client roster
  const roster=edActiveClients().map(c=>({c,s:clientStats(c,YEAR)}));
  { const _d=ED_ROSTER_SORT.dir==='asc'?1:-1,_k=ED_ROSTER_SORT.col; roster.sort((x,y)=> _k==='name' ? x.c.name.localeCompare(y.c.name)*_d : (((x.s[_k]||0)-(y.s[_k]||0))*_d)); }
  const ri=(col)=>ED_ROSTER_SORT.col===col?(ED_ROSTER_SORT.dir==='asc'?' \u25B2':' \u25BC'):'';
  const rosterRows=roster.map(({c,s})=>{const st=edStatusOf(c,s);return `<div class="hov-row ed-roster-row" data-client-id="${c.id}" style="display:grid;grid-template-columns:1fr 104px 104px 104px 104px;gap:16px;align-items:center;padding:13px 0;border-bottom:1px solid var(--hairline);cursor:pointer;">
    <span style="display:flex;gap:9px;align-items:flex-start;"><span style="width:7px;height:7px;border-radius:50%;background:${edDotColor(st)};margin-top:6px;flex-shrink:0;"></span>
      <span><span style="font-family:var(--display);font-weight:700;font-size:17.3px;letter-spacing:.04em;text-transform:uppercase;color:var(--ink);">${esc(c.name)}</span>
      <span style="font-family:var(--serif);font-style:italic;font-size:13.5px;color:var(--ink-mute);display:block;margin-top:3px;">${esc(titleCase(c.full_name)||edStatusWord(st))}</span></span></span>
    <span class="ed-num-tab" style="font-family:var(--sans-cond);font-size:16px;text-align:right;color:var(--ink-soft);">${s.totalFee?fmt0(s.totalFee):'—'}</span>
    <span class="ed-num-tab" style="font-family:var(--sans-cond);font-size:16px;text-align:right;color:var(--ink);">${fmt0(s.billed)}</span>
    <span class="ed-num-tab" style="font-family:var(--sans-cond);font-size:16px;text-align:right;color:var(--forest);">${fmt0(s.collected)}</span>
    <span class="ed-num-tab" style="font-family:var(--sans-cond);font-size:16px;text-align:right;color:var(--rust);">${fmt0(s.remaining)}</span></div>`;}).join('');
  const plate02=`<div class="plate" style="padding:56px 0 8px;">
    <div class="side"><div class="bignum" style="font-family:var(--sans-comp);font-size:84px;color:var(--rust);line-height:.82;">02</div>
      <div><div style="font-family:var(--titling);font-size:10px;letter-spacing:.42em;text-transform:uppercase;color:var(--ink-mute);margin-top:12px;">The Year</div>
      <div class="rule" style="width:40px;height:2px;background:var(--rust);margin:16px 0;"></div>
      <div style="font-family:var(--display);font-weight:700;font-size:15px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink);line-height:1.25;">Client Roster</div>
      <div style="font-family:var(--serif);font-style:italic;font-size:14px;color:var(--ink-soft);margin-top:18px;line-height:1.5;">${roster.length} active clients.</div></div></div>
    <div class="scrollx"><div class="scrollx-in">
      <div style="display:grid;grid-template-columns:1fr 104px 104px 104px 104px;gap:16px;padding:0 0 9px;border-bottom:1px solid var(--ink);font-family:var(--titling);font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-mute);"><span class="ed-rsort" data-sort="name" style="cursor:pointer;">Client${ri('name')}</span><span class="ed-rsort" data-sort="totalFee" style="text-align:right;cursor:pointer;">Fee${ri('totalFee')}</span><span class="ed-rsort" data-sort="billed" style="text-align:right;cursor:pointer;">Billed${ri('billed')}</span><span class="ed-rsort" data-sort="collected" style="text-align:right;cursor:pointer;">Collected${ri('collected')}</span><span class="ed-rsort" data-sort="remaining" style="text-align:right;cursor:pointer;">Remaining${ri('remaining')}</span></div>
      ${rosterRows}
      <div style="display:grid;grid-template-columns:1fr 104px 104px 104px 104px;gap:16px;align-items:baseline;padding:15px 0 0;border-top:2px solid var(--ink);">
        <span style="font-family:var(--titling);font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:var(--ink-mute);">Totals &middot; ${roster.length} clients</span>
        <span class="ed-num-tab" style="font-family:var(--sans-comp);font-size:18px;text-align:right;color:var(--ink);">${fmt0(t.totalFee)}</span>
        <span class="ed-num-tab" style="font-family:var(--sans-comp);font-size:18px;text-align:right;color:var(--ink);">${fmt0(t.billed)}</span>
        <span class="ed-num-tab" style="font-family:var(--sans-comp);font-size:18px;text-align:right;color:var(--forest);">${fmt0(t.collected)}</span>
        <span class="ed-num-tab" style="font-family:var(--sans-comp);font-size:18px;text-align:right;color:var(--rust);">${fmt0(t.remaining)}</span></div>
    </div></div></div>`;

  // Plate 03 - year-end projection (editable % to collect)
  const psKey=PROJ_SORT.col, psDir=PROJ_SORT.dir==='asc'?1:-1;
  const pVal=(c)=>{const p=clientProjection(c,YEAR); return psKey==='billed'?p.ytdBilled:psKey==='rem'?p.remainingYearFee:psKey==='conf'?p.collectPct:p.projectedYearTotal;};
  const projC=edActiveClients().filter(c=>!c.closed_out && (clientStats(c,YEAR).totalFee>0)).sort((a,b)=> psKey==='name' ? a.name.localeCompare(b.name)*psDir : ((pVal(a)-pVal(b))*psDir));
  const pArrow=(col)=>PROJ_SORT.col===col?(PROJ_SORT.dir==='asc'?' \u25B2':' \u25BC'):'';
  const pj=projectionTotals(YEAR);
  const pctOpts=(selv)=>{let o='';for(let v=100;v>=0;v-=10){o+=`<option value="${v}" ${v===selv?'selected':''}>${v}%</option>`;}return o;};
  const projRows=projC.map(c=>{const p=clientProjection(c,YEAR);return `<div style="display:grid;grid-template-columns:1fr 100px 110px 92px 116px;gap:16px;align-items:center;padding:12px 0;border-bottom:1px solid var(--hairline);">
    <span class="ed-proj-name" data-client-id="${c.id}" style="font-family:var(--display);font-weight:700;font-size:16.6px;letter-spacing:.04em;text-transform:uppercase;color:var(--ink);cursor:pointer;">${esc(c.name)}</span>
    <span class="ed-num-tab" style="font-family:var(--sans-cond);font-size:15px;text-align:right;color:var(--ink-soft);">${fmt0(p.ytdBilled)}</span>
    <span class="ed-num-tab" style="font-family:var(--sans-cond);font-size:15px;text-align:right;color:var(--ink);">${fmt0(p.remainingYearFee)}</span>
    <span style="text-align:right;"><select class="ed-eoy-collect" data-client-id="${c.id}" style="font-family:var(--sans-cond);font-size:14px;color:var(--rust);background:transparent;border:1px solid var(--hairline);border-radius:0;padding:3px 4px;cursor:pointer;">${pctOpts(p.collectPct)}</select></span>
    <span class="ed-num-tab" style="font-family:var(--sans-cond);font-size:15px;text-align:right;color:var(--rust);">${fmt0(p.projectedYearTotal)}</span></div>`;}).join('');
  const plate03=`<div class="plate" style="padding:56px 0 8px;">
    <div class="side"><div class="bignum" style="font-family:var(--sans-comp);font-size:84px;color:var(--rust);line-height:.82;">03</div>
      <div><div style="font-family:var(--titling);font-size:10px;letter-spacing:.42em;text-transform:uppercase;color:var(--ink-mute);margin-top:12px;">Looking Ahead</div>
      <div class="rule" style="width:40px;height:2px;background:var(--rust);margin:16px 0;"></div>
      <div style="font-family:var(--display);font-weight:700;font-size:15px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink);line-height:1.25;">Year-End Projection</div>
      <div style="font-family:var(--serif);font-style:italic;font-size:14px;color:var(--ink-soft);margin-top:18px;line-height:1.5;">Remaining fee weighted by the % you expect to collect.</div></div></div>
    <div class="scrollx"><div class="scrollx-in">
      <div style="display:grid;grid-template-columns:1fr 100px 110px 92px 116px;gap:16px;padding:0 0 9px;border-bottom:1px solid var(--ink);font-family:var(--titling);font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-mute);"><span class="ed-psort" data-sort="name" style="cursor:pointer;">Client${pArrow('name')}</span><span class="ed-psort" data-sort="billed" style="text-align:right;cursor:pointer;">Billed${pArrow('billed')}</span><span class="ed-psort" data-sort="rem" style="text-align:right;cursor:pointer;">Remaining${pArrow('rem')}</span><span class="ed-psort" data-sort="conf" style="text-align:right;cursor:pointer;">% Collect${pArrow('conf')}</span><span class="ed-psort" data-sort="proj" style="text-align:right;cursor:pointer;">Projected${pArrow('proj')}</span></div>
      ${projRows||'<div style="font-family:var(--serif);font-style:italic;color:var(--ink-soft);padding:14px 0;">No active fee work to project.</div>'}
      <div style="display:grid;grid-template-columns:1fr 100px 110px 92px 116px;gap:16px;align-items:baseline;padding:15px 0 0;border-top:2px solid var(--ink);">
        <span style="font-family:var(--titling);font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:var(--ink-mute);">Projected ${YEAR} Total</span>
        <span class="ed-num-tab" style="font-family:var(--sans-comp);font-size:19px;text-align:right;color:var(--ink-soft);">${fmt0(pj.ytdBilled)}</span>
        <span class="ed-num-tab" style="font-family:var(--sans-comp);font-size:19px;text-align:right;color:var(--ink);">${fmt0(pj.remainingYearFee)}</span><span></span>
        <span class="ed-num-tab" style="font-family:var(--sans-comp);font-size:22px;text-align:right;color:var(--rust);">${fmt0(pj.projectedYearTotal)}</span></div>
    </div></div></div>`;

  const _folio = `<div style="display:flex;justify-content:space-between;align-items:baseline;font-family:var(--titling);font-size:10px;letter-spacing:.36em;text-transform:uppercase;color:var(--ink-mute);padding:34px 0 60px;border-top:1px solid var(--hairline);margin-top:48px;"><span>The Billing Ledger</span><span style="color:var(--rust);">Carlisle Moore Architects<span style="color:var(--ink-mute);margin-left:10px;">FY ${YEAR}</span></span></div>`;
  root.innerHTML = `<div class="kpis" style="border-top:1px solid var(--hairline-strong);border-bottom:1px solid var(--hairline);">${kpiCells}</div>${plate01}${plate02}${plate03}${_folio}`;

  root.querySelectorAll('.ed-out-row').forEach(el=>el.addEventListener('click',()=>openInvoiceEditor(el.dataset.clientId, el.dataset.invoiceId)));
  root.querySelectorAll('.ed-roster-row').forEach(el=>el.addEventListener('click',()=>{const c=DATA.clients.find(x=>x.id===el.dataset.clientId); if(c) openClientEditor(c);}));
  root.querySelectorAll('.ed-eoy-collect').forEach(sel=>sel.addEventListener('change',()=>{const c=DATA.clients.find(x=>x.id===sel.dataset.clientId); if(!c) return; c.projection_collect_pct=parseInt(sel.value,10); delete c.projection_confidence; markDirty(); renderOverview();}));
  root.querySelectorAll('.ed-rsort').forEach(el=>el.addEventListener('click',()=>{const col=el.dataset.sort; if(ED_ROSTER_SORT.col===col){ED_ROSTER_SORT.dir=ED_ROSTER_SORT.dir==='asc'?'desc':'asc';}else{ED_ROSTER_SORT.col=col;ED_ROSTER_SORT.dir=(col==='name')?'asc':'desc';} renderOverview();}));
  root.querySelectorAll('.ed-proj-name').forEach(el=>el.addEventListener('click',()=>{const c=DATA.clients.find(x=>x.id===el.dataset.clientId); if(c) openClientEditor(c);}));
  root.querySelectorAll('.ed-psort').forEach(el=>el.addEventListener('click',()=>{const col=el.dataset.sort; if(PROJ_SORT.col===col){PROJ_SORT.dir=PROJ_SORT.dir==='asc'?'desc':'asc';}else{PROJ_SORT.col=col;PROJ_SORT.dir=(col==='name')?'asc':'desc';} renderOverview();}));
  root.querySelectorAll('.ed-paid-toggle').forEach(btn=>btn.addEventListener('click',(e)=>{
    e.stopPropagation();
    const c=DATA.clients.find(x=>x.id===btn.dataset.clientId); if(!c) return;
    const inv=(c.invoices||[]).find(i=>String(i.id)===String(btn.dataset.invoiceId)); if(!inv) return;
    const row=btn.closest('.ed-out-row');
    inv.paid=!inv.paid; markDirty();
    if(inv.paid){
      if(row) row.classList.add('ed-row-paid');
      btn.classList.add('is-paid'); btn.textContent='Paid \u2713 \u2014 undo';
      if(ED_PAID_TIMERS[inv.id]) clearTimeout(ED_PAID_TIMERS[inv.id]);
      ED_PAID_TIMERS[inv.id]=setTimeout(()=>{ delete ED_PAID_TIMERS[inv.id]; renderOverview(); }, 2400);
    } else {
      if(ED_PAID_TIMERS[inv.id]){ clearTimeout(ED_PAID_TIMERS[inv.id]); delete ED_PAID_TIMERS[inv.id]; }
      renderOverview();
    }
  }));
}

// ----- Billed This Month matrix (Overview tab) -----
// Two rows × 12 month columns + Total column.
//   Billed       = sum of invoices.amount for invoices dated in that month
//                  (sent OR unsent — i.e. all invoices issued that month) +
//                  synthetic deposit event in that month.
//   Outstanding  = same set, restricted to (sent && !paid) — i.e. the portion
//                  of that month's billings still unpaid.
// The "This Month" callout shows the current month's Billed total.
function renderBilledByMonth() {
  const year = SETTINGS.fiscal_year || new Date().getFullYear();
  const yearEl = $('#billedByMonthYear');
  if (yearEl) yearEl.textContent = String(year);

  const billed      = new Array(12).fill(0);
  const outstanding = new Array(12).fill(0);

  for (const c of DATA.clients) {
    if (c.archived) continue;
    billingEventsInYear(c, year).forEach(e => {
      // Session 12 (2026-05-27): the Overview "Billed This Month" matrix is the
      // counterpart to the Fee Summary, so it must read from real invoices ONLY.
      // monthly_planned_2026 "planned-sent" entries were causing the matrix total
      // to disagree with Billed YTD (ghost entries + Visintainer Mar double-count).
      // The Cash Flow tab still uses billingEventsInYear including planned events.
      if (e.kind === 'planned') return;
      // Count anything billed (sent OR drafted invoices) toward Billed —
      // drafts that are not yet sent should NOT count, since they aren't billed yet.
      if (e.sent) billed[e.month] += e.amount || 0;
      if (e.sent && !e.paid) outstanding[e.month] += e.amount || 0;
    });
  }

  // Build the header row with month labels + Total
  const head = $('#billedByMonthHead');
  const now = new Date();
  const currentMonthIdx = (now.getFullYear() === year) ? now.getMonth() : -1;
  if (head) {
    head.innerHTML = '<th class="row-label"></th>' +
      MONTHS.map((m, i) => `<th class="month-col${i === currentMonthIdx ? ' current' : ''}">${m}</th>`).join('') +
      '<th class="total-col">Total</th>';
  }

  // Build the two data rows
  const totalBilled      = billed.reduce((s, x) => s + x, 0);
  const totalOutstanding = outstanding.reduce((s, x) => s + x, 0);

  const billedRow = $('#billedByMonthTable .row-billed');
  if (billedRow) {
    billedRow.innerHTML = '<th class="row-label">Billed</th>' +
      billed.map((v, i) =>
        `<td class="num month-cell${i === currentMonthIdx ? ' current' : ''}${v === 0 ? ' zero' : ''}">${v === 0 ? '—' : fmt0(v)}</td>`
      ).join('') +
      `<td class="num total-cell">${fmt0(totalBilled)}</td>`;
  }
  const outRow = $('#billedByMonthTable .row-outstanding');
  if (outRow) {
    outRow.innerHTML = '<th class="row-label">Outstanding</th>' +
      outstanding.map((v, i) =>
        `<td class="num month-cell${i === currentMonthIdx ? ' current' : ''}${v === 0 ? ' zero' : ''}${v > 0 ? ' warn' : ''}">${v === 0 ? '—' : fmt0(v)}</td>`
      ).join('') +
      `<td class="num total-cell${totalOutstanding > 0 ? ' warn' : ''}">${fmt0(totalOutstanding)}</td>`;
  }

  // Callout — current month's billed total
  const calloutVal = $('#billedThisMonth');
  const calloutSub = $('#billedThisMonthSub');
  if (calloutVal) {
    if (currentMonthIdx < 0) {
      calloutVal.textContent = '—';
      if (calloutSub) calloutSub.textContent = `not in ${year}`;
    } else {
      calloutVal.textContent = fmt0(billed[currentMonthIdx]);
      if (calloutSub) {
        const outThisMonth = outstanding[currentMonthIdx];
        calloutSub.textContent = outThisMonth > 0
          ? `${fmt0(outThisMonth)} outstanding`
          : `${MONTHS[currentMonthIdx]} ${year}`;
      }
    }
  }
}

function renderOutstandingInvoices() {
  const tbody = $('#outstandingBody');
  const tfoot = $('#outstandingFoot');
  if (!tbody) return;

  // Gather all unpaid sent invoices across clients
  const today = new Date();
  const fy = (SETTINGS && SETTINGS.fiscal_year) || new Date().getFullYear();
  let invs = [];
  for (const c of DATA.clients) {
    if (c.archived) continue;
    for (const inv of (c.invoices || [])) {
      if (inv.sent && !inv.paid) {
        const d = inv.date ? new Date(inv.date + 'T12:00:00') : today;
        const daysOut = Math.max(0, Math.round((today - d) / (1000 * 60 * 60 * 24)));
        invs.push({ inv, c, daysOut, _planned: null });
      }
    }
    // Also include monthly-plan entries marked sent but not paid — these count
    // toward Outstanding A/R but have no invoice record, so without this they'd
    // be invisible in the table while still inflating the metric.
    for (const m of (c.monthly_planned_2026 || [])) {
      if (m.sent && !m.paid) {
        const monthIdx = MONTHS.indexOf(m.month);
        const safeIdx = monthIdx >= 0 ? monthIdx : 0;
        const dateStr = `${fy}-${String(safeIdx + 1).padStart(2, '0')}-01`;
        const d = new Date(dateStr + 'T12:00:00');
        const daysOut = Math.max(0, Math.round((today - d) / (1000 * 60 * 60 * 24)));
        const synthetic = {
          id: `plan-${m.month}`,
          number: '',
          date: dateStr,
          amount: m.amount || 0,
          note: '(monthly plan — no invoice record)'
        };
        invs.push({ inv: synthetic, c, daysOut, _planned: m });
      }
    }
  }
  // Apply user-selected sort
  const oState = SORT_STATE.outstanding;
  const oGet = ({ inv, c, daysOut }) => ({
    date:    inv.date || '',
    number:  parseInt(inv.number, 10) || 0,
    name:    (c.name || '').toLowerCase(),
    note:    (inv.note || '').toLowerCase(),
    amount:  inv.amount || 0,
    daysOut: daysOut,
  })[oState.col];
  invs.sort((a, b) => compareSort(oGet(a), oGet(b), oState.dir));
  updateSortIndicator(document.querySelector('table.outstanding-invoices thead'), oState);
  wireSortHeaders('table.outstanding-invoices thead', 'outstanding', renderOutstandingInvoices);

  if (invs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="outstanding-empty">No outstanding invoices. Nice.</td></tr>`;
    tfoot.innerHTML = '';
    return;
  }

  tbody.innerHTML = invs.map(({ inv, c, daysOut, _planned }) => {
    const overdue = daysOut > 30;
    const plannedClass = _planned ? ' planned-row' : '';
    const plannedAttr = _planned ? ` data-planned="1"` : '';
    return `<tr class="${overdue ? 'overdue' : ''}${plannedClass}" data-client-id="${c.id}" data-invoice-id="${inv.id}"${plannedAttr} title="Click to mark paid">
      <td class="col-date">${fmtDate(inv.date)}</td>
      <td class="col-num">${escapeHtml(inv.number || '')}</td>
      <td class="col-name">${escapeHtml(c.name)}</td>
      <td class="col-note">${escapeHtml(inv.note || '')}</td>
      <td class="col-num amount-due">${fmt0(inv.amount)}</td>
      <td class="col-num ${overdue ? 'warn' : ''}">${daysOut}</td>
    </tr>`;
  }).join('');

  const total = sum(invs, x => x.inv.amount);
  tfoot.innerHTML = `<tr>
    <td colspan="4" style="text-align:right;">Total Outstanding · ${invs.length} invoice${invs.length === 1 ? '' : 's'}</td>
    <td class="col-num warn" style="font-weight:700;">${fmt0(total)}</td>
    <td></td>
  </tr>`;

  // Click a real invoice row → open it in the invoice editor
  // Click a planned row → mark paid (no editor record exists)
  tbody.querySelectorAll('tr[data-invoice-id]').forEach(tr => {
    tr.addEventListener('click', () => {
      const cId = tr.dataset.clientId;
      const iId = tr.dataset.invoiceId;
      const isPlanned = tr.dataset.planned === '1';
      const client = DATA.clients.find(x => x.id === cId);
      if (!client) return;
      if (isPlanned) {
        const monthName = String(iId).replace(/^plan-/, '');
        const m = (client.monthly_planned_2026 || []).find(x => x.month === monthName);
        if (!m) return;
        if (!confirm(`Mark planned ${monthName} ${fmt0(m.amount)} for ${client.name} as paid?`)) return;
        m.paid = true;
        markDirty();
        renderAll();
        toast(`Marked ${client.name} (planned) as paid`, 'success');
      } else {
        // Open the invoice in the editor
        activateTab('invoices');
        openInvoiceEditor(cId, iId);
      }
    });
  });
}

// Chart shows a 5-month window: last 2, current, next 2
// CHART_OFFSET = 0 means centered on current month; user can scroll +/-
let CHART_OFFSET = 0;
const CHART_WINDOW = 5;

function chartCenterMonth() {
  // Returns the [year, monthIndex] for the center of the current window
  const now = new Date();
  const baseY = now.getFullYear();
  const baseM = now.getMonth();
  // Apply offset
  const totalMonths = baseY * 12 + baseM + CHART_OFFSET;
  return [Math.floor(totalMonths / 12), totalMonths % 12];
}

function chartWindowMonths() {
  // Returns array of [year, month] for the 5-month window
  const [cy, cm] = chartCenterMonth();
  const result = [];
  for (let off = -2; off <= 2; off++) {
    const t = cy * 12 + cm + off;
    result.push([Math.floor(t / 12), t % 12]);
  }
  return result;
}

// Get aggregates for a single month across all clients
function aggregatesForMonth(year, monthIdx) {
  let planned = 0, invoiced = 0, collected = 0;
  for (const c of DATA.clients) {
    if (c.archived) continue;
    // Planned (only for current fiscal year)
    if (year === SETTINGS.fiscal_year) {
      const arr = c.monthly_planned_2026 || [];
      for (const m of arr) {
        if (m.month === monthIdx + 1) planned += m.amount || 0;
      }
    }
    // Invoiced and collected
    for (const inv of (c.invoices || [])) {
      if (!inv.date) continue;
      const d = new Date(inv.date + 'T12:00:00');
      if (d.getFullYear() === year && d.getMonth() === monthIdx) {
        if (inv.sent) invoiced += inv.amount || 0;
        if (inv.paid) collected += inv.amount || 0;
      }
    }
  }
  return { planned, invoiced, collected };
}

function renderMonthlyChart() {
  if (!document.getElementById('monthlyChart')) return;
  const window = chartWindowMonths();
  const data = window.map(([y, m]) => ({ year: y, month: m, ...aggregatesForMonth(y, m) }));
  const max = Math.max(...data.map(d => Math.max(d.planned, d.invoiced, d.collected)), 1);

  // Update range label
  const first = data[0], last = data[data.length - 1];
  const rangeLabel = `${MONTHS[first.month]} ${first.year} – ${MONTHS[last.month]} ${last.year}`;
  const rangeEl = $('#chartRangeLabel');
  if (rangeEl) rangeEl.textContent = rangeLabel;

  // Larger, less dense layout for 5 bars
  const W = 1280, H = 320;
  const padL = 90, padR = 30, padT = 40, padB = 60;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const groupW = innerW / data.length;
  const barW = groupW * 0.22;
  const barGap = groupW * 0.04;

  const yTicks = niceTicks(0, max, 4);
  const yMax = yTicks[yTicks.length - 1];

  // Better tones — softer and warmer
  const C_PLANNED = '#d8d4c5';     // warm taupe (planned)
  const C_INVOICED = '#3e3e3a';    // soft black/charcoal (invoiced)
  const C_COLLECTED = '#5a8a6c';   // muted sage green (collected)
  const C_AXIS = '#1c1c1a';
  const C_LABEL = '#4a4a45';
  const C_FAINT = '#7a7872';

  const [todayY, todayM] = (() => { const d = new Date(); return [d.getFullYear(), d.getMonth()]; })();

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">`;

  // Y-axis tick labels
  yTicks.forEach(v => {
    const y = padT + innerH - (v / yMax) * innerH;
    svg += `<text x="${padL - 12}" y="${y + 5}" font-family="ff-meta-correspondence-web-p, monospace" font-size="14" fill="${C_FAINT}" text-anchor="end">${fmt0bare(v)}</text>`;
    if (v === yMax) {
      svg += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="#e8e6e0" stroke-width="0.5"/>`;
    }
  });

  // Baseline
  svg += `<line x1="${padL}" x2="${W - padR}" y1="${padT + innerH}" y2="${padT + innerH}" stroke="${C_AXIS}" stroke-width="1"/>`;

  // Bars
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    const x0 = padL + i * groupW;
    const ph = (d.planned / yMax) * innerH;
    const ih = (d.invoiced / yMax) * innerH;
    const ch = (d.collected / yMax) * innerH;
    const isCurrent = (d.year === todayY && d.month === todayM);

    // Highlight strip behind current month
    if (isCurrent) {
      svg += `<rect x="${x0}" y="${padT}" width="${groupW}" height="${innerH}" fill="#f4ead8" opacity="0.35"/>`;
    }

    // Three bars side by side: planned, invoiced, collected
    const startX = x0 + (groupW - 3 * barW - 2 * barGap) / 2;

    if (d.planned > 0) {
      svg += `<rect x="${startX}" y="${padT + innerH - ph}" width="${barW}" height="${ph}" fill="${C_PLANNED}"/>`;
    }
    if (d.invoiced > 0) {
      svg += `<rect x="${startX + barW + barGap}" y="${padT + innerH - ih}" width="${barW}" height="${ih}" fill="${C_INVOICED}"/>`;
    }
    if (d.collected > 0) {
      svg += `<rect x="${startX + 2 * (barW + barGap)}" y="${padT + innerH - ch}" width="${barW}" height="${ch}" fill="${C_COLLECTED}"/>`;
    }

    // Month label
    const monthLabelY = padT + innerH + 22;
    svg += `<text x="${x0 + groupW / 2}" y="${monthLabelY}" font-family="interstate-condensed, sans-serif" font-weight="700" font-size="16" fill="${isCurrent ? C_AXIS : C_LABEL}" text-anchor="middle">${MONTHS[d.month].toUpperCase()}</text>`;
    // Year label below (smaller)
    svg += `<text x="${x0 + groupW / 2}" y="${monthLabelY + 16}" font-family="interstate-condensed, sans-serif" font-size="12" fill="${C_FAINT}" text-anchor="middle">${d.year}</text>`;

    // Direct value labels above the tallest bar in each group (compact)
    const tallest = Math.max(d.planned, d.invoiced, d.collected);
    if (tallest > 0) {
      const tallestH = (tallest / yMax) * innerH;
      svg += `<text x="${x0 + groupW / 2}" y="${padT + innerH - tallestH - 8}" font-family="ff-meta-correspondence-web-p, monospace" font-size="12" fill="${C_LABEL}" text-anchor="middle">${fmt0bare(tallest)}</text>`;
    }
  }

  // Legend — top left, larger swatches and text
  svg += `<g transform="translate(${padL}, 18)">`;
  svg += `<rect x="0" y="-12" width="14" height="14" fill="${C_PLANNED}"/><text x="20" y="0" font-family="interstate-condensed, sans-serif" font-size="14" fill="${C_LABEL}">PLANNED</text>`;
  svg += `<rect x="110" y="-12" width="14" height="14" fill="${C_INVOICED}"/><text x="130" y="0" font-family="interstate-condensed, sans-serif" font-size="14" fill="${C_LABEL}">INVOICED</text>`;
  svg += `<rect x="225" y="-12" width="14" height="14" fill="${C_COLLECTED}"/><text x="245" y="0" font-family="interstate-condensed, sans-serif" font-size="14" fill="${C_LABEL}">COLLECTED</text>`;
  svg += `</g>`;

  svg += `</svg>`;
  $('#monthlyChart').innerHTML = svg;
}

function niceTicks(min, max, n) {
  if (max <= 0) return [0];
  const range = max - min;
  const rough = range / n;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  let step;
  if (norm < 1.5) step = 1 * mag;
  else if (norm < 3) step = 2 * mag;
  else if (norm < 7) step = 5 * mag;
  else step = 10 * mag;
  const ticks = [];
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(v);
  return ticks;
}

function renderRoster() {
  const year = SETTINGS.fiscal_year;
  const tbody = $('#rosterBody');
  if (!tbody) return;
  const active = DATA.clients.filter(c => !c.archived);
  // Build rows with their stats so we can sort once and reuse
  const rows = active.map(c => ({ c, s: clientStats(c, year) }));
  const rState = SORT_STATE.roster;
  const rGet = ({ c, s }) => ({
    name:        (c.name || '').toLowerCase(),
    totalFee:    s.totalFee,
    billed:      s.billed,
    collected:   s.collected,
    outstanding: s.outstanding,
    remaining:   s.remaining,
  })[rState.col];
  rows.sort((a, b) => compareSort(rGet(a), rGet(b), rState.dir));
  updateSortIndicator(document.querySelector('table.roster thead'), rState);
  wireSortHeaders('table.roster thead', 'roster', renderRoster);

  tbody.innerHTML = rows.map(({ c, s }) => {
    // For outstanding > 0, show date of most recent unpaid sent invoice to the LEFT of the amount
    let outstandingCell = fmt0(s.outstanding);
    if (s.outstanding > 0) {
      const unpaid = (c.invoices || []).filter(i => i.sent && !i.paid);
      if (unpaid.length > 0) {
        // Prefer invoices with valid ISO dates (YYYY-MM-DD); fall back to any with a date string
        const withGoodDate = unpaid.filter(i => /^\d{4}-\d{2}-\d{2}/.test(String(i.date || '')));
        const pool = withGoodDate.length > 0 ? withGoodDate : unpaid.filter(i => i.date);
        pool.sort((a, b) => String(b.date).localeCompare(String(a.date)));
        const latestDate = pool[0] && pool[0].date;
        if (latestDate) {
          outstandingCell = `<span class="outstanding-date">${fmtDate(latestDate)}</span> ${fmt0(s.outstanding)}`;
        }
      }
    }
    return `<tr data-client-id="${c.id}">
      <td class="col-name">${escapeHtml(c.name)}</td>
      <td class="col-num total-fee">${fmt0(s.totalFee)}</td>
      <td class="col-num">${fmt0(s.billed)}</td>
      <td class="col-num">${fmt0(s.collected)}</td>
      <td class="col-num ${s.outstanding > 0 ? 'warn' : ''}">${outstandingCell}</td>
      <td class="col-num remaining">${fmt0(s.remaining)}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const c = DATA.clients.find(x => x.id === tr.dataset.clientId);
      if (c) openClientEditor(c);
    });
  });

  // Roster totals — top row inside thead
  const rosterTotalsRow = document.getElementById('rosterTotalsRow');
  if (rosterTotalsRow) {
    const tot = rows.reduce((acc, { s }) => {
      acc.totalFee    += s.totalFee;
      acc.billed      += s.billed;
      acc.collected   += s.collected;
      acc.outstanding += s.outstanding;
      acc.remaining   += s.remaining;
      return acc;
    }, { totalFee: 0, billed: 0, collected: 0, outstanding: 0, remaining: 0 });
    rosterTotalsRow.innerHTML = `
      <th class="col-name roster-total-label">TOTAL</th>
      <th class="col-num roster-total-num">${fmt0(tot.totalFee)}</th>
      <th class="col-num roster-total-num">${fmt0(tot.billed)}</th>
      <th class="col-num roster-total-num">${fmt0(tot.collected)}</th>
      <th class="col-num roster-total-num ${tot.outstanding > 0 ? 'warn' : ''}">${fmt0(tot.outstanding)}</th>
      <th class="col-num roster-total-num remaining">${fmt0(tot.remaining)}</th>
    `;
  }
}

// ----- Year-End Projection (Session 11) -----
// Per-client editable % of fee to collect (0-100 in 10s) + projected EOY $ override.
// "Weighted" = projectedEoy * (collect% / 100).
// "Projected Year Total" = YTD billed + weighted projection.
function renderEoyProjection() {
  const tbody = $('#eoyBody');
  const totalsRow = $('#eoyTotalsRow');
  // Section may not be in the DOM yet (older index.html); bail quietly.
  if (!tbody || !totalsRow) return;
  const year = SETTINGS.fiscal_year;

  const active = DATA.clients.filter(c => !c.archived && !c.closed_out);
  let rows = active.map(c => ({ c, p: clientProjection(c, year) }))
    // Show every active client, even those with nothing left — they're
    // anchors for total-row accuracy and let the user mark "Low" intentionally.
    ;
  rows.sort((a, b) =>
    (b.p.remainingYearFee + b.p.ytdBilled) - (a.p.remainingYearFee + a.p.ytdBilled)
  );

  // 100 down to 0 in 10-pt steps
  const collectSteps = Array.from({ length: 11 }, (_, i) => 100 - i * 10);

  tbody.innerHTML = rows.map(({ c, p }) => {
    const confOpts = collectSteps.map(pct =>
      `<option value="${pct}" ${pct === p.collectPct ? 'selected' : ''}>${pct}%</option>`
    ).join('');
    const confSelect = `<select class="eoy-confidence" data-client-id="${c.id}" aria-label="% of fee to collect">${confOpts}</select>`;
    const overrideMark = p.isOverride ? '<span class="eoy-override-mark" title="Manual override">·</span>' : '';
    const projInput =
      `<input class="eoy-projected col-num-input" data-client-id="${c.id}" ` +
      `value="${fmt0(p.projectedEoy)}" inputmode="numeric" ` +
      `title="${p.isOverride ? 'Manual override — clear to revert to remaining year-fee default' : 'Defaults to remaining year-fee · type to override'}">`;
    return `<tr data-client-id="${c.id}">
      <td class="col-name">${escapeHtml(c.name)}</td>
      <td class="col-num">${fmt0(p.ytdBilled)}</td>
      <td class="col-num">${fmt0(p.remainingYearFee)}</td>
      <td class="col-num eoy-projected-cell">${projInput}${overrideMark}</td>
      <td class="col-confidence">${confSelect}</td>
      <td class="col-num">${fmt0(p.weighted)}</td>
      <td class="col-num eoy-year-total">${fmt0(p.projectedYearTotal)}</td>
    </tr>`;
  }).join('');

  // Totals
  const tot = rows.reduce((a, { p }) => ({
    ytdBilled:         a.ytdBilled + p.ytdBilled,
    remainingYearFee:  a.remainingYearFee + p.remainingYearFee,
    projectedEoy:      a.projectedEoy + p.projectedEoy,
    weighted:          a.weighted + p.weighted,
    projectedYearTotal:a.projectedYearTotal + p.projectedYearTotal,
  }), { ytdBilled: 0, remainingYearFee: 0, projectedEoy: 0, weighted: 0, projectedYearTotal: 0 });
  totalsRow.innerHTML = `
    <th class="col-name roster-total-label">TOTAL</th>
    <th class="col-num roster-total-num">${fmt0(tot.ytdBilled)}</th>
    <th class="col-num roster-total-num">${fmt0(tot.remainingYearFee)}</th>
    <th class="col-num roster-total-num">${fmt0(tot.projectedEoy)}</th>
    <th class="col-confidence"></th>
    <th class="col-num roster-total-num">${fmt0(tot.weighted)}</th>
    <th class="col-num roster-total-num eoy-year-total">${fmt0(tot.projectedYearTotal)}</th>
  `;

  // Inline edit handlers
  tbody.querySelectorAll('.eoy-confidence').forEach(sel => {
    sel.addEventListener('change', () => {
      const c = DATA.clients.find(x => x.id === sel.dataset.clientId);
      if (!c) return;
      c.projection_collect_pct = parseInt(sel.value, 10);
      delete c.projection_confidence;  // retire legacy field
      markDirty();
      renderEoyProjection();
    });
  });
  tbody.querySelectorAll('.eoy-projected').forEach(inp => {
    inp.addEventListener('change', () => {
      const c = DATA.clients.find(x => x.id === inp.dataset.clientId);
      if (!c) return;
      const v = currencyVal(inp);
      if (!v || v <= 0) {
        // Empty / zero — revert to default (remaining year-fee)
        delete c.projected_eoy_capture;
      } else {
        c.projected_eoy_capture = v;
      }
      markDirty();
      renderEoyProjection();
    });
    // Select-all on focus for quick overwrites
    inp.addEventListener('focus', () => inp.select());
  });
}

// Sparkline: tiny inline SVG, Tufte-style — line only, no axes
function sparkline(values, w, h) {
  if (!values.length || values.every(v => !v)) {
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><line x1="0" y1="${h - 1}" x2="${w}" y2="${h - 1}" stroke="#d4d2cc" stroke-width="1"/></svg>`;
  }
  const max = Math.max(...values, 1);
  const stepX = w / (values.length - 1 || 1);
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = h - (v / max) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  // Last value endpoint
  const lastX = (values.length - 1) * stepX;
  const lastY = h - (values[values.length - 1] / max) * (h - 4) - 2;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <polyline points="${points}" fill="none" stroke="#1c1c1a" stroke-width="1.2"/>
    ${values[values.length - 1] > 0 ? `<circle cx="${lastX}" cy="${lastY}" r="1.8" fill="#1c1c1a"/>` : ''}
  </svg>`;
}

// ----- Clients tab -----
function renderClients() {
  const root = document.getElementById('tab-clients');
  if (!root) return;
  const YEAR = SETTINGS.fiscal_year;
  const saEl = document.getElementById('showArchived');
  const showArchived = !!(saEl && saEl.checked);
  const GROUPS=[['active','In Progress','On the Boards'],['alert','Past Due','Awaiting Payment'],['done','Paid in Full','Closed Out'],['prospect','Prospect','In Conversation']];
  const pool = DATA.clients.filter(c=> showArchived || !c.archived);
  const withStat=pool.map(c=>({c,s:clientStats(c,YEAR),st:null}));
  withStat.forEach(o=>o.st=edStatusOf(o.c,o.s));
  let gi=0;
  const groups=GROUPS.map((g)=>{
    const rows=withStat.filter(o=>o.st===g[0]).sort((a,b)=>a.c.name.localeCompare(b.c.name));
    if(!rows.length) return '';
    gi++;
    const feeTot=sum(rows,o=>o.s.contractFee);
    const rowsHtml=rows.map(({c,s,st})=>{
      const ex=ED_EXPANDED_CLIENT===c.id;
      const billedPct=s.contractFee?Math.round(s.allBilled/s.contractFee*100):0, collPct=s.contractFee?Math.round(s.allCollected/s.contractFee*100):0;
      const outStr=s.outstanding>0?fmt0(s.outstanding):'—';
      const pvs=(c.invoices||[]).slice().sort((a,b)=>a.date<b.date?1:-1).map(i=>{const od=edOverdue(i);
        const label=i.paid?'Paid':(od?'Overdue':(i.sent?'Sent':'Draft'));
        const col=i.paid?'var(--forest)':(od?'var(--alert)':(i.sent?'var(--gold)':'var(--ink-mute)'));
        const bd=i.paid?'var(--forest)':(od?'var(--alert)':'var(--hairline)');
        return `<div style="display:grid;grid-template-columns:74px 90px 1fr 96px 96px;gap:14px;align-items:baseline;padding:11px 0;border-bottom:1px solid var(--hairline);">
          <span class="ed-num-tab" style="font-family:var(--sans-cond);font-size:13px;color:var(--rust);">${fmtMD(i.date)}</span>
          <span style="font-family:var(--titling);font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-mute);">#${esc(i.number||'')}</span>
          <span style="font-family:var(--serif);font-style:italic;font-size:14.5px;color:var(--ink-soft);">${esc(i.note||'')}</span>
          <span class="ed-num-tab" style="font-family:var(--sans-cond);font-size:15px;text-align:right;color:var(--ink);">${fmt0(i.amount)}</span>
          <span style="text-align:right;"><span style="font-family:var(--titling);font-size:9px;letter-spacing:.16em;text-transform:uppercase;border:1px solid ${bd};color:${col};padding:5px 10px;">${label}</span></span>
        </div>`;}).join('');
      const expanded= ex ? `<div style="padding:8px 0 30px;">
        <div class="scrollx"><div class="scrollx-in" style="display:grid;grid-template-columns:repeat(4,1fr);gap:24px;padding:22px 0;border-top:1px solid var(--hairline);border-bottom:1px solid var(--hairline);">
          <div><div style="font-family:var(--titling);font-size:9px;letter-spacing:.28em;text-transform:uppercase;color:var(--ink-mute);">Fee</div><div class="ed-num-tab" style="font-family:var(--sans-comp);font-size:30px;color:var(--ink);margin-top:8px;">${s.contractFee?fmt0(s.contractFee):'—'}</div></div>
          <div><div style="font-family:var(--titling);font-size:9px;letter-spacing:.28em;text-transform:uppercase;color:var(--ink-mute);">Billed</div><div class="ed-num-tab" style="font-family:var(--sans-comp);font-size:30px;color:var(--ink);margin-top:8px;">${fmt0(s.allBilled)}</div></div>
          <div><div style="font-family:var(--titling);font-size:9px;letter-spacing:.28em;text-transform:uppercase;color:var(--ink-mute);">Collected</div><div class="ed-num-tab" style="font-family:var(--sans-comp);font-size:30px;color:var(--forest);margin-top:8px;">${fmt0(s.allCollected)}</div></div>
          <div><div style="font-family:var(--titling);font-size:9px;letter-spacing:.28em;text-transform:uppercase;color:var(--ink-mute);">Remaining</div><div class="ed-num-tab" style="font-family:var(--sans-comp);font-size:30px;color:var(--rust);margin-top:8px;">${fmt0(s.contractRemaining)}</div></div>
        </div></div>
        <div style="padding:18px 0;"><div style="height:5px;background:var(--paper-deep);position:relative;overflow:hidden;">
          <div style="position:absolute;left:0;top:0;bottom:0;width:${Math.min(100,billedPct)}%;background:var(--rust-soft);"></div>
          <div style="position:absolute;left:0;top:0;bottom:0;width:${Math.min(100,collPct)}%;background:var(--forest);"></div></div>
          <div style="display:flex;justify-content:space-between;margin-top:8px;font-family:var(--titling);font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-mute);"><span>${billedPct}% billed &middot; ${collPct}% collected</span><span>${outStr} outstanding</span></div></div>
        <div style="font-family:var(--titling);font-size:9px;letter-spacing:.34em;text-transform:uppercase;color:var(--ink-mute);margin:22px 0 4px;">Invoices</div>
        <div class="scrollx"><div class="scrollx-in">${pvs||'<div style="font-family:var(--serif);font-style:italic;color:var(--ink-mute);padding:10px 0;">No invoices yet.</div>'}</div></div>
        ${c.notes?`<div style="font-family:var(--serif);font-style:italic;font-size:16px;color:var(--ink-soft);line-height:1.5;max-width:680px;margin-top:22px;">${esc(c.notes)}</div>`:''}
        <div style="margin-top:22px;"><button class="ed-edit-client" data-client-id="${c.id}" style="font-family:var(--titling);font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--paper);background:var(--ink);border:none;border-radius:0;padding:8px 18px;cursor:pointer;">Edit client</button></div>
      </div>` : '';
      return `<div style="border-bottom:1px solid var(--hairline);">
        <div class="hov-row ed-client-head" data-client-id="${c.id}" style="display:grid;grid-template-columns:1fr 130px 130px 18px;gap:18px;align-items:center;padding:18px 0;cursor:pointer;">
          <span class="ed-client-name" data-client-id="${c.id}" style="cursor:pointer;"><span style="font-family:var(--serif);font-style:italic;font-size:27.6px;color:var(--ink);">${esc(c.name)}</span>
            <span style="font-family:var(--titling);font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--ink-mute);display:block;margin-top:6px;">${esc(c.project_address||c.address||titleCase(c.full_name)||'')}</span></span>
          <span style="text-align:right;"><span class="ed-num-tab" style="font-family:var(--sans-comp);font-size:22px;color:var(--ink);display:block;line-height:1;">${s.contractFee?fmt0(s.contractFee):'—'}</span>
            <span style="font-family:var(--titling);font-size:8px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-mute);display:block;margin-top:4px;">Total Fee</span></span>
          <span style="text-align:right;"><span class="ed-num-tab" style="font-family:var(--sans-comp);font-size:22px;color:${s.outstanding>0?'var(--rust)':'var(--ink-mute)'};display:block;line-height:1;">${outStr}</span>
            <span style="font-family:var(--serif);font-style:italic;font-size:13px;color:var(--ink-mute);display:block;margin-top:3px;">${edStatusWord(st)}</span></span>
          <span style="font-family:var(--serif);font-size:18px;color:var(--rust);text-align:center;transform:${ex?'rotate(90deg)':'rotate(0deg)'};transition:transform 200ms;">›</span>
        </div>${expanded}</div>`;
    }).join('');
    return `<div class="plate" style="padding:44px 0 8px;">
      <div class="side" style="position:sticky;top:150px;"><div class="bignum" style="font-family:var(--sans-comp);font-size:72px;color:var(--rust);line-height:.82;">0${gi}</div>
        <div><div style="font-family:var(--titling);font-size:10px;letter-spacing:.42em;text-transform:uppercase;color:var(--ink-mute);margin-top:12px;">${g[2]}</div>
        <div class="rule" style="width:40px;height:2px;background:var(--rust);margin:16px 0;"></div>
        <div style="font-family:var(--display);font-weight:700;font-size:15px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink);line-height:1.25;">${g[1]}</div>
        <div style="font-family:var(--serif);font-style:italic;font-size:14px;color:var(--ink-soft);margin-top:14px;">${rows.length+(rows.length===1?' project':' projects')} &middot; ${feeTot?fmt0(feeTot):'—'}</div></div></div>
      <div style="border-top:1px solid var(--ink);">${rowsHtml}</div></div>`;
  }).join('');

  root.innerHTML = `<div class="ed-clients-bar" style="display:flex;align-items:center;justify-content:space-between;gap:18px;padding:14px 0 6px;">
      <button id="addClientBtn" class="ed-save" style="background:var(--rust);">+ Add Client</button>
      <label style="font-family:var(--titling);font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-mute);cursor:pointer;display:flex;align-items:center;gap:6px;"><input type="checkbox" id="showArchived" ${showArchived?'checked':''}> show archived</label>
    </div><div style="border-top:1px solid var(--hairline-strong);padding-top:8px;">${groups||'<div style="font-family:var(--serif);font-style:italic;color:var(--ink-soft);padding:30px 0;">No clients yet.</div>'}</div>`;

  const sa2=document.getElementById('showArchived'); if(sa2) sa2.addEventListener('change',renderClients);
  const ab=document.getElementById('addClientBtn'); if(ab) ab.addEventListener('click',()=>openClientEditor(null));
  root.querySelectorAll('.ed-client-head').forEach(el=>el.addEventListener('click',()=>{const id=el.dataset.clientId; ED_EXPANDED_CLIENT=(ED_EXPANDED_CLIENT===id?null:id); renderClients();}));
  // Clicking the client's name specifically opens the full Client Card (edit modal)
  // instead of just toggling the inline row preview.
  // Session 21: .ed-client-name used to wrap ONLY the name text itself, with
  // the address/full-name sub-line sitting in a separate, unclickable span
  // next to it. For a client with a long project address (wraps to its own
  // line, e.g. Davis - Liberty Park's full mailing address vs. most clients'
  // shorter or blank address), a click anywhere near the name but not
  // precisely on the name text landed on that dead space instead — bubbling
  // up to .ed-client-head and just toggling the row's inline preview instead
  // of opening the card. .ed-client-name now wraps the whole name+sub-line
  // block, so clicking anywhere in that block opens the card.
  root.querySelectorAll('.ed-client-name').forEach(el=>el.addEventListener('click',(e)=>{e.stopPropagation(); const c=DATA.clients.find(x=>x.id===el.dataset.clientId); if(c) openClientEditor(c);}));
  root.querySelectorAll('.ed-edit-client').forEach(el=>el.addEventListener('click',(e)=>{e.stopPropagation(); const c=DATA.clients.find(x=>x.id===el.dataset.clientId); if(c) openClientEditor(c);}));
}

// ----- Cash Flow tab -----
function renderCashFlow() {
  // Small multiples removed; only the planned billing matrix remains.
  renderMatrix();
}

function smChart(planned, invoiced, max) {
  const W = 360, H = 36;
  const stepX = W / 12;
  const barW = stepX * 0.7;
  let svg = `<svg class="sm-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  // Baseline
  svg += `<line x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}" stroke="#d4d2cc" stroke-width="0.5"/>`;
  for (let i = 0; i < 12; i++) {
    const x = i * stepX + stepX * 0.15;
    if (planned[i] > 0) {
      const h = (planned[i] / max) * (H - 2);
      svg += `<rect x="${x}" y="${H - h}" width="${barW}" height="${h}" fill="#e8e6e0"/>`;
    }
    if (invoiced[i] > 0) {
      const h = (invoiced[i] / max) * (H - 2);
      svg += `<rect x="${x + barW * 0.1}" y="${H - h}" width="${barW * 0.8}" height="${h}" fill="#1c1c1a"/>`;
    }
  }
  svg += `</svg>`;
  return svg;
}

function renderMatrix() {
  const year = SETTINGS.fiscal_year;
  const active = DATA.clients.filter(c => !c.archived);
  active.sort((a, b) => a.name.localeCompare(b.name));
  const tbl = $('#billingMatrix');
  let html = '<thead><tr><th class="client-col">Client</th><th>Total</th>';
  MONTHS.forEach(m => html += `<th>${m}</th>`);
  html += '</tr></thead><tbody>';

  const monthTotals = new Array(12).fill(0);
  const monthSent = new Array(12).fill(0);
  const monthPaid = new Array(12).fill(0);
  const monthOverdue = new Array(12).fill(0);
  let grandTotal = 0, grandSent = 0, grandPaid = 0, grandOverdue = 0;

  // For overdue computation
  const today = new Date();

  active.forEach(c => {
    const planned = clientMonthlyPlanned(c);
    const invoiced = clientMonthlyInvoiced(c, year);
    const collected = clientMonthlyCollected(c, year);
    // Overdue per month: sum of invoices in that month that are sent && !paid && >30 days old
    const overdueByMonth = new Array(12).fill(0);
    for (const inv of (c.invoices || [])) {
      if (!inv.date || !inv.sent || inv.paid) continue;
      const d = new Date(inv.date + 'T12:00:00');
      if (d.getFullYear() !== year) continue;
      const daysOut = (today - d) / (1000 * 60 * 60 * 24);
      if (daysOut > 30) overdueByMonth[d.getMonth()] += inv.amount || 0;
    }

    let rowTotal = 0;
    let monthCells = '';
    for (let i = 0; i < 12; i++) {
      const value = invoiced[i] || planned[i];
      const sent = invoiced[i] > 0;
      const paid = collected[i] > 0;
      const overdue = overdueByMonth[i] > 0;
      let cls = 'cell';
      if (!value) cls += ' empty';
      if (sent && !paid) cls += ' sent';
      if (paid) cls += ' paid';
      if (overdue) cls += ' overdue';

      // Build dot indicator
      let dot = '';
      if (paid) dot = '<span class="matrix-dot paid" title="paid"></span>';
      else if (overdue) dot = '<span class="matrix-dot overdue" title="overdue"></span>';
      else if (sent) dot = '<span class="matrix-dot sent" title="sent"></span>';

      const cellContent = value
        ? `${dot}<span class="matrix-num">${fmt0bare(value)}</span>`
        : '·';
      monthCells += `<td class="${cls}" data-month="${i}">${cellContent}</td>`;
      rowTotal += value;
      monthTotals[i] += value;
      if (sent && !paid) {
        monthSent[i] += invoiced[i];
        grandSent += invoiced[i];
      }
      if (paid) {
        monthPaid[i] += collected[i];
        grandPaid += collected[i];
      }
      if (overdue) {
        monthOverdue[i] += overdueByMonth[i];
        grandOverdue += overdueByMonth[i];
      }
    }
    // Total column appears first after Client name
    html += `<tr data-client-id="${c.id}">`;
    html += `<td class="client-col">${escapeHtml(c.name)}</td>`;
    html += `<td>${fmt0bare(rowTotal)}</td>`;
    html += monthCells;
    html += '</tr>';
    grandTotal += rowTotal;
  });

  // Footer: Total column first, then months (matching header order)
  html += '</tbody><tfoot>';
  html += `<tr class="total-row"><td class="client-col">Total</td><td>${fmt0bare(grandTotal)}</td>`;
  monthTotals.forEach(v => html += `<td>${fmt0bare(v)}</td>`);
  html += '</tr>';
  html += `<tr class="total-sent"><td class="client-col"><span class="matrix-dot sent"></span> Sent</td><td>${fmt0bare(grandSent)}</td>`;
  monthSent.forEach(v => html += `<td>${v ? fmt0bare(v) : ''}</td>`);
  html += '</tr>';
  html += `<tr class="total-paid"><td class="client-col"><span class="matrix-dot paid"></span> Paid</td><td>${fmt0bare(grandPaid)}</td>`;
  monthPaid.forEach(v => html += `<td>${v ? fmt0bare(v) : ''}</td>`);
  html += '</tr>';
  html += `<tr class="total-overdue"><td class="client-col"><span class="matrix-dot overdue"></span> Overdue</td><td>${fmt0bare(grandOverdue)}</td>`;
  monthOverdue.forEach(v => html += `<td>${v ? fmt0bare(v) : ''}</td>`);
  html += '</tr>';
  html += '</tfoot>';
  tbl.innerHTML = html;

  tbl.querySelectorAll('tbody td.cell').forEach(td => {
    td.addEventListener('click', (e) => {
      e.stopPropagation();
      const tr = td.closest('tr');
      const c = DATA.clients.find(x => x.id === tr.dataset.clientId);
      if (c) editPlannedMonth(c, parseInt(td.dataset.month, 10));
    });
  });
}

// Edit a planned month — a cleaner modal-style prompt for amount + sent + paid
function editPlannedMonth(client, monthIdx) {
  const monthName = MONTHS[monthIdx];
  let entry = (client.monthly_planned_2026 || []).find(m => m.month === monthName);
  const cur = entry ? entry.amount : 0;

  // Build a small modal dynamically
  const m = document.createElement('div');
  m.className = 'modal-backdrop';
  m.innerHTML = `<div class="modal" style="width:min(420px,92vw)">
    <div class="modal-header">
      <h2>${escapeHtml(client.name)} — ${monthName} ${SETTINGS.fiscal_year}</h2>
      <button class="close-x" data-close>×</button>
    </div>
    <div class="modal-body">
      <label style="display:block;font-family:var(--font-ui);font-size: 0.78rem;letter-spacing:0.05em;text-transform:uppercase;color:var(--ink-soft);font-weight:700;">
        Planned amount
        <input type="text" id="pm_amount" class="currency-input" value="${cur}" style="display:block;width:100%;margin-top:0.25rem;">
      </label>
      <div class="form-row" style="margin-top:0.6rem;">
        <label class="checkbox-label"><input type="checkbox" id="pm_sent" ${entry && entry.sent ? 'checked' : ''}> Invoice sent</label>
        <label class="checkbox-label"><input type="checkbox" id="pm_paid" ${entry && entry.paid ? 'checked' : ''}> Paid</label>
      </div>
      <div class="modal-footer">
        ${entry ? '<button class="action danger" data-act="remove">Remove</button>' : ''}
        <span class="spacer"></span>
        <button class="action ghost" data-close>Cancel</button>
        <button class="action" data-act="save">Save</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(m);
  wireCurrencyInput(m.querySelector('#pm_amount'));

  function close() { m.remove(); }
  m.addEventListener('click', (e) => {
    if (e.target === m) close();
    if (e.target.matches('[data-close]')) close();
    const act = e.target.dataset.act;
    if (act === 'save') {
      const amt = currencyVal(m.querySelector('#pm_amount'));
      const sent = m.querySelector('#pm_sent').checked;
      const paid = m.querySelector('#pm_paid').checked;
      if (!client.monthly_planned_2026) client.monthly_planned_2026 = [];
      client.monthly_planned_2026 = client.monthly_planned_2026.filter(x => x.month !== monthName);
      if (amt > 0 || sent || paid) {
        client.monthly_planned_2026.push({ month: monthName, amount: amt, sent, paid });
      }
      close();
      markDirty();
      renderAll();
    }
    if (act === 'remove') {
      client.monthly_planned_2026 = (client.monthly_planned_2026 || []).filter(x => x.month !== monthName);
      close();
      markDirty();
      renderAll();
    }
  });
}

// ----- Invoices tab -----
// Sort state
let INVOICE_SORT = { col: 'date', dir: 'desc' };

// Year filter for invoices tab — null = all years, otherwise a year number
// Defaults to current year
let INVOICE_YEAR_FILTER = new Date().getFullYear();

function renderInvoices() {
  // Populate year-filter buttons based on years present in the data
  const yearFilterEl = $('#invoiceYearFilter');
  if (yearFilterEl) {
    const years = new Set();
    DATA.clients.forEach(c => (c.invoices || []).forEach(inv => {
      if (inv.date) {
        const m = String(inv.date).match(/^(\d{4})/);
        if (m) years.add(parseInt(m[1], 10));
      }
    }));
    const sortedYears = Array.from(years).sort((a, b) => b - a);
    const activeYear = INVOICE_YEAR_FILTER;
    yearFilterEl.innerHTML = sortedYears.map(y =>
      `<button class="year-btn ${y === activeYear ? 'active' : ''}" data-year="${y}">${y}</button>`
    ).join('') + `<button class="year-btn ${activeYear === null ? 'active' : ''}" data-year="all">All</button>`;
    yearFilterEl.querySelectorAll('.year-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.year;
        INVOICE_YEAR_FILTER = (v === 'all') ? null : parseInt(v, 10);
        renderInvoices();
      });
    });
  }

  // Populate client filter
  const clientSelect = $('#invoiceClientFilter');
  const currentVal = clientSelect.value;
  clientSelect.innerHTML = '<option value="">All clients</option>' +
    DATA.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  clientSelect.value = currentVal;

  const filter = $('#invoiceFilter').value;
  const clientFilter = clientSelect.value;

  // Flatten invoices with their client
  let invs = [];
  DATA.clients.forEach(c => {
    (c.invoices || []).forEach(inv => {
      invs.push({ ...inv, _clientId: c.id, _clientName: c.name });
    });
  });

  // Filter by year
  if (INVOICE_YEAR_FILTER !== null) {
    invs = invs.filter(i => {
      if (!i.date) return false;
      const m = String(i.date).match(/^(\d{4})/);
      return m && parseInt(m[1], 10) === INVOICE_YEAR_FILTER;
    });
  }

  // Filter
  if (clientFilter) invs = invs.filter(i => i._clientId === clientFilter);
  if (filter === 'unsent') invs = invs.filter(i => !i.sent);
  else if (filter === 'unpaid') invs = invs.filter(i => i.sent && !i.paid);
  else if (filter === 'paid') invs = invs.filter(i => i.paid);

  // Sort
  const dir = INVOICE_SORT.dir === 'asc' ? 1 : -1;
  invs.sort((a, b) => {
    const col = INVOICE_SORT.col;
    let va, vb;
    if (col === 'date') { va = a.date || ''; vb = b.date || ''; }
    else if (col === 'number') {
      // Numeric sort if possible
      const na = parseInt(a.number, 10), nb = parseInt(b.number, 10);
      if (!isNaN(na) && !isNaN(nb)) return dir * (na - nb);
      va = a.number || ''; vb = b.number || '';
    }
    else if (col === 'client') { va = a._clientName || ''; vb = b._clientName || ''; }
    else if (col === 'amount') return dir * ((a.amount || 0) - (b.amount || 0));
    else if (col === 'note') { va = a.note || ''; vb = b.note || ''; }
    else if (col === 'sent') return dir * ((a.sent ? 1 : 0) - (b.sent ? 1 : 0));
    else if (col === 'paid') return dir * ((a.paid ? 1 : 0) - (b.paid ? 1 : 0));
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });

  // Update sort indicators on headers
  $$('#invoicesHeadRow .sortable-th').forEach(th => {
    th.classList.remove('active');
    const ind = th.querySelector('.sort-ind');
    ind.classList.remove('asc', 'desc');
    if (th.dataset.sort === INVOICE_SORT.col) {
      th.classList.add('active');
      ind.classList.add(INVOICE_SORT.dir);
    }
  });

  const tbody = $('#invoicesBody');
  tbody.innerHTML = invs.map(inv => {
    // Sent column: yellow if sent, gray (drafted) if not
    const sentDot = inv.sent
      ? '<span class="dot on" title="sent"></span>'
      : '<span class="dot" title="drafted"></span>';
    // Paid column: green if paid, red if not paid yet
    const paidDot = inv.paid
      ? '<span class="dot paid" title="paid"></span>'
      : '<span class="dot unpaid" title="not paid"></span>';
    return `<tr data-id="${inv.id}" data-client-id="${inv._clientId}" class="${!inv.sent ? 'unsent' : ''} ${inv.sent && !inv.paid ? 'unpaid' : ''}">
      <td class="col-date">${fmtDate(inv.date)}</td>
      <td class="col-num">${escapeHtml(inv.number || '')}</td>
      <td class="col-name">${escapeHtml(inv._clientName)}</td>
      <td class="col-num">${fmt0(inv.amount)}</td>
      <td class="col-note">${escapeHtml(inv.note || '')}</td>
      <td class="col-status">${sentDot}</td>
      <td class="col-status">${paidDot}</td>
      <td class="col-actions"></td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => {
      openInvoiceEditor(tr.dataset.clientId, tr.dataset.id);
    });
  });

  // Footer totals
  const total = sum(invs, i => i.amount);
  const totalSent = sum(invs.filter(i => i.sent), i => i.amount);
  const totalPaid = sum(invs.filter(i => i.paid), i => i.amount);
  $('#invoicesFoot').innerHTML = `<tr>
    <td colspan="3" style="text-align:right; font-family: var(--font-ui); text-transform:uppercase; font-size: 0.78rem; letter-spacing:0.05em; color: var(--ink-soft);">Totals · ${invs.length} invoices</td>
    <td class="col-num">${fmt0(total)}</td>
    <td colspan="4" style="font-style:italic; color:var(--ink-soft); padding-left:1rem;">sent ${fmt0(totalSent)} · paid ${fmt0(totalPaid)}</td>
  </tr>`;
}

// ----- Settings tab -----
function renderSettings() {
  $('#setFy').value = SETTINGS.fiscal_year;
  $('#setOwner').value = SETTINGS.owner || '';
  $('#setRepo').value = SETTINGS.repo || '';
  $('#setBranch').value = SETTINGS.branch || 'main';
  $('#setPath').value = SETTINGS.path || 'data.json';
  $('#setToken').value = SETTINGS.token || '';
  // 2026-05-07: local copy on save toggle
  const lcEl = $('#setLocalCopyOnSave');
  if (lcEl) lcEl.checked = !!SETTINGS.local_copy_on_save;
  // Firm info
  const f = DATA.firm || defaultFirm();
  $('#setFirmName').value = f.name || '';
  $('#setPrincipal1').value = f.principal1_name || '';
  $('#setPhoneScott').value = f.principal1_phone || '';
  $('#setPrincipal2').value = f.principal2_name || '';
  $('#setPhoneBill').value = f.principal2_phone || '';
  $('#setAddr1').value = f.address_line1 || '';
  $('#setAddr2').value = f.address_line2 || '';
  $('#setBank').value = f.bank_name || '';
  $('#setRouting').value = f.bank_routing || '';
  $('#setAccount').value = f.bank_account || '';
  $('#setBeneficiary').value = f.beneficiary || '';
  $('#setWebsite').value = f.website || '';
}

function saveFirmInfo() {
  DATA.firm = {
    name: $('#setFirmName').value.trim(),
    principal1_name: $('#setPrincipal1').value.trim(),
    principal1_phone: $('#setPhoneScott').value.trim(),
    principal2_name: $('#setPrincipal2').value.trim(),
    principal2_phone: $('#setPhoneBill').value.trim(),
    address_line1: $('#setAddr1').value.trim(),
    address_line2: $('#setAddr2').value.trim(),
    bank_name: $('#setBank').value.trim(),
    bank_routing: $('#setRouting').value.trim(),
    bank_account: $('#setAccount').value.trim(),
    beneficiary: $('#setBeneficiary').value.trim(),
    website: $('#setWebsite').value.trim(),
  };
  markDirty();
  toast('Firm info saved', 'success');
}

// ===============================================================
// CLIENT EDITOR
// ===============================================================
let editingClientId = null;


// Estimate revisions — in-memory state for the editor session.
// Persisted to client.estimate_revisions = [{id, estimate, date}] on save.
let CF_REVISIONS = [];
let CF_PHASE_FEE = 0;  // total fee the phase amounts are computed from (for $-entry back-calc)

function calcFeeForEstimate(est) {
  const ft = getCurrentFeeType();
  if (est <= 0 || ft === 'fixed') return 0;
  if (ft === 'percentage') {
    return est * ((parseFloat($('#cf_pct_value').value) || 0) / 100);
  }
  return computeClientFee({
    fee_type: 'tiered_percentage',
    fee_estimate: est,
    fee_tier1_pct: parseFloat($('#cf_tier1_pct').value) || 0,
    fee_tier_threshold: currencyVal($('#cf_tier_threshold')),
    fee_tier2_pct: parseFloat($('#cf_tier2_pct').value) || 0,
  });
}

function updateCatchupDisplay() {
  // Orig. Estimate is mirrored by recomputeClientForm into cf_orig_estimate.
  // The Orig. Fee box is computed here from that value.
  const origEstEl    = $('#cf_orig_estimate');
  const origFeeEl    = $('#cf_orig_fee_calc');
  const currentFeeEl = $('#cf_current_fee_calc');
  const feeRemainingEl = $('#cf_fee_remaining_calc');
  if (!origEstEl) return;

  const ft = getCurrentFeeType();
  const origEst = currencyVal(origEstEl) || 0;
  const origFee = calcFeeForEstimate(origEst);

  if (origFeeEl) {
    if (ft === 'fixed') {
      // For fixed-fee clients, Orig. Fee = the fixed amount itself, so it
      // matches the Phase Amounts table above.
      const fixedAmt = currencyVal($('#cf_fixed_amount')) || 0;
      origFeeEl.value = fixedAmt > 0 ? fmt0(fixedAmt) : '—';
    } else {
      origFeeEl.value = (origEst > 0) ? fmt0(origFee) : '—';
    }
  }

  // Current Fee = original fee with the latest estimate revision applied.
  if (currentFeeEl) {
    if (ft === 'fixed') {
      const fixedAmt = currencyVal($('#cf_fixed_amount')) || 0;
      currentFeeEl.value = fixedAmt > 0 ? fmt0(fixedAmt) : '—';
    } else {
      let curFee = origFee;
      if (Array.isArray(CF_REVISIONS) && CF_REVISIONS.length > 0) {
        const latestEst = parseFloat(CF_REVISIONS[CF_REVISIONS.length - 1].estimate) || 0;
        if (latestEst > 0) curFee = calcFeeForEstimate(latestEst);
      }
      currentFeeEl.value = (curFee > 0) ? fmt0(curFee) : '—';
    }
  }

  // Fee Remaining = Current Fee minus billed-to-date for the editing client.
  if (feeRemainingEl) {
    let curFee = 0;
    if (currentFeeEl && currentFeeEl.value) {
      curFee = parseFloat(String(currentFeeEl.value).replace(/[^0-9.\-]/g, '')) || 0;
    }
    const editingC = (typeof editingClientId !== 'undefined' && editingClientId)
      ? DATA.clients.find(x => x.id === editingClientId)
      : null;
    let billed = 0;
    if (editingC) {
      const allInvs = editingC.invoices || [];
      billed = allInvs.filter(i => i.sent).reduce((a, i) => a + (parseFloat(i.amount) || 0), 0);
      if (editingC.deposit_paid) billed += parseFloat(editingC.deposit_paid_amount) || 0;
      if (typeof pocCreditFor === 'function') billed += pocCreditFor(editingC);
    }
    const remaining = Math.max(0, curFee - billed);
    feeRemainingEl.value = (curFee > 0) ? fmt0(remaining) : '—';
  }

  // Re-render every revision row so their fee/catch-up reflect the
  // current fee type and current Original estimate.
  renderEstimateRevisions();
}

function renderEstimateRevisions() {
  const list = $('#cf_revisionsList');
  if (!list) return;
  const ft = getCurrentFeeType();
  const origEst = currencyVal($('#cf_orig_estimate')) || 0;
  const origFee = calcFeeForEstimate(origEst);

  // 2026-05-07: also render revisions for fixed-fee clients. For fixed-fee, the
  // "estimate" field is interpreted as the new fee directly. Button label and
  // input labels change to reflect this.
  const isFixed = (ft === 'fixed');
  const fixedOrigFee = isFixed ? (currencyVal($('#cf_fixed_amount')) || parseFloat($('#cf_fixed_amount')?.value || 0) || 0) : 0;
  const baseFeeForCatchup = isFixed ? fixedOrigFee : origFee;

  // Update the button label to match fee type
  const addBtn = $('#cf_addRevision');
  if (addBtn) addBtn.textContent = isFixed ? '+ Add fee revision' : '+ Add new estimate';
  const hint = $('#cf_revisionsHint');
  if (hint) hint.textContent = (CF_REVISIONS.length === 0)
    ? (isFixed ? 'No revisions yet. Click + Add fee revision to record a fee change. The most recent revision becomes the current fee.'
               : 'No revisions yet. Click + Add new estimate to record a construction-estimate change. The most recent revision drives the catch-up.')
    : (isFixed ? 'Each revision starts from the previous one; the most recent becomes the current fee.'
               : 'Each new estimate starts from the previous one; the most recent drives the catch-up.');

  if (CF_REVISIONS.length === 0) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = CF_REVISIONS.map((rev, idx) => {
    const dateLabel = rev.date ? fmtDate(rev.date) : '';
    const labelTitle = isFixed ? 'New Fee' : 'New Estimate';
    const computedTitle = isFixed ? '(fee shown above)' : 'New Fee';
    return `<div class="fee-revision-row" data-rev-id="${rev.id}" data-rev-idx="${idx}">
      <div class="fr-tag">
        Revision
        <span class="fr-tag-num">#${idx + 1}</span>
        <span style="font-size:0.65rem;font-weight:400;color:var(--ink-faint);">${escapeHtml(dateLabel)}</span>
      </div>
      <div class="fr-box">
        <label>${labelTitle}</label>
        <input type="text" class="currency-input fee-track-input fr-estimate" data-rev-idx="${idx}" value="">
      </div>
      <div class="fr-box">
        <label>${computedTitle}</label>
        <input type="text" class="fee-track-input fr-fee" readonly tabindex="-1">
      </div>
      <div class="fr-box">
        <label>Catch-up vs Original</label>
        <input type="text" class="fee-track-input fr-catchup" readonly tabindex="-1">
      </div>
      <button type="button" class="fr-remove" data-rev-idx="${idx}" title="Remove this revision">×</button>
    </div>`;
  }).join('');

  // Wire each row's input + remove button
  CF_REVISIONS.forEach((rev, idx) => {
    const row = list.querySelector(`.fee-revision-row[data-rev-idx="${idx}"]`);
    if (!row) return;
    const estInput = row.querySelector('.fr-estimate');
    setCurrencyVal(estInput, rev.estimate || 0);
    wireCurrencyInput(estInput);
    estInput.addEventListener('input', () => {
      CF_REVISIONS[idx].estimate = currencyVal(estInput) || 0;
      updateRevisionRow(row, idx, baseFeeForCatchup);
    });
    estInput.addEventListener('blur', () => {
      CF_REVISIONS[idx].estimate = currencyVal(estInput) || 0;
      updateRevisionRow(row, idx, baseFeeForCatchup);
    });
    row.querySelector('.fr-remove').addEventListener('click', () => {
      CF_REVISIONS.splice(idx, 1);
      recomputeClientForm();
    });
    updateRevisionRow(row, idx, baseFeeForCatchup);
  });
}

function updateRevisionRow(row, idx, origFee) {
  const ft = getCurrentFeeType();
  const rev = CF_REVISIONS[idx];
  if (!rev) return;
  const feeEl = row.querySelector('.fr-fee');
  const catchEl = row.querySelector('.fr-catchup');
  if ((rev.estimate || 0) <= 0) {
    feeEl.value = '—';
    catchEl.value = '—';
    catchEl.className = 'fee-track-input fr-catchup';
    return;
  }
  // 2026-05-07: for fixed-fee, the revision's "estimate" field IS the new fee directly.
  // For percentage/tiered, derive new fee from the new estimate via calcFeeForEstimate.
  const newFee = (ft === 'fixed') ? (rev.estimate || 0) : calcFeeForEstimate(rev.estimate || 0);
  feeEl.value = fmt0(newFee);
  const delta = newFee - (origFee || 0);
  catchEl.value = delta === 0 ? '$0'
    : delta > 0 ? '+' + fmt0(delta)
    : '−' + fmt0(Math.abs(delta));
  catchEl.className = 'fee-track-input fr-catchup'
    + (delta > 0 ? ' catchup-pos' : delta < 0 ? ' catchup-neg' : '');
}

function addNewEstimateRevision() {
  // 2026-05-07: also support fixed-fee clients. For fixed, the previous value
  // defaults to the current fee_fixed_amount (so a revision starts as "same fee").
  const ft = getCurrentFeeType();
  const isFixed = (ft === 'fixed');
  let origVal = 0;
  if (isFixed) {
    origVal = currencyVal($('#cf_fixed_amount')) || 0;
  } else {
    origVal = currencyVal($('#cf_orig_estimate')) || 0;
  }
  const prev = CF_REVISIONS.length > 0
    ? (CF_REVISIONS[CF_REVISIONS.length - 1].estimate || 0)
    : origVal;
  CF_REVISIONS.push({
    id: uuid(),
    estimate: prev,
    date: nowIsoDate(),
  });
  renderEstimateRevisions();
  // Focus the newly added estimate input for quick editing
  setTimeout(() => {
    const list = $('#cf_revisionsList');
    if (!list) return;
    const inputs = list.querySelectorAll('.fr-estimate');
    if (inputs.length > 0) {
      const last = inputs[inputs.length - 1];
      last.focus();
      last.select();
    }
  }, 0);
}

function nowIsoDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function loadRevisionsFromClient(client) {
  // Prefer estimate_revisions array; fall back to legacy revised_estimate single value.
  if (Array.isArray(client.estimate_revisions) && client.estimate_revisions.length > 0) {
    CF_REVISIONS = client.estimate_revisions.map(r => ({
      id: r.id || uuid(),
      estimate: parseFloat(r.estimate) || 0,
      date: r.date || '',
    }));
    return;
  }
  CF_REVISIONS = [];
  const legacy = parseFloat(client.revised_estimate) || 0;
  const orig = parseFloat(client.fee_estimate) || 0;
  if (legacy > 0 && Math.abs(legacy - orig) >= 1) {
    CF_REVISIONS.push({
      id: uuid(),
      estimate: legacy,
      date: client.original_set_at || nowIsoDate(),
    });
  }
}

function openClientEditor(client) {
  editingClientId = client ? client.id : null;
  const isNew = !client;
  if (isNew) {
    client = {
      id: uuid(),
      name: '',
      full_name: '',
      address: '',
      phone: '',
      email: '',
      project_address: '',
      archived: false,
      fee_type: 'fixed',
      fee_fixed_amount: 0,
      fee_percentage: 0,
      fee_estimate: 0,
      fee_tier1_pct: 0,
      fee_tier_threshold: 0,
      fee_tier2_pct: 0,
      is_phased: true,
      phases: { DEPOSIT: 0.05, SD: 0.20, DD: 0.20, CD: 0.50, CA: 0.05 },
      monthly_planned_2026: [],
      invoices: [],
      notes: ''
    };
    editingClientId = client.id;
    DATA.clients.push(client);
  }

  // Title: just the client name (or NEW CLIENT), bold, larger via CSS
  $('#clientEditorTitle').textContent = isNew
    ? 'New Client'
    : (client.name || '');

  $('#cf_name').value = client.name || '';
  // Fee tracking — orig estimate mirrors the fee-type estimate (read-only, set by recomputeClientForm)
  // Estimate revisions live in CF_REVISIONS (loaded below)
  $('#cf_full_name').value = client.full_name || '';
  $('#cf_address').value = client.address || '';
  $('#cf_phone').value = client.phone || '';
  $('#cf_email').value = client.email || '';
  $('#cf_project_address').value = client.project_address || '';
  $('#cf_notes').value = client.notes || '';
  if ($('#cf_poc_amount')) setCurrencyVal($('#cf_poc_amount'), parseFloat(client.poc_amount) || 0);
  if ($('#cf_poc_at')) $('#cf_poc_at').value = client.poc_at || '';

  // Per-year fee — auto-derived: currentClientFee minus invoices billed in years before FY.
  const fy = SETTINGS.fiscal_year;
  $$('#cf_yearLabel, .cf_yearLabel2').forEach(el => el.textContent = fy);
  const billedPriorYears = (client.invoices || []).reduce((s, inv) => {
    if (!inv.sent || !inv.date) return s;
    const y = new Date(inv.date + 'T12:00:00').getUTCFullYear();
    return (y < fy) ? s + (parseFloat(inv.amount) || 0) : s;
  }, 0);
  const autoYearFee = Math.max(0, currentClientFee(client) || 0);
  setCurrencyVal($('#cf_year_fee'), autoYearFee);

  // Fee type radios
  const ft = client.fee_type || 'fixed';
  $$('input[name="cf_fee_type"]').forEach(r => r.checked = (r.value === ft));

  setCurrencyVal($('#cf_fixed_amount'), client.fee_fixed_amount || '');

  setCurrencyVal($('#cf_pct_estimate'), client.fee_estimate || '');
  $('#cf_pct_value').value = client.fee_percentage || '';

  setCurrencyVal($('#cf_tier_estimate'), client.fee_estimate || '');
  $('#cf_tier1_pct').value = client.fee_tier1_pct || '';
  setCurrencyVal($('#cf_tier_threshold'), client.fee_tier_threshold || '');
  $('#cf_tier2_pct').value = client.fee_tier2_pct || '';

  const ph = client.phases || { DEPOSIT: 0.05, SD: 0.20, DD: 0.20, CD: 0.50, CA: 0.05 };
  // Session 9: display as whole-number percentages (store as decimals)
  $('#cf_p_deposit').value = fmtPhasePct(ph.DEPOSIT * 100);
  $('#cf_p_sd').value      = fmtPhasePct(ph.SD      * 100);
  $('#cf_p_dd').value      = fmtPhasePct(ph.DD      * 100);
  $('#cf_p_cd').value      = fmtPhasePct(ph.CD      * 100);
  $('#cf_p_ca').value      = fmtPhasePct(ph.CA      * 100);

  // Phased mode toggle
  const isPhased = !!client.is_phased;
  $('#cf_is_phased').checked = isPhased;
  $('#cf_phased_block').hidden = !isPhased;
  // Build O: Deposit Paid checkbox
  const dpCb = $('#cf_deposit_paid');
  const dpStatus = $('#cf_deposit_paid_status');
  if (dpCb) dpCb.checked = !!client.deposit_paid;
  // Session 13: populate the editable amount input
  const dpAmtEl = $('#cf_deposit_paid_amount');
  if (dpAmtEl) {
    const _amt = parseFloat(client.deposit_paid_amount) || 0;
    setCurrencyVal(dpAmtEl, _amt);
  }
  if (dpStatus) {
    if (client.deposit_paid) {
      const dt = client.deposit_paid_at ? fmtDate(client.deposit_paid_at) : '';
      const amt = parseFloat(client.deposit_paid_amount) || 0;
      dpStatus.textContent = dt ? `Marked paid ${dt} · ${fmt0(amt)}` : `Marked paid · ${fmt0(amt)}`;
    } else {
      dpStatus.textContent = '';
    }
  }

  // Hide Create Invoice button on new (unsaved) clients
  $('#cf_create_invoice').style.display = isNew ? 'none' : '';

  showFeeBlock(ft);
  // Load estimate revisions for this client into CF_REVISIONS BEFORE recompute,
  // so renderEstimateRevisions() (called via updateCatchupDisplay) sees them.
  loadRevisionsFromClient(client);
  recomputeClientForm();
  updateCatchupDisplay();
  renderClientPastInvoices(client);
  renderFeeRevisions(client);
  // Update Close Out button to reflect current state
  const coBtn = $('#cf_closeout');
  if (coBtn) {
    const isClosed = !!client.closed_out;
    coBtn.textContent = isClosed ? 'Re-open' : 'Close Out';
    coBtn.className   = isClosed ? 'action ghost' : 'action ghost';
  }
  $('#clientEditor').hidden = false;
}

function renderFeeRevisions(client) {
  const tbody = $('#cf_revisionBody');
  const tfoot = $('#cf_revisionFoot');
  if (!tbody) return;

  const isPhased = !!client.is_phased;
  // Build P: Current = currentClientFee (latest revision applied);
  // Original = un-revised baseline computeClientFee. With no revisions, the two are equal.
  const currentTotal = currentClientFee(client) || 0;
  const originalTotal = computeClientFee(client) || 0;
  const currentPhases = client.phases || { DEPOSIT: 0.05, SD: 0.20, DD: 0.20, CD: 0.50, CA: 0.05 };
  const originalPhases = client.original_phases || { DEPOSIT: 0.05, SD: 0.20, DD: 0.20, CD: 0.50, CA: 0.05 };

  let bodyHtml = '';
  const _pocCred = (typeof pocCreditFor === 'function') ? pocCreditFor(client) : 0;
  if (isPhased) {
    // If DEPOSIT is fully billed, lock it at original and redistribute delta to other phases
    const priorProg = priorPhaseProgress(client);
    const depositDone = (priorProg['DEPOSIT'] || 0) >= 100;
    const depositOrigWeight = parseFloat(originalPhases['DEPOSIT']) || 0;
    const depositLockedAmt = depositDone && originalTotal > 0
      ? originalTotal * depositOrigWeight
      : 0;
    const nonDepositOrigWeight = 1 - depositOrigWeight;
    const nonDepositCurWeight  = 1 - (parseFloat(currentPhases['DEPOSIT']) || 0);

    for (const p of PHASE_NAMES) {
      let origAmt, curAmt;
      if (p === 'DEPOSIT' && depositDone) {
        origAmt = depositLockedAmt;
        curAmt  = depositLockedAmt;  // locked — doesn't scale with fee revision
      } else if (depositDone) {
        // Distribute remaining fee among non-deposit phases
        const w = parseFloat(originalPhases[p]) || 0;
        origAmt = nonDepositOrigWeight > 0
          ? (originalTotal - depositLockedAmt) * (w / nonDepositOrigWeight)
          : originalTotal * w;
        const cw = parseFloat(currentPhases[p]) || 0;
        curAmt = nonDepositCurWeight > 0
          ? (currentTotal - depositLockedAmt) * (cw / nonDepositCurWeight)
          : currentTotal * cw;
      } else {
        origAmt = originalTotal * (parseFloat(originalPhases[p]) || 0);
        curAmt  = currentTotal  * (parseFloat(currentPhases[p])  || 0);
      }
      const delta = curAmt - origAmt;
      const cls = delta > 0 ? 'increase-pos' : delta < 0 ? 'increase-neg' : '';
      const sign = delta > 0 ? '+' : '';
      const lockedNote = (p === 'DEPOSIT' && depositDone) ? ' <span style="font-size:0.8em;opacity:0.6;">(locked)</span>' : '';
      bodyHtml += `<div style="display:grid;grid-template-columns:1fr 96px 96px 86px;align-items:baseline;padding:9px 0;border-bottom:1px solid var(--hairline);">
        <span style="font-family:var(--display);font-weight:700;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);">${p}${lockedNote}</span>
        <span class="cc-num-tab" style="font-family:var(--sans-cond);font-size:14px;text-align:right;color:var(--ink-soft);">${fmt0(origAmt)}</span>
        <span class="cc-num-tab" style="font-family:var(--sans-cond);font-size:14px;text-align:right;color:var(--ink);">${fmt0(curAmt)}</span>
        <span class="cc-num-tab ${cls}" style="font-family:var(--sans-cond);font-size:14px;text-align:right;color:var(--ink-mute);">${sign}${fmt0(delta)}</span>
      </div>`;
      if (p === 'DEPOSIT' && _pocCred > 0) {
        bodyHtml += `<div style="display:grid;grid-template-columns:1fr 96px 96px 86px;align-items:baseline;padding:8px 0;border-bottom:1px solid var(--hairline);"><span style="font-family:var(--serif);font-style:italic;font-size:13px;color:var(--forest);padding-left:1.2em;">Proof of Concept received</span><span></span><span class="cc-num-tab" style="font-family:var(--sans-cond);font-size:14px;text-align:right;color:var(--forest);">\u2212 ${fmt0(_pocCred)}</span><span></span></div>`
                  + `<div style="display:grid;grid-template-columns:1fr 96px 96px 86px;align-items:baseline;padding:9px 0;border-bottom:1px solid var(--hairline);background:var(--paper-edge);"><span style="font-family:var(--display);font-weight:700;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);padding-left:1.2em;">Deposit Due</span><span></span><span class="cc-num-tab" style="font-family:var(--sans-cond);font-size:15px;text-align:right;color:var(--rust);font-weight:700;">${fmt0(Math.max(0, curAmt - _pocCred))}</span><span></span></div>`;
      }
    }
  } else {
    // Non-phased: just show the single total row
    const delta = currentTotal - originalTotal;
    const cls = delta > 0 ? 'increase-pos' : delta < 0 ? 'increase-neg' : '';
    const sign = delta > 0 ? '+' : '';
    bodyHtml = `<div style="display:grid;grid-template-columns:1fr 96px 96px 86px;align-items:baseline;padding:9px 0;border-bottom:1px solid var(--hairline);">
      <span style="font-family:var(--display);font-weight:700;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);">Fee</span>
      <span class="cc-num-tab" style="font-family:var(--sans-cond);font-size:14px;text-align:right;color:var(--ink-soft);">${fmt0(originalTotal)}</span>
      <span class="cc-num-tab" style="font-family:var(--sans-cond);font-size:14px;text-align:right;color:var(--ink);">${fmt0(currentTotal)}</span>
      <span class="cc-num-tab ${cls}" style="font-family:var(--sans-cond);font-size:14px;text-align:right;color:var(--ink-mute);">${sign}${fmt0(delta)}</span>
    </div>`;
  }
  tbody.innerHTML = bodyHtml;

  // Total footer
  const totalDelta = currentTotal - originalTotal;
  const totalCls = totalDelta > 0 ? 'increase-pos' : totalDelta < 0 ? 'increase-neg' : '';
  const totalSign = totalDelta > 0 ? '+' : '';
  tfoot.innerHTML = `<div style="display:grid;grid-template-columns:1fr 96px 96px 86px;align-items:baseline;padding:11px 0 0;border-top:2px solid var(--ink);">
    <span style="font-family:var(--titling);font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:var(--ink-mute);">Total</span>
    <span class="cc-num-tab" style="font-family:var(--sans-comp);font-size:17px;text-align:right;color:var(--ink);">${fmt0(originalTotal)}</span>
    <span class="cc-num-tab" style="font-family:var(--sans-comp);font-size:17px;text-align:right;color:var(--ink);">${fmt0(currentTotal)}</span>
    <span class="cc-num-tab ${totalCls}" style="font-family:var(--sans-comp);font-size:17px;text-align:right;color:var(--ink-mute);">${totalSign}${fmt0(totalDelta)}</span>
  </div>`;

  // Hint label updates with original-set-at date
  const hint = $('#cf_originalLockHint');
  if (hint) {
    if (client.original_set_at) {
      hint.textContent = `Original locked on ${fmtDate(client.original_set_at)}. Click again to update the baseline.`;
    } else {
      hint.textContent = 'Use this once the original contract is finalized. After that, fee changes will be tracked as increases.';
    }
  }
}

function renderClientPastInvoices(client) {
  const tbody = $('#cf_invoicesBody');
  const tfoot = $('#cf_invoicesFoot');
  if (!tbody) return;

  // Build a list that prepends a synthetic 'Deposit received' entry when
  // client.deposit_paid is true, so the user sees the deposit in context.
  const realInvs = (client.invoices || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const invoices = [];
  if (client.deposit_paid) {
    invoices.push({
      id: 'deposit-' + client.id,
      _deposit: true,
      date: client.deposit_paid_at || '',
      amount: parseFloat(client.deposit_paid_amount) || 0,
      note: 'Deposit (received outside of invoicing)',
      sent: true, paid: true,
    });
  }
  const _pocCredit = (typeof pocCreditFor === 'function') ? pocCreditFor(client) : 0;
  if (_pocCredit > 0) {
    invoices.push({
      id: 'poc-' + client.id,
      _poc: true,
      date: client.poc_at || '',
      amount: _pocCredit,
      note: 'Proof of Concept (credited to deposit)',
      sent: true, paid: true,
    });
  }
  for (const i of realInvs) invoices.push(i);

  if (invoices.length === 0) {
    tbody.innerHTML = '<div style="font-family:var(--serif);font-style:italic;color:var(--ink-mute);padding:14px 0;">No invoices yet for this client.</div>';
    tfoot.innerHTML = '';
    return;
  }

  tbody.innerHTML = invoices.map(inv => {
    // SENT dot: yellow when sent, gray when drafted
    const sentDot = `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${inv.sent?'var(--gold)':'var(--paper-deep)'};"></span>`;
    const paidDot = `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${inv.paid?'var(--forest)':'var(--paper-deep)'};"></span>`;
    const bg = inv.paid ? 'var(--forest-wash)' : (inv.sent ? 'var(--rust-wash)' : 'transparent');
    return `<div data-invoice-id="${inv.id}" style="display:grid;grid-template-columns:84px 92px 1fr 52px 52px;align-items:center;padding:11px 0;border-bottom:1px solid var(--hairline);background:${bg};cursor:pointer;">
      <span class="cc-num-tab" style="font-family:var(--sans-cond);font-size:13px;color:var(--rust);">${fmtDate(inv.date)}</span>
      <span class="cc-num-tab" style="font-family:var(--sans-cond);font-size:15px;text-align:right;color:var(--ink);">${fmt0(inv.amount)}</span>
      <span style="font-family:var(--serif);font-style:italic;font-size:13.5px;color:var(--ink-soft);padding-left:14px;line-height:1.35;">${escapeHtml(inv.note || '')}</span>
      <span style="text-align:center;">${sentDot}</span>
      <span style="text-align:center;">${paidDot}</span>
    </div>`;
  }).join('');

  // Totals: stacked Sent / Paid / Outstanding / Fee Remaining
  // Outstanding shown in red when > 0; Fee Remaining is contract fee minus what's been sent.
  const totalSent = sum(invoices.filter(i => i.sent), i => i.amount);
  const totalPaid = sum(invoices.filter(i => i.paid), i => i.amount);
  const outstanding = totalSent - totalPaid;
  const outClass = outstanding > 0 ? 'has-outstanding' : '';
  const feeTotal = currentClientFee(client) || 0;
  const feeRemaining = feeTotal - totalSent;
  const feeRemClass = feeRemaining < 0 ? 'over-billed' : (feeRemaining === 0 ? 'fully-billed' : '');
  tfoot.innerHTML = `<tr class="invoices-totals-row">
    <td colspan="5">
      <div class="invoices-totals">
        <span class="invoices-count">${invoices.length} invoice${invoices.length === 1 ? '' : 's'}</span>
        <div class="invoices-totals-stack">
          <div class="totals-line"><span class="l">Sent</span><span class="v">${fmt0(totalSent)}</span></div>
          <div class="totals-line"><span class="l">Paid</span><span class="v">${fmt0(totalPaid)}</span></div>
          <div class="totals-line outstanding ${outClass}"><span class="l">Outstanding</span><span class="v">${fmt0(outstanding)}</span></div>
          <div class="totals-line fee-remaining ${feeRemClass}"><span class="l">Fee Remaining</span><span class="v">${fmt0(feeRemaining)}</span></div>
        </div>
      </div>
    </td>
  </tr>`;

  // Click any row to open it for editing — close the client editor first then open invoice editor
  tbody.querySelectorAll('[data-invoice-id]').forEach(tr => {
    tr.addEventListener('click', () => {
      const invId = tr.dataset.invoiceId;
      if (invId && (invId.startsWith('deposit-') || invId.startsWith('poc-'))) return;  // Synthetic rows — no editor.
      // Close client editor and open invoice editor
      $('#clientEditor').hidden = true;
      openInvoiceEditor(client.id, invId);
    });
  });
}

function showFeeBlock(ft) {
  $('#cf_fixed_block').hidden = (ft !== 'fixed');
  $('#cf_percentage_block').hidden = (ft !== 'percentage');
  $('#cf_tiered_block').hidden = (ft !== 'tiered_percentage');
}

function getCurrentFeeType() {
  const r = document.querySelector('input[name="cf_fee_type"]:checked');
  return r ? r.value : 'fixed';
}

// Recompute just the phase Sum readout from the five % inputs, without a full
// re-render (so focus stays in whatever field is being typed).
function updatePhaseSumDisplay() {
  const ph = {
    DEPOSIT: (parseFloat($('#cf_p_deposit').value) || 0) / 100,
    SD:      (parseFloat($('#cf_p_sd').value)      || 0) / 100,
    DD:      (parseFloat($('#cf_p_dd').value)      || 0) / 100,
    CD:      (parseFloat($('#cf_p_cd').value)      || 0) / 100,
    CA:      (parseFloat($('#cf_p_ca').value)      || 0) / 100,
  };
  const sum = Object.values(ph).reduce((a, b) => a + b, 0);
  const el = $('#cf_p_sum');
  if (el) {
    el.value = fmtPhasePct(sum * 100) + '%';
    el.style.color = Math.abs(sum - 1) < 0.001 ? 'var(--ink)' : 'var(--warn)';
  }
}

// Make the Amount column in the Phase Amounts table editable: typing a dollar
// amount sets that phase's percentage (= amount / total fee), to 3 decimals.
// Live keystrokes update only the % cell + Sum (no re-render, keeps focus);
// blur runs a full recompute to normalize everything.
const CF_PHASE_FIELD = { DEPOSIT: 'cf_p_deposit', SD: 'cf_p_sd', DD: 'cf_p_dd', CD: 'cf_p_cd', CA: 'cf_p_ca' };
function wirePhaseAmountInputs() {
  const host = $('#cf_phase_amounts');
  if (!host) return;
  host.querySelectorAll('.cf-phase-amt-input').forEach(inp => {
    wireCurrencyInput(inp);
    inp.addEventListener('input', () => {
      const fee = CF_PHASE_FEE || 0;
      const phase = inp.dataset.phase;
      const pf = $('#' + CF_PHASE_FIELD[phase]);
      if (fee <= 0 || !pf) return;
      const amt = currencyVal(inp);
      const pct = (amt / fee) * 100;
      pf.value = fmtPhasePct(pct);
      const disp = host.querySelector('.pa-pct[data-phase="' + phase + '"]');
      if (disp) disp.textContent = fmtPhasePct(pct) + '%';
      updatePhaseSumDisplay();
    });
    inp.addEventListener('change', () => recomputeClientForm());
  });
}

function recomputeClientForm() {
  const ft = getCurrentFeeType();
  showFeeBlock(ft);

  // Build a temporary client object to compute the fee
  const temp = {
    fee_type: ft,
    fee_fixed_amount: currencyVal($('#cf_fixed_amount')),
    fee_estimate: ft === 'tiered_percentage'
      ? (currencyVal($('#cf_tier_estimate')))
      : (currencyVal($('#cf_pct_estimate'))),
    fee_percentage: parseFloat($('#cf_pct_value').value) || 0,
    fee_tier1_pct: parseFloat($('#cf_tier1_pct').value) || 0,
    fee_tier_threshold: currencyVal($('#cf_tier_threshold')),
    fee_tier2_pct: parseFloat($('#cf_tier2_pct').value) || 0,
  };
  const fee = computeClientFee(temp);

  // Unified computed-fee display (formerly per-block cf_pct_computed / cf_tier_computed)
  const _cfCompEl = $('#cf_computed_fee');
  if (_cfCompEl) _cfCompEl.value = fee ? fmt0(fee) : '';

  // Phase sum
  const phases = {
    DEPOSIT: (parseFloat($('#cf_p_deposit').value) || 0) / 100,
    SD:      (parseFloat($('#cf_p_sd').value)      || 0) / 100,
    DD:      (parseFloat($('#cf_p_dd').value)      || 0) / 100,
    CD:      (parseFloat($('#cf_p_cd').value)      || 0) / 100,
    CA:      (parseFloat($('#cf_p_ca').value)      || 0) / 100,
  };
  const phaseSum = Object.values(phases).reduce((a, b) => a + b, 0);
  $('#cf_p_sum').value = fmtPhasePct(phaseSum * 100) + '%';
  $('#cf_p_sum').style.color = Math.abs(phaseSum - 1) < 0.001 ? 'var(--ink)' : 'var(--warn)';

  // Phase amounts based on the CURRENT total fee (latest estimate/fee revision
  // applied, if any). 2026-05-07: also honor fee revisions for fixed-fee.
  let feeWithRevisions = fee;
  if (Array.isArray(CF_REVISIONS) && CF_REVISIONS.length > 0) {
    const latestVal = parseFloat(CF_REVISIONS[CF_REVISIONS.length - 1].estimate) || 0;
    if (latestVal > 0) {
      if (ft === 'fixed') {
        feeWithRevisions = latestVal;
      } else {
        const tempRev = Object.assign({}, temp, { fee_estimate: latestVal });
        feeWithRevisions = computeClientFee(tempRev);
      }
    }
  }
  // Session 13: apply Deposit Paid shortfall rule. If the deposit-paid box is
  // checked and the entered amount is LESS than the calculated deposit, the
  // shortfall rolls into the SD phase (or the next non-zero phase: DD, CD, CA).
  // This keeps total billable fee unchanged.
  const _baseAmts = {};
  PHASE_NAMES.forEach(p => { _baseAmts[p] = feeWithRevisions * phases[p]; });
  const _finalAmts = Object.assign({}, _baseAmts);
  let _shortfallTarget = null;
  let _shortfallDiff = 0;
  const _dpChecked = $('#cf_deposit_paid') && $('#cf_deposit_paid').checked;
  const _dpAmtEl = $('#cf_deposit_paid_amount');
  const _dpAmt = (_dpChecked && _dpAmtEl) ? (currencyVal(_dpAmtEl) || 0) : 0;
  if (_dpChecked && _dpAmt > 0 && _dpAmt < _baseAmts.DEPOSIT) {
    _shortfallDiff = _baseAmts.DEPOSIT - _dpAmt;
    _finalAmts.DEPOSIT = _dpAmt;
    const _rollOrder = ['SD', 'DD', 'CD', 'CA'];
    _shortfallTarget = _rollOrder.find(p => (phases[p] || 0) > 0) || 'SD';
    _finalAmts[_shortfallTarget] = (_finalAmts[_shortfallTarget] || 0) + _shortfallDiff;
  } else if (_dpChecked && _dpAmt >= _baseAmts.DEPOSIT) {
    // Overpayment / exact: display calculated deposit; overage is informational only.
    _finalAmts.DEPOSIT = _baseAmts.DEPOSIT;
  }
  // Total fee the phase amounts are taken from — stashed so the editable
  // Amount inputs can back-compute each phase's percentage from a typed $.
  CF_PHASE_FEE = feeWithRevisions || 0;
  const _pocC = (typeof pocCreditFor === 'function') ? pocCreditFor(DATA.clients.find(x => x.id === editingClientId) || {}) : 0;
  const _PG='display:grid;grid-template-columns:1fr auto 130px;align-items:center;padding:9px 0;border-bottom:1px solid var(--hairline);';
  $('#cf_phase_amounts').innerHTML = PHASE_NAMES.map(p => {
    const pctOf = phases[p];
    const amt = _finalAmts[p];
    const note = (p === _shortfallTarget && _shortfallDiff > 0)
      ? ` <span class="dp-shortfall-note" style="font-style:italic;color:var(--ink-mute);font-size:11px;">(+${fmt0(_shortfallDiff)} shortfall)</span>`
      : '';
    let row = `<div style="${_PG}">`
      + `<span style="font-family:var(--display);font-weight:700;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink);">${p}</span>`
      + `<span class="pa-pct" data-phase="${p}" style="font-family:var(--sans-cond);font-size:14px;color:var(--ink-soft);text-align:center;">${fmtPhasePct(pctOf * 100)}%</span>`
      + `<span style="text-align:right;"><input type="text" class="cf-phase-amt-input cc-num-tab" data-phase="${p}" value="${fmt0(amt)}" inputmode="numeric" style="text-align:right;width:118px;background:#fff;border:1px solid var(--hairline-ink);padding:6px 8px;font-family:var(--sans-cond);">${note}</span>`
      + `</div>`;
    if (p === 'DEPOSIT' && _pocC > 0) {
      row += `<div style="${_PG}"><span style="font-family:var(--serif);font-style:italic;font-size:13.5px;color:var(--forest);padding-left:16px;">Proof of Concept received</span><span></span><span class="cc-num-tab" style="font-family:var(--sans-cond);font-size:15px;color:var(--forest);text-align:right;">\u2212 ${fmt0(_pocC)}</span></div>`
           + `<div style="${_PG}background:var(--paper-edge);"><span style="font-family:var(--display);font-weight:700;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink);padding-left:16px;">Deposit Due</span><span></span><span class="cc-num-tab" style="font-family:var(--sans-cond);font-size:16px;color:var(--rust);text-align:right;font-weight:700;">${fmt0(Math.max(0, amt - _pocC))}</span></div>`;
    }
    return row;
  }).join('');
  wirePhaseAmountInputs();
  // Current Fee box = full fee from the inputs (latest revision applied).
  setCurrencyVal($('#cf_year_fee'), Math.max(0, feeWithRevisions || 0));

  // Re-render fee revisions to reflect any changes
  const c = DATA.clients.find(x => x.id === editingClientId);
  if (c) {
    // Build temp client merging form state into the saved client so phases pick up
    const tempC = Object.assign({}, c, {
      ...temp,
      is_phased: $('#cf_is_phased').checked,
      phases,
    });
    renderFeeRevisions(tempC);
  }

  // Mirror fee-type estimate into cf_orig_estimate (read-only display).
  // The list of estimate revisions is rendered separately by updateCatchupDisplay → renderEstimateRevisions.
  const origEstEl = $('#cf_orig_estimate');
  const updPct = $('#cf_upd_pct');
  if (updPct) {
    if (ft === 'fixed') {
      if (origEstEl) origEstEl.value = '—';
      updPct.value = '—';
    } else if (ft === 'percentage') {
      const est = currencyVal($('#cf_pct_estimate')) || 0;
      const pct = parseFloat($('#cf_pct_value').value) || 0;
      if (origEstEl) { est ? setCurrencyVal(origEstEl, est) : (origEstEl.value = ''); }
      updPct.value = pct ? pct.toFixed(2) + '%' : '—';
    } else {
      const est = currencyVal($('#cf_tier_estimate')) || 0;
      const t1  = parseFloat($('#cf_tier1_pct').value) || 0;
      const t2  = parseFloat($('#cf_tier2_pct').value) || 0;
      if (origEstEl) { est ? setCurrencyVal(origEstEl, est) : (origEstEl.value = ''); }
      updPct.value = t1 ? t1.toFixed(2) + '% / ' + t2.toFixed(2) + '%' : '—';
    }
  }
  // Recalculate orig fee box and re-render revision rows
  updateCatchupDisplay();
}

function saveClientForm() {
  const c = DATA.clients.find(x => x.id === editingClientId);
  if (!c) return;
  c.name = $('#cf_name').value.trim();
  // Save estimate revisions array. Also keep revised_estimate in sync with
  // the latest revision for any legacy code paths that still read it.
  c.estimate_revisions = CF_REVISIONS.map(r => ({
    id: r.id,
    estimate: r.estimate || 0,
    date: r.date || '',
  }));
  if (CF_REVISIONS.length > 0) {
    c.revised_estimate = CF_REVISIONS[CF_REVISIONS.length - 1].estimate || 0;
  } else {
    c.revised_estimate = 0;
  }
  // closed_out is set by the Close Out button; preserve it on normal save
  c.full_name = $('#cf_full_name').value.trim();
  c.address = $('#cf_address').value.trim();
  c.phone = $('#cf_phone').value.trim();
  c.email = $('#cf_email').value.trim();
  c.project_address = $('#cf_project_address').value.trim();
  c.notes = $('#cf_notes').value;
  c.poc_amount = $('#cf_poc_amount') ? (currencyVal($('#cf_poc_amount')) || 0) : (c.poc_amount || 0);
  c.poc_at = $('#cf_poc_at') ? ($('#cf_poc_at').value || '') : (c.poc_at || '');

  c.fee_type = getCurrentFeeType();
  c.fee_fixed_amount = currencyVal($('#cf_fixed_amount'));
  if (c.fee_type === 'tiered_percentage') {
    c.fee_estimate = currencyVal($('#cf_tier_estimate'));
  } else {
    c.fee_estimate = currencyVal($('#cf_pct_estimate'));
  }
  c.fee_percentage = parseFloat($('#cf_pct_value').value) || 0;
  c.fee_tier1_pct = parseFloat($('#cf_tier1_pct').value) || 0;
  c.fee_tier_threshold = currencyVal($('#cf_tier_threshold'));
  c.fee_tier2_pct = parseFloat($('#cf_tier2_pct').value) || 0;

  // Per-year fee is auto-derived from currentClientFee - prior-year billing.
  // No longer stored on the client; remove any legacy total_fee_<fy> field.
  const fy = SETTINGS.fiscal_year;
  delete c[`total_fee_${fy}`];

  c.phases = {
    DEPOSIT: (parseFloat($('#cf_p_deposit').value) || 0) / 100,
    SD:      (parseFloat($('#cf_p_sd').value)      || 0) / 100,
    DD:      (parseFloat($('#cf_p_dd').value)      || 0) / 100,
    CD:      (parseFloat($('#cf_p_cd').value)      || 0) / 100,
    CA:      (parseFloat($('#cf_p_ca').value)      || 0) / 100,
  };
  c.is_phased = $('#cf_is_phased').checked;
  if (!c.name) { toast('Client needs a name', 'error'); return; }
  $('#clientEditor').hidden = true;
  markDirty();
  renderAll();
  toast('Client saved');
}

function deleteClient() {
  const c = DATA.clients.find(x => x.id === editingClientId);
  if (!c) return;
  if (!confirm(`Delete ${c.name}? This removes the client AND all their invoices. This can't be undone.`)) return;
  DATA.clients = DATA.clients.filter(x => x.id !== editingClientId);
  $('#clientEditor').hidden = true;
  markDirty();
  renderAll();
  toast('Client deleted');
}

function archiveClient() {
  const c = DATA.clients.find(x => x.id === editingClientId);
  if (!c) return;
  c.archived = !c.archived;
  $('#clientEditor').hidden = true;
  markDirty();
  renderAll();
  toast(c.archived ? 'Client archived' : 'Client restored');
}

// ===============================================================
// INVOICE EDITOR
// ===============================================================
let editingInvoice = { clientId: null, invoiceId: null };

function openInvoiceEditor(clientId, invoiceId) {
  editingInvoice = { clientId, invoiceId };
  const client = DATA.clients.find(c => c.id === clientId);
  let inv = null;
  if (invoiceId && client) inv = client.invoices.find(i => i.id === invoiceId);
  const isNew = !inv;

  $('#invoiceEditorTitle').textContent = isNew ? 'NEW INVOICE' : 'EDIT INVOICE';
  const sel = $('#if_client');
  sel.innerHTML = DATA.clients.filter(c => !c.archived).map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  sel.value = clientId || (DATA.clients[0] && DATA.clients[0].id) || '';

  if (inv) {
    $('#if_date').value = inv.date || '';
    $('#if_number').value = inv.number || '';
    setCurrencyVal($('#if_amount'), inv.amount || '');
    $('#if_note').value = inv.note || '';
    $('#if_sent').checked = !!inv.sent;
    $('#if_paid').checked = !!inv.paid;
    // Show redownload only if this invoice has phase_progress (i.e., was generated by the builder)
    const hasPhaseData = inv.phase_progress && Object.keys(inv.phase_progress).length;
    $('#if_redownload').hidden = !hasPhaseData;
  } else {
    $('#if_date').value = new Date().toISOString().slice(0, 10);
    $('#if_number').value = '';
    setCurrencyVal($('#if_amount'), 0);
    $('#if_note').value = '';
    $('#if_sent').checked = true;
    $('#if_paid').checked = false;
    $('#if_redownload').hidden = true;
  }
  $('#if_delete').style.display = isNew ? 'none' : '';
  $('#invoiceEditor').hidden = false;
}

function saveInvoiceForm() {
  const targetClientId = $('#if_client').value;
  const target = DATA.clients.find(c => c.id === targetClientId);
  if (!target) { toast('Pick a client', 'error'); return; }
  const date = $('#if_date').value;
  const amount = currencyVal($('#if_amount'));
  const number = $('#if_number').value.trim();
  if (!date) { toast('Date required', 'error'); return; }
  if (isNaN(amount)) { toast('Amount required', 'error'); return; }

  const fields = {
    date, amount, number,
    note: $('#if_note').value,
    sent: $('#if_sent').checked,
    paid: $('#if_paid').checked
  };

  if (editingInvoice.invoiceId) {
    const oldClient = DATA.clients.find(c => (c.invoices || []).some(i => i.id === editingInvoice.invoiceId));
    if (oldClient && oldClient.id !== targetClientId) {
      const oldInv = oldClient.invoices.find(i => i.id === editingInvoice.invoiceId);
      const preserved = { phase_progress: oldInv.phase_progress, reimbursable: oldInv.reimbursable, outstanding_prior: oldInv.outstanding_prior };
      oldClient.invoices = oldClient.invoices.filter(i => i.id !== editingInvoice.invoiceId);
      target.invoices = target.invoices || [];
      target.invoices.push({ id: editingInvoice.invoiceId, ...preserved, ...fields });
    } else if (oldClient) {
      const inv = oldClient.invoices.find(i => i.id === editingInvoice.invoiceId);
      Object.assign(inv, fields);
    }
  } else {
    target.invoices = target.invoices || [];
    target.invoices.push({ id: uuid(), ...fields });
  }
  $('#invoiceEditor').hidden = true;
  markDirty();
  renderAll();
  toast('Invoice saved');
}

async function redownloadInvoice() {
  const c = DATA.clients.find(c => (c.invoices || []).some(i => i.id === editingInvoice.invoiceId));
  if (!c) return;
  const inv = c.invoices.find(i => i.id === editingInvoice.invoiceId);
  if (!inv) return;

  // Reconstruct the summary from saved fields
  const reimb = parseFloat(inv.reimbursable) || 0;
  const outstanding = parseFloat(inv.outstanding_prior) || 0;
  const feeForWork = (inv.amount || 0) - reimb - outstanding;

  // Compute paid-to-date and remaining at the time of this invoice — year-scoped
  const invYear = inv.date ? new Date(inv.date).getUTCFullYear() : SETTINGS.fiscal_year;
  const yearFee = clientYearFee(c, invYear);
  const idx = c.invoices.findIndex(i => i.id === inv.id);
  const priorBilledThisYear = c.invoices.slice(0, idx)
    .filter(i => i.sent && i.date && new Date(i.date).getUTCFullYear() === invYear)
    .reduce((s, i) => s + (i.amount || 0), 0);
  const paidToDate = priorBilledThisYear + feeForWork;
  const remaining = yearFee - paidToDate;

  const summary = { feeForWork, reimb, outstanding, total: inv.amount || 0, paidToDate, remaining };
  try {
    await buildAndDownloadInvoiceDoc(c, inv, summary, inv.note || 'Architectural services');
    toast('Word doc downloaded', 'success');
  } catch (e) {
    toast('Download failed: ' + e.message, 'error');
  }
}

function deleteInvoice() {
  if (!confirm('Delete this invoice?')) return;
  const c = DATA.clients.find(c => (c.invoices || []).some(i => i.id === editingInvoice.invoiceId));
  if (c) c.invoices = c.invoices.filter(i => i.id !== editingInvoice.invoiceId);
  $('#invoiceEditor').hidden = true;
  markDirty();
  renderAll();
  toast('Invoice deleted');
}

// ===============================================================
// GITHUB SYNC
// ===============================================================
async function gh(method, url, body) {
  // Note: use 'token' format (not 'Bearer') and omit X-GitHub-Api-Version
  // to avoid iOS Safari CORS preflight failures ("Load failed" error).
  const headers = {
    'Authorization': `token ${SETTINGS.token}`,
    'Accept': 'application/vnd.github+json',
  };
  if (body) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    // iOS Safari throws TypeError: "Load failed" for network/CORS issues
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      throw new Error('Network request blocked — on iOS, open Settings → Safari → turn off "Prevent Cross-Site Tracking" and try again. Or use the dashboard on a desktop browser.');
    }
    throw new Error('Network error: ' + networkErr.message);
  }
  if (!res.ok) {
    const txt = await res.text();
    let msg = `GitHub ${res.status}`;
    if (res.status === 401) msg = 'Bad token — check your GitHub Personal Access Token in Settings';
    else if (res.status === 404) msg = 'Repo not found — check Owner and Repo name in Settings';
    else if (res.status === 403) msg = 'Access denied — token may lack repo permissions';
    else msg += ': ' + txt.slice(0, 120);
    throw new Error(msg);
  }
  return res.json();
}

function ghContentsUrl() {
  const { owner, repo, path, branch } = SETTINGS;
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
}

async function loadFromGithub() {
  if (DEMO_MODE) {
    toast('Demo Mode — this is a standalone copy and never connects to GitHub.', 'success');
    return;
  }
  if (!SETTINGS.token || !SETTINGS.owner || !SETTINGS.repo) {
    toast('Configure GitHub settings first', 'error'); return;
  }
  setSettingsStatus('Loading from GitHub…', '');
  try {
    const json = await gh('GET', ghContentsUrl());
    const text = b64decode(json.content);
    DATA = JSON.parse(text);
    SHA = json.sha;
    DIRTY = false;
    saveLocal();
    renderAll();
    setSettingsStatus('Loaded from GitHub.', 'success');
    toast('Loaded from GitHub', 'success');
  } catch (e) {
    setSettingsStatus('Error: ' + e.message, 'error');
    toast('Load failed', 'error');
  }
}

async function saveToGithub(silent) {
  if (DEMO_MODE) {
    if (!silent) toast('Demo Mode — changes stay in this browser only, nothing syncs to GitHub.', 'success');
    return;
  }
  if (!SETTINGS.token || !SETTINGS.owner || !SETTINGS.repo) {
    if (!silent) toast('Configure GitHub settings first', 'error');
    return;
  }
  // Get current SHA if we don't have it (or refresh to be safe)
  try {
    const cur = await gh('GET', ghContentsUrl()).catch(() => null);
    if (cur && cur.sha) SHA = cur.sha;
  } catch {}

  // Timestamp before serializing (version already bumped by markDirty on each change)
  DATA.updated_at = nowIso();

  const content = JSON.stringify(DATA, null, 2);
  const body = {
    message: `Update billing data v${DATA.version} — ${new Date().toLocaleString()}`,
    content: b64encode(content),
    branch: SETTINGS.branch
  };
  if (SHA) body.sha = SHA;

  try {
    const url = `https://api.github.com/repos/${encodeURIComponent(SETTINGS.owner)}/${encodeURIComponent(SETTINGS.repo)}/contents/${encodeURIComponent(SETTINGS.path)}`;
    const result = await gh('PUT', url, body);
    SHA = result.content.sha;
    DIRTY = false;
    AUTOSAVE_PENDING = false;
    if (AUTOSAVE_TIMER) { clearTimeout(AUTOSAVE_TIMER); AUTOSAVE_TIMER = null; }
    saveLocal();  // persist updated version/timestamp to local cache too
    updateSyncStatus();
    showSaveFeedback(`Saved · v${DATA.version}`, 'success');

    // 2026-05-07: optionally also download data.json to the user's machine
    // after a successful GitHub save. Configured via Settings → Local Copy on Save.
    if (SETTINGS.local_copy_on_save) {
      try {
        const blob = new Blob([content], { type: 'application/json' });
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objUrl;
        a.download = 'data.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Revoke after a tick so the click has time to register
        setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
      } catch (downloadErr) {
        console.warn('Local copy download failed:', downloadErr);
      }
    }
  } catch (e) {
    console.error(e);
    showSaveFeedback('Save failed: ' + e.message, 'error');
    setSettingsStatus('Error: ' + e.message, 'error');
  }
}

let SAVE_FEEDBACK_TIMER = null;
function showSaveFeedback(text, kind) {
  const el = $('#saveFeedback');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', kind === 'error');
  el.hidden = false;
  if (SAVE_FEEDBACK_TIMER) clearTimeout(SAVE_FEEDBACK_TIMER);
  SAVE_FEEDBACK_TIMER = setTimeout(() => {
    el.hidden = true;
  }, kind === 'error' ? 6000 : 4000);
}

async function testConnect() {
  if (DEMO_MODE) {
    setSettingsStatus('Demo Mode — GitHub sync is disabled in this standalone demo copy.', 'success');
    return;
  }
  setSettingsStatus('Testing…', '');
  try {
    if (!SETTINGS.token) throw new Error('No token — paste your GitHub Personal Access Token above and click Save Settings first');
    if (!SETTINGS.owner) throw new Error('No owner — enter your GitHub username above and click Save Settings');
    if (!SETTINGS.repo)  throw new Error('No repo name — enter your repository name above and click Save Settings');
    const u = await gh('GET', 'https://api.github.com/user');
    const r = await gh('GET', `https://api.github.com/repos/${encodeURIComponent(SETTINGS.owner)}/${encodeURIComponent(SETTINGS.repo)}`);
    setSettingsStatus(`✓ Connected as ${u.login} — repo ${r.full_name} accessible (${r.private ? 'private' : 'public'})`, 'success');
  } catch (e) {
    setSettingsStatus('⚠ ' + e.message, 'error');
  }
}

function setSettingsStatus(msg, kind) {
  const el = $('#settingsStatus');
  el.textContent = msg;
  el.className = 'settings-status' + (kind ? ' ' + kind : '');
}

// ===============================================================
// IMPORT / EXPORT
// ===============================================================
function exportJson() {
  const blob = new Blob([JSON.stringify(DATA, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `TSC-BILLING-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.clients) throw new Error('No clients array in JSON');
      if (!confirm(`Import ${data.clients.length} clients? This replaces your current data.`)) return;
      DATA = data;
      saveLocal();
      DIRTY = true;
      renderAll();
      toast('Import complete');
    } catch (err) {
      toast('Import failed: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

// ===============================================================
// ACCOUNTANT EXPORT — Multi-tab Excel (.xlsx)  (Session 11)
// Asks for a tax year, then builds a workbook with:
//   1. Year Summary — cash + accrual income, A/R, year fee, projection
//   2. By Client ({year}) — per-client row for the tax year
//   3. All Invoices ({year}) — flat ledger of invoices dated in that year
//   4. A/R Aging — outstanding invoices bucketed by days out
//   5. Fee Structure — full client list with lifetime numbers (legacy view)
// ===============================================================

// ---- shared workbook helpers ----
function _aw_applyStyles(ws, aoa, classifier) {
  if (!ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  aoa.forEach((row, idx) => {
    const cls = classifier(row, idx);
    if (!cls) return;
    for (let col = range.s.c; col <= range.e.c; col++) {
      const addr = XLSX.utils.encode_cell({ r: idx, c: col });
      if (!ws[addr]) continue;
      ws[addr].s = ws[addr].s || {};
      ws[addr].s.font = {
        bold: true,
        sz: cls === 'title' ? 14 : cls === 'section' ? 12 : 11
      };
      if (cls === 'section') ws[addr].s.fill = { fgColor: { rgb: 'EFEADC' }, patternType: 'solid' };
      if (cls === 'header')  ws[addr].s.fill = { fgColor: { rgb: 'F4F2EC' }, patternType: 'solid' };
      if (cls === 'total')   ws[addr].s.border = { top: { style: 'thin', color: { rgb: '000000' } } };
    }
  });
}
function _aw_applyCurrency(ws, cols) {
  if (!ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (const col of cols) {
      const addr = XLSX.utils.encode_cell({ r, c: col });
      const cell = ws[addr];
      if (cell && typeof cell.v === 'number') {
        cell.z = '"$"#,##0;[Red]-"$"#,##0';
      }
    }
  }
}
function _aw_agingBucket(daysOut) {
  if (daysOut <= 30) return '0–30';
  if (daysOut <= 60) return '31–60';
  if (daysOut <= 90) return '61–90';
  return '90+';
}
function _aw_daysBetween(d1, d2) {
  if (!d1 || !d2) return 0;
  const a = new Date(d1 + 'T12:00:00');
  const b = new Date(d2 + 'T12:00:00');
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

function exportAccountantSpreadsheet() {
  if (typeof XLSX === 'undefined') {
    toast('Spreadsheet library not loaded — make sure lib/xlsx.full.min.js is in your repo', 'error');
    return;
  }

  // ---- Tax year picker ----
  const defaultYear = SETTINGS.fiscal_year || new Date().getFullYear();
  const input = prompt(`Tax year to export?\n(Enter the calendar year you're filing for — e.g. ${defaultYear})`, defaultYear);
  if (input === null) return;
  const taxYear = parseInt(String(input).trim(), 10);
  if (!Number.isFinite(taxYear) || taxYear < 2000 || taxYear > 2100) {
    toast('Invalid year — export cancelled', 'error');
    return;
  }

  const today = fmtDate(new Date().toISOString().slice(0, 10));
  const wb = XLSX.utils.book_new();
  const active = DATA.clients.filter(c => !c.archived);

  // ---- Per-client per-year stats helper (uses existing clientStats logic) ----
  const yearStats = (c, y) => {
    const s = clientStats(c, y);
    return {
      contractFee: (c.archived || c.closed_out) ? 0 : (currentClientFee(c) || 0),
      yearFee:     s.yearFee,
      yearBilled:  s.yearBilled,    // accrual basis (sent in {y})
      yearCollected: s.yearCollected, // cash basis    (paid in {y}, dated in {y})
      yearOutstanding: s.yearOutstanding,
    };
  };

  // =============================================================
  // TAB 1 — Year Summary
  // =============================================================
  {
    const aoa = [];
    aoa.push([`T. SCOTT CARLISLE / Carlisle Moore Architects`]);
    aoa.push([`Year Summary — Tax Year ${taxYear}`]);
    aoa.push([`Generated ${today}`]);
    aoa.push([]);

    // Roll-ups
    let tContract = 0, tYearFee = 0, tBilled = 0, tCollected = 0, tOutstanding = 0;
    let priorBilled = 0, priorCollected = 0;
    active.forEach(c => {
      const y = yearStats(c, taxYear);
      tContract     += y.contractFee;
      tYearFee      += y.yearFee;
      tBilled       += y.yearBilled;
      tCollected    += y.yearCollected;
      tOutstanding  += y.yearOutstanding;
      const yp = yearStats(c, taxYear - 1);
      priorBilled    += yp.yearBilled;
      priorCollected += yp.yearCollected;
    });
    // Ending A/R: every sent-but-not-paid invoice dated on or before Dec 31 of taxYear
    let endingAR = 0;
    DATA.clients.forEach(c => {
      (c.invoices || []).forEach(inv => {
        if (!inv.sent || inv.paid || !inv.date) return;
        if (inv.date.slice(0, 4) <= String(taxYear)) {
          endingAR += parseFloat(inv.amount) || 0;
        }
      });
    });

    aoa.push(['INCOME — TAX YEAR ' + taxYear]);
    aoa.push(['Metric', 'Amount', 'Notes']);
    aoa.push(['Billed (accrual basis)',   tBilled,    `Invoices dated ${taxYear} that were sent`]);
    aoa.push(['Collected (cash basis)',   tCollected, `Invoices dated ${taxYear} that were paid`]);
    aoa.push(['Outstanding at year-end',  endingAR,   `Sent but not paid as of Dec 31, ${taxYear}`]);
    aoa.push([]);

    aoa.push(['CONTRACT POSITION']);
    aoa.push(['Metric', 'Amount', 'Notes']);
    aoa.push(['Total contract fee (active clients)', tContract, 'Full contract value across all active engagements']);
    aoa.push([`Total ${taxYear} fee (year-scoped)`,  tYearFee,  'Contract fee minus prior-year billings (active)']);
    aoa.push([`Active clients`, active.length, '']);
    aoa.push([]);

    aoa.push([`YoY COMPARISON (${taxYear - 1} → ${taxYear})`]);
    aoa.push(['Metric', `${taxYear - 1}`, `${taxYear}`, 'Change']);
    aoa.push(['Billed (accrual)',    priorBilled,    tBilled,    tBilled - priorBilled]);
    aoa.push(['Collected (cash)',    priorCollected, tCollected, tCollected - priorCollected]);
    aoa.push([]);

    // EOY projection — only meaningful when taxYear === current fiscal year
    if (taxYear === SETTINGS.fiscal_year) {
      const pt = projectionTotals(taxYear);
      aoa.push([`YEAR-END PROJECTION (as of ${today})`]);
      aoa.push(['Metric', 'Amount', 'Notes']);
      aoa.push(['Billed YTD',                     pt.ytdBilled,         '']);
      aoa.push(['Remaining year fee',             pt.remainingYearFee,  '']);
      aoa.push(['Projected EOY capture (raw)',    pt.projectedEoy,      'Sum of per-client projections']);
      aoa.push(['Projected EOY capture (weighted)', pt.weighted,        'Adjusted by per-client % of fee expected to collect']);
      aoa.push([`Projected ${taxYear} total`,     pt.projectedYearTotal, 'YTD billed + weighted projection']);
      aoa.push([]);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 38 }, { wch: 18 }, { wch: 18 }, { wch: 50 }];
    _aw_applyStyles(ws, aoa, (row, idx) => {
      const first = (row[0] || '').toString();
      if (idx === 0) return 'title';
      if (idx === 1) return 'section';
      if (first.endsWith(taxYear) && first === 'INCOME — TAX YEAR ' + taxYear) return 'section';
      if (first === 'CONTRACT POSITION') return 'section';
      if (first.startsWith('YoY COMPARISON')) return 'section';
      if (first.startsWith('YEAR-END PROJECTION')) return 'section';
      if (first === 'Metric') return 'header';
      return null;
    });
    _aw_applyCurrency(ws, [1, 2, 3]);  // Amount + YoY change columns
    XLSX.utils.book_append_sheet(wb, ws, 'Year Summary');
  }

  // =============================================================
  // TAB 2 — By Client ({taxYear})
  // =============================================================
  {
    const aoa = [];
    aoa.push([`By Client — Tax Year ${taxYear}`]);
    aoa.push([`Generated ${today}`]);
    aoa.push([]);
    aoa.push([
      'Client', 'Full Name', 'Fee Type',
      'Contract Fee', `${taxYear} Fee`, `Billed ${taxYear}`, `Collected ${taxYear}`,
      `A/R ${taxYear}`, 'Contract Remaining', 'Status'
    ]);

    const sorted = active.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    let tCF=0, tYF=0, tB=0, tC=0, tAR=0, tCR=0;
    for (const c of sorted) {
      const y = yearStats(c, taxYear);
      const contractRem = Math.max(0, y.contractFee -
        ((c.invoices||[]).filter(i=>i.sent).reduce((s,i)=>s+(parseFloat(i.amount)||0),0) +
         (c.deposit_paid ? (parseFloat(c.deposit_paid_amount)||0) : 0)));
      aoa.push([
        c.name || '',
        c.full_name || '',
        c.fee_type || 'fixed',
        y.contractFee, y.yearFee, y.yearBilled, y.yearCollected, y.yearOutstanding,
        contractRem,
        c.closed_out ? 'Closed Out' : 'Active'
      ]);
      tCF += y.contractFee; tYF += y.yearFee;
      tB  += y.yearBilled;  tC  += y.yearCollected;
      tAR += y.yearOutstanding; tCR += contractRem;
    }
    aoa.push([]);
    aoa.push(['TOTALS (active)', '', '', tCF, tYF, tB, tC, tAR, tCR, '']);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 24 }, { wch: 28 }, { wch: 14 },
      { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
      { wch: 12 }, { wch: 16 }, { wch: 12 }
    ];
    _aw_applyStyles(ws, aoa, (row, idx) => {
      if (idx === 0) return 'title';
      if (row[0] === 'Client' && row[1] === 'Full Name') return 'header';
      if ((row[0] || '').toString().startsWith('TOTALS')) return 'total';
      return null;
    });
    _aw_applyCurrency(ws, [3, 4, 5, 6, 7, 8]);
    XLSX.utils.book_append_sheet(wb, ws, `By Client ${taxYear}`);
  }

  // =============================================================
  // TAB 3 — All Invoices ({taxYear})
  // =============================================================
  {
    const aoa = [];
    aoa.push([`All Invoices — Tax Year ${taxYear}`]);
    aoa.push([`Generated ${today}`]);
    aoa.push([]);
    aoa.push([
      'Date', 'Client', 'Project Address', 'Invoice #',
      'Amount', 'Sent', 'Paid', 'Description'
    ]);

    // Flatten + filter to taxYear, sort by date desc
    const rows = [];
    for (const c of DATA.clients) {
      for (const inv of (c.invoices || [])) {
        if (!inv.date) continue;
        if (inv.date.slice(0, 4) !== String(taxYear)) continue;
        rows.push({ inv, c });
      }
    }
    rows.sort((a, b) => (b.inv.date || '').localeCompare(a.inv.date || ''));

    let invTotal = 0, paidTotal = 0;
    for (const { inv, c } of rows) {
      aoa.push([
        inv.date || '',
        c.name || '',
        c.project_address || c.address || '',
        inv.number || '',
        parseFloat(inv.amount) || 0,
        inv.sent ? 'Yes' : 'No',
        inv.paid ? 'Yes' : 'No',
        inv.note || ''
      ]);
      if (inv.sent) invTotal += parseFloat(inv.amount) || 0;
      if (inv.paid) paidTotal += parseFloat(inv.amount) || 0;
    }
    aoa.push([]);
    aoa.push(['TOTALS', '', '', `${rows.length} invoices`, invTotal, '', '', `Sent ${invTotal}, Paid ${paidTotal}`]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 12 }, { wch: 24 }, { wch: 28 }, { wch: 12 },
      { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 40 }
    ];
    _aw_applyStyles(ws, aoa, (row, idx) => {
      if (idx === 0) return 'title';
      if (row[0] === 'Date' && row[1] === 'Client') return 'header';
      if ((row[0] || '').toString() === 'TOTALS') return 'total';
      return null;
    });
    _aw_applyCurrency(ws, [4]);
    XLSX.utils.book_append_sheet(wb, ws, `Invoices ${taxYear}`);
  }

  // =============================================================
  // TAB 4 — A/R Aging  (sent but unpaid as of Dec 31, taxYear)
  // =============================================================
  {
    const aoa = [];
    aoa.push([`A/R Aging — as of Dec 31, ${taxYear}`]);
    aoa.push([`Generated ${today}`]);
    aoa.push([]);
    aoa.push(['Client', 'Invoice #', 'Date', 'Amount', 'Days Out', 'Bucket', 'Description']);

    const cutoff = `${taxYear}-12-31`;
    const cutoffEnd = new Date(cutoff + 'T12:00:00');
    const today_iso = new Date().toISOString().slice(0, 10);
    // For aging "days out", use the LATER of {today, cutoff} when taxYear is the
    // current FY (mid-year report) — for historical years, use the year-end cutoff.
    const asOf = (taxYear < SETTINGS.fiscal_year || (taxYear === SETTINGS.fiscal_year && today_iso > cutoff))
      ? cutoff : today_iso;

    const rows = [];
    for (const c of DATA.clients) {
      for (const inv of (c.invoices || [])) {
        if (!inv.sent || inv.paid || !inv.date) continue;
        if (inv.date.slice(0, 4) > String(taxYear)) continue;  // future to this report
        const daysOut = _aw_daysBetween(inv.date, asOf);
        rows.push({ inv, c, daysOut });
      }
    }
    rows.sort((a, b) => b.daysOut - a.daysOut);

    const buckets = { '0–30': 0, '31–60': 0, '61–90': 0, '90+': 0 };
    let total = 0;
    for (const { inv, c, daysOut } of rows) {
      const bucket = _aw_agingBucket(daysOut);
      const amt = parseFloat(inv.amount) || 0;
      aoa.push([
        c.name || '', inv.number || '', inv.date || '',
        amt, daysOut, bucket, inv.note || ''
      ]);
      buckets[bucket] += amt;
      total += amt;
    }
    aoa.push([]);
    aoa.push(['BUCKET TOTALS']);
    aoa.push(['Bucket', 'Amount', 'Share']);
    Object.entries(buckets).forEach(([b, amt]) => {
      aoa.push([b, amt, total ? (amt / total) : 0]);
    });
    aoa.push([]);
    aoa.push(['TOTAL A/R', '', '', total, '', '', '']);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 24 }, { wch: 12 }, { wch: 12 },
      { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 40 }
    ];
    _aw_applyStyles(ws, aoa, (row, idx) => {
      if (idx === 0) return 'title';
      if (row[0] === 'Client' && row[1] === 'Invoice #') return 'header';
      if (row[0] === 'BUCKET TOTALS') return 'section';
      if (row[0] === 'Bucket' && row[1] === 'Amount') return 'header';
      if ((row[0] || '').toString() === 'TOTAL A/R') return 'total';
      return null;
    });
    _aw_applyCurrency(ws, [3]);
    // Percentage format on bucket share column
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let r = range.s.r; r <= range.e.r; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: 2 });
      const cell = ws[addr];
      if (cell && typeof cell.v === 'number' && cell.v > 0 && cell.v < 1) {
        cell.z = '0.0%';
      }
      // also currency on bucket "Amount" column at col 1 for the BUCKET TOTALS block
      const a1 = XLSX.utils.encode_cell({ r, c: 1 });
      const c1 = ws[a1];
      if (c1 && typeof c1.v === 'number' && Math.abs(c1.v) >= 1) {
        c1.z = '"$"#,##0;[Red]-"$"#,##0';
      }
    }
    XLSX.utils.book_append_sheet(wb, ws, 'A R Aging');
  }

  // =============================================================
  // TAB 5 — Fee Structure (lifetime view — legacy/reference)
  // =============================================================
  {
    const aoa = [];
    aoa.push([`Fee Structure — All Clients`]);
    aoa.push([`Generated ${today}  ·  Lifetime totals (not year-scoped)`]);
    aoa.push([]);
    aoa.push([
      'Client', 'Full Name', 'Project Address',
      'Fee Type', 'Construction Estimate', 'Percentage / Notes',
      'Phased', 'Original Fee', 'Current Fee', 'Increase',
      'Billed (lifetime)', 'Collected (lifetime)', 'Outstanding', 'Original Locked', 'Status'
    ]);

    const sorted = DATA.clients.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    let tOrig = 0, tCur = 0, tBilled = 0, tCollected = 0;
    for (const c of sorted) {
      const original = parseFloat(c.original_fee) || 0;
      const current = computeClientFee(c) || 0;
      const billed = (c.invoices || []).filter(i => i.sent).reduce((s, i) => s + (parseFloat(i.amount)||0), 0);
      const collected = (c.invoices || []).filter(i => i.paid).reduce((s, i) => s + (parseFloat(i.amount)||0), 0);
      let feeNotes = '';
      if (c.fee_type === 'percentage') feeNotes = `${c.fee_percentage || 0}%`;
      else if (c.fee_type === 'tiered_percentage') feeNotes = `${c.fee_tier1_pct || 0}% up to $${(c.fee_tier_threshold||0).toLocaleString()}, then ${c.fee_tier2_pct || 0}%`;
      aoa.push([
        c.name || '', c.full_name || '', c.project_address || c.address || '',
        c.fee_type || 'fixed', c.fee_estimate || 0, feeNotes,
        c.is_phased ? 'Yes' : 'No',
        original, current, current - original,
        billed, collected, billed - collected,
        c.original_set_at ? fmtDate(c.original_set_at) : '',
        c.archived ? 'Archived' : (c.closed_out ? 'Closed Out' : 'Active')
      ]);
      if (!c.archived) {
        tOrig += original; tCur += current;
        tBilled += billed; tCollected += collected;
      }
    }
    aoa.push([]);
    aoa.push([
      'TOTALS (active only)', '', '', '', '', '', '',
      tOrig, tCur, tCur - tOrig,
      tBilled, tCollected, tBilled - tCollected,
      '', ''
    ]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 22 }, { wch: 28 }, { wch: 30 },
      { wch: 12 }, { wch: 16 }, { wch: 22 }, { wch: 10 },
      { wch: 14 }, { wch: 14 }, { wch: 14 },
      { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }
    ];
    _aw_applyStyles(ws, aoa, (row, idx) => {
      if (idx === 0) return 'title';
      if (row[0] === 'Client' && row[1] === 'Full Name') return 'header';
      if ((row[0] || '').toString().startsWith('TOTALS')) return 'total';
      return null;
    });
    _aw_applyCurrency(ws, [4, 7, 8, 9, 10, 11, 12]);
    XLSX.utils.book_append_sheet(wb, ws, 'Fee Structure');
  }

  // Write file
  const filename = `TSC_Accountant_${taxYear}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
  toast(`Exported ${taxYear} workbook`, 'success');
}

// ---- Legacy single-sheet exporter kept available under a different name in
// case the old one-tab format is ever needed. It is no longer wired to a
// button; the new multi-tab export above replaces it.
function _legacy_exportAccountantSpreadsheet_v1() {

  const sortedClients = DATA.clients.slice().sort((a, b) => a.name.localeCompare(b.name));
  let totalOriginal = 0, totalCurrent = 0, totalBilled = 0, totalCollected = 0;

  for (const c of sortedClients) {
    const original = parseFloat(c.original_fee) || 0;
    const current = computeClientFee(c) || 0;
    const increase = current - original;

    // Lifetime billed/collected (not year-scoped — accountant wants total)
    const billed = (c.invoices || []).filter(i => i.sent).reduce((s, i) => s + (i.amount || 0), 0);
    const collected = (c.invoices || []).filter(i => i.paid).reduce((s, i) => s + (i.amount || 0), 0);
    const outstanding = billed - collected;

    let feeNotes = '';
    if (c.fee_type === 'percentage') feeNotes = `${c.fee_percentage || 0}%`;
    else if (c.fee_type === 'tiered_percentage') feeNotes = `${c.fee_tier1_pct || 0}% up to $${(c.fee_tier_threshold || 0).toLocaleString()}, then ${c.fee_tier2_pct || 0}%`;

    aoa.push([
      c.name || '',
      c.full_name || '',
      c.project_address || c.address || '',
      c.fee_type || 'fixed',
      c.fee_estimate || 0,
      feeNotes,
      c.is_phased ? 'Yes' : 'No',
      original,
      current,
      increase,
      billed,
      collected,
      outstanding,
      c.original_set_at ? fmtDate(c.original_set_at) : '',
      c.archived ? 'Archived' : 'Active'
    ]);

    if (!c.archived) {
      totalOriginal += original;
      totalCurrent += current;
      totalBilled += billed;
      totalCollected += collected;
    }
  }

  // Totals row for active clients
  aoa.push([]);
  aoa.push([
    'TOTALS (active only)', '', '', '', '', '', '',
    totalOriginal, totalCurrent, totalCurrent - totalOriginal,
    totalBilled, totalCollected, totalBilled - totalCollected,
    '', ''
  ]);

  // ---- Section 2: Phase breakdown for phased clients ----
  const phasedClients = sortedClients.filter(c => c.is_phased && !c.archived);
  if (phasedClients.length > 0) {
    aoa.push([]);
    aoa.push([]);
    aoa.push(['PHASE-BY-PHASE FEE BREAKDOWN (phased clients only)']);
    aoa.push([
      'Client', 'Phase',
      'Original %', 'Original Amount',
      'Current %', 'Current Amount',
      'Increase'
    ]);
    for (const c of phasedClients) {
      const original = parseFloat(c.original_fee) || 0;
      const current = computeClientFee(c) || 0;
      const op = c.original_phases || {};
      const cp = c.phases || {};
      for (const p of PHASE_NAMES) {
        const oPct = parseFloat(op[p]) || 0;
        const cPct = parseFloat(cp[p]) || 0;
        const oAmt = original * oPct;
        const cAmt = current * cPct;
        aoa.push([
          c.name || '', p,
          oPct, oAmt,
          cPct, cAmt,
          cAmt - oAmt
        ]);
      }
    }
  }

  // ---- Section 3: All invoices ----
  aoa.push([]);
  aoa.push([]);
  aoa.push(['INVOICES']);
  aoa.push([
    'Client', 'Project Address', 'Invoice Date', 'Invoice #',
    'Amount', 'Reimbursable', 'Outstanding (prior)',
    'Description', 'Sent', 'Paid'
  ]);

  // Flatten and sort by date desc
  const allInvoices = [];
  for (const c of DATA.clients) {
    for (const inv of (c.invoices || [])) {
      allInvoices.push({ inv, c });
    }
  }
  allInvoices.sort((a, b) => (b.inv.date || '').localeCompare(a.inv.date || ''));

  let invTotal = 0, invPaid = 0;
  for (const { inv, c } of allInvoices) {
    aoa.push([
      c.name || '',
      c.project_address || c.address || '',
      inv.date || '',
      inv.number || '',
      inv.amount || 0,
      inv.reimbursable || 0,
      inv.outstanding_prior || 0,
      inv.note || '',
      inv.sent ? 'Yes' : 'No',
      inv.paid ? 'Yes' : 'No'
    ]);
    if (inv.sent) invTotal += inv.amount || 0;
    if (inv.paid) invPaid += inv.amount || 0;
  }

  aoa.push([]);
  aoa.push([
    'INVOICE TOTALS', '', '', '',
    invTotal, '', '',
    `Sent total — Paid total: ${invPaid.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`,
    `${allInvoices.filter(x => x.inv.sent).length} sent`,
    `${allInvoices.filter(x => x.inv.paid).length} paid`
  ]);

  // ---- Build the sheet ----
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Set column widths
  ws['!cols'] = [
    { wch: 22 }, // Client / project addr column
    { wch: 28 },
    { wch: 30 },
    { wch: 12 },
    { wch: 16 },
    { wch: 22 },
    { wch: 10 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 }
  ];

  // Bold the section headers and table headers
  const boldRows = [];
  aoa.forEach((row, idx) => {
    const first = (row[0] || '').toString();
    if (first === 'CLIENTS — FEE STRUCTURE' || first === 'PHASE-BY-PHASE FEE BREAKDOWN (phased clients only)' || first === 'INVOICES') {
      boldRows.push({ idx, isSection: true });
    } else if (first === 'Client' && row[1] && (row[1] === 'Full Name' || row[1] === 'Phase' || row[1] === 'Project Address')) {
      boldRows.push({ idx, isHeader: true });
    } else if (first.startsWith('TOTALS') || first === 'INVOICE TOTALS') {
      boldRows.push({ idx, isTotal: true });
    } else if (first.startsWith('T. SCOTT CARLISLE')) {
      boldRows.push({ idx, isTitle: true });
    }
  });

  // Apply formatting via cell objects
  // SheetJS community edition supports bold via cell.s.font, but the writer may not include it
  // unless we set the cellStyles option. We'll do a best-effort: write cells with style hints.
  for (const { idx, isSection, isHeader, isTotal, isTitle } of boldRows) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddr = XLSX.utils.encode_cell({ r: idx, c: col });
      if (!ws[cellAddr]) continue;
      ws[cellAddr].s = ws[cellAddr].s || {};
      ws[cellAddr].s.font = { bold: true, sz: isTitle ? 14 : isSection ? 12 : 11 };
      if (isSection) ws[cellAddr].s.fill = { fgColor: { rgb: 'EFEADC' }, patternType: 'solid' };
      if (isHeader) ws[cellAddr].s.fill = { fgColor: { rgb: 'F4F2EC' }, patternType: 'solid' };
      if (isTotal) ws[cellAddr].s.border = { top: { style: 'thin', color: { rgb: '000000' } } };
    }
  }

  // Apply currency format to dollar columns
  // Columns 7,8,9 (orig/current/increase), 10,11,12 (billed/collected/outstanding) in section 1
  // Column 4,5,6 (orig amt, cur amt, increase) in section 2 (offset by client+phase = 0,1)
  // Column 4 (amount) in section 3
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddr = XLSX.utils.encode_cell({ r, c: col });
      const cell = ws[cellAddr];
      if (cell && typeof cell.v === 'number') {
        // Heuristic: if the value looks like a dollar amount, format as currency
        cell.s = cell.s || {};
        // Skip percentage cells (less than 1 in phase rows)
        if (Math.abs(cell.v) >= 1 || cell.v === 0) {
          // Treat as currency if column likely holds money
          // We can't be 100% precise without tracking column meanings, but most numbers above 0
          // here are money. Phase percentages are < 1 so they're skipped.
          if (Math.abs(cell.v) >= 1) {
            cell.z = '"$"#,##0;[Red]-"$"#,##0';
          }
        } else if (Math.abs(cell.v) > 0 && Math.abs(cell.v) < 1) {
          cell.z = '0.0%';
        }
      }
    }
  }

  // Build workbook and trigger download
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'TSC Report');

  const filename = `TSC_Accountant_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
  toast('Spreadsheet exported', 'success');
}


function closeOutClient() {
  const c = DATA.clients.find(x => x.id === editingClientId);
  if (!c) return;
  const isClosedOut = !!c.closed_out;
  if (isClosedOut) {
    if (!confirm('Re-open "' + c.name + '"? This will mark it as active again.')) return;
    c.closed_out = false;
    toast(c.name + ' re-opened', 'success');
  } else {
    if (!confirm('Close out "' + c.name + '"? This marks the job complete — no more fee will be collected. You can re-open it later.')) return;
    c.closed_out = true;
    toast(c.name + ' closed out', 'success');
  }
  markDirty();
  saveClientForm();
  renderAll();
  $('#clientEditor').hidden = true;
}

// ===============================================================
// EVENT BINDING
// ===============================================================
function bindUi() {
  // Tabs — use activateTab helper
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    if (t.dataset.tab === 'newinvoice') IB_PREV_TAB = document.querySelector('.tab.active')?.dataset?.tab || 'overview';
    activateTab(t.dataset.tab);
    if (t.dataset.tab === 'newinvoice') renderInvoiceBuilder();
  }));

  // Chart navigation
  $('#chartPrev').addEventListener('click', () => {
    CHART_OFFSET -= 5;
    renderMonthlyChart();
  });
  $('#chartNext').addEventListener('click', () => {
    CHART_OFFSET += 5;
    renderMonthlyChart();
  });
  $('#chartToday').addEventListener('click', () => {
    CHART_OFFSET = 0;
    renderMonthlyChart();
  });

  // Click the Outstanding A/R metric card → scroll to the Outstanding Invoices section
  const oCard = $('#metricOutstandingCard');
  if (oCard) {
    oCard.addEventListener('click', () => {
      const target = $('#outstandingInvoicesSection');
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Brief highlight to draw the eye
      target.classList.add('flash-highlight');
      setTimeout(() => target.classList.remove('flash-highlight'), 1400);
    });
  }

  // Header actions
  $('#saveBtn').addEventListener('click', () => saveToGithub(false));
  // 2026-05-23: sidebar Save button (always visible, no need to open Settings).
  const sideSave = $('#sideSaveBtn');
  if (sideSave) sideSave.addEventListener('click', () => saveToGithub(false));
  // Backup & restore (in Settings only now)
  $('#exportBtn').addEventListener('click', exportJson);
  $('#exportXlsxBtn').addEventListener('click', exportAccountantSpreadsheet);
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (e) => {
    if (e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = '';
  });

  // Clients tab
  $('#showArchived').addEventListener('change', renderClients);
  $('#addClientBtn').addEventListener('click', () => openClientEditor(null));

  // Client editor
  $('#clientEditorClose').addEventListener('click', closeClientEditor);
  $('#cf_cancel').addEventListener('click', closeClientEditor);
  $('#cf_save').addEventListener('click', saveClientForm);
  $('#cf_delete').addEventListener('click', deleteClient);
  $('#cf_closeout').addEventListener('click', closeOutClient);
  $('#cf_archive').addEventListener('click', archiveClient);
  $('#cf_create_invoice').addEventListener('click', () => {
    const c = DATA.clients.find(x => x.id === editingClientId);
    if (!c) return;
    saveClientForm();
    closeClientEditor();
    IB_PREV_TAB = 'clients';
    activateTab('newinvoice');
    renderInvoiceBuilder();
    $('#ib_client').value = c.id;
    onInvoiceClientChange();
  });
  ['cf_fixed_amount','cf_pct_estimate','cf_pct_value',
   'cf_tier_estimate','cf_tier1_pct','cf_tier_threshold','cf_tier2_pct',
   'cf_p_deposit','cf_p_sd','cf_p_dd','cf_p_cd','cf_p_ca'].forEach(id => {
    $('#' + id).addEventListener('input', recomputeClientForm);
  });

  // Add-revision button — appends a new estimate row pre-filled with the previous one.
  const addRev = $('#cf_addRevision');
  if (addRev) addRev.addEventListener('click', addNewEstimateRevision);
  $$('input[name="cf_fee_type"]').forEach(r => {
    r.addEventListener('change', recomputeClientForm);
  });
  $('#cf_deposit_paid').addEventListener('change', () => {
    const c = DATA.clients.find(x => x.id === editingClientId);
    if (!c) return;
    const checked = $('#cf_deposit_paid').checked;
    const amtEl = $('#cf_deposit_paid_amount');
    // Session 13: when toggling on with an empty amount field, default it to
    // the calculated deposit so the user sees what we'd otherwise compute.
    let explicit = null;
    if (checked) {
      const typed = amtEl ? (currencyVal(amtEl) || 0) : 0;
      explicit = typed > 0 ? typed : null;
    }
    setDepositPaid(c, checked, explicit);
    // Reflect any defaulted amount back into the input
    if (amtEl) setCurrencyVal(amtEl, parseFloat(c.deposit_paid_amount) || 0);
    markDirty();
    // Refresh the in-modal status hint and the past-invoices list.
    const st = $('#cf_deposit_paid_status');
    if (st) {
      if (c.deposit_paid) {
        const dt = c.deposit_paid_at ? fmtDate(c.deposit_paid_at) : '';
        const amt = parseFloat(c.deposit_paid_amount) || 0;
        st.textContent = dt ? `Marked paid ${dt} · ${fmt0(amt)}` : `Marked paid · ${fmt0(amt)}`;
      } else {
        st.textContent = '';
      }
    }
    if (typeof renderClientPastInvoices === 'function') renderClientPastInvoices(c);
    if (typeof renderRoster === 'function') renderRoster();
    if (typeof recomputeClientForm === 'function') recomputeClientForm();
  });
  // Session 13: amount input — push changes through setDepositPaid then
  // recompute the phase-amounts table to show the SD shortfall in real time.
  {
    const dpAmtEl = $('#cf_deposit_paid_amount');
    if (dpAmtEl) {
      dpAmtEl.addEventListener('change', () => {
        const c = DATA.clients.find(x => x.id === editingClientId);
        if (!c) return;
        if (!$('#cf_deposit_paid').checked) return;
        const typed = currencyVal(dpAmtEl) || 0;
        setDepositPaid(c, true, typed);
        markDirty();
        const st = $('#cf_deposit_paid_status');
        if (st) {
          const dt = c.deposit_paid_at ? fmtDate(c.deposit_paid_at) : '';
          const amt = parseFloat(c.deposit_paid_amount) || 0;
          st.textContent = dt ? `Marked paid ${dt} · ${fmt0(amt)}` : `Marked paid · ${fmt0(amt)}`;
        }
        if (typeof renderClientPastInvoices === 'function') renderClientPastInvoices(c);
        if (typeof renderRoster === 'function') renderRoster();
        if (typeof recomputeClientForm === 'function') recomputeClientForm();
      });
    }
  }
  {
    const pocEl = $('#cf_poc_amount');
    if (pocEl) {
      wireCurrencyInput(pocEl);
      pocEl.addEventListener('input', () => {
        const c = DATA.clients.find(x => x.id === editingClientId);
        if (!c) return;
        c.poc_amount = currencyVal(pocEl) || 0;
        const da = $('#cf_poc_at'); if (da) c.poc_at = da.value || '';
        markDirty();
        if (typeof renderClientPastInvoices === 'function') renderClientPastInvoices(c);
        if (typeof renderRoster === 'function') renderRoster();
        if (typeof recomputeClientForm === 'function') recomputeClientForm();
      });
    }
    const pocDate = $('#cf_poc_at');
    if (pocDate) {
      pocDate.addEventListener('change', () => {
        const c = DATA.clients.find(x => x.id === editingClientId);
        if (!c) return;
        c.poc_at = pocDate.value || '';
        markDirty();
        if (typeof renderClientPastInvoices === 'function') renderClientPastInvoices(c);
        if (typeof renderRoster === 'function') renderRoster();
      });
    }
  }
  $('#cf_is_phased').addEventListener('change', () => {
    $('#cf_phased_block').hidden = !$('#cf_is_phased').checked;
    recomputeClientForm();
  });

  // Invoices
  $('#invoiceFilter').addEventListener('change', renderInvoices);
  $('#invoiceClientFilter').addEventListener('change', renderInvoices);
  $('#addInvoiceBtn').addEventListener('click', () => openInvoiceEditor('', null));
  $('#invoiceEditorClose').addEventListener('click', () => $('#invoiceEditor').hidden = true);
  $('#if_cancel').addEventListener('click', () => $('#invoiceEditor').hidden = true);
  $('#if_save').addEventListener('click', saveInvoiceForm);
  $('#if_delete').addEventListener('click', deleteInvoice);
  $('#if_redownload').addEventListener('click', redownloadInvoice);

  // Sortable columns on invoices
  $$('#invoicesHeadRow .sortable-th').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (INVOICE_SORT.col === col) {
        INVOICE_SORT.dir = INVOICE_SORT.dir === 'asc' ? 'desc' : 'asc';
      } else {
        INVOICE_SORT.col = col;
        // Default direction by column type
        INVOICE_SORT.dir = (col === 'amount' || col === 'date' || col === 'number') ? 'desc' : 'asc';
      }
      renderInvoices();
    });
  });

  // Invoice builder
  $('#ib_client').addEventListener('change', onInvoiceClientChange);
  $('#ib_reimb').addEventListener('input', updateInvoiceBuilderSummary);
  $('#ib_outstanding').addEventListener('input', updateInvoiceBuilderSummary);
  $('#ib_description').addEventListener('input', () => { IB_STATE.manualDescription = true; });
  $('#ib_add_other').addEventListener('click', () => {
    IB_STATE.otherItems = IB_STATE.otherItems || [];
    IB_STATE.otherItems.push({ label: '', amount: 0 });
    renderOtherItems();
  });
  $('#ib_reset').addEventListener('click', resetInvoiceBuilder);
  $('#ib_cancel').addEventListener('click', () => {
    resetInvoiceBuilder();
    activateTab(IB_PREV_TAB || 'overview');
  });
  $('#ib_draft').addEventListener('click', saveDraftInvoice);
  $('#ib_generate').addEventListener('click', generateInvoice);
  // 2026-05-23: Preview & Print to PDF — opens the HTML preview window with the
  // current Create Invoice state, WITHOUT generating the .docx or saving the invoice
  // record. The preview's "Print / Save as PDF" button uses the browser's print
  // function, which renders with the user's installed Mac fonts (Goudy Old Style,
  // Warnock Pro, Columbia Titling) and produces a real-fonts PDF.
  const ibPreviewBtn = $('#ib_preview');
  if (ibPreviewBtn) ibPreviewBtn.addEventListener('click', previewInvoiceForPrint);

  // Settings
  $('#settingsSave').addEventListener('click', () => {
    SETTINGS.fiscal_year = parseInt($('#setFy').value, 10) || new Date().getFullYear();
    SETTINGS.owner = $('#setOwner').value.trim();
    SETTINGS.repo = $('#setRepo').value.trim();
    SETTINGS.branch = $('#setBranch').value.trim() || 'main';
    SETTINGS.path = $('#setPath').value.trim() || 'data.json';
    SETTINGS.token = $('#setToken').value.trim();
    // 2026-05-07: local-copy-on-save toggle
    const lcEl = $('#setLocalCopyOnSave');
    SETTINGS.local_copy_on_save = lcEl ? !!lcEl.checked : false;
    saveSettings();
    setSettingsStatus('Settings saved. Fiscal year override applies for this session only.', 'success');
    renderAll();
  });
  $('#firmSave').addEventListener('click', saveFirmInfo);
  $('#testConnect').addEventListener('click', testConnect);
  $('#loadFromGh').addEventListener('click', loadFromGithub);
  $('#resetData').addEventListener('click', () => {
    if (!confirm('Wipe ALL local data and start fresh? Use "Download Backup" first if you want a backup.')) return;
    DATA = newEmptyData();
    saveLocal();
    renderAll();
    toast('Data reset');
  });

  // Backdrop close — client editor stays open until × / Cancel / Save (per Scott).
  // Invoice editor still closes on backdrop click.
  $('#invoiceEditor').addEventListener('click', (e) => {
    if (e.target.id === 'invoiceEditor') $('#invoiceEditor').hidden = true;
  });
}

function closeClientEditor() {
  // If a freshly added client was never saved with a name, remove it
  const c = DATA.clients.find(x => x.id === editingClientId);
  if (c && !c.name) {
    DATA.clients = DATA.clients.filter(x => x.id !== editingClientId);
  }
  $('#clientEditor').hidden = true;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Boot
init();
