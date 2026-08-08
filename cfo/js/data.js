// data.js — state management, localStorage, and all computed metrics

const STORAGE_KEY = 'cfo_data';

// ── State ─────────────────────────────────────────────────────────────────
let _state = null;

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    _state = raw ? JSON.parse(raw) : null;
  } catch (e) {
    _state = null;
  }
  if (!_state) _state = getDefaultState();
  return _state;
}

export function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
}

export function importJSON(json) {
  _state = JSON.parse(json);
  saveState();
}

export function exportJSON() {
  return JSON.stringify(_state, null, 2);
}

export function getState() { return _state; }

export function updateCompany(fields) {
  Object.assign(_state.company, fields);
  saveState();
}

export function upsertMonth(period, data) {
  const idx = _state.months.findIndex(m => m.period === period);
  if (idx >= 0) _state.months[idx] = { ...data, period };
  else _state.months.push({ ...data, period });
  _state.months.sort((a, b) => a.period.localeCompare(b.period));
  saveState();
}

// ── Computed metrics ──────────────────────────────────────────────────────

export function divisionRevenue(month) {
  const out = {};
  (month.revenue?.by_division || []).forEach(d => { out[d.division_id] = d.total || 0; });
  return out;
}

export function divisionCOGS(month) {
  const out = {};
  (month.cogs?.by_division || []).forEach(d => {
    out[d.division_id] = (d.materials || 0) + (d.direct_labor || 0) + (d.shipping || 0) + (d.other_direct || 0);
  });
  return out;
}

export function divisionGrossProfit(month) {
  const rev = divisionRevenue(month);
  const cogs = divisionCOGS(month);
  const out = {};
  Object.keys(rev).forEach(id => { out[id] = (rev[id] || 0) - (cogs[id] || 0); });
  return out;
}

export function divisionMargin(month) {
  const rev = divisionRevenue(month);
  const gp = divisionGrossProfit(month);
  const out = {};
  Object.keys(rev).forEach(id => { out[id] = rev[id] ? gp[id] / rev[id] : 0; });
  return out;
}

export function totalRevenue(month) {
  return (month.revenue?.by_division || []).reduce((s, d) => s + (d.total || 0), 0);
}

export function totalCOGS(month) {
  return (month.cogs?.by_division || []).reduce((s, d) =>
    s + (d.materials || 0) + (d.direct_labor || 0) + (d.shipping || 0) + (d.other_direct || 0), 0);
}

export function grossProfit(month) { return totalRevenue(month) - totalCOGS(month); }
export function grossMargin(month) {
  const r = totalRevenue(month);
  return r ? grossProfit(month) / r : 0;
}

export function totalOpex(month) {
  const e = month.expenses || {};
  return (e.payroll?.salary_and_wages || 0)
       + (e.payroll?.payroll_taxes_benefits || 0)
       + (e.contractors?.total || 0)
       + (e.facilities?.rent || 0)
       + (e.facilities?.utilities || 0)
       + (e.facilities?.maintenance || 0)
       + (e.software_and_tools?.total || 0)
       + (e.marketing?.paid_ads || 0)
       + (e.marketing?.content_and_creative || 0)
       + (e.marketing?.events_and_sponsorships || 0)
       + (e.professional_services?.accounting || 0)
       + (e.professional_services?.legal || 0)
       + (e.professional_services?.consulting || 0)
       + (e.other_opex?.total || 0);
}

export function netIncome(month) { return grossProfit(month) - totalOpex(month); }
export function netMargin(month) {
  const r = totalRevenue(month);
  return r ? netIncome(month) / r : 0;
}

export function expenseBreakdown(month) {
  const e = month.expenses || {};
  return {
    'Payroll': (e.payroll?.salary_and_wages || 0) + (e.payroll?.payroll_taxes_benefits || 0),
    'Contractors': e.contractors?.total || 0,
    'Facilities': (e.facilities?.rent || 0) + (e.facilities?.utilities || 0) + (e.facilities?.maintenance || 0),
    'Software': e.software_and_tools?.total || 0,
    'Marketing': (e.marketing?.paid_ads || 0) + (e.marketing?.content_and_creative || 0) + (e.marketing?.events_and_sponsorships || 0),
    'Professional': (e.professional_services?.accounting || 0) + (e.professional_services?.legal || 0) + (e.professional_services?.consulting || 0),
    'Other': e.other_opex?.total || 0,
  };
}

export function cashRunway(month) {
  const bal = month.cash?.opening_balance || 0;
  const monthly_burn = totalOpex(month) + totalCOGS(month);
  const monthly_rev = totalRevenue(month);
  const net_burn = monthly_burn - monthly_rev;
  return net_burn > 0 ? bal / net_burn : 99;
}

export function arTotal(month) {
  const c = month.cash || {};
  return (c.ar_current || 0) + (c.ar_31_60 || 0) + (c.ar_61_90 || 0) + (c.ar_over_90 || 0);
}

export function arAging(month) {
  const c = month.cash || {};
  const total = arTotal(month) || 1;
  return {
    current: (c.ar_current || 0) / total,
    d31_60:  (c.ar_31_60  || 0) / total,
    d61_90:  (c.ar_61_90  || 0) / total,
    over90:  (c.ar_over_90 || 0) / total,
  };
}

export function inventoryTurnover(month) {
  const cogs = totalCOGS(month);
  const inv  = month.inventory?.totals?.total_inventory_value || 0;
  return inv ? (cogs * 12) / inv : 0;
}

export function daysOnHand(month) {
  const turn = inventoryTurnover(month);
  return turn ? 365 / turn : 0;
}

export function recurringRevenuePct(month) {
  const total = totalRevenue(month) || 1;
  const recurring = (month.revenue?.by_division || []).reduce((s, d) => s + (d.recurring || 0), 0);
  return recurring / total;
}

// Trailing trend arrays for charts
export function trendData(months, fn) {
  return months.map(m => ({ period: m.period, value: fn(m) }));
}

export function pctChange(current, prior) {
  return prior ? (current - prior) / prior : 0;
}

// ── Default state ─────────────────────────────────────────────────────────
function getDefaultState() {
  return {
    company: {
      name: 'Your Company',
      fiscal_year_start_month: 1,
      industry: 'product',
      divisions: [
        { id: 'div1', name: 'Division 1', type: 'product' }
      ]
    },
    months: []
  };
}
