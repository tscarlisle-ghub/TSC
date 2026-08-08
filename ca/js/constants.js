// Shared vocabulary + color mapping for the CA Task Manager.
// Keep this the single source of truth — db.js, app.js and parse.js all read from it.

const RESPONSIBLE_PARTIES = ['Owner', 'Architect', 'Interior Designer', 'Contractor'];

const RESPONSIBLE_COLORS = {
  'Owner': 'var(--ink)',
  'Architect': 'var(--rust)',
  'Interior Designer': 'var(--rust-mid)',
  'Contractor': 'var(--ink-soft)',
};

const PRIORITIES = ['High', 'Medium', 'Low'];

const PRIORITY_COLORS = {
  'High': 'var(--alert)',
  'Medium': 'var(--gold)',
  'Low': 'var(--ink-mute)',
};

const STATUSES = ['Open', 'In Progress', 'Blocked', 'Done'];

const STATUS_COLORS = {
  'Open': 'var(--ink-mute)',
  'In Progress': 'var(--gold)',
  'Blocked': 'var(--alert)',
  'Done': 'var(--forest)',
};

const TASK_TYPES = ['RFI', 'Submittal', 'Change Order', 'Punch List', 'Payment', 'Inspection', 'Site Visit', 'General'];

// Construction categories / trades — used to group the "Category View" ledger.
const CATEGORIES = [
  'Sitework & Excavation',
  'Foundation & Structural',
  'Framing',
  'Roofing',
  'Exterior & Envelope',
  'Windows & Doors',
  'Plumbing',
  'Electrical',
  'HVAC',
  'Insulation & Drywall',
  'Interior Finishes',
  'Millwork & Cabinetry',
  'Flooring',
  'Painting',
  'Landscape & Hardscape',
  'Punch List',
  'General',
];

const PROJECT_STATUSES = ['Active', 'On Hold', 'Complete'];
const PROJECT_PHASES = ['SD', 'DD', 'CD', 'CA'];

function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

function fmtDateShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysFromToday(iso) {
  if (!iso) return null;
  const today = new Date(todayISO() + 'T12:00:00');
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d)) return null;
  return Math.round((d - today) / 86400000);
}

// Priority sorts High -> Medium -> Low
function priorityRank(p) { return { High: 0, Medium: 1, Low: 2 }[p] ?? 3; }
