# CMA Construction Cost Estimator — Session Notes

A running log of instructions received from Scott and changes made.
Most recent at top.

> Going forward this file is `session-notes.md` (non-hidden) so it shows up in
> Finder. The old hidden copy `.session-notes.md` is left in place per Scott's
> instruction to never delete files without asking.

---

## 2026-04-29 — Pass 17: short, client-friendly share links via is.gd + mandatory project name

### Instructions
1. Make the project-name field **mandatory**.
2. The share link needs to be **way smaller** — client-friendly, not a
   150-character monstrosity.

### What changed
- **Mandatory project name**: `requireProjectName()` helper. Both the
  **Copy share link** and **Email to client** buttons now check for a
  non-empty `state.projectName` first. If empty:
  - The masthead input flashes red briefly (border-bottom + soft
    background pulse, animation runs twice).
  - The placeholder updates to "Add a project name first to share…".
  - Focus jumps to the input.
  - The button does nothing else.
- **URL shortener**: `getShortLink(longURL)` calls **is.gd** —
  `https://is.gd/create.php?format=simple&url=…` — free, no API key,
  CORS-friendly. Returns a ~20–25 char short URL like `https://is.gd/abc123`.
  - Both share buttons now run the long URL through this before copying /
    emailing. The button text shows "Shortening link…" while it's working.
  - **Graceful fallback**: if is.gd is unreachable or returns an unexpected
    response, falls back to the long URL silently. The Copy button label
    distinguishes ("Short link copied" vs. "Long link copied") so the user
    knows which they got.
  - Note: shortening only works when the page is served over http(s) (not
    `file://`) because is.gd requires a fetchable URL.

### Result
- Default-state share link: was ~5,100 chars, then ~990 with LZ-string,
  now **~24 characters** when the shortener is reachable. Fits in any
  email subject line, reads well in iMessage / SMS, easy to dictate over
  the phone if needed.
- The full long URL is still always present in the address bar and in
  localStorage as a permanent fallback. The shortener URL just **points** to
  it; the real state lives in the encoded URL we generate.

### One thing to know about is.gd
is.gd is a 16-year-old free shortener with strict TOS but very reliable.
Links don't expire. There's no auth. If they ever go down, the long URL
fallback keeps everything working — clients still get a functioning link,
just longer.

If Scott wants belt-and-suspenders later, the architecture lets us swap in
TinyURL or v.gd by editing the one fetch call in `getShortLink()`.

---

## 2026-04-29 — Pass 16: tiny share link (LZ-string + compact snapshot) + tier text −25%

### Instructions
1. "Can you make the link address smaller, like way smaller?"
2. "Make the text labels for the cost summary tier, $/sf, etc. 25% smaller and
   the same for the text for each tier including the titles."

### Share-link compression
- Embedded **LZ-string 1.4.4** (pieroxy, MIT) inline at the top of the script
  (~3 KB minified). No CDN dependency.
- `encodeStateForURL()` now uses `LZString.compressToEncodedURIComponent()`.
- `decodeStateFromURL()` tries LZ-string first, then falls back to the legacy
  base64 decode so any links Scott already shared keep working.
- Also **compacted the snapshot itself** before compression:
  - Top-level keys unchanged (already short).
  - Each room is now stored as `{ k, w, l, g, x?, c?, cond? }` instead of
    the verbose `{ tplKey, tplIndex, name, w, l, count, group, conditioned,
    removable }`. `name`, `defaultW/L`, `minW/L`, `isStair`, `removable` are
    all reconstructed from `TPL[k]` at load.
  - `c` (count) only present when > 1; `x` (tplIndex) only present when set;
    `cond` only present if it differs from the template's default.
- `applySnapshot()` accepts both the new compact format and the old verbose
  format (for backward compat with any existing share links).

### Size reduction (real measurement, full default house with project name)
| Stage | Length |
|---|---|
| Old base64 of full JSON | ~5,100 chars |
| LZ-string of full JSON | ~2,000 chars |
| **LZ-string of compact JSON** | **~990 chars** |

Roughly **80% smaller** vs. the old base64 link. Most share links should
now sit comfortably under 1 KB and fit in any URL bar / email client.

### Tier table −25%
- `th` (column headers): 19 → **14 px**
- Tier name: 25 → **19 px**
- $/sf primary: 23 → **17 px**
- "Under roof" small label: 14 → **10 px**
- "($X-$X conditioned)" line: 19 → **14 px**
- Tier base range: 23 → **17 px**
- Total w/ adjustments: 26 → **20 px**
- Cell padding 12 → 9 px to keep proportions tight.

---

### Pick-up at the office (refreshed for end-of-session)

Everything is in `TSC-SQF/` (Dropbox-synced):
- `index.html` — the tool (≈91 KB now, includes LZ-string)
- `README.md` — public, GitHub Pages-ready
- `.gitignore` — excludes private inputs, both session-notes files, sample xlsx
- `session-notes.md` ← this file (visible)
- `inputs/` — private bid PDFs and plan sets (gitignored)
- `SAMPLE- SPACE CALCULATIONS 2026.xlsx` — CMA reference (gitignored)
- The hidden `.session-notes.md` is left in place untouched

#### Workflow Scott can use today
1. Open `index.html` (or the GitHub Pages URL once deployed).
2. Type a project name in the masthead field (e.g. "Smith Residence").
3. Pick a finish-level tier in House Type — that cascades the matching
   defaults into Materials &amp; Finishes (walls, roof, interior, cabinets,
   landscape).
4. Adjust rooms (sliders or type W/L), modifiers, materials.
5. Click **Email to client** → a mail draft opens with the project name
   in the subject and the (now ~1 KB) share link in the body.
6. Client opens the link → exact configuration loads on their device.
7. They tweak, send back, etc. Scott can also **Copy share link** to
   paste anywhere, or **Export to Excel** for an editable workbook
   styled in Seaford with formula-driven SF totals.

#### Open follow-ups (not yet built)
- Construction contingency toggle (0% / 5% / 10%).
- Fireplaces (count + material — limestone surrounds at $5–12k each
  per Davis pricing).
- Window package as its own selector (separate from walls).
- Possible additions: HVAC tier, driveway type, outdoor kitchen,
  fencing/gates, smart home / AV.
- Free-text "Notes for Scott" field that travels with the share link.

#### Permanent rules in memory (apply across all projects)
- `feedback_session_notes.md` — keep `session-notes.md` updated after every
  change/instruction in every project workspace.
- `feedback_no_delete_without_asking.md` — never delete files without
  explicit approval, including hidden/leftover/obsolete-looking ones.
- `feedback_cma_design.md` — Tufte information-design principles for all
  CMA tools (cream paper, restrained color, Interstate Condensed for
  display, Trajan Sans for the firm wordmark).

---

## 2026-04-29 — Pass 15: per-client share links via project name + Email-to-client button

### Instruction
"Would it be possible to have a unique link I could send to each client?
Maybe I do a first pass, type in a client name and then create a link to send
them a unique version to play with."

Plus: "Write session notes as I am leaving to work and will pick it up there."

### What I added

#### Project name field
- New `state.projectName` (default `""`).
- New italic-serif text input in the masthead under the title:
  `<input id="projectName" placeholder="Project name (optional)…" maxlength=80>`.
- The value:
  - **Persists in localStorage** via `saveState()` on each keystroke.
  - **Persists in the share-link URL** via `syncStateToURL()` (so the link
    you copy or email already carries the project name; the recipient sees
    "Smith Residence" or whatever you typed when they open it).
  - Survives the round-trip in `applySnapshot()` on load.
  - Appears as a third title line in the **Excel export** (large italic,
    just under the firm name).

#### Email-to-client button
- New **Email to client** button at the front of the header actions.
- On click it:
  1. Calls `syncStateToURL()` to make sure the URL reflects current state.
  2. Reads `location.href` for the share link.
  3. Builds a `mailto:` URL with:
     - **Subject:** `<projectName> — Construction Cost Estimate · Carlisle Moore Architects`
       (skips the dash if no project name).
     - **Body:** A short, professional message that includes the share link
       and is signed "— Scott / Carlisle Moore Architects".
  4. Opens the user's default mail client with the draft pre-filled.
- The recipient just clicks the link in the email → lands on a copy of the
  estimator with that exact configuration loaded.

#### Per-client workflow
1. Open the estimator.
2. Type the client/project name in the masthead field
   (e.g., "Smith Residence — 4321 Vestavia Drive").
3. Configure the first pass (bedrooms, modifiers, finishes, rooms).
4. Click **Email to client** → mailto draft opens with subject + body
   pre-filled. Edit if you want, send.
5. Client receives the link, opens it, makes their own changes — none
   of those changes affect your local copy because they're loading from
   the URL, not from your localStorage.
6. They can click **Copy share link** or **Email to client** themselves
   to send their version back to you.

Each link is **already** unique by virtue of encoding the configuration
in `?s=...`. Adding the project name just labels it and makes the email
flow one-click instead of "compose, copy URL, paste."

---

### Where the project lives, for the office
- `index.html` (the tool, single file)
- `README.md` (public, for GitHub)
- `.gitignore` (excludes `inputs/`, both session-notes files, working
  template, OS noise)
- `session-notes.md` ← you're reading it; non-hidden. **The hidden
  `.session-notes.md` is left in place per "never delete files without
  asking"; it's frozen at pre-pass-12 and not updated anymore.**
- `inputs/` — private GC estimates and plan sets used to derive pricing
- `SAMPLE- SPACE CALCULATIONS 2026.xlsx` — CMA's reference template

### Current pricing model summary
- **Tiers** ($/sf under-roof): Normally Nice $315–$345 / Elevated $350–$390 /
  Very High $420–$465.
- **15% uplift** on summed conditioned room SF for walls + circulation.
- **Material adjustments** ($/U-R sf): walls (Normal $0 / Elevated +$6 /
  Very High +$14); roof (Asphalt $0 / Cedar +$15 / Slate +$28); interior
  (Normal $0 / Elevated +$15 / Very High +$35); cabinetry (Normal $0 /
  Elevated +$10 / Very High +$25).
- **Steep site %**: Flat 0% / Sloping 4% / Steep 8% — applied to
  (tier base + materials).
- **Flat adds** (NOT subject to steep): Pool $120,000 when on; Landscape
  $60k / $90k / $135k always added.
- **Garage**: 1-car 12'×24' / 2-car 24'×24' / 3-car 36'×24' — fixed,
  selected via segmented selector.
- **Stairs**: 5'×18' = 90 sf, may grow up to 5%.
- **Tier cascade**: picking a tier in House Type or via clicking a tier
  row cascades the matching defaults into Materials &amp; Finishes (user
  can still override individual selections after).

### Open follow-ups Scott liked but hasn't decided to add
- **Construction contingency** toggle (0% / 5% / 10%).
- **Fireplaces** count + material (limestone surrounds at $5–12k each).
- **Window package** as its own selector (separate from walls).
- HVAC tier, driveway type, outdoor kitchen, fencing, smart home / AV.
- Notes/free-text field that travels with the share link.

### Pick-up from the office
- The whole project is in `TSC-SQF/` in Dropbox so it follows you.
- This file is the canonical change log — most recent at top, so just read
  the top entry to see where we left off.
- All state is auto-saving to localStorage as Scott uses the tool, AND
  encoded in the URL — so any share link Scott has tried before will
  reproduce that exact config.

---

## 2026-04-29 — Pass 14: bolder labels, +20% sections, tier headers in Interstate Condensed Medium

### Instructions
1. Make all label headers ALL CAPS and bold everywhere; keep the size that
   Materials &amp; Finishes uses.
2. Make the section labels (House Type, Materials &amp; Finishes, Rooms,
   Cost Summary, etc.) ALL CAPS and 20% larger.
3. Make the tier table column headers (Tier, $/sf, Tier base range, etc.)
   ALL CAPS and 20% larger in **Interstate Condensed Medium**.

### Changes
- `.config-cell .label-line`: weight 600 → **700** (true bold), color
  `--ink-mute` → **`--ink`** (full ink). Already ALL CAPS at 11 px / 0.18em
  letter-spacing &mdash; size unchanged because Scott liked it.
- `h2.section`: 11 → **13 px** (~20% larger), weight 600 → 700. Stays ALL CAPS.
- `.cost-h2` override removed; "Cost Summary" now matches the other section
  headers (uppercase / 13 px).
- Tier table column headers (`table.tiers th`): 16 → **19 px** (~20% larger),
  weight 600 → **500 (Interstate Condensed Medium)**, color stays `--ink`,
  letter-spacing dialed to 0.14em for readability at the larger size.

### Plus: tier-cascade into Materials &amp; Finishes
Scott also asked: "When I make a selection on the Finish level in House Type,
change the selections to the appropriate tier on Materials &amp; Finishes."

Added a `TIER_PRESETS` map and an `applyTierPreset(tierKey)` function:

| Tier | Walls | Roof | Interior | Cabinetry | Landscape |
|---|---|---|---|---|---|
| Normally Nice | Normal   | Asphalt     | Normal   | Normal   | Normal   |
| Elevated      | Elevated | Cedar shake | Elevated | Elevated | Elevated |
| Very High     | Very High| Slate       | Very High| Very High| Very High|

`applyTierPreset` is now invoked from both the Finish-level segmented click
handler **and** the click-anywhere-on-a-tier-row handler in the cost summary,
so picking a tier in either place cascades the matching materials. After
cascading, `syncUIToState()` updates the segmented active states and the wall
description display refreshes. Pool stays out of the cascade (always a
separate decision).

Users can still override individual selections after picking a tier — the
cascade only fires on the actual tier selection event.

---

## 2026-04-29 — Pass 13: hide tier marker, bigger/caps/darker labels, Pool selector under Landscape, House Type spacing

### Instructions received (this batch)
1. Lose the little bar before the selected tier.
2. Make the tier, $/sf and other labels ALL CAPS, darker, and 25% larger.
3. Under landscape, add Pool as a selector and add $120k if selected.
4. Take Pool out of the Levels chips.
5. Put the same space between the House Type buttons as on Levels & Site
   (i.e., consistent spacing across the whole House Type row).
6. Update the index file.
7. Think about other things to add (suggestions in chat).

### Changes
- `.selected-marker` → `display: none`. The cream highlight + bold text
  carry the selection on their own.
- Tier table dialed up 25% with darker labels + caps:
  - Column header (`th`): 13 → 16 px, color `--ink-faint` → `--ink`,
    text-transform `none` → `uppercase`, weight 500 → 600.
  - Tier name: 20 → 25 px, weight 400 → 600, ALL CAPS, color `--ink`.
  - $/sf primary: 18 → 23 px.
  - "Under roof" label inside the psf cell: 13 → 14 px, ALL CAPS,
    color `--ink-faint` → `--ink`, weight 500 → 600.
  - "($X-$X conditioned)" sub-line: 15 → 19 px.
  - Tier base range: 18 → 23 px, color `--ink-mute` → `--ink`.
  - Total w/ adjustments: 21 → 26 px, weight 500 → 600.
- Pool moved out of the Levels chips. The "Levels & site" cell renamed
  back to just "Levels" with two chips: Two-story / Basement.
- New **Pool** selector added at the end of Materials & Finishes, right
  after Landscape. Two options: "No" (default) and "Yes (+$120k)". Wired
  to the existing `state.modifiers.pool` so all the calc / Excel / share-
  link / localStorage logic keeps working.
- House Type bar now uses a chip-style variant of the segmented buttons:
  no surrounding box, 8 px gap between buttons, individual borders. This
  gives Steep site and Finish level the same airy spacing as the Levels
  chips.

### Why I'd recommend a few more additions (chat reply)
Saved at end of this entry for future reference.

### Instructions received
1. Tier labels (Normally Nice etc.) **30% smaller**.
2. Put the selection for the various materials in two columns or a row so they
   take up less space vertically.
3. Make the cost summary text **Title Case** (drop the all-caps).
4. Remove the **Print PDF** button — the screen should print just like it
   looks (rely on the browser's native Print).
5. Make the **Excel export** more closely align with the on-screen layout —
   just room size cells (no sliders), but otherwise a close approximation.
6. Under the final total price, **change the descriptions based on any changes
   in the material selections above**.
7. **Never delete files without asking** (saved as a permanent rule across
   all projects in memory).

### Changes
- **Tier label** font-size: 28 → **20 px** (~30% smaller); `text-transform`
  switched from `uppercase` to `none`; letter-spacing softened.
- **Material text-list** is now a **row layout** (`flex-direction: row`) with
  a horizontal gap. The active option's description is rendered in a sibling
  `.opt-desc-display` element below the row — currently used by Walls, blank
  for the others. JS keeps it in sync.
- **Cost summary** uses Title Case throughout: section h2, tier table column
  headers, tier names, stat-row sub spans, grand-total label, and the
  "$/sf — Under roof" small label all drop their `text-transform: uppercase`.
- **Print button** removed from the header. Print stylesheet stripped down to
  just hiding the action buttons (Reset / Export / Share) so the on-screen
  layout prints as-is via the browser's native print dialog (Save as PDF
  still works there).
- **Excel export** rewritten as a single sheet "Estimate" that closely mirrors
  the screen:
  - Title rows: "Construction Cost Estimator" + "Carlisle Moore Architects"
    (large bold + smaller italic).
  - **House Type** label/value pairs.
  - **Materials & Finishes** label/value pairs.
  - **Rooms** by floor — each floor section has a heading, a column header
    row, and one data row per room. **W and L are editable cells** (no
    sliders), `SF Each = W*L` and `SF Total = Count*SF Each` are formulas.
    Each floor has a subtotal row (also formulas).
  - **Cost Summary** at the bottom: gross, +15% uplift, H&C, unconditioned,
    and total under roof — all formulas referencing the rooms range
    (SUMIF on the Conditioned column).
  - **Tier table** with formulas multiplying U-R total by the tier's
    $/sf and adding material adjustments + steep surcharge + pool +
    landscape.
  - Selected tier rendered in **sage green bold** (matches the screen).
  - **Grand total** range, with the **dynamic descriptor** (see below).
  - Adjustment notes at the bottom (material $/sf, steep %, pool, landscape).
  - Base font: **Seaford** throughout.
- **Dynamic descriptor under the grand total**:
  - New `buildSelectedDescriptor()` function. Generates a phrase from current
    material selections rather than the tier's static `sub`.
  - Format: `<walls description> · <roof> roof · <interior> interior finish ·
    <cabinetry> cabinetry · <landscape> landscape [· pool]`
  - Example: `Mix of brick or painted brick and wood siding · asphalt roof ·
    normal interior finish · normal cabinetry · normal landscape`
  - Updates live whenever a material selector changes.
  - Same descriptor is used in the Excel export.

### Permanent rule saved to memory
"Never delete files without asking" — applies to every project, every file
type (including hidden / leftover / obsolete-looking files). Even if a delete
seems beneficial (cleanup, replacing with a renamed copy), Claude must explain
the reason and ask the user before invoking any delete tool. Renames count as
deletions of the old name. Saved as `feedback_no_delete_without_asking.md`.

### Note on the hidden vs. visible session-notes file
- Scott rejected the request to delete `.session-notes.md` (the hidden one).
- Going forward, this file (`session-notes.md`, no leading dot) is the canonical
  log. The old hidden copy stays in place untouched and is no longer updated.
- `.gitignore` updated accordingly so neither file gets pushed to a public repo.

---

## 2026-04-29 — Pass 11: garage selector, pool, landscape, walls=N/E/VH, big tier-table refresh

### Instructions received (this batch)
1. Make stairs all one stair section (regardless of stories/basement).
2. Garage = car-count selector (1 / 2 / 3 car) + a separate Garage Storage room
   that the user can size with a slider.
3. Cabinetry/millwork: Normal / Elevated / Very High.
4. Interior finish level: Normal / Elevated / Very High.
5. Add a Pool toggle &mdash; flat **+$120,000** when on.
6. Add a Landscape selector &mdash; **$60k baseline** for Normal, then 50%
   incremental steps (Normal $60k / Elevated $90k / Very High $135k).
7. Take the descriptors out of the tier rows and put the selected tier's
   descriptor under the larger total price, ~20% larger than before.
8. More space between rooms columns.
9. Click in a W or L input → automatically select all the text.
10. On the selected tier, bold all the text.
11. Replace the &times; delete button with the word "DELETE" next to the room
    name, in small Interstate Condensed Light all caps.
12. Make the tier text all a little larger; use a condensed font for ALL the
    text in the tier table so it fits better.
13. Exterior walls &rarr; Normal / Elevated / Very High with descriptions:
    - Normal &mdash; mix of brick or painted brick and wood siding
    - Elevated &mdash; mix of reclaimed brick, some stone, and wood siding
    - Very High &mdash; mostly stone and reclaimed brick, limited wood siding
14. Show those descriptions below each option name.
15. Put the materials in two columns to take up less space.
16. If a default room is deleted, make it show up in the Add pulldown so it can
    be restored.

### What I changed

#### Data model
- **STAIR** stays at 5'&times;18' = 90 sf with a 5% growth cap. Now a single
  TPL entry (`stair`) added when either Two-story or Basement is on
  (instead of separate `stairUp` + `stairDown`).
- **GARAGE_BY_CAR** map: 1-car = 12'&times;24' = 288 sf, 2-car = 24'&times;24' = 576,
  3-car = 36'&times;24' = 864. State holds `state.garageCars` (default 2).
- **garageStorage** &mdash; new template (default 8'&times;10' = 80 sf), regular
  slider behavior. User can size or remove.
- **MATERIALS.walls** rebuilt to three options:
  - Normal &mdash; baseline ($0 / U-R sf), description above
  - Elevated &mdash; +$6 / U-R sf
  - Very High &mdash; +$14 / U-R sf
- **MATERIALS.interior** &amp; **cabinets** keys renamed to
  `normal / elevated / veryHigh` (was `standard/elevated/custom` and
  `standard/semi/full`). Same $/sf rates.
- **POOL_DOLLARS** = **$120,000** flat. Added when `state.modifiers.pool` is on.
- **LANDSCAPE_TIERS**: Normal $60,000 / Elevated $90,000 / Very High $135,000.
  Always added (default `state.landscape = "normal"`).
- Pool and Landscape are NOT subject to the steep-site % surcharge &mdash; they're
  flat dollar amounts added to the (tier base + materials) &times; (1 + steep)
  total.

#### Migration / safety
- `applySnapshot` (loadState) now maps any legacy material keys
  (`brick / painted / siding / reclaimed / stone / custom / semi / full`)
  to the new key set so existing share links and saved state still load.

#### UI
- Tier table:
  - All text now in **Interstate Condensed** (was a mix of mono and Helvetica).
  - Tier label 25 &rarr; 28 px; subtitle removed; column header 11 &rarr; 13 px;
    psf 16 &rarr; 18 px; range 16 &rarr; 18 px; total 17 &rarr; 21 px.
  - Selected tier: every cell goes **bold**.
  - Tier-row descriptor (the line under each tier name) is removed.
- **Grand total** below the table now shows the selected tier's descriptor
  in italic serif (~16 px) under the dollar range.
- **Walls** options each have a serif italic description below the label.
  Descriptions for Walls only; other selectors stay clean.
- **Materials &amp; Finishes** section uses an explicit 2-column grid; selectors
  pair up rather than auto-flow across the page.
- Material text-list reverted to **single column** (with the outer 2-col, this
  reads better and gives walls' descriptions room to breathe).
- Rooms grid column gap **36 &rarr; 64 px**.
- W and L inputs now **select all text on focus / click** so users can type
  immediately.
- Delete button replaced with the word "DELETE" in Interstate Condensed Light
  10 px small caps, placed next to the room name. Hover turns red.

#### Garage row rendering
- Special case in `renderRoomRow`: when `r.tplKey === "garage"`, render
  shows the SF + dimensions inline and a 1-car / 2-car / 3-car segmented
  selector instead of the slider + W/L inputs.

#### Restore deleted defaults from the Add menu
- The Add-to-floor dropdown now also surfaces any **deleted default singletons**
  for that floor, so the user can put back rooms they removed.
- Selecting one of those re-added items removes the deletion key and rebuilds,
  so the room comes back as a default (not a duplicate user-added entry).
- Excludes count-multiplier rooms (bedroom/bath/closet) and special rows
  (stair, garage, garage storage) from the recovery list.

---

## 2026-04-29 — Pass 10: materials labels match section title, 2-col options, bigger Add-room

### Instructions
1. Make the labels for Materials &amp; Finishes the same color as section titles.
2. Put the various materials/finishes in two columns per sub-section.
3. Make the Add-room text and boxes ~20% bigger.

### Changes
- `.config-cell .label-line` updated:
  - color: `--ink-faint` → `--ink-mute` (matches the section h2)
  - font-size: 10 → 11 px
  - font-weight: normal → 600 (matches section h2 weight)
  - letter-spacing: 0.16em → 0.18em (matches)
  - This affects every cell label in both the House Type and Materials &amp; Finishes
    sections.
- `.segmented.text-list` switched from a single column to a 2-column CSS grid
  (`grid-template-columns: 1fr 1fr`, `column-gap: 18px`).
  - Walls (5 options) lays out 3 + 2; Roof / Interior / Cabinetry (3 each) lay
    out 2 + 1.
- Add-room row bumped:
  - font-size: 11 → 13 px on label, select, and button
  - padding on select/button: 4×8 → 6×12 px
  - vertical spacing: margin-top 10 → 14, padding 6 → 8

---

## 2026-04-29 — Pass 9: cost-summary labels +20%, "High" → "Elevated"

### Instructions
1. Make the tier labels and other labels in the cost summary 20% larger.
2. Rename the middle tier from "High" to "Elevated" (Normally Nice / Elevated /
   Very High).

### Changes
- `TIERS.high.label`: "High" → "Elevated" (the data key stays `high` so existing
  saved state and shared URLs keep working).
- Finish-level segmented button label updated to match.
- Cost-summary type sizes bumped ~20%:
  - Tier name: 21 → 25 px
  - Tier subtitle: 11 → 13 px
  - Tier table column headers: 9 → 11 px
  - Tier `$/sf`: 13 → 16 px (with "Under roof" label 9 → 11; "conditioned" 11 → 13)
  - Tier base range: 13 → 16 px
  - Tier total w/ adjustments: 14 → 17 px
  - Stat row labels: 14 → 17 px (`.sub` 10 → 12)
  - Grand-total label: 10 → 12 px

Note: there are now two distinct selectors that surface "Elevated" — the
**Finish level** tier (Normally Nice / Elevated / Very High) and the
**Interior finish level** material option (Normal / Elevated / Custom).
That's per Scott's request; keep an eye on whether clients find it confusing.

---

## 2026-04-29 — Pass 8: README polish + .gitignore for GitHub

### Instruction
"Session notes and a readme files for github."

### What I did
- Rewrote `README.md` to be public-repo-ready:
  - Documented the share-link feature (Copy share link button, URL-encoded
    state, recipient-side load-from-URL behavior).
  - Added the click-to-select-tier behavior.
  - Removed specific client/project codenames from the pricing-data section
    (replaced with generic "recent CMA project bids covering multiple GCs").
  - Added a "Persistence and sharing" section explaining the three
    independent ways state is preserved (localStorage / URL / Excel).
  - File list now reflects only what should be in the public repo.
- Added `.gitignore` to keep private content out of any public repo:
  - `inputs/` (private GC estimates and plan sets)
  - `.session-notes.md` (internal change log; references private project names)
  - `SAMPLE- SPACE CALCULATIONS 2026.xlsx` (CMA's working template)
  - `derivation-notes.md`, OS/editor noise (`.DS_Store`, `node_modules/`, etc.)

### Public-repo manifest (what gets pushed)
- `index.html`
- `README.md`
- `.gitignore`

That's it. Everything else stays in the working folder for development
context but is excluded by `.gitignore`.

---

## 2026-04-29 — Pass 7: red back as primary accent, share link, click-to-select tier

### Instructions received
1. Keep red text everywhere except tier highlight + grand total — those stay green.
2. Tier labels and all headers in **ALL CAPS**.
3. Material selectors: drop the boxes. Just **vertical text list** with line spacing.
   Selected option goes **bold + colored**.
4. Don't use **bold** for tier text.
5. Still **two columns for the rooms** within each floor; floor sections still stack.
6. Build the **Copy share link** feature.
7. Selecting a tier (clicking a tier row in the cost summary) should **change the
   larger total** below.
8. Total square-footage numbers in the cost summary **~20% larger**, and **bold the
   total under-roof number** specifically.

### What I changed

#### Color
- Restored Tufte brick red (`#8b2818`) as the primary `--accent`. Used by floor
  headings, delete button, count multiplier, etc.
- Added a separate `--tier-accent` (sage green `#5a7548`) used **only** for:
  the selected tier row, the selected-tier marker, and the grand total figure.

#### Tier table
- Tier labels are now `text-transform: uppercase` with a wider letter-spacing.
- `font-weight: 400` on the tier label (no longer bold).
- Selected tier still highlighted with the cream `--highlight` background, but
  the tier name and `Total w/ adjustments` figure use the green tier-accent.
- **Click anywhere on a tier row** in the cost summary now selects that tier as
  the project's finish level — and the segmented Finish-level buttons sync
  visually. The grand total below updates immediately.

#### Material selectors → vertical text list
- The four selectors in **Materials &amp; Finishes** (Walls, Roof, Interior finish,
  Cabinetry &amp; millwork) now use a new `.text-list` style:
  - No box, no border, no background.
  - Each option on its own line with a small vertical gap.
  - Hover lifts the color from `--ink-mute` to `--ink`.
  - **Active option is bold and red** (the primary accent).
- The **House Type** section selectors (Bedrooms stepper, Levels chips, Steep
  site, Finish level) still use the boxed style for clear hierarchy.

#### Headers
- Floor heading names — uppercase (`1ST FLOOR`, `2ND FLOOR`, etc.).
- Section heads were already uppercase via the section-header style.

#### Cost summary numbers
- Stat-row values bumped from 14 → 17 px (~20% larger).
- The **Total under roof** row gets a dedicated `under-roof-total` modifier:
  19 px and bold; label is also semi-bold so the bottom-line summary number
  reads as the headline figure.

#### Rooms
- Reverted to **2 columns** within each floor section. Floor sections still
  stack vertically, so 1st Floor → 2nd Floor → Basement → Under Roof flow
  top-to-bottom but each floor's rooms balance left/right.

#### Share link
- New **"Copy share link"** button next to Print and Export.
- The URL silently updates to encode the full state (`?s=&lt;base64-url-safe&gt;`)
  using `history.replaceState` — no back-button clutter.
- Clicking the button copies the current URL to the clipboard and shows
  "Link copied" briefly. Falls back to `document.execCommand("copy")` on older
  browsers and to a `prompt()` if both fail.
- On boot, the URL takes precedence over `localStorage` — so a shared link
  always loads the shared configuration even if the recipient previously had
  their own state saved on that device.
- Reset clears both `localStorage` and the URL `?s=` parameter so a fresh
  reload returns to defaults.

### Why this is forgiving for clients
- **Same device, close + reopen:** localStorage restores. No save dialog.
- **Different device or sent to spouse:** Copy share link, paste anywhere. The
  receiving device loads the exact configuration from the URL.
- **iOS Safari 7-day localStorage eviction:** the URL itself is the permanent
  record. As long as they have the link bookmarked or in their email, the
  configuration is preserved.
- **Snapshot for the file:** Excel export remains for archival or numerical work.

---

## 2026-04-29 — Pass 6: 3-section reorg, persistence, exports, plan-aligned defaults

### Instructions received (in arrival order)
1. Show $/sf in $5 increments. Rename "Standard finishes" → **"Normally Nice"**.
2. Add an **Interior finish levels** selector under materials.
3. "Can you think of any other categories that would push the price needle?"
4. Reorganize into three sections: **House Type / Materials &amp; Finishes / Cost Summary**.
5. Firm name in **Trajan Sans Semibold**.
6. Create a **README** for GitHub.
7. **Excel export** without sliders but with input — use **Seaford** as the base font.
8. **Two-column rooms** with more space; 1st floor left, 2nd right, basement
   under 1st (later overridden — see below).
9. Material section spacing should match house-type spacing.
10. Take out **ceiling height** and the per-line material-change list under tiers.
11. **No italic sans-serif** fonts. Tier labels in **Interstate Condensed Bold**.
12. Subtitle text under each tier left-aligned with the tier name.
13. Add the **steep site** modifier (replaces simple Steep lot chip).
14. **8% steep-lot surcharge** with a tier selector (None / Sloping / Steep at 0/4/8%).
15. Use room sizes from `SAMPLE SPACE CALCULATIONS 2026.xlsx` as the starting point.
   Slider min = 20% smaller, slider max = 50% larger; user can type any value.
16. **Stairs**: 5'×18' is the min and starting point; can grow up to 5%.
17. Save data on website reload (**localStorage**).
18. **Print to PDF** option (browser print with custom print stylesheet).
19. **Override**: keep room breakouts stacked vertically (drop the 2-col floor layout).
20. Never use the phrase "**bonus room**".
21. On the 2nd floor, all bedrooms/baths/closets the same size — single row each
   with a **count multiplier**. Add **sitting room** and **playroom** as 2nd-floor defaults.
22. Footer text full-width and a little larger.
23. Tier highlighting and totals: **soft green** (sage), not red — friendlier.
24. Take out the word **"Standard"** anywhere — call it **"Normal"** instead.
   Sophisticated wealthy clientele; design for **quiet elegance**.
25. Save session notes at every change so Scott can pick up at the office.
   Apply the same notes-keeping habit to **all projects automatically**.

### Major changes implemented

#### Section reorg
- HTML now has three sections:
  - **House Type** — bedrooms stepper, Two-story / Basement chips, **Steep site**
    segmented (Flat &middot; Sloping &middot; Steep), Finish level (Normally Nice / High / Very High).
  - **Materials &amp; Finishes** — Exterior walls, Roof, Interior finish, Cabinetry &amp; millwork.
    (No ceiling height anymore.)
  - **Cost Summary** with Reset / Print / Export-to-Excel actions inline.

#### Steep site
- Replaced the binary chip with a 3-tier segmented selector backed by `STEEP_TIERS`:
  Flat / mild = **0%**, Sloping = **4%**, Steep = **8%**. Surcharge applies to
  (tier base + materials) before the grand total.

#### Pricing tiers — under-roof baseline
- Tiers expressed as **$/sf under roof** (the contractor metric in the SAMPLE
  spreadsheet). Conditioned $/sf is derived (`base ÷ H&amp;C SF`).
  - Normally Nice: $315–$345 U-R  (≈ $381–$418 conditioned at Young scale)
  - High: $350–$390
  - Very High: $420–$465
- All endpoints are clean **$5 increments**.

#### Material additions
- Interior finish: **Normal / Elevated / Custom** (+$0 / +$15 / +$35 per U-R sf)
- Cabinetry &amp; millwork: **Normal / Semi-custom / Fully custom** (+$0 / +$10 / +$25)
- "Standard" label replaced with "**Normal**" throughout. Material keys renamed
  from `standard` to `normal` for consistency.
- Removed the "Material adjustments" line list under the tier table — now the
  tier table's `Total w/ adjustments` column is the only place adjustments surface.

#### Room defaults — re-aligned to SAMPLE SPACE CALCULATIONS
| Room | New default (W × L) | Source |
|---|---|---|
| Entry / Foyer | 5' × 8' | small foyer convention |
| Kitchen | 16' × 18' | SAMPLE |
| Pantry | 5' × 8' | SAMPLE |
| Dining Room | 12' × 16' | SAMPLE |
| Living Room | 20' × 24' | SAMPLE |
| Sitting Room (1st) | 14' × 14' | SAMPLE 1st-floor sitting |
| Study / Office | 12' × 14' | typical CMA |
| Mudroom | 6' × 8' | SAMPLE |
| Powder Room | 3' × 7' | SAMPLE |
| Laundry | 12' × 12' | SAMPLE 2nd-floor laundry |
| Primary Bedroom | 14' × 16' | SAMPLE |
| Primary Bath | 7' × 16' | split from SAMPLE 14×16 combined |
| Primary Closet | 7' × 16' | split from SAMPLE 14×16 combined |
| Bedroom (each) | 12' × 14' | SAMPLE bedroom average |
| Bath (each) | 5' × 10' | split from SAMPLE 5×15 combined |
| Closet (each) | 5' × 5' | split from SAMPLE 5×15 combined |
| Sitting Room (2nd) | 12' × 12' | SAMPLE |
| Playroom (2nd default) | 14' × 16' | typical CMA upstairs |
| Stair to 2nd floor | 5' × 18' = 90 sf | SAMPLE stair |
| Stair to basement  | 5' × 18' = 90 sf | (added when basement modifier on) |
| Basement Storage | 30' × 30' | SAMPLE |
| Basement Media | 16' × 16' | SAMPLE |
| Garage | 24' × 24' | SAMPLE |
| Front Porch | 10' × 20' | split from SAMPLE 20×24 combined |
| Rear Porch | 14' × 20' | split from SAMPLE 20×24 combined |

#### Bedroom count multiplier
- Secondary bedrooms / baths / closets are now stored as a **single row** with
  a `count` multiplier instead of N triplet rows. Display shows
  `Bedroom × 3` with `504 sf  (168 ea.)`.
- Applies on both 1st floor (downstairs extras) and 2nd floor (upstairs extras).
- Slider/typed dimensions affect the per-room W/L; `count` multiplies for totals.

#### Stair behavior
- Stairs are no longer truly fixed — they adjust within a tight band:
  cannot shrink below 5'×18'; cap at 5% growth per axis.
- Stair displayed as a normal room row (not the "fixed" pill).

#### Slider bounds
- Non-stair rooms: slider min = 20% smaller than starting SF, max = 50% larger.
  User can still TYPE values outside the slider range — only `minW`/`minL` are
  hard floors.
- Stairs: slider min = starting SF, max = +5%.

#### Typography &amp; color
- Added **Trajan Sans Semibold** for the firm wordmark (via Typekit kit `ikf0hkb`).
- **Interstate Condensed Bold** (not italic) for tier labels and floor headings.
- All italic sans-serif removed — italics only used on serif (footer, room
  unheated tag).
- Accent color flipped from Tufte brick red to **soft sage green** (`#5a7548`).
  Lighter sage `#a3b598` for muted accent. Friendlier feel for the wealthy
  client audience.
- Floor heading totals are now **larger** (~50% bump) — same size as the
  floor name for visual balance.
- Room name, SF, and dim inputs all bumped up a step (16/15/14px).
- Footer goes full-width (no max-width) and bumps from 12 to 14px.

#### Layout
- Floors stack vertically (single column). The 2-col plan was rolled back
  per Scott's clarification.
- Section spacing: configuration grid gap increased to 22px × 36px so
  selectors breathe.

#### Persistence + outputs
- **localStorage**: every state change saves a snapshot (`cma-cost-estimator-v1`).
  Page reload restores the last state. **Reset** button clears it.
- **Print &middot; PDF**: `window.print()` with a `@media print` stylesheet that hides
  sliders, segmented buttons (only active option shows), add-room rows, and
  delete buttons. Choose "Save as PDF" in the OS print dialog.
- **Export to Excel**: uses ExcelJS 4.4.0 from cdnjs (loaded on first click).
  Three sheets — Setup, Rooms (editable W/L with formulas for SF and totals),
  and Costs (formulas referencing Rooms). All cells styled with **Seaford**
  as the base font (size 11, with bold size 14 for headers).

#### README
- Added `README.md` covering: what the tool does, GitHub Pages deployment,
  persistence behavior, outputs, pricing data origins, dependencies, file list.

### Vocabulary
- **"Bonus room"** is removed everywhere. Replaced with **Playroom** (2nd-floor
  default) and the existing room palette.
- **"Standard"** is removed from option labels — replaced with **"Normal"**.

### Open follow-ups
- The Typekit kit `ikf0hkb` is assumed to include both **Interstate Condensed**
  and **Trajan Sans Pro**. If those aren't currently in the kit, add them in
  the Adobe Fonts kit editor; the CSS will pick them up automatically.
- Other cost-driver categories I considered but didn't add (could layer in if
  it'd help close conversations): HVAC system tier (geothermal vs standard),
  appliance package, smart home / AV, fireplaces (count + material), site work
  beyond steep-lot, pools / outdoor kitchens.

### Cross-project habit (now in memory)
Updated the saved feedback to apply session-notes upkeep to **every** project
workspace, not only CMA. On every new session in any folder, I now check for
`.session-notes.md` and create/update it as part of the deliverable so Scott
can pick up wherever the last session left off, on whichever machine he's on.

---

## 2026-04-28 — Pass 5: pricing-model flip + UX overhaul

### Instructions received
1. Show $/sf in $5 increments.
2. Rename "Standard finishes" → **"Normally Nice"**.
3. Under the material selector, add an **Interior finish levels** selector.
4. "Can you think of any other categories that would push the overall price needle?"
5. **Under-roof is the primary number** — the bidders price by under-roof
   (matching `SAMPLE- SPACE CALCULATIONS 2026.xlsx`). H&C $/sf should be
   *derived* (total ÷ H&C SF), not the baseline.
6. Display tier $/sf as: `$315–$345 Under roof` with `($XXX–$XXX conditioned)`
   underneath. Tier names a little larger.
7. **Two-column rooms layout.**
8. **Display dimensions in whole feet** ("14'") — drop inches.
9. Tier names in **Interstate italic** via Typekit kit `ikf0hkb`.

### What I did

#### Pricing model
- Flipped the calculation: tier ranges are now `$/under-roof SF`, applied to
  total under-roof. H&C $/sf is computed as `(tier base ÷ H&C SF)` and shown
  as a derived figure in parens.
- Tier ranges (all $5-aligned, derived from the Young/Ray/Taylor multi-bid spreads):
  - **Normally Nice**: **$315–$345** Under roof  (≈ $381–$418 conditioned at Young scale)
  - **High**:          **$350–$390** Under roof  (≈ $424–$472 conditioned)
  - **Very High**:     **$420–$465** Under roof  (≈ $508–$563 conditioned)
- Sanity check vs. Young (7,797 U-R / 6,441 H&C):
  - Normally Nice → $2.46M–$2.69M  ✓ matches Fante $2.40M / Mimikakis $2.48M
  - High          → $2.73M–$3.04M  ✓ matches Robert Fry $3.03M
  - Very High     → $3.27M–$3.63M  ✓ matches Taylor-scope bids $3.5–3.7M

#### New cost-driving categories added
The tool now has **5 selectors** beyond walls/roof:
- **Exterior walls**: Painted brick / Wood siding / Brick / Reclaimed brick / Stone
- **Roof**: Asphalt / Cedar shake / Slate
- **Interior finish level**: Standard / Elevated (+$15/U-R sf) / Custom (+$35)
- **Cabinetry & millwork**: Standard / Semi-custom (+$10) / Fully custom (+$25)
- **Ceiling height**: 9' / 10' (+$8) / 11'+ (+$18)

#### Other categories I considered (not added — happy to add any of these)
- HVAC system tier (standard / high-eff variable / geothermal) — ~$5–$15/U-R sf delta
- Smart home / AV (none / standard / extensive) — typically lump-sum
- Appliance package (standard / pro / luxury) — pure allowance
- Window/door package (clad standard / steel windows / mahogany) — separate from walls
- Site work depth (driveway length, retaining beyond steep-lot, hardscapes)
- Pools, hot tubs, outdoor kitchens — usually quoted separately
- Fireplaces (count and material) — Davis pricing showed limestone surrounds at ~$5–12k each
- Garage size beyond 2-car (already a slider, but could be a quick toggle)

#### UI changes
- **Tier names now in Interstate italic** via Typekit (`https://use.typekit.net/ikf0hkb.css`),
  ~19px and slightly looser line-height. Subtitle stays in small-caps Helvetica.
- **Tier $/sf cell** shows the under-roof range as the primary number with a
  small `Under roof` label, and the derived `($X-$X conditioned)` underneath.
- **Rooms in 2 columns**: each floor section uses a CSS grid
  (`grid-template-columns: repeat(2, 1fr)`) of room cards. Each card has the
  name + SF on the top line and slider + W × L inputs below. Falls back to one
  column on screens narrower than 760 px.
- **Dimensions in whole feet only**: `snap1` rounds to the nearest foot;
  `fmtFt` displays "14'" with no inch portion. The W and L inputs still tolerate
  pasted values like `14'-6"` or `14-6` and round on commit.
- Stair updated to **8' × 11' = 88 sf** (whole-foot snap of the previous
  switchback assumption).

---

## 2026-04-28 — Pass 4: lighter active-button color

### Instruction
"Make the background color on the selections and configuration buttons lighter
— make the same color but slightly darker than the darker color at cost range."

### What I did
- Added a new CSS variable `--btn-active: #e8e3cc` — same cream/tan family as
  the cost-range row highlight (`--highlight: #f6f4e8`), one step darker.
- Switched `.segmented button.active` (Finish level, Walls, Roof) from
  `background: var(--ink); color: var(--paper)` to
  `background: var(--btn-active); color: var(--ink)`.
- Switched `.chip.active` (Two-story / Basement / Steep lot modifiers)
  similarly, with a soft `--ink-faint` border instead of the hard ink border.
- Net effect: the configuration row no longer has heavy black blocks — active
  states read as a quiet cream wash that's clearly differentiated from
  inactive but stays in the Tufte palette.

---

## 2026-04-28 — Pass 3: room defaults rebuilt from CMA plan sets

### Instructions received
1. "Review the PDFs and update everything; be sure to write session notes after every change."
2. "If I put a few PDF sets in the intake folder can you figure out some standard
   room sizes to start with."

### What I did
- Parsed the 7 newly added PDFs in `inputs/`:
  - `Young - A2.1-FIRST FLOOR PLAN.pdf` & `Young - A2.2-SECOND FLOOR PLAN.pdf`
  - `YOUNG RESIDENCE - PRICING SET.pdf`
  - `DAVIS PLANS 7-29-25.pdf` & `Davis - Pricing 08-21-25.pdf`
  - `PRICING SET - RAY.pdf`
  - `Stratas Proof of Concept drawings.pdf` & `Stratas - initial pricing 04-24-23.pdf`
- Pulled **Area Calculations** tables and individual room dimensions where extractable.

### Plan-derived area data

| Project | 1st Floor | 2nd Floor | Bonus | Basement | Total Cond | Garage | Porches | Total Framed |
|---------|-----------|-----------|-------|----------|------------|--------|---------|--------------|
| Young | 3,134 | 2,480 | 827 | — | 6,441 | 965 | 391 | 7,797 |
| Davis (no bsmt) | 4,334 | 1,773 | 652 | — | 6,759 | 1,380 | 448 | 8,587 |
| Davis (w/ bsmt) | 4,334 | 1,773 | 652 | 1,482 | 8,241 | 1,380 | 448 | 10,069 |
| Stratas | 2,960 | 2,280 | — | — | 5,240 | 343 | 391 | 5,974 |
| Ray | — | — | — | — | ~5,099 | — | — | — |

### Default room sizes recalibrated to match CMA plan patterns
- Added **Hearth Room (14×16)** as a 1st-floor default (present in Young & Davis plans).
- Added **Study / Office (12×14)** as a 1st-floor default (present in Young plan).
- Split the previously combined "Primary Bath / Closet" into two separate rooms:
  - **Primary Bath: 10'×16'** (160 sf)
  - **Primary Closet: 8'×12'** (96 sf)
- Tweaked: Kitchen 16'×22' (was 16'×20'), Pantry 5'×9', Dining 12'×18', Living/Great
  Room 20'×22', Mudroom 6'×12', Powder 5'×6', Laundry 8'×12'.
- Reduced typical secondary bedroom set: Bedroom 12'×14', Bath 6'×10', Closet 6'×8'.

### Default 4BR/2-story now lands at
- Conditioned gross: 3,179 sf
- + 15% walls/circulation: 477 sf
- = H&C net: 3,656 sf
- Unconditioned: 928 sf (garage + porches)
- Total under-roof: 4,584 sf
- Normal-tier total: ~$1.15M – $1.26M

(Real CMA projects run 5,000–8,000 H&C — defaults are deliberately on the modest
end so clients see the entry point and use sliders to scale up.)

### Default-room deletion behavior
- All non-fixed rooms (everything except stairs) are now removable.
- Deletions persist across bedroom/modifier changes via a `deletedKeys` set in
  state — won't pop back when count changes.
- User-added rooms get a unique tplIndex so they never collide with the
  default-room keys.

---

## 2026-04-28 — Pass 2: major rebuild from feedback

### Instructions received
Scott's feature list:
1. Slider plus typeable W/L per room.
2. Sizes in 6-inch increments, displayed as `x'-x"`.
3. Stairs: assume 11' floor-to-floor, 4' wide, switchback, 4' deep landing —
   make it a fixed number; only include for 2-story or basement houses.
4. Drop "Lake house" type.
5. Drop "Windows" material selection.
6. Expand the cost-range section, make it wider, move it above the rooms.
7. Show the 15% wall thickness / circulation uplift transparently in the totals.
8. Allow adding rooms to each floor (1st, 2nd, basement, unheated).
9. Exterior walls: add **Painted brick** (less expensive) and **Reclaimed brick**
   (more than baseline brick) alongside existing options.
10. Add a **Steep lot** modifier — 5% surcharge to cover deeper foundations,
    retaining walls, added site work.

### Implementation
- **Layout:** single-column. Configuration bar at top, expanded cost summary
  below it (gross → +15% → net → unconditioned → under-roof; tier table with
  base range and total-with-adjustments columns), then rooms organized by floor.
- **Stairs:** fixed at 8'×10'-6" (84 sf, conditioned). One stair if `twoStory`,
  one if `basement`, two if both. Tagged "fixed" — no slider, no W/L inputs.
- **Per-room W & L inputs:** text inputs accepting `14'-6"`, `14-6`, `14.5`, or
  just `14`. Snapped to 6" (0.5 ft) on commit. Slider scales W & L
  proportionally; typing W or L changes only that axis.
- **Material set updated:**
  - Walls: Painted brick **−$3/sf**, Wood siding **−$5/sf**, Brick (baseline),
    Reclaimed brick **+$6/sf**, Stone **+$14/sf**.
  - Roof: Asphalt (baseline), Cedar shake **+$15/sf**, Slate **+$28/sf**.
  - Windows option removed.
- **Steep lot:** 5% surcharge applied after material adjustments. Shown as a
  transparent line item in the breakdown.

### Note on intake folder
Confirmed I can extract room sizes from architectural PDFs — easiest when a
sheet has a room schedule or area-calc table; floor-plan-only sets work but are
slower. Suggested Scott drop them into `inputs/` (or similar) and tell me when.

---

## 2026-04-28 — Pass 1: initial build

(See earlier entries below — bid data extraction, tier derivation, first-pass
build with two-column layout, default room set tuning to ~3,150 H&C for 4BR
2-story.)

### Bid data baseline (unchanged in pass 2 & 3)

| Project | Bidder | Total | H&C | Framed | $/H&C |
|---|---|---|---|---|---|
| Young | Thornton | $2,196,000 | 6,441 | 7,797 | $341 |
| Young | Fante | $2,404,415 | 6,441 | 7,797 | $373 |
| Young | Mimikakis | $2,484,134 | 6,441 | 7,797 | $386 |
| Young | Robert Fry | $3,028,430 | 6,441 | 7,797 | $470 |
| Ray | Davis | $2,333,650 | 5,099 | — | $458 |
| Ray | McGuire | $2,359,298 | 5,099 | — | $463 |
| Ray | TCC | $2,338,790 | 5,099 | — | $459 |
| Taylor | McGuire | $3,492,026 | — | — | — |
| Taylor | Taylor 3.14.25 | $3,643,503 | — | — | — |
| Taylor (w/ pool) | Daystar | $3,667,230 | — | — | — |
| Taylor (w/ shop+pool) | Mimikakis | $4,477,779 | — | — | — |

### Tier ranges baked into the tool ($/H&C SF)
- Normal:    $315 – $345 — asphalt + standard finishes
- High:      $350 – $390 — cedar shake + nice finishes
- Very High: $440 – $485 — premium cedar or slate + custom

### Files in `TSC-SQF/`
- `index.html` — single-file estimator, GitHub Pages-ready
- `inputs/` — source estimate PDFs, plan sheets, and pricing-set drawings
- `SAMPLE- SPACE CALCULATIONS 2026.xlsx` — original room logic reference
- `.session-notes.md` — this file

### Open follow-ups
- Confirm tier numbers feel right after Scott uses the tool with real prospects.
- Mimikakis-Taylor and pre-pool Taylor projects didn't have firm SF in the
  bids; if Scott pulls SF from the Taylor plan set (when available) we can
  tighten the Very High tier upper bound.
- If desired, add a "save / share" feature so clients can email a snapshot
  of their configuration back to CMA.
