# TSC-CONT — Supplementary Conditions Builder

A static GitHub Pages app that generates AIA B105-2017 Supplementary Conditions
Word documents for Carlisle Moore Architects residential projects, sharing client
and fee-structure data with the existing **TSC-BILLING** dashboard.

## Files

```
index.html          # the app
styles.css          # CMA visual language (matches TSC-BILLING)
app.js              # all logic — client picker, fee table, scope, docx export
README.md           # this file
Intake/             # reference PDF + sample data.json (not deployed)
```

The app is intentionally a single page with no build step — drop these three
files at the root of a repo and turn on GitHub Pages.

## Deploy to GitHub Pages

1. Create a new GitHub repo named **TSC-cont** (or whatever you like).
2. Copy `index.html`, `styles.css`, and `app.js` to the root of the repo.
3. Push to `main`.
4. In the repo settings → **Pages**, set the source to `main` / `/ (root)`.
5. Wait a minute and visit `https://<your-username>.github.io/TSC-cont/`.

## First-time setup inside the app

Open the **Settings** tab and fill in the GitHub data source:

| Field   | Value                                             |
| ------- | ------------------------------------------------- |
| Owner   | `<your-username>` (the owner of TSC-BILLING)      |
| Repo    | `TSC-BILLING`                                     |
| Branch  | `main`                                            |
| Path    | `data.json`                                       |
| Token   | a fine-scoped PAT with **Contents: Read & Write** |

Generate the token at <https://github.com/settings/personal-access-tokens/new>
and grant access to the **TSC-BILLING repository only**. The token is stored
in this browser's `localStorage` — clear it when you're done on a shared
machine.

Click **Test Connection** to verify, then **Load from GitHub now** to pull
the client list.

> No PAT yet? Click **Load local data.json** in Settings to pick a copy from
> your computer for testing. You can switch to GitHub later.

## Using the app

The Builder tab is a single flowing form on the left and a live preview of
the document on the right.

1. **Client** — type to search the dropdown, click a result, or use **+ Add new**
   to create a client inline. New clients are saved back to `data.json` in
   GitHub immediately if a PAT is configured.
2. **Project Information** — name, location (city, state), date, square
   footage, and a one-paragraph description that appears under the heading
   *The Owner and Architect agree the scope of work for this project is as
   follows:*
3. **General Scope of Work** — bulleted list that appears in the document.
   Toggle the checkboxes to include/exclude items, or type a custom item and
   hit **+ Add**.
4. **Compensation** — fee type, percentage, construction estimate, and total
   fee are auto-pulled from the selected client's `fee_basis` in `data.json`.
   Each phase row (Deposit / SD / DD / CD / CA) is fully editable; type a
   percentage *or* an amount to override.
5. **Scope by Phase** — each phase has a description paragraph and a list of
   deliverables. The text and checkboxes are pre-populated from the templates
   embedded in the Davis sample document and can be edited freely. Use
   **+ Sub-bullet** for indented items (e.g. the engineering exclusion under
   Construction Administration).
6. **Compensation Narrative** — the paragraphs around the fee table. The lead-in
   line uses `{ESTIMATE}` and `{PCT}` placeholders that are auto-filled.
   Override either by typing in the textarea or directly in the preview.
7. **Live Preview** — anything in the preview with a hover outline can be
   clicked and edited in place. Edits flow back into the form fields on blur.
8. **Download Word Document** — generates a `.docx` named
   `Supplementary_Conditions_<ProjectName>.docx`. The file lands in your
   Downloads folder; the document is also saved to the in-app History tab so
   you can re-load or re-download later.

## How it integrates with TSC-BILLING

- **Reads** the same `data.json` (clients array, `fee_basis`, `phases`,
  contact fields). Adding a contact field to TSC-BILLING shows up here on the
  next refresh.
- **Writes** by appending new clients to `clients[]` and saving the whole
  file back via the GitHub Contents API. The TSC-BILLING dashboard's next
  load picks up the changes.
- The app caches the most recent `data.json` and SHA in `localStorage`, so it
  works offline as long as you don't add new clients.

## Document History

Every generated document is snapshotted into the **History** tab — click
**Re-load** to repopulate the Builder with that draft, or **Re-download** to
generate the `.docx` again. History lives in this browser only.

## Data flow

```
              ┌──────────────────┐
              │  TSC-BILLING     │
              │  (data.json)     │
              └────────┬─────────┘
                       │ GitHub Contents API
       ┌───────────────┴───────────────┐
       │  TSC-CONT (this app)          │
       │   - read clients & fees       │
       │   - write new clients         │
       │   - never touches invoices    │
       └───────────────┬───────────────┘
                       │ in-browser (docx.js)
                       ▼
        Supplementary_Conditions.docx
```

## Build info

Build stamp is in the masthead status row. Bump the `?v=` query parameter on
`styles.css` and `app.js` in `index.html` when you push a change so browsers
fetch the new version.
