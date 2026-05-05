/* TSC-CONT — Supplementary Conditions Builder
   Carlisle Moore Architects · build 2026-05-04
   --------------------------------------------------
   Pulls clients & fee structures from the same data.json the
   TSC-BILLING dashboard uses (in GitHub) and produces an AIA
   B105-2017 Supplementary Conditions Word document.
*/

(function () {
'use strict';

// =================================================================
// CONSTANTS & DEFAULTS
// =================================================================

const PHASES = ['DEPOSIT', 'SD', 'DD', 'CD', 'CA'];
const PHASE_LABELS = {
  DEPOSIT: 'Initial Deposit',
  SD: 'Schematic Design',
  DD: 'Design Development',
  CD: 'Construction Documents',
  CA: 'Construction Administration',
};
const SCOPE_PHASES = ['SD', 'DD', 'CD', 'CA'];   // phases shown in scope section

// Standard scope text drawn from the Davis PDF, with typical residential deliverables.
const FACTORY_TEMPLATES = {
  SD: {
    description:
      'In this phase, The Architect will provide initial design concepts including plans, ' +
      'elevations, general details, and materials in the form of sketches, floor plans, ' +
      'schematic specifications and other drawings as required. Once the Schematic Design is ' +
      'approved, the drawings and other information, as required, will be provided for pricing ' +
      'to the contractor(s).',
    items: [
      { text: 'Site analysis and contextual research', checked: true },
      { text: 'Conceptual floor plans', checked: true },
      { text: 'Conceptual exterior elevations', checked: true },
      { text: 'General details and material studies', checked: true },
      { text: 'Schematic specifications', checked: true },
      { text: 'Pricing set issued to contractor(s)', checked: true },
    ],
  },
  DD: {
    description:
      'In this phase, The Architect will further develop the Schematic Design and address any ' +
      'changes that are needed to bring the project in line with the budget and finalize the ' +
      'design. Any major changes to plans or elevations after the approval of Design Development ' +
      'drawings will be carried out as additional services at an hourly rate.',
    items: [
      { text: 'Refined floor plans, elevations, and key sections', checked: true },
      { text: 'Material and finish coordination at the architectural level', checked: true },
      { text: 'Coordination with structural and other consultants', checked: true },
      { text: 'Budget reconciliation with contractor', checked: true },
      { text: 'Final design approval set', checked: true },
    ],
  },
  CD: {
    description:
      'In this phase, The Architect will provide the drawings and details needed to communicate ' +
      'and describe to the builder the design intent of the project. This typically consists of ' +
      'plans, elevations, sections and other details, cabinet elevations, door and window ' +
      'schedules, electrical plans, and other details as required for final pricing, permitting, ' +
      'and construction. Any major changes to plans or elevations after approval of Construction ' +
      'Documents will be carried out as additional services with a fee to be approved by the ' +
      'owner prior to start of work.',
    items: [
      { text: 'Floor plans, foundation plan, roof plan', checked: true },
      { text: 'Building elevations', checked: true },
      { text: 'Building sections and wall sections', checked: true },
      { text: 'Cabinet elevations', checked: true },
      { text: 'Door and window schedules', checked: true },
      { text: 'Architectural electrical plans', checked: true },
      { text: 'Final Pricing Set issued to contractor', checked: true },
      { text: 'For-Construction Set issued upon final payment for CD phase', checked: true },
    ],
  },
  CA: {
    description:
      'The Architect will be involved through the duration of construction to review and approve ' +
      'shop drawings and submittals, to answer questions from the contractor, and to review and ' +
      'advise on any architectural issues that arise. Site visits will occur at the major ' +
      'milestones as well as on an as-needed basis.',
    items: [
      { text: 'Coordination with the Interior Designer is INCLUDED in The Architect’s scope of services', checked: true, indent: 1 },
      { text: 'Finish selections such as tile, interior paint, fabrics, furniture, countertops, plumbing fixtures, and decorative lighting are NOT part of The Architect’s services. Hardware and plumbing fixture selections will be coordinated as required.', checked: true, indent: 1 },
      { text: 'Engineering (Geotechnical, Civil, Mechanical, Electrical, Plumbing, and fire protection) is NOT included in The Architect’s scope of services.', checked: true, indent: 1 },
    ],
  },
};

const FACTORY_GEN_SCOPE = [
  { text: 'A new residence between [SF range] square feet', checked: true },
  { text: 'Two level', checked: true },
  { text: 'Bedrooms with ensuite bathrooms for each', checked: true },
  { text: 'Screen porch', checked: false },
  { text: 'Garage with living space above', checked: false },
  { text: 'Mudroom connected to laundry', checked: false },
  { text: 'Outdoor living spaces', checked: false },
  { text: 'Kitchen at the heart with a great view', checked: false },
  { text: 'Timeless design incorporating stone, timber, slate roof, warmth and practicality', checked: false },
];

const DEFAULT_COMP_INTRO =
  'The Architect’s compensation shall be a percentage of the Total Construction Cost ' +
  'with a percentage of {PCT}%. The fee calculation will be based on the Total Final ' +
  'Construction Estimated Cost as provided by the contractor at the start of construction. ' +
  'To ensure that both parties are all working with the same baseline of costs, this contract ' +
  'defines Total Construction Cost as the total amount the contractor charges the Owner for ' +
  'construction of the project as described in the Contract Documents prepared by the Architect. ' +
  'This will be the total fee unless additional scope of work is added to the project.';

const DEFAULT_COMP_LEAD_IN =
  'For this project, based on the scope above and an initial estimated budget of (plus or minus) ' +
  '{ESTIMATE}, the fee would be scheduled as follows:';

const DEFAULT_COMP_CLOSING =
  'Billing is monthly based on the percentage complete at the time of billing.\n\n' +
  'The final fee will be adjusted, up or down, based on the Total Final Construction Estimate ' +
  'as provided by the contractor using the fee calculation method above. At the end of the ' +
  'construction document phase, we will release a "Final Pricing Set" for review by the ' +
  'contractor to finalize their contract price. Once final payment is received for the ' +
  'Construction Document phase, we will release a "For Construction Set" for permitting and ' +
  'construction.\n\n' +
  'If additional design work and drawings are required by a change in the scope after ' +
  'Construction Drawings are issued, The Architect will provide a change order prior to the ' +
  'start of design work outlining the fee.';

const FIXED_COMP_INTRO =
  'The Architect’s compensation shall be a fixed fee in the amount of {TOTAL}. ' +
  'This fee covers the scope of work described above. Any additional scope of work added to ' +
  'the project will be carried out as additional services with a fee to be approved by the ' +
  'Owner prior to start of work.';

// =================================================================
// CONFIG (localStorage)
// =================================================================

const LS_KEY = 'tsc-cont:config';

function defaultConfig () {
  return {
    github: { owner: '', repo: 'TSC-BILLING', branch: 'main', path: 'data.json', token: '' },
    firm: {
      name: 'Carlisle Moore Architects',
      principal1: 'T Scott Carlisle',
      phone1: '(205)587-4868',
      principal2: 'Bill Moore',
      phone2: '(205)966-2554',
      addr1: '2814 Petticoat Lane',
      addr2: 'Mountain Brook, AL 35223',
      website: 'carlislemoorearchitects.com',
    },
    scopeTemplates: JSON.parse(JSON.stringify(FACTORY_TEMPLATES)),
    cachedData: null,        // last-loaded data.json
    cachedDataSha: null,     // last-loaded sha (for writes)
    cachedDataAt: null,      // ISO timestamp
    history: [],
  };
}

function loadConfig () {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultConfig();
    const c = JSON.parse(raw);
    return Object.assign(defaultConfig(), c, {
      github: Object.assign(defaultConfig().github, c.github || {}),
      firm:   Object.assign(defaultConfig().firm,   c.firm   || {}),
    });
  } catch (e) {
    console.warn('Config load failed', e);
    return defaultConfig();
  }
}

function saveConfig () {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state.config));
  } catch (e) {
    console.warn('Config save failed', e);
  }
}

// =================================================================
// STATE
// =================================================================

const state = {
  config: loadConfig(),
  data: null,                  // current data.json contents
  dataSha: null,
  dataDirty: false,            // true if we've added clients locally
  currentClient: null,         // selected client object (reference into state.data.clients)
  project: { name: '', location: '', address: '', sf: '', description: '', date: todayISO() },
  genScope: cloneItems(FACTORY_GEN_SCOPE),
  fee: {
    type: 'percentage',
    percentage: 10.0,
    estimate: 3000000,
    total: 300000,
    totalOverride: false,
    phases: { DEPOSIT: 0.05, SD: 0.20, DD: 0.20, CD: 0.50, CA: 0.05 },
    phaseAmountOverrides: {},  // phase -> amount (manual)
  },
  scopeByPhase: cloneTemplates(),
  comp: {
    intro: DEFAULT_COMP_INTRO,
    leadIn: DEFAULT_COMP_LEAD_IN,
    closing: DEFAULT_COMP_CLOSING,
  },
};

// Apply cached data immediately if we have one
if (state.config.cachedData) {
  state.data = state.config.cachedData;
  state.dataSha = state.config.cachedDataSha;
}

// =================================================================
// HELPERS
// =================================================================

function $ (id) { return document.getElementById(id); }

function todayISO () {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function formatLongDate (iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return iso;
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

function fmtCurrency (n, opts) {
  opts = opts || {};
  if (n == null || isNaN(n)) return '$0';
  const fixed = opts.cents ? 2 : 0;
  const v = Number(n);
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v).toFixed(fixed);
  const [whole, frac] = abs.split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + '$' + withCommas + (frac ? '.' + frac : '');
}

function parseCurrency (s) {
  if (s == null) return 0;
  if (typeof s === 'number') return s;
  const cleaned = String(s).replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function fmtPct (frac, places) {
  places = places == null ? 0 : places;
  if (frac == null || isNaN(frac)) return '0%';
  return (Number(frac) * 100).toFixed(places).replace(/\.0+$/, '') + '%';
}

function cloneItems (arr) {
  return arr.map(x => Object.assign({}, x));
}

function cloneTemplates () {
  const out = {};
  for (const p of SCOPE_PHASES) {
    const tpl = state.config.scopeTemplates[p] || FACTORY_TEMPLATES[p];
    out[p] = {
      description: tpl.description,
      items: cloneItems(tpl.items),
    };
  }
  return out;
}

function genId () {
  return Math.random().toString(16).slice(2, 10);
}

function showToast (msg, kind) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast shown' + (kind ? ' ' + kind : '');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    t.classList.remove('shown');
  }, 2400);
}

function setSyncStatus (label, kind) {
  const el = $('syncStatus');
  el.textContent = label;
  el.className = 'sync-status' + (kind ? ' ' + kind : '');
}

// =================================================================
// GITHUB API
// =================================================================

async function ghGetFile () {
  const g = state.config.github;
  if (!g.token || !g.owner || !g.repo) {
    throw new Error('GitHub not configured');
  }
  const url = `https://api.github.com/repos/${g.owner}/${g.repo}/contents/${encodeURIComponent(g.path)}?ref=${encodeURIComponent(g.branch)}`;
  const resp = await fetch(url, {
    headers: {
      'Authorization': 'Bearer ' + g.token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error('GitHub fetch failed (' + resp.status + '): ' + txt.slice(0, 200));
  }
  const j = await resp.json();
  if (!j.content) throw new Error('No content in response');
  // base64 decode (utf-8 safe)
  const b64 = j.content.replace(/\n/g, '');
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const text = new TextDecoder('utf-8').decode(bytes);
  return { json: JSON.parse(text), sha: j.sha };
}

async function ghPutFile (newJson, sha, message) {
  const g = state.config.github;
  if (!g.token || !g.owner || !g.repo) throw new Error('GitHub not configured');
  const url = `https://api.github.com/repos/${g.owner}/${g.repo}/contents/${encodeURIComponent(g.path)}`;
  const text = JSON.stringify(newJson, null, 2);
  // base64 encode utf-8 string
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  const body = {
    message: message || 'TSC-CONT update',
    content: b64,
    branch: g.branch,
  };
  if (sha) body.sha = sha;
  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer ' + g.token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error('GitHub write failed (' + resp.status + '): ' + txt.slice(0, 200));
  }
  const j = await resp.json();
  return j.content && j.content.sha;
}

async function loadDataFromGitHub () {
  setSyncStatus('syncing…', 'syncing');
  try {
    const { json, sha } = await ghGetFile();
    state.data = json;
    state.dataSha = sha;
    state.dataDirty = false;
    state.config.cachedData = json;
    state.config.cachedDataSha = sha;
    state.config.cachedDataAt = new Date().toISOString();
    saveConfig();
    setSyncStatus('connected', 'connected');
    updateDataSourceLabel();
    renderClientSuggestions('');
    showToast(`Loaded ${json.clients?.length || 0} clients from GitHub`, 'success');
    return true;
  } catch (e) {
    console.error(e);
    setSyncStatus('error', 'error');
    showToast(e.message, 'error');
    return false;
  }
}

async function saveDataToGitHub (message) {
  if (!state.data) return false;
  setSyncStatus('saving…', 'syncing');
  try {
    const newSha = await ghPutFile(state.data, state.dataSha, message);
    state.dataSha = newSha;
    state.dataDirty = false;
    state.config.cachedData = state.data;
    state.config.cachedDataSha = newSha;
    state.config.cachedDataAt = new Date().toISOString();
    saveConfig();
    setSyncStatus('connected', 'connected');
    updateDataSourceLabel();
    return true;
  } catch (e) {
    console.error(e);
    setSyncStatus('error', 'error');
    showToast(e.message, 'error');
    return false;
  }
}

function updateDataSourceLabel () {
  const el = $('dataSourceLabel');
  const lbl = $('lastSyncCaption');
  if (state.data && state.config.github.owner && state.config.github.repo) {
    const g = state.config.github;
    el.textContent = `${g.owner}/${g.repo} · ${state.data.clients?.length || 0} clients`;
  } else if (state.data) {
    el.textContent = `${state.data.clients?.length || 0} clients (local)`;
  } else {
    el.textContent = 'no data source configured';
  }
  if (state.config.cachedDataAt) {
    const d = new Date(state.config.cachedDataAt);
    lbl.textContent = 'last loaded ' + d.toLocaleString();
  } else {
    lbl.textContent = '—';
  }
}

// =================================================================
// CLIENT PICKER
// =================================================================

function renderClientSuggestions (query) {
  const wrap = $('clientSuggestions');
  wrap.innerHTML = '';
  const q = (query || '').trim().toLowerCase();
  const clients = (state.data && state.data.clients) || [];
  let matches = clients.filter(c => !c.archived);
  if (q) {
    matches = matches.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.full_name || '').toLowerCase().includes(q) ||
      (c.id || '').toLowerCase().includes(q)
    );
  }
  matches.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  matches = matches.slice(0, 30);

  if (matches.length === 0) {
    const div = document.createElement('div');
    div.className = 'client-suggestion';
    div.innerHTML = '<span class="cs-full empty">' +
      (clients.length ? 'No matches.' : 'No clients loaded — go to Settings to connect or load local data.json.') +
      '</span>';
    wrap.appendChild(div);
  }

  for (const c of matches) {
    const div = document.createElement('div');
    div.className = 'client-suggestion';
    div.dataset.id = c.id;
    div.innerHTML =
      `<span class="cs-name"></span>` +
      `<span class="cs-full"></span>` +
      `<span class="cs-id"></span>`;
    div.children[0].textContent = c.name || '(unnamed)';
    div.children[1].textContent = c.full_name || '';
    div.children[2].textContent = c.id || '';
    div.addEventListener('mousedown', e => {
      e.preventDefault();
      selectClient(c.id);
      $('clientSuggestions').classList.remove('open');
      $('clientSearch').value = c.name || '';
    });
    wrap.appendChild(div);
  }

  // Always offer the "+ Add new" item at the bottom
  if (q) {
    const add = document.createElement('div');
    add.className = 'client-suggestion';
    add.innerHTML = `<span class="cs-add">+ Add &ldquo;${escapeHtml(query)}&rdquo; as a new client</span>`;
    add.addEventListener('mousedown', e => {
      e.preventDefault();
      $('clientSuggestions').classList.remove('open');
      openNewClientForm({ name: query });
    });
    wrap.appendChild(add);
  }
}

function escapeHtml (s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function selectClient (id) {
  const c = (state.data && state.data.clients || []).find(c => c.id === id);
  if (!c) return;
  state.currentClient = c;
  fillSelectedClientCard(c);
  applyClientToFee(c);
  applyClientToProject(c);
  hideNewClientForm();
  $('selectedClientCard').classList.add('shown');
  refreshAll();
}

function fillSelectedClientCard (c) {
  $('sccName').textContent = c.name || '';
  $('sccFullName').textContent = c.full_name || '';
  $('sccId').textContent = c.id || '';
  $('sccAddress').textContent = c.address || '—';
  $('sccPhone').textContent = c.phone || '—';
  $('sccEmail').textContent = c.email || '—';
  // Fee summary
  const fb = c.fee_basis || {};
  let summary = '';
  if (typeof fb.percentage === 'number') {
    summary = `${fmtPct(fb.percentage, 2)} of ${fmtCurrency(fb.current_estimate || 0)} = ${fmtCurrency(fb.current_fee || 0)}`;
  } else if (fb.percentage === 'FIXED' || c.fee_type === 'fixed') {
    summary = `Fixed fee ${fmtCurrency(fb.current_fee || fb.starting_fee || 0)}`;
  } else if (c.fee_type === 'tiered_percentage') {
    summary = `Tiered: ${(c.fee_tier1_pct || 0)}% / ${(c.fee_tier2_pct || 0)}% above ${fmtCurrency(c.fee_tier_threshold)}`;
  } else {
    summary = `Total fee ${fmtCurrency(fb.current_fee || 0)}`;
  }
  $('sccFeeSummary').textContent = summary;
}

function applyClientToProject (c) {
  // Don't overwrite if user already typed something
  if (!state.project.name) {
    state.project.name = (c.name || '').replace(/\b(\w)/g, m => m.toUpperCase()) + ' Residence';
  }
  // Pre-fill location from address tail if blank
  if (!state.project.location && c.project_address) {
    state.project.location = guessCityState(c.project_address);
  } else if (!state.project.location && c.address) {
    state.project.location = guessCityState(c.address);
  }
  if (!state.project.address) {
    state.project.address = c.project_address || c.address || '';
  }
  // Push to inputs
  $('proj_name').value = state.project.name;
  $('proj_location').value = state.project.location;
  $('proj_address').value = state.project.address;
}

function guessCityState (addr) {
  // Extract last "City, State" before zip — best-effort
  if (!addr) return '';
  const m = addr.match(/,\s*([A-Za-z .'-]+),\s*([A-Z]{2})\b/);
  if (m) return `${m[1].trim()}, ${stateName(m[2])}`;
  return '';
}

function stateName (abbr) {
  const map = { AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California',
    CO:'Colorado', CT:'Connecticut', DE:'Delaware', FL:'Florida', GA:'Georgia', HI:'Hawaii',
    ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky',
    LA:'Louisiana', ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan',
    MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana', NE:'Nebraska',
    NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NY:'New York',
    NC:'North Carolina', ND:'North Dakota', OH:'Ohio', OK:'Oklahoma', OR:'Oregon',
    PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota',
    TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia', WA:'Washington',
    WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming', DC:'District of Columbia' };
  return map[abbr] || abbr;
}

function applyClientToFee (c) {
  const fb = c.fee_basis || {};
  // Detect type
  let type = c.fee_type;
  if (!type) {
    if (typeof fb.percentage === 'number') type = 'percentage';
    else if (fb.percentage === 'FIXED') type = 'fixed';
    else type = 'percentage';
  }
  state.fee.type = type;
  if (type === 'fixed') {
    state.fee.percentage = 0;
    state.fee.estimate = 0;
    state.fee.total = Number(fb.current_fee || fb.starting_fee || c.fee_fixed_amount || 0);
    state.fee.totalOverride = true;
  } else if (type === 'tiered_percentage') {
    state.fee.percentage = Number(c.fee_tier1_pct || 0);
    state.fee.estimate = Number(fb.current_estimate || c.fee_estimate || 0);
    state.fee.total = Number(fb.current_fee || 0);
    state.fee.totalOverride = true;
  } else {
    state.fee.percentage = (typeof fb.percentage === 'number') ? fb.percentage * 100 : 0;
    state.fee.estimate = Number(fb.current_estimate || c.fee_estimate || 0);
    state.fee.total = state.fee.estimate * (state.fee.percentage / 100);
    if (Math.abs(state.fee.total - Number(fb.current_fee || 0)) > 1 && fb.current_fee) {
      // honor explicit current_fee if set
      state.fee.total = Number(fb.current_fee);
      state.fee.totalOverride = true;
    } else {
      state.fee.totalOverride = false;
    }
  }
  // Phases
  const ph = c.phases || {};
  state.fee.phases = {
    DEPOSIT: typeof ph.DEPOSIT === 'number' ? ph.DEPOSIT : 0.05,
    SD:      typeof ph.SD      === 'number' ? ph.SD      : 0.20,
    DD:      typeof ph.DD      === 'number' ? ph.DD      : 0.20,
    CD:      typeof ph.CD      === 'number' ? ph.CD      : 0.50,
    CA:      typeof ph.CA      === 'number' ? ph.CA      : 0.05,
  };
  state.fee.phaseAmountOverrides = {};
}

// =================================================================
// NEW CLIENT FORM
// =================================================================

let editingClientId = null;

function openNewClientForm (initial) {
  editingClientId = null;
  $('ncfTitle').textContent = '+ Add New Client';
  $('ncf_name').value = (initial && initial.name) || '';
  $('ncf_full_name').value = '';
  $('ncf_address').value = '';
  $('ncf_phone').value = '';
  $('ncf_email').value = '';
  $('ncf_status').textContent = '';
  $('newClientForm').classList.add('shown');
  $('ncf_name').focus();
}

function openEditClientForm (c) {
  editingClientId = c.id;
  $('ncfTitle').textContent = 'Edit Client — ' + (c.name || '');
  $('ncf_name').value = c.name || '';
  $('ncf_full_name').value = c.full_name || '';
  $('ncf_address').value = c.address || '';
  $('ncf_phone').value = c.phone || '';
  $('ncf_email').value = c.email || '';
  $('ncf_status').textContent = '';
  $('newClientForm').classList.add('shown');
  $('ncf_name').focus();
}

function hideNewClientForm () {
  $('newClientForm').classList.remove('shown');
}

async function saveNewClient () {
  if (!state.data) {
    state.data = { version: '1.0', clients: [] };
  }
  if (!Array.isArray(state.data.clients)) state.data.clients = [];

  const name = $('ncf_name').value.trim();
  const fullName = $('ncf_full_name').value.trim();
  if (!name) { showToast('Name is required', 'error'); $('ncf_name').focus(); return; }

  let client;
  if (editingClientId) {
    client = state.data.clients.find(c => c.id === editingClientId);
    if (!client) { showToast('Could not find client to edit', 'error'); return; }
    client.name = name;
    client.full_name = fullName || name;
    client.address = $('ncf_address').value.trim();
    client.phone = $('ncf_phone').value.trim();
    client.email = $('ncf_email').value.trim();
  } else {
    client = {
      id: genId(),
      name: name,
      full_name: fullName || name,
      archived: false,
      fee_basis: {
        percentage: 0.10,
        starting_budget: 0,
        starting_fee: 0,
        current_estimate: 0,
        current_fee: 0,
      },
      phases: { DEPOSIT: 0.05, SD: 0.20, DD: 0.20, CD: 0.50, CA: 0.05 },
      total_fee_2026: 0,
      monthly_planned_2026: [],
      invoices: [],
      notes: '',
      address: $('ncf_address').value.trim(),
      phone: $('ncf_phone').value.trim(),
      email: $('ncf_email').value.trim(),
      fee_type: 'percentage',
    };
    state.data.clients.push(client);
  }
  state.dataDirty = true;

  // Try to save back to GitHub
  $('ncf_status').textContent = 'Saving…';
  let saved = false;
  if (state.config.github.token && state.config.github.owner && state.config.github.repo) {
    saved = await saveDataToGitHub(editingClientId ? `Update client ${client.name}` : `Add client ${client.name}`);
  } else {
    // Cache locally only
    state.config.cachedData = state.data;
    state.config.cachedDataAt = new Date().toISOString();
    saveConfig();
    showToast('Saved locally (GitHub not configured)', 'success');
    saved = true;
  }
  if (saved) {
    $('ncf_status').textContent = '';
    hideNewClientForm();
    selectClient(client.id);
    $('clientSearch').value = client.name;
    updateDataSourceLabel();
  } else {
    $('ncf_status').textContent = 'Save failed — see toast.';
  }
}

// =================================================================
// FORM RENDERING
// =================================================================

function renderGeneralScope () {
  const root = $('genScopeItems');
  root.innerHTML = '';
  state.genScope.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'scope-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = !!item.checked;
    cb.addEventListener('change', () => { item.checked = cb.checked; renderPreview(); });
    const ti = document.createElement('input');
    ti.type = 'text'; ti.value = item.text;
    ti.addEventListener('input', () => { item.text = ti.value; renderPreview(); });
    const rm = document.createElement('button');
    rm.className = 'scope-remove'; rm.title = 'Remove'; rm.textContent = '×';
    rm.addEventListener('click', () => { state.genScope.splice(idx, 1); renderGeneralScope(); renderPreview(); });
    row.append(cb, ti, rm);
    root.appendChild(row);
  });
}

function renderScopeByPhase () {
  const root = $('scopePhases');
  root.innerHTML = '';
  for (const phase of SCOPE_PHASES) {
    const card = document.createElement('div');
    card.className = 'scope-phase open';
    card.dataset.phase = phase;

    const header = document.createElement('div');
    header.className = 'scope-phase-header';
    const tg = document.createElement('span'); tg.className = 'scope-phase-toggle';
    const nm = document.createElement('span'); nm.className = 'scope-phase-name';
    nm.textContent = PHASE_LABELS[phase];
    const cnt = document.createElement('span'); cnt.className = 'scope-phase-count';
    const checkedCount = (state.scopeByPhase[phase].items || []).filter(i => i.checked).length;
    cnt.textContent = `${checkedCount} of ${(state.scopeByPhase[phase].items || []).length} selected`;
    header.append(tg, nm, cnt);
    header.addEventListener('click', () => { card.classList.toggle('open'); });
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'scope-phase-body';

    // Description
    const descWrap = document.createElement('div');
    descWrap.className = 'scope-phase-desc';
    const descLbl = document.createElement('span');
    descLbl.className = 'scope-phase-desc-label';
    descLbl.textContent = 'Phase description (appears after the bold phase name in the document)';
    const ta = document.createElement('textarea');
    ta.value = state.scopeByPhase[phase].description;
    ta.addEventListener('input', () => {
      state.scopeByPhase[phase].description = ta.value;
      renderPreview();
    });
    descWrap.append(descLbl, ta);
    body.appendChild(descWrap);

    // Items
    const itemsWrap = document.createElement('div');
    itemsWrap.className = 'scope-items';
    state.scopeByPhase[phase].items.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'scope-item';
      if (item.indent) row.style.marginLeft = (item.indent * 1.2) + 'rem';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = !!item.checked;
      cb.addEventListener('change', () => {
        item.checked = cb.checked;
        cnt.textContent = `${state.scopeByPhase[phase].items.filter(i => i.checked).length} of ${state.scopeByPhase[phase].items.length} selected`;
        renderPreview();
      });
      const ti = document.createElement('input');
      ti.type = 'text'; ti.value = item.text;
      ti.addEventListener('input', () => { item.text = ti.value; renderPreview(); });
      const rm = document.createElement('button');
      rm.className = 'scope-remove'; rm.title = 'Remove'; rm.textContent = '×';
      rm.addEventListener('click', () => {
        state.scopeByPhase[phase].items.splice(idx, 1);
        renderScopeByPhase();
        renderPreview();
      });
      row.append(cb, ti, rm);
      itemsWrap.appendChild(row);
    });
    body.appendChild(itemsWrap);

    // Add row
    const addRow = document.createElement('div');
    addRow.className = 'scope-add-row';
    const addInp = document.createElement('input');
    addInp.type = 'text'; addInp.placeholder = 'Add a custom item to ' + PHASE_LABELS[phase] + '…';
    const addBtn = document.createElement('button');
    addBtn.className = 'action ghost small'; addBtn.textContent = '+ Add';
    function commitAdd () {
      const v = addInp.value.trim();
      if (!v) return;
      state.scopeByPhase[phase].items.push({ text: v, checked: true });
      addInp.value = '';
      renderScopeByPhase();
      renderPreview();
    }
    addBtn.addEventListener('click', commitAdd);
    addInp.addEventListener('keydown', e => { if (e.key === 'Enter') commitAdd(); });
    const addIndentBtn = document.createElement('button');
    addIndentBtn.className = 'action ghost small';
    addIndentBtn.textContent = '+ Sub-bullet';
    addIndentBtn.title = 'Add as an indented sub-bullet';
    addIndentBtn.addEventListener('click', () => {
      const v = addInp.value.trim();
      if (!v) return;
      state.scopeByPhase[phase].items.push({ text: v, checked: true, indent: 1 });
      addInp.value = '';
      renderScopeByPhase();
      renderPreview();
    });
    addRow.append(addInp, addBtn, addIndentBtn);
    body.appendChild(addRow);

    card.appendChild(body);
    root.appendChild(card);
  }
}

function renderFee () {
  // Header inputs
  $('fee_type').value = state.fee.type;
  $('fee_percentage').value = state.fee.percentage || 0;
  $('fee_estimate').value = fmtCurrency(state.fee.estimate || 0);
  $('fee_total').value = fmtCurrency(state.fee.total || 0);
  $('fee_total_override').checked = !!state.fee.totalOverride;
  // Show/hide based on type
  $('lbl_pct').style.display = state.fee.type === 'fixed' ? 'none' : '';
  $('lbl_estimate').style.display = state.fee.type === 'fixed' ? 'none' : '';

  // Body
  const tb = $('feeTableBody');
  tb.innerHTML = '';
  let totalAmt = 0;
  let totalPct = 0;
  for (const phase of PHASES) {
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.textContent = PHASE_LABELS[phase];
    const tdPct = document.createElement('td');
    tdPct.className = 'pct-cell num';
    const pctInp = document.createElement('input');
    pctInp.type = 'number'; pctInp.step = '0.1';
    pctInp.value = ((state.fee.phases[phase] || 0) * 100).toFixed(2).replace(/\.?0+$/, '');
    pctInp.addEventListener('input', () => {
      const v = parseFloat(pctInp.value || '0') / 100;
      state.fee.phases[phase] = v;
      // Clear amount override when % changes
      delete state.fee.phaseAmountOverrides[phase];
      renderFee();
      renderPreview();
    });
    tdPct.appendChild(pctInp);
    const tdAmt = document.createElement('td');
    tdAmt.className = 'amt-cell num';
    const amtInp = document.createElement('input');
    amtInp.type = 'text';
    const amtFromPct = (state.fee.total || 0) * (state.fee.phases[phase] || 0);
    const amt = (phase in state.fee.phaseAmountOverrides) ? state.fee.phaseAmountOverrides[phase] : amtFromPct;
    amtInp.value = fmtCurrency(amt);
    amtInp.addEventListener('focus', () => {
      amtInp.value = String(parseCurrency(amtInp.value));
      amtInp.select();
    });
    amtInp.addEventListener('blur', () => {
      const v = parseCurrency(amtInp.value);
      state.fee.phaseAmountOverrides[phase] = v;
      // Optionally: re-derive percent from amount if total is known
      if (state.fee.total > 0) {
        state.fee.phases[phase] = v / state.fee.total;
      }
      renderFee();
      renderPreview();
    });
    amtInp.addEventListener('keydown', e => { if (e.key === 'Enter') amtInp.blur(); });
    tdAmt.appendChild(amtInp);
    const tdAct = document.createElement('td');
    if (phase in state.fee.phaseAmountOverrides) {
      const reset = document.createElement('button');
      reset.className = 'action ghost small';
      reset.title = 'Reset to %-derived amount';
      reset.textContent = '↺';
      reset.addEventListener('click', () => {
        delete state.fee.phaseAmountOverrides[phase];
        renderFee(); renderPreview();
      });
      tdAct.appendChild(reset);
    }
    tr.append(tdLabel, tdPct, tdAmt, tdAct);
    tb.appendChild(tr);
    totalAmt += amt;
    totalPct += (state.fee.phases[phase] || 0);
  }
  // Foot
  const tf = $('feeTableFoot');
  tf.innerHTML = '';

  // Summary
  $('feePctSum').textContent = (totalPct * 100).toFixed(1).replace(/\.0$/, '') + '%';
  $('feePctSum').className = 'item-value' + (Math.abs(totalPct - 1) > 0.001 ? ' warn' : '');
  $('feeAmtSum').textContent = fmtCurrency(totalAmt);
  $('feeAmtSum').className = 'item-value' + (Math.abs(totalAmt - state.fee.total) > 1 ? ' warn' : '');
  $('feeTotalDisplay').textContent = fmtCurrency(state.fee.total);
}

function renderProject () {
  $('proj_name').value = state.project.name;
  $('proj_location').value = state.project.location;
  $('proj_address').value = state.project.address;
  $('proj_sf').value = state.project.sf;
  $('proj_description').value = state.project.description;
  $('proj_date').value = state.project.date;
}

function renderComp () {
  $('compIntro').value = compIntroResolved();
  $('compLeadIn').value = compLeadInResolved();
  $('compClosing').value = state.comp.closing;
}

function compIntroResolved () {
  // If the user has manually edited the intro, it's stored with an OVERRIDE: prefix.
  // Strip the prefix and use as-is (no template substitution).
  if (state.comp.intro && state.comp.intro.startsWith('OVERRIDE:')) {
    return state.comp.intro.slice('OVERRIDE:'.length).trim();
  }
  if (state.fee.type === 'fixed') {
    return FIXED_COMP_INTRO.replace('{TOTAL}', fmtCurrency(state.fee.total || 0));
  }
  // Resolve {PCT}
  const tpl = state.comp.intro || DEFAULT_COMP_INTRO;
  return tpl.replace('{PCT}', String(state.fee.percentage || 0));
}

function compLeadInResolved () {
  const tpl = state.comp.leadIn || DEFAULT_COMP_LEAD_IN;
  return tpl.replace('{ESTIMATE}', fmtCurrency(state.fee.estimate || 0));
}

// =================================================================
// LIVE PREVIEW
// =================================================================

function renderPreview () {
  const project = state.project;
  bindEditableText('projectName', project.name || 'Project Name');
  bindEditableText('projectLocation', project.location || '');
  bindEditableText('projectDate', formatLongDate(project.date));
  bindEditableText('projectDescription', project.description ||
    `The general scope of work for this contract is the design of a new residence in ${project.location || '[location]'}.`);

  // General scope
  const genUl = $('prev_genScope');
  genUl.innerHTML = '';
  for (const item of state.genScope) {
    if (!item.checked) continue;
    const li = document.createElement('li');
    li.textContent = item.text;
    li.contentEditable = 'true';
    li.addEventListener('blur', () => { item.text = li.textContent; });
    genUl.appendChild(li);
  }

  // Phases
  const phasesUl = $('prev_phases');
  phasesUl.innerHTML = '';
  for (const phase of SCOPE_PHASES) {
    const data = state.scopeByPhase[phase];
    const checkedItems = (data.items || []).filter(i => i.checked);
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = PHASE_LABELS[phase] + ': ';
    li.appendChild(b);
    const span = document.createElement('span');
    span.textContent = data.description || '';
    span.contentEditable = 'true';
    span.addEventListener('blur', () => { data.description = span.textContent; });
    li.appendChild(span);
    if (checkedItems.length) {
      const sub = document.createElement('ul');
      sub.className = 'sub-bullets';
      for (const it of checkedItems) {
        const sli = document.createElement('li');
        if (it.indent && it.indent > 0) sli.style.marginLeft = ((it.indent - 1) * 0.3) + 'in';
        sli.textContent = it.text;
        sli.contentEditable = 'true';
        sli.addEventListener('blur', () => { it.text = sli.textContent; });
        sub.appendChild(sli);
      }
      li.appendChild(sub);
    }
    phasesUl.appendChild(li);
  }

  // Compensation block
  bindEditableHTML('compIntro', '<p>' + escapeHtml(compIntroResolved()) + '</p>');
  bindEditableText('compLeadIn', compLeadInResolved());
  bindEditableHTML('compClosing', state.comp.closing.split(/\n\n+/).map(p => '<p>' + escapeHtml(p) + '</p>').join(''));

  // Fee table
  const tbody = $('prev_feeTable').querySelector('tbody');
  tbody.innerHTML = '';
  // Total Fee header row
  const totalLabel = state.fee.type === 'fixed'
    ? 'Total Fee'
    : (state.fee.percentage ? `Total Fee: ${state.fee.percentage}% of ${fmtCurrency(state.fee.estimate)}` : 'Total Fee');
  const headerTr = document.createElement('tr');
  headerTr.className = 'total-row';
  headerTr.innerHTML = `<td class="lbl"></td><td class="pct"></td><td class="amt"></td>`;
  headerTr.children[0].textContent = totalLabel;
  headerTr.children[2].textContent = fmtCurrency(state.fee.total || 0);
  tbody.appendChild(headerTr);
  for (const phase of PHASES) {
    const pct = state.fee.phases[phase] || 0;
    const amt = (phase in state.fee.phaseAmountOverrides)
      ? state.fee.phaseAmountOverrides[phase]
      : (state.fee.total || 0) * pct;
    if (pct === 0 && amt === 0) continue;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="lbl"></td><td class="pct"></td><td class="amt"></td>`;
    tr.children[0].textContent = PHASE_LABELS[phase];
    tr.children[1].textContent = (pct * 100).toFixed(0) + '%';
    tr.children[2].textContent = fmtCurrency(amt);
    tbody.appendChild(tr);
  }
}

function bindEditableText (key, value) {
  const el = document.querySelector(`[data-bind="${key}"]`);
  if (!el) return;
  if (el.textContent !== value) el.textContent = value;
  if (!el.dataset.editableBound) {
    el.contentEditable = 'true';
    el.dataset.editableBound = '1';
    el.addEventListener('blur', () => {
      const v = el.textContent;
      switch (key) {
        case 'projectName': state.project.name = v; $('proj_name').value = v; break;
        case 'projectLocation': state.project.location = v; $('proj_location').value = v; break;
        case 'projectDescription': state.project.description = v; $('proj_description').value = v; break;
        case 'compLeadIn': state.comp.leadIn = v; $('compLeadIn').value = v; break;
        case 'projectDate':
          // try parse
          const d = parseAnyDate(v);
          if (d) {
            state.project.date = d;
            $('proj_date').value = d;
          }
          break;
      }
    });
  }
}

function parseAnyDate (s) {
  if (!s) return null;
  // Long form: "May 9, 2025"
  const m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const months = ['january','february','march','april','may','june',
                    'july','august','september','october','november','december'];
    const mi = months.indexOf(m[1].toLowerCase());
    if (mi >= 0) {
      return `${m[3]}-${String(mi + 1).padStart(2,'0')}-${String(parseInt(m[2],10)).padStart(2,'0')}`;
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function bindEditableHTML (key, html) {
  const el = document.querySelector(`[data-bind="${key}"]`);
  if (!el) return;
  if (el.innerHTML !== html) el.innerHTML = html;
  if (!el.dataset.editableBound) {
    el.contentEditable = 'true';
    el.dataset.editableBound = '1';
    el.addEventListener('blur', () => {
      const text = el.innerText.trim();
      if (key === 'compIntro') {
        // Mark as override so we don't re-render template
        state.comp.intro = 'OVERRIDE:' + text;
        $('compIntro').value = text;
      } else if (key === 'compClosing') {
        state.comp.closing = text;
        $('compClosing').value = text;
      }
    });
  }
}

function refreshAll () {
  renderProject();
  renderGeneralScope();
  renderFee();
  renderScopeByPhase();
  renderComp();
  renderPreview();
}

// =================================================================
// DOCX GENERATION
// =================================================================

async function generateDocx () {
  if (typeof window.docx === 'undefined') {
    showToast('docx library failed to load', 'error');
    return;
  }
  const D = window.docx;
  const {
    Document, Packer, Paragraph, TextRun, AlignmentType,
    Table, TableRow, TableCell, WidthType, BorderStyle,
    HeadingLevel, Header, Footer, PageNumber, NumberFormat,
    LevelFormat, convertInchesToTwip, TabStopType, TabStopPosition,
  } = D;

  const project = state.project;
  const firm = state.config.firm;

  // Helpers — fonts
  const SERIF = 'Cambria';
  const SANS  = 'Calibri';

  function P (text, opts) {
    opts = opts || {};
    return new Paragraph({
      children: opts.children || [ new TextRun({ text: text || '', font: opts.font || SERIF, size: opts.size || 22, bold: opts.bold, italics: opts.italics, color: opts.color }) ],
      alignment: opts.alignment,
      spacing: opts.spacing || { after: 120 },
      bullet: opts.bullet,
      indent: opts.indent,
      heading: opts.heading,
      pageBreakBefore: opts.pageBreakBefore,
    });
  }

  function R (text, opts) {
    opts = opts || {};
    return new TextRun({
      text: text || '', font: opts.font || SERIF, size: opts.size || 22,
      bold: opts.bold, italics: opts.italics, color: opts.color,
      superScript: opts.superScript,
    });
  }

  // -------- Header (firm letterhead, top-of-page on all pages) --------
  const headerLogo = new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 60 },
    children: [
      new TextRun({ text: 'CARLISLE  MOORE  ARCHITECTS', font: SANS, size: 22, bold: true, color: 'B35A1F' }),
    ],
  });
  const headerInfo = new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 0 },
    children: [
      new TextRun({ text: `${firm.principal1} ${firm.phone1}    `, font: SANS, size: 14, bold: true, color: '4A4A4A' }),
      new TextRun({ text: `${firm.principal2} ${firm.phone2}    `, font: SANS, size: 14, bold: true, color: '4A4A4A' }),
      new TextRun({ text: `${firm.addr1.toUpperCase()}  ${firm.addr2.toUpperCase()}    `, font: SANS, size: 14, color: '4A4A4A' }),
      new TextRun({ text: firm.website.toUpperCase(), font: SANS, size: 14, color: '4A4A4A' }),
    ],
  });
  const headerRule = new Paragraph({
    spacing: { before: 60, after: 200 },
    border: { bottom: { color: 'B35A1F', space: 1, style: BorderStyle.SINGLE, size: 8 } },
    children: [ new TextRun({ text: '', font: SANS, size: 2 }) ],
  });

  // -------- Footer (page X of Y) --------
  const footerPara = new Paragraph({
    alignment: AlignmentType.LEFT,
    children: [
      new TextRun({ text: 'Page ', font: SANS, size: 14, color: '888888' }),
      new TextRun({ children: [PageNumber.CURRENT], font: SANS, size: 14, color: '888888' }),
      new TextRun({ text: ' of ', font: SANS, size: 14, color: '888888' }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], font: SANS, size: 14, color: '888888' }),
    ],
  });

  // -------- Body --------
  const body = [];

  // Title
  body.push(new Paragraph({
    spacing: { before: 0, after: 60 },
    children: [ new TextRun({ text: 'SUPPLEMENTARY CONDITIONS', font: SANS, size: 56, bold: true, color: '1C1C1C' }) ],
  }));
  body.push(new Paragraph({
    spacing: { after: 40 },
    children: [ new TextRun({ text: project.name || 'Project', font: SERIF, size: 36 }) ],
  }));
  if (project.location) {
    body.push(new Paragraph({
      spacing: { after: 60 },
      children: [ new TextRun({ text: project.location, font: SERIF, size: 22 }) ],
    }));
  }
  body.push(new Paragraph({
    spacing: { after: 240 },
    children: [ new TextRun({ text: formatLongDate(project.date) || '', font: SERIF, size: 22 }) ],
  }));

  // Preamble
  body.push(new Paragraph({
    spacing: { after: 240 },
    children: [
      R('The following supplements modify AIA Document '),
      R('B105', { italics: true }),
      R('TM', { italics: true, superScript: true }),
      R('–2017, Standard Short Form of Agreement Between Owner and Architect.', { italics: true }),
      R(' Where a portion of the Agreement is modified or deleted by these Supplementary Conditions, the unaltered portions of the Agreement shall remain in effect. In the event that there is a conflict between these Supplementary Conditions and the AIA Document B105 referenced above, these Supplementary Conditions shall apply.'),
    ],
  }));

  // Section 1
  body.push(P('', {
    children: [ R('The Owner and Architect agree the scope of work for this project is as follows:', { bold: true }) ],
    spacing: { after: 120 },
  }));
  const desc = project.description || `The general scope of work for this contract is the design of a new residence in ${project.location || '[location]'}.`;
  body.push(P(desc, { spacing: { after: 200 } }));

  // General Scope of Work
  body.push(P('', { children: [R('General Scope of Work', { bold: true })], spacing: { after: 80 } }));
  for (const item of state.genScope) {
    if (!item.checked) continue;
    body.push(new Paragraph({
      bullet: { level: 0 },
      spacing: { after: 60 },
      children: [ R(item.text) ],
    }));
  }
  body.push(new Paragraph({ children:[R(' ')], spacing: { after: 120 } }));

  // Phases heading
  body.push(P('', {
    children: [ R('This work will be delivered in the following Phases:', { bold: true }) ],
    spacing: { after: 80 },
  }));
  for (const phase of SCOPE_PHASES) {
    const data = state.scopeByPhase[phase];
    body.push(new Paragraph({
      bullet: { level: 0 },
      spacing: { after: 80 },
      children: [
        R(PHASE_LABELS[phase] + ': ', { bold: true }),
        R(data.description || ''),
      ],
    }));
    for (const it of (data.items || [])) {
      if (!it.checked) continue;
      // All items under a phase are sub-bullets (level 1 in the bullet list).
      // If the user marked an item as further indented, push to level 2-equivalent.
      const isExtraIndent = !!(it.indent && it.indent > 1);
      body.push(new Paragraph({
        bullet: { level: 1 },
        spacing: { after: 50 },
        indent: isExtraIndent ? { left: convertInchesToTwip(1.1) } : undefined,
        children: [ R(it.text) ],
      }));
    }
  }
  body.push(new Paragraph({ children:[R(' ')], spacing: { after: 120 } }));

  // Article 6
  body.push(new Paragraph({
    spacing: { before: 240, after: 80 },
    children: [ R('ARTICLE 6   PAYMENTS AND COMPENSATION TO THE ARCHITECT', { bold: true }) ],
  }));
  body.push(P('', { children: [R('(add as follows)', { bold: true })], spacing: { after: 200 } }));
  body.push(P('', { children: [R('The Architect’s Compensation shall be:', { bold: true })], spacing: { after: 120 } }));

  // Comp intro paragraphs
  const introText = compIntroResolved();
  for (const para of introText.split(/\n\n+/)) {
    body.push(P(para, { spacing: { after: 200 } }));
  }

  // Lead-in
  body.push(P(compLeadInResolved(), { spacing: { after: 80 } }));

  // Fee table
  const feeRows = [];
  // Total fee header row
  const totalLabelDocx = state.fee.type === 'fixed'
    ? 'Total Fee:'
    : (state.fee.percentage ? `Total Fee:  ${state.fee.percentage}% of ${fmtCurrency(state.fee.estimate)}` : 'Total Fee:');

  feeRows.push(new TableRow({
    children: [
      new TableCell({
        width: { size: 60, type: WidthType.PERCENTAGE },
        children: [ P('', { children: [ R(totalLabelDocx, { bold: true }) ], spacing: { after: 0 } }) ],
        borders: noBorders(),
      }),
      new TableCell({
        width: { size: 15, type: WidthType.PERCENTAGE },
        children: [ P('', { spacing: { after: 0 } }) ],
        borders: noBorders(),
      }),
      new TableCell({
        width: { size: 25, type: WidthType.PERCENTAGE },
        children: [ P('', { children: [ R(fmtCurrency(state.fee.total || 0), { bold: true }) ], alignment: AlignmentType.RIGHT, spacing: { after: 0 } }) ],
        borders: noBorders(),
      }),
    ],
  }));
  for (const phase of PHASES) {
    const pct = state.fee.phases[phase] || 0;
    const amt = (phase in state.fee.phaseAmountOverrides)
      ? state.fee.phaseAmountOverrides[phase]
      : (state.fee.total || 0) * pct;
    if (pct === 0 && amt === 0) continue;
    feeRows.push(new TableRow({
      children: [
        new TableCell({
          width: { size: 60, type: WidthType.PERCENTAGE },
          children: [ P(PHASE_LABELS[phase], { spacing: { after: 0 } }) ],
          borders: noBorders(),
        }),
        new TableCell({
          width: { size: 15, type: WidthType.PERCENTAGE },
          children: [ P((pct * 100).toFixed(0) + '%', { alignment: AlignmentType.RIGHT, spacing: { after: 0 } }) ],
          borders: noBorders(),
        }),
        new TableCell({
          width: { size: 25, type: WidthType.PERCENTAGE },
          children: [ P(fmtCurrency(amt), { alignment: AlignmentType.RIGHT, spacing: { after: 0 } }) ],
          borders: noBorders(),
        }),
      ],
    }));
  }
  const feeTable = new Table({
    rows: feeRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders(),
  });
  body.push(feeTable);
  body.push(new Paragraph({ children:[R(' ')], spacing: { after: 200 } }));

  // Closing
  for (const para of (state.comp.closing || '').split(/\n\n+/)) {
    body.push(P(para, { spacing: { after: 200 } }));
  }

  // End marker
  body.push(P('', { children: [R('--- END OF ADDITIONS -----', { bold: true })], spacing: { before: 240 } }));

  function noBorders () {
    const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    return { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
  }

  const doc = new Document({
    creator: firm.name,
    title: `Supplementary Conditions — ${project.name}`,
    description: 'AIA B105-2017 Supplementary Conditions',
    styles: {
      default: {
        document: {
          run: { font: SERIF, size: 22 },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [
            { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } } },
            { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: convertInchesToTwip(0.9), hanging: convertInchesToTwip(0.25) } } } },
          ],
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          margin: {
            top:    convertInchesToTwip(0.85),
            right:  convertInchesToTwip(0.7),
            bottom: convertInchesToTwip(0.85),
            left:   convertInchesToTwip(0.85),
            header: convertInchesToTwip(0.4),
            footer: convertInchesToTwip(0.4),
          },
        },
      },
      headers: {
        default: new Header({ children: [headerLogo, headerInfo, headerRule] }),
      },
      footers: {
        default: new Footer({ children: [footerPara] }),
      },
      children: body,
    }],
  });

  const blob = await Packer.toBlob(doc);
  const safeName = (project.name || 'Project').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '_');
  const filename = `Supplementary_Conditions_${safeName || 'Project'}.docx`;
  if (window.saveAs) {
    saveAs(blob, filename);
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Save to history
  saveToHistory(project, filename);
  showToast(`Downloaded ${filename}`, 'success');
}

function saveToHistory (project, filename) {
  const entry = {
    id: genId(),
    at: new Date().toISOString(),
    clientId: state.currentClient?.id || null,
    clientName: state.currentClient?.name || null,
    projectName: project.name || '',
    projectLocation: project.location || '',
    filename,
    snapshot: {
      project: JSON.parse(JSON.stringify(state.project)),
      genScope: JSON.parse(JSON.stringify(state.genScope)),
      fee: JSON.parse(JSON.stringify(state.fee)),
      scopeByPhase: JSON.parse(JSON.stringify(state.scopeByPhase)),
      comp: JSON.parse(JSON.stringify(state.comp)),
    },
  };
  state.config.history.unshift(entry);
  state.config.history = state.config.history.slice(0, 50);
  saveConfig();
  renderHistory();
}

function renderHistory () {
  const list = $('historyList');
  list.innerHTML = '';
  if (!state.config.history.length) {
    list.innerHTML = '<p class="empty">No documents downloaded yet.</p>';
    return;
  }
  for (const h of state.config.history) {
    const row = document.createElement('div');
    row.className = 'history-row';
    const date = new Date(h.at).toLocaleString();
    row.innerHTML =
      '<span class="hr-name"></span>' +
      '<span class="hr-date"></span>' +
      '<button class="action ghost small">Re-load</button>' +
      '<button class="action ghost small">Re-download</button>' +
      '<button class="action ghost small">Delete</button>';
    row.children[0].textContent = `${h.projectName || '(untitled)'}${h.clientName ? ' — ' + h.clientName : ''}`;
    row.children[1].textContent = date;
    row.children[2].addEventListener('click', () => loadFromHistory(h));
    row.children[3].addEventListener('click', () => {
      loadFromHistory(h);
      generateDocx();
    });
    row.children[4].addEventListener('click', () => {
      state.config.history = state.config.history.filter(x => x.id !== h.id);
      saveConfig();
      renderHistory();
    });
    list.appendChild(row);
  }
}

function loadFromHistory (h) {
  state.project = Object.assign({}, h.snapshot.project);
  state.genScope = JSON.parse(JSON.stringify(h.snapshot.genScope));
  state.fee = Object.assign({}, h.snapshot.fee);
  state.scopeByPhase = JSON.parse(JSON.stringify(h.snapshot.scopeByPhase));
  state.comp = Object.assign({}, h.snapshot.comp);
  if (h.clientId) {
    const c = (state.data?.clients || []).find(c => c.id === h.clientId);
    if (c) {
      state.currentClient = c;
      fillSelectedClientCard(c);
      $('selectedClientCard').classList.add('shown');
      $('clientSearch').value = c.name || '';
    }
  }
  switchTab('builder');
  refreshAll();
  showToast('Loaded from history', 'success');
}

// =================================================================
// SETTINGS
// =================================================================

function loadSettingsForm () {
  const g = state.config.github;
  $('setOwner').value = g.owner || '';
  $('setRepo').value = g.repo || 'TSC-BILLING';
  $('setBranch').value = g.branch || 'main';
  $('setPath').value = g.path || 'data.json';
  $('setToken').value = g.token || '';
  const f = state.config.firm;
  $('setFirmName').value = f.name;
  $('setPrincipal1').value = f.principal1;
  $('setPhoneScott').value = f.phone1;
  $('setPrincipal2').value = f.principal2;
  $('setPhoneBill').value = f.phone2;
  $('setAddr1').value = f.addr1;
  $('setAddr2').value = f.addr2;
  $('setWebsite').value = f.website;
}

function saveSettingsForm () {
  state.config.github = {
    owner: $('setOwner').value.trim(),
    repo: $('setRepo').value.trim(),
    branch: $('setBranch').value.trim() || 'main',
    path: $('setPath').value.trim() || 'data.json',
    token: $('setToken').value.trim(),
  };
  saveConfig();
  $('settingsStatus').textContent = 'Saved.';
  $('settingsStatus').className = 'settings-status ok';
}

function saveFirmForm () {
  state.config.firm = {
    name: $('setFirmName').value,
    principal1: $('setPrincipal1').value,
    phone1: $('setPhoneScott').value,
    principal2: $('setPrincipal2').value,
    phone2: $('setPhoneBill').value,
    addr1: $('setAddr1').value,
    addr2: $('setAddr2').value,
    website: $('setWebsite').value,
  };
  saveConfig();
  showToast('Firm info saved', 'success');
}

async function testGitHubConnection () {
  $('settingsStatus').textContent = 'Testing…';
  $('settingsStatus').className = 'settings-status';
  // Pull settings from form first (might not be saved yet)
  saveSettingsForm();
  try {
    const { json } = await ghGetFile();
    $('settingsStatus').textContent = `OK — ${json.clients?.length || 0} clients found.`;
    $('settingsStatus').className = 'settings-status ok';
  } catch (e) {
    $('settingsStatus').textContent = e.message;
    $('settingsStatus').className = 'settings-status error';
  }
}

async function loadLocalDataFile (file) {
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    state.data = json;
    state.dataSha = null;
    state.config.cachedData = json;
    state.config.cachedDataAt = new Date().toISOString();
    saveConfig();
    setSyncStatus('local file', 'connected');
    updateDataSourceLabel();
    renderClientSuggestions('');
    showToast(`Loaded ${json.clients?.length || 0} clients from ${file.name}`, 'success');
  } catch (e) {
    showToast('Could not load local file: ' + e.message, 'error');
  }
}

// =================================================================
// TABS & EVENT WIRING
// =================================================================

function switchTab (name) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p =>
    p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'history') renderHistory();
  if (name === 'settings') loadSettingsForm();
}

function wireEvents () {
  // Tabs
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Reload data
  $('reloadDataBtn').addEventListener('click', async () => {
    if (state.config.github.token) {
      await loadDataFromGitHub();
    } else {
      showToast('Configure GitHub in Settings, or use "Load local data.json"', 'error');
      switchTab('settings');
    }
  });

  // Client search
  const search = $('clientSearch');
  search.addEventListener('input', () => {
    renderClientSuggestions(search.value);
    $('clientSuggestions').classList.add('open');
  });
  search.addEventListener('focus', () => {
    renderClientSuggestions(search.value);
    $('clientSuggestions').classList.add('open');
  });
  search.addEventListener('blur', () => {
    setTimeout(() => $('clientSuggestions').classList.remove('open'), 150);
  });
  search.addEventListener('keydown', e => {
    if (e.key === 'Escape') $('clientSuggestions').classList.remove('open');
  });

  $('addClientBtn').addEventListener('click', () => openNewClientForm({ name: search.value }));
  $('editClientBtn').addEventListener('click', () => {
    if (state.currentClient) openEditClientForm(state.currentClient);
  });
  $('ncf_save').addEventListener('click', saveNewClient);
  $('ncf_cancel').addEventListener('click', hideNewClientForm);

  // Project info
  bindInput('proj_name',        v => state.project.name        = v);
  bindInput('proj_location',    v => state.project.location    = v);
  bindInput('proj_address',     v => state.project.address     = v);
  bindInput('proj_sf',          v => state.project.sf          = v);
  bindInput('proj_description', v => state.project.description = v);
  bindInput('proj_date',        v => state.project.date        = v);

  // General scope add
  $('genScopeAddBtn').addEventListener('click', () => {
    const v = $('genScopeAddInput').value.trim();
    if (!v) return;
    state.genScope.push({ text: v, checked: true });
    $('genScopeAddInput').value = '';
    renderGeneralScope();
    renderPreview();
  });
  $('genScopeAddInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('genScopeAddBtn').click();
  });

  // Fee inputs
  $('fee_type').addEventListener('change', () => {
    state.fee.type = $('fee_type').value;
    renderFee();
    renderComp();
    renderPreview();
  });
  $('fee_percentage').addEventListener('input', () => {
    state.fee.percentage = parseFloat($('fee_percentage').value) || 0;
    if (!state.fee.totalOverride) {
      state.fee.total = state.fee.estimate * (state.fee.percentage / 100);
      state.fee.phaseAmountOverrides = {};
    }
    renderFee();
    renderComp();
    renderPreview();
  });
  $('fee_estimate').addEventListener('input', () => {
    state.fee.estimate = parseCurrency($('fee_estimate').value);
    if (!state.fee.totalOverride && state.fee.type !== 'fixed') {
      state.fee.total = state.fee.estimate * (state.fee.percentage / 100);
      state.fee.phaseAmountOverrides = {};
    }
    renderFee();
    renderComp();
    renderPreview();
  });
  $('fee_estimate').addEventListener('blur', () => {
    $('fee_estimate').value = fmtCurrency(state.fee.estimate);
  });
  $('fee_total').addEventListener('input', () => {
    state.fee.total = parseCurrency($('fee_total').value);
    state.fee.totalOverride = true;
    state.fee.phaseAmountOverrides = {};
    $('fee_total_override').checked = true;
    renderFee();
    renderComp();
    renderPreview();
  });
  $('fee_total').addEventListener('blur', () => {
    $('fee_total').value = fmtCurrency(state.fee.total);
  });
  $('fee_total_override').addEventListener('change', () => {
    state.fee.totalOverride = $('fee_total_override').checked;
    if (!state.fee.totalOverride && state.fee.type !== 'fixed') {
      state.fee.total = state.fee.estimate * (state.fee.percentage / 100);
      state.fee.phaseAmountOverrides = {};
    }
    renderFee();
    renderComp();
    renderPreview();
  });

  // Reset scope
  $('resetScopeBtn').addEventListener('click', () => {
    if (!confirm('Reset all scope items and descriptions to your saved templates?')) return;
    state.scopeByPhase = cloneTemplates();
    state.genScope = cloneItems(FACTORY_GEN_SCOPE);
    renderGeneralScope();
    renderScopeByPhase();
    renderPreview();
  });

  // Comp
  bindInput('compIntro', v => { state.comp.intro = 'OVERRIDE:' + v; });
  bindInput('compLeadIn', v => { state.comp.leadIn = v; });
  bindInput('compClosing', v => { state.comp.closing = v; });

  // Actions
  $('downloadDocxBtn').addEventListener('click', generateDocx);
  $('downloadAgainBtn').addEventListener('click', () => {
    saveToHistory(state.project, '(saved without download)');
    showToast('Saved to history', 'success');
  });
  $('clearFormBtn').addEventListener('click', () => {
    if (!confirm('Clear all form fields and start fresh?')) return;
    clearForm();
  });
  $('resyncPreviewBtn').addEventListener('click', renderPreview);

  // Settings
  $('settingsSave').addEventListener('click', () => {
    saveSettingsForm();
    showToast('Settings saved', 'success');
  });
  $('testConnect').addEventListener('click', testGitHubConnection);
  $('loadFromGh').addEventListener('click', async () => {
    saveSettingsForm();
    await loadDataFromGitHub();
  });
  $('loadLocalBtn').addEventListener('click', () => $('localDataInput').click());
  $('localDataInput').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) loadLocalDataFile(f);
  });
  $('firmSave').addEventListener('click', saveFirmForm);
  $('resetScopeTemplatesBtn').addEventListener('click', () => {
    if (!confirm('Reset scope templates to factory defaults? Custom edits will be lost.')) return;
    state.config.scopeTemplates = JSON.parse(JSON.stringify(FACTORY_TEMPLATES));
    saveConfig();
    showToast('Scope templates reset', 'success');
  });
  $('editScopeTemplatesBtn').addEventListener('click', () => {
    showToast('Edit scope items in the Builder, then use the "Reset to defaults" button to revert.', 'success');
    switchTab('builder');
  });
  $('exportPrefsBtn').addEventListener('click', exportPrefs);
  $('importPrefsBtn').addEventListener('click', () => $('importPrefsFile').click());
  $('importPrefsFile').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) importPrefs(f);
  });
}

function bindInput (id, fn) {
  const el = $(id);
  if (!el) return;
  el.addEventListener('input', () => {
    fn(el.value);
    renderPreview();
  });
}

function clearForm () {
  state.currentClient = null;
  state.project = { name: '', location: '', address: '', sf: '', description: '', date: todayISO() };
  state.genScope = cloneItems(FACTORY_GEN_SCOPE);
  state.fee = {
    type: 'percentage', percentage: 10.0, estimate: 3000000, total: 300000, totalOverride: false,
    phases: { DEPOSIT: 0.05, SD: 0.20, DD: 0.20, CD: 0.50, CA: 0.05 },
    phaseAmountOverrides: {},
  };
  state.scopeByPhase = cloneTemplates();
  state.comp = { intro: DEFAULT_COMP_INTRO, leadIn: DEFAULT_COMP_LEAD_IN, closing: DEFAULT_COMP_CLOSING };
  $('clientSearch').value = '';
  $('selectedClientCard').classList.remove('shown');
  refreshAll();
}

function exportPrefs () {
  const data = JSON.stringify(state.config, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tsc-cont-config-' + todayISO() + '.json';
  document.body.appendChild(a); a.click(); a.remove();
}
async function importPrefs (file) {
  try {
    const text = await file.text();
    const j = JSON.parse(text);
    state.config = Object.assign(defaultConfig(), j);
    saveConfig();
    loadSettingsForm();
    showToast('Backup restored', 'success');
  } catch (e) {
    showToast('Restore failed: ' + e.message, 'error');
  }
}

// =================================================================
// INIT
// =================================================================

function init () {
  loadSettingsForm();

  // Initial state
  $('proj_date').value = state.project.date;
  refreshAll();
  updateDataSourceLabel();

  // If we have cached data, mark connected; otherwise offline
  if (state.data) {
    setSyncStatus(state.config.github.token ? 'cached · click Refresh' : 'cached', 'connected');
  } else {
    setSyncStatus('no data', 'error');
  }

  wireEvents();

  // Auto-load from GitHub if token is configured
  if (state.config.github.token && state.config.github.owner && state.config.github.repo) {
    loadDataFromGitHub();
  }

  renderHistory();
}

document.addEventListener('DOMContentLoaded', init);

})();
