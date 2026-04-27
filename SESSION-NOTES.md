# TSC-PR — Session Notes
*Last updated: April 27, 2026*

---

## Where things stand

The app is now a single-file standalone web application (`index.html`, ~1,400 lines) with:

- **Intake form** — proposal type, project name, client + address, square footage, budget, project description, phases, fee structure (lump / % / POC fixed / hourly with per-mode subforms), timeline, free-form notes.
- **Tone sliders** — three calibrated axes (Formal↔Casual, Detailed↔Concise, Technical↔Accessible). Center = the firm's typical voice across the ten reference proposals.
- **Generation** — direct browser-to-Anthropic call (`anthropic-dangerous-direct-browser-access`), structured JSON output that maps 1:1 from on-screen rendering to Word export.
- **Lock + regenerate** — click any paragraph to mark it kept; regenerate preserves locked sections verbatim and rewrites the rest.
- **Version history** — every Generate/Regenerate produces a new version, persisted locally and to GitHub.
- **GitHub persistence** — fine-grained PAT, REST contents API, debounced 1.5s save. Each proposal is `data/proposals/<id>.json`; an `_index.json` lets the Open dialog list everything.
- **Word export** — docx.js (UMD) builds a .docx matching the Ouellette format: TradeGothic Bold heads, Surveyor Text Light body, US Letter with 2.25" left letterhead margin, footer with the firm contact line, TERMS appended on a new page for full proposals.
- **Tufte-aligned design** — paper-and-ink palette, EB Garamond body, sans for chrome, hairline rules, single navy accent, single amber for locked sections, margin notes on the empty state.

The previous v1 is preserved as `index.v1.html.bak`. The old `CMA-Proposal-Studio.html` file remains in the folder.

---

## Repo layout

```
TSC-PR/                              ← rename when you push to GitHub
├── index.html                       ← the app
├── README.md
├── SESSION-NOTES.md                 ← this file
├── .gitignore                       ← ignores inputs/, OS junk
├── data/
│   └── proposals/
│       ├── _index.json              ← updated on every save
│       └── <id>.json                ← created on first save
├── inputs/                          ← GIT-IGNORED, never commit
└── index.v1.html.bak                ← previous version, can delete after verifying v2
```

---

## First-run setup checklist

1. **Open settings** (top-right link). Add:
   - Anthropic API key (paste, click Save settings)
   - GitHub PAT, owner, repo, branch (optional but recommended)
2. **Push to GitHub** as `TSC-PR` (private).
3. **Enable Pages** on the repo (Settings → Pages → Deploy from branch `main` / `/`).
4. **Generate a test proposal** to verify the round trip end-to-end.

---

## Voice + structure source

Trained on ten finished proposals: Ballagas, Callahan (barn), Clikas, Davis, Fields, Ford, Ouellette (remodel), Sanders, Weil (pool house), Young — plus email excerpts and the CMA Design Process iPad PDF.

Two structural variants are supported:

- **Full Architectural Services** — header → opening → scope of work → deliverables (SD/CD/Notes blocks) → timeline (optional) → compensation structure → closing → signature → TERMS (Articles 1–7, appended verbatim).
- **Proof of Concept** — header → brief opening → scope of work → process → fee → closing → signature (no TERMS).

Boilerplate is hardcoded in the app (verbatim from the corpus) and supplied to Claude in the prompt: opening line, SD description, CD description + drawing list, Notes on Deliverables, Final Pricing Set + termination clauses, closing thanks + closing question, signature, and the seven TERMS articles. The model is instructed not to paraphrase boilerplate.

---

## Voice patterns the model honors

- Opens with **"Thank you for considering our firm."**
- Lowercase H2 headings: *scope of work*, *deliverables*, *timeline*, *compensation structure*, *process*, *fee*.
- Salutation uses first names with a colon: *"Michael & Julie:"*.
- Money formatted as `$50,000`.
- Phase names capitalized: Schematic Design, Construction Drawings, Construction Administration.
- Closes with *"...please feel free to give either of us a call."*
- Signs *Regards, / T. Scott Carlisle / For the Firm*.
- Mentions *"Final Pricing Set"* → *"For Construction Set"* on final payment.

---

## What's next

- [ ] Verify Word export round-trip on a real proposal — confirm fonts substitute cleanly when TradeGothic / Surveyor aren't installed.
- [ ] Header logo embedded in the .docx (currently the docx export sets the letterhead margin and footer but does not embed the logo image — Word will leave the header area blank). If wanted, add an image upload in settings or commit a `assets/logo.png` and wire it into the docx Header.
- [ ] Compare-versions view — diff between two versions in the right rail.
- [ ] Client address book — autocomplete in the intake form, populated from previously generated proposals.
- [ ] Surveyor / TradeGothic font embedding in the .docx (requires base64 font file + a styles.xml hack — only worth doing if recipients without the fonts get bad substitutions).

---

## Architectural decisions worth remembering

- **Single-file HTML.** No build step. CDN-loaded `docx@8.5.0` and `file-saver@2.0.5`. Vanilla JS state — no framework.
- **Direct browser-to-Anthropic calls.** Uses the `anthropic-dangerous-direct-browser-access: true` header. The API key never leaves the user's browser.
- **GitHub REST contents API for persistence.** No backend. Each proposal is its own JSON file; the index is a separate JSON file regenerated on every save. Saves are debounced 1.5s to avoid noisy commits during rapid edits.
- **Tone sliders as text descriptors.** The slider value (-3..+3) maps to a phrase like "a touch casual" that's injected into the user prompt — not a numeric weight. This kept the prompt human-readable and the calibration intuitive.
- **JSON-structured generation.** Claude returns `{ sections: [{id, style, text}] }`. The same JSON drives the on-screen render and the .docx export — what you see is what ships.
