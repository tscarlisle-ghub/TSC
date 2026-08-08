# Fractional CFO Dashboard

A self-contained financial intelligence dashboard for micro-businesses ($500K–$5M revenue). Built to support the fractional CFO service model: clients enter their data, the dashboard produces the analysis, and the CFO team delivers the narrative.

No server required. No account. No data leaves the client's browser.

---

## What it does

- **Division-level P&L** — tracks revenue and expenses by profit stream, not just company-wide
- **Expense category analysis** — breaks costs into COGS, payroll, contractors, software, facilities, marketing, and other with fixed/variable flagging
- **Inventory analysis** — turnover rate, carrying cost, reorder alerts, dead stock identification
- **Cash runway modeling** — three scenarios (conservative, base, growth) updated live as data changes
- **Monthly trend view** — trailing 12-month sparklines for every key metric
- **Input forms with validation** — clear schema showing exactly what data the analysis requires
- **PDF export** — print any view to PDF for the monthly client package

---

## Deployment

### GitHub Pages (recommended)

```bash
git clone https://github.com/yourname/cfo-dashboard
cd cfo-dashboard
# No build step needed — open index.html directly or serve via Pages
```

Enable GitHub Pages on the repository (Settings → Pages → Deploy from branch → main).

The dashboard is then live at `https://yourname.github.io/cfo-dashboard`.

### Local

```bash
open index.html
```

Or serve locally to avoid any browser file-restriction issues:

```bash
npx serve .
# then open http://localhost:3000
```

---

## Data model

All data is stored in `localStorage` under the key `cfo_data`. The schema is documented in `data/schema.json`. To pre-load a client's data, populate the JSON and paste it into Settings → Import.

### Required inputs per month

| Section | Required fields |
|---|---|
| Company | Name, fiscal year start, divisions (1–8) |
| Revenue | Amount per division, new vs. recurring split |
| COGS | Direct cost per division |
| Expenses | Amount per category, fixed/variable flag |
| Payroll | Headcount, total payroll cost, contractor spend |
| Inventory | Units on hand, cost per unit, units sold this month |
| Cash | Opening bank balance, AR aging buckets |

### Optional enrichments

- Prior-year comparison figures (enables YoY view)
- Budget/target figures per line item (enables variance view)
- Individual SKU data (enables item-level inventory analysis)

---

## Architecture

```
cfo-dashboard/
  index.html        — single-page app, all tabs
  css/
    styles.css      — design system, layout, components
  js/
    data.js         — state management, localStorage, schema
    charts.js       — Chart.js configurations and helpers
    app.js          — tab routing, event handling, computed metrics
  data/
    schema.json     — documented input schema with types and descriptions
    sample.json     — fully populated sample dataset (Meridian Supply Co.)
```

---

## Design

The dashboard uses the same typographic and color system as the printed CFO report: Playfair Display for display figures, system sans-serif for labels and UI chrome, oxblood (`#74130c`) as the primary accent. The goal is that the screen dashboard and the printed monthly package feel like the same document.

---

## License

MIT. Use it, fork it, sell it to your clients.
