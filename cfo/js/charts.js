// charts.js — Chart.js configurations and rendering helpers

export const PALETTE = {
  oxblood:  '#74130c',
  forest:   '#1a5c2e',
  slate:    '#4a4a4a',
  amber:    '#b07d15',
  teal:     '#1a5c52',
  steel:    '#2a4a6a',
  hair:     '#9a9a9a',
  faint:    '#e8e5de',
  divColors: ['#74130c','#1a5c2e','#2a4a6a','#b07d15','#1a5c52','#6b3a7d','#4a4a4a','#7a3a10'],
};

const isDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
const gridColor  = () => isDark() ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
const tickColor  = () => isDark() ? 'rgba(255,255,255,0.4)'  : '#9a9a9a';

const baseScales = () => ({
  x: {
    grid: { color: gridColor() },
    ticks: { color: tickColor(), font: { size: 11 } },
    border: { color: 'transparent' }
  },
  y: {
    grid: { color: gridColor() },
    ticks: { color: tickColor(), font: { size: 11 } },
    border: { color: 'transparent' }
  }
});

const dollarFormatter = v => '$' + (Math.abs(v) >= 1000 ? Math.round(Math.abs(v)/1000) + 'K' : Math.round(v));
const signedDollar    = v => (v < 0 ? '-' : '') + '$' + Math.round(Math.abs(v)/1000) + 'K';
const pctFormatter    = v => Math.round(v * 100) + '%';

// ── Revenue vs Expenses bar chart ────────────────────────────────────────
export function revExpConfig(labels, revData, expData) {
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Revenue',  data: revData, backgroundColor: PALETTE.forest,  borderRadius: 2, borderSkipped: false },
        { label: 'Expenses', data: expData, backgroundColor: PALETTE.oxblood, borderRadius: 2, borderSkipped: false },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + dollarFormatter(ctx.parsed.y) } } },
      scales: { ...baseScales(), y: { ...baseScales().y, ticks: { ...baseScales().y.ticks, callback: dollarFormatter } } }
    }
  };
}

// ── Division stacked revenue bar ─────────────────────────────────────────
export function divRevConfig(labels, divisions, dataByDiv) {
  return {
    type: 'bar',
    data: {
      labels,
      datasets: divisions.map((div, i) => ({
        label: div.name,
        data: dataByDiv[div.id] || [],
        backgroundColor: PALETTE.divColors[i % PALETTE.divColors.length],
        borderRadius: i === divisions.length - 1 ? 2 : 0,
        borderSkipped: false,
        stack: 'revenue',
      }))
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ' ' + ctx.dataset.label + ': ' + dollarFormatter(ctx.parsed.y) } }
      },
      scales: { ...baseScales(), y: { ...baseScales().y, stacked: true, ticks: { ...baseScales().y.ticks, callback: dollarFormatter } }, x: { ...baseScales().x, stacked: true } }
    }
  };
}

// ── Gross margin line ────────────────────────────────────────────────────
export function marginLineConfig(labels, gmData, nmData) {
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Gross margin', data: gmData, borderColor: PALETTE.forest, borderWidth: 2, pointRadius: 3, pointBackgroundColor: PALETTE.forest, tension: 0.3, fill: false },
        { label: 'Net margin',   data: nmData, borderColor: PALETTE.oxblood, borderWidth: 2, pointRadius: 3, pointBackgroundColor: PALETTE.oxblood, tension: 0.3, fill: false, borderDash: [4,3] },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + ctx.dataset.label + ': ' + pctFormatter(ctx.parsed.y) } } },
      scales: { ...baseScales(), y: { ...baseScales().y, ticks: { ...baseScales().y.ticks, callback: pctFormatter }, min: 0, max: 1 } }
    }
  };
}

// ── Expense donut ────────────────────────────────────────────────────────
export function expenseDonutConfig(labels, data) {
  return {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: [PALETTE.slate, PALETTE.oxblood, PALETTE.steel, PALETTE.teal, PALETTE.amber, PALETTE.forest, PALETTE.hair],
        borderWidth: 0,
        hoverOffset: 4,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ' ' + ctx.label + ': ' + dollarFormatter(ctx.parsed) } }
      }
    }
  };
}

// ── Cash position line ───────────────────────────────────────────────────
export function cashLineConfig(labels, cashData) {
  return {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Cash balance',
        data: cashData,
        borderColor: PALETTE.slate,
        borderWidth: 1.5,
        pointRadius: 3,
        pointBackgroundColor: PALETTE.slate,
        tension: 0.3,
        fill: true,
        backgroundColor: isDark() ? 'rgba(74,74,74,0.12)' : 'rgba(74,74,74,0.06)',
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + dollarFormatter(ctx.parsed.y) } } },
      scales: { ...baseScales(), y: { ...baseScales().y, ticks: { ...baseScales().y.ticks, callback: dollarFormatter } } }
    }
  };
}

// ── Inventory days-on-hand bar ───────────────────────────────────────────
export function inventoryBarConfig(labels, dohData, turnData) {
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Days on hand', data: dohData, backgroundColor: PALETTE.steel, borderRadius: 2, yAxisID: 'y' },
        { label: 'Turnover (annualized)', data: turnData, backgroundColor: PALETTE.amber, borderRadius: 2, yAxisID: 'y2' },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + ctx.dataset.label + ': ' + Math.round(ctx.parsed.y * 10) / 10 } } },
      scales: {
        ...baseScales(),
        y:  { ...baseScales().y, position: 'left',  title: { display: true, text: 'Days on hand', color: tickColor(), font: { size: 10 } } },
        y2: { ...baseScales().y, position: 'right', grid: { display: false }, title: { display: true, text: 'Turns / yr', color: tickColor(), font: { size: 10 } } }
      }
    }
  };
}

// ── AR aging stacked bar ──────────────────────────────────────────────────
export function arAgingConfig(labels, agingData) {
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Current (0–30)',  data: agingData.current, backgroundColor: PALETTE.forest, stack: 'ar' },
        { label: '31–60 days',      data: agingData.d31_60,  backgroundColor: PALETTE.amber,  stack: 'ar' },
        { label: '61–90 days',      data: agingData.d61_90,  backgroundColor: PALETTE.oxblood, stack: 'ar' },
        { label: 'Over 90 days',    data: agingData.over90,  backgroundColor: '#3a0a06', stack: 'ar' },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + ctx.dataset.label + ': ' + dollarFormatter(ctx.parsed.y) } } },
      scales: { ...baseScales(), y: { ...baseScales().y, stacked: true, ticks: { ...baseScales().y.ticks, callback: dollarFormatter } }, x: { ...baseScales().x, stacked: true } }
    }
  };
}

// ── Render helper — destroys previous instance safely ────────────────────
const _instances = {};
export function renderChart(id, config) {
  if (_instances[id]) { _instances[id].destroy(); }
  const ctx = document.getElementById(id);
  if (!ctx) return;
  _instances[id] = new Chart(ctx, config);
  return _instances[id];
}
