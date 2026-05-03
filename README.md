# Conceptual Cost Estimator
### Carlisle Moore Architects &mdash; preliminary scope &amp; budget

A single-file, client-facing cost estimator for CMA's custom residential
projects in the Birmingham, Alabama market. Configures a project by bedroom
count, floor structure, finish level, and material selections, and shows
preliminary cost ranges across three tiers in real time.

No build step. No server. One self-contained HTML file.

---

## Quick start

Open `index.html` directly in any browser, or deploy via **GitHub Pages**:

1. Create a public repo with `index.html` (and this `README.md`).
2. In the repo's **Settings &rarr; Pages**, set the source to your default
   branch and the `/` (root) folder. Save.
3. The tool will be available at
   `https://<your-username>.github.io/<repo-name>/`.

---

## What it does

- **Bedroom stepper** auto-populates a room list using CMA's standard
  `SAMPLE SPACE CALCULATIONS` template as the starting point.
- **Per-room sliders** ranging from 20% smaller to 50% larger than the
  starting size, plus typeable W and L inputs in whole-foot increments.
  Type any value to override the slider range.
- **Stairs** assume a 5'&times;18' switchback with an 11' floor-to-floor
  height; can grow up to 5%, can't shrink.
- **House type modifiers** &mdash; Two-story, Basement, and a three-tier
  Steep-site selector (Flat / Sloping / Steep &rarr; 0% / 4% / 8% surcharge).
- **Material selections**:
  - Exterior walls &mdash; Painted brick, Wood siding, Brick, Reclaimed brick, Stone
  - Roof &mdash; Asphalt, Cedar shake, Slate
  - Interior finish level &mdash; Normal, Elevated, Custom
  - Cabinetry &amp; millwork &mdash; Normal, Semi-custom, Fully custom
- **Three-tier cost summary** &mdash; Normally Nice / High / Very High &mdash;
  showing all three simultaneously. Click any tier row to select it as the
  project tier; the bottom-line total updates immediately.

The under-roof $/sf is the contractor pricing baseline; conditioned $/sf is
shown as a derived figure. A 15% uplift on summed conditioned room SF
accounts for wall thicknesses and miscellaneous circulation, matching CMA's
standard area-calculation method.

| Tier | $/sf under roof |
|---|---|
| Normally Nice | $315 &ndash; $345 |
| High | $350 &ndash; $390 |
| Very High | $420 &ndash; $465 |

---

## Persistence and sharing

The tool has three independent ways to preserve a configuration:

**1. Auto-save (this device).** Every change writes to the browser's
`localStorage`. Close the window, come back tomorrow on the same device, and
your configuration is restored. The **Reset** button clears it.

**2. Share link (any device).** As you change anything, the page URL silently
updates to encode the full configuration. Click **Copy share link** to grab
that URL. Email it, text it, paste it on another device &mdash; the receiving
browser loads the exact configuration from the URL itself, with no prior
state required. The shared link wins over local state, so a recipient always
sees what you sent.

**3. Excel snapshot.** **Export to Excel** downloads a `.xlsx` workbook with
three sheets: Setup, Rooms (with editable W/L cells and formulas), and Costs
(formulas referencing the Rooms sheet). Styled with the Seaford font as the
base.

iOS Safari clears `localStorage` on sites unvisited for ~7 days &mdash; the share
link doubles as a permanent bookmark to defend against this.

---

## Outputs

- **Copy share link** &mdash; URL-encoded snapshot, copies to clipboard.
- **Print &middot; PDF** &mdash; opens the browser print dialog with a custom print
  stylesheet that hides sliders, segmented buttons (only the active option
  prints), and add-room rows. Choose &ldquo;Save as PDF.&rdquo;
- **Export to Excel** &mdash; downloads `CMA-Cost-Estimate.xlsx`.
- **Reset** &mdash; clears `localStorage` and the share-link URL parameter, then
  reloads to defaults.

---

## Tuning the pricing

Tier ranges and material adjustments live in the `TIERS` and `MATERIALS`
blocks at the top of the `<script>` in `index.html`. Single source of truth.
Numbers are derived from recent CMA project bids covering multiple GCs per
project. Figures reflect construction cost only &mdash; no land, design fees,
pools, landscaping, furnishings, or sales tax.

---

## Dependencies

- **Adobe Typekit** kit `ikf0hkb` &mdash; used for Interstate Condensed (tier
  labels, floor headings) and Trajan Sans (firm wordmark).
  Confirm both fonts are added to the kit in the Adobe Fonts kit editor.
- **ExcelJS 4.4.0** via cdnjs &mdash; loaded on demand only when
  &ldquo;Export to Excel&rdquo; is clicked.

No other JavaScript libraries. The tool runs offline once loaded (the
Typekit and Excel CDNs are only needed for fonts and the Excel export).

---

## Files

| File | Description |
|---|---|
| `index.html` | The tool. HTML + CSS + JS in one file. |
| `README.md` | This file. |
| `.gitignore` | Keeps private project files out of the repo. |

The repo's `.gitignore` excludes the `inputs/` folder (private GC estimates),
`.session-notes.md` (internal change log), and CMA's working sample
spreadsheet. Those live in the working folder for development context but
should not be pushed to a public repo.

---

## License

&copy; Carlisle Moore Architects, Inc. All rights reserved.
