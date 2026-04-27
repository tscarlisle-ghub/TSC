# TSC-PR — CMA Proposal Generator

A standalone web application for **Carlisle Moore Architects** that generates new proposals in the firm's established voice, lets you iteratively refine them paragraph by paragraph, persists every version to a private GitHub repository, and exports finished proposals as Word documents in CMA's letterhead format.

Single file. No build step. Runs in any browser, hosted on GitHub Pages.

---

## How it works

1. **Open the app.** First run prompts for an Anthropic API key (and optionally a GitHub PAT for cross-device persistence). Both live in browser localStorage.
2. **Pick a proposal type** — Full Architectural Services or Proof of Concept.
3. **Fill in the intake form** — project name, client, address, square footage, budget, phases, fee structure, timeline, free-form notes.
4. **Set the tone sliders** — three calibrated axes:
   - Formal ↔ Casual
   - Detailed ↔ Concise
   - Technical ↔ Accessible
   The center position on every slider corresponds to the firm's typical voice as observed across ten finished proposals.
5. **Generate.** A complete proposal appears in the center pane.
6. **Click any paragraph to lock it.** Locked sections show an amber rule and a filled dot.
7. **Regenerate.** Locked sections are preserved verbatim; everything else is rewritten in the same tone, against the same intake.
8. **Save versions automatically.** Every Generate / Regenerate / version switch writes to GitHub at `data/proposals/<id>.json`. The full version history rides along with each proposal record.
9. **Word export.** Produces a .docx with the Ouellette letterhead format — TradeGothic Bold heads, Surveyor Text Light body, 2.25" left margin, footer with the firm contact block, and Articles 1–7 as a separate TERMS section.

---

## Setup

### 1. Create the GitHub repo

```bash
cd /path/to/TSC-Proposals
git init
git add index.html README.md SESSION-NOTES.md .gitignore data/
git commit -m "Initial commit — TSC-PR"
git remote add origin https://github.com/<your-username>/TSC-PR.git
git branch -M main
git push -u origin main
```

Make the repo **private** — proposal records contain client information.

### 2. Enable GitHub Pages

Settings → Pages → Source: Deploy from branch → Branch: `main` → Folder: `/ (root)` → Save.

App is live at `https://<your-username>.github.io/TSC-PR/`.

> ⚠ Because the repo is private, GitHub Pages requires a **Pro / Team / Enterprise** plan. On the free tier, either make the repo public (the app code is fine to publish — proposal data sits inside `data/` which contains client information) or run the app locally by opening `index.html` in your browser.

### 3. Create a GitHub Personal Access Token

For the GitHub persistence feature, create a **fine-grained PAT** scoped to only the TSC-PR repository:

- GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token
- Repository access: Only select repositories → choose `TSC-PR`
- Repository permissions: **Contents: Read and write**
- Save the token, paste it into the app's settings drawer.

### 4. Get an Anthropic API key

console.anthropic.com → API keys → Create. Paste it into settings.

---

## Repo layout

```
TSC-PR/
├── index.html              # the entire app
├── README.md               # this file
├── SESSION-NOTES.md        # working log
├── .gitignore              # ignores inputs/ and OS junk
├── data/
│   └── proposals/
│       ├── _index.json     # quick-listing index, updated on every save
│       └── <id>.json       # one file per proposal, full version history inside
└── inputs/                 # GIT-IGNORED — private past proposals + design process docs
```

### Proposal record shape

```json
{
  "id": "prop_a1b2c3...",
  "createdAt": 1730000000000,
  "updatedAt": 1730000200000,
  "ptype": "full" | "poc",
  "intake":  { ... form snapshot ... },
  "tone":    { "formal": 0, "detail": 0, "tech": 0 },
  "activeVnum": 3,
  "versions": [
    {
      "vnum": 1,
      "ts": 1730000000000,
      "intakeSnap": { ... },
      "toneSnap":   { ... },
      "sections": [
        { "id": "p_xx", "style": "title", "text": "PROPOSAL", "locked": false },
        { "id": "p_yy", "style": "h2",    "text": "scope of work", "locked": true },
        ...
      ]
    },
    { "vnum": 2, ... },
    { "vnum": 3, ... }
  ]
}
```

Section styles map 1:1 from screen render to Word export, so what you lock on screen is what ships in the .docx.

---

## Voice + structure source

The generator was trained on these finished CMA proposals (kept in `inputs/`, not committed):

Ballagas, Callahan (barn), Clikas, Davis, Fields, Ford, Ouellette (remodel), Sanders, Weil (pool house), Young — plus the email-excerpts file and the CMA Design Process iPad PDF.

Two structural variants emerged and both are supported:

- **Full Architectural Services** — header → opening → scope of work → deliverables (SD/CD/Notes blocks) → timeline (optional) → compensation structure → closing → signature → TERMS (Articles 1–7, appended verbatim)
- **Proof of Concept** — header → brief opening → scope of work → process → fee → closing → signature (no TERMS section)

The **Ouellette** proposal is the format reference for the Word export — TradeGothic Bold for heads, Surveyor Text Light for body, US Letter with the wide 2.25" left letterhead margin, footer with the firm contact line.

---

## Design language

Edward Tufte's information design principles, applied to a tool:

- High data-ink ratio — only ink that conveys information.
- No chartjunk — no bevels, drop shadows, gradients, animated transitions, or icons-as-decoration.
- Restrained color — paper-and-ink (#fffff8 / #11110f) with one navy accent and one amber highlight for locked sections. That's it.
- Precise typographic hierarchy — EB Garamond for body, system sans for chrome at small sizes, lowercase letterspaced labels for section heads.
- Margin notes (per Tufte) on the empty state.
- Hairline rules instead of borders.

---

## Keyboard

- `⌘/Ctrl + Enter` — Generate (or Regenerate if a proposal is loaded)
- `Esc` — close drawer / modal
- Click any paragraph after generation — toggle lock

---

## Privacy

- API keys and PATs live only in your browser's localStorage. Nothing is sent to any third party except the direct Anthropic and GitHub API calls the app makes.
- The `inputs/` folder of past proposals is gitignored. Don't commit it.
- The `data/proposals/` folder lives in your private GitHub repo. Treat it as confidential client data.

---

## License

Internal CMA tool. Not for distribution.
