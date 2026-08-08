# CA Task Ledger — Carlisle Moore Architects

A construction-administration task tracker built in the CMA Editorial style. It
runs entirely as a static site — no server to run or pay for — and stores its
data as a SQLite file (`tasks.db`) committed to this GitHub repo. There's no
login system; it's built for one person (you) to run.

What it does:

- Tracks tasks with who's responsible (**Owner / Architect / Interior
  Designer / Contractor**), a due date, a status, a priority, and a
  construction category/trade.
- On the **Tasks** tab, toggle between a **Priority List** (grouped High →
  Medium → Low) and a **Category List** (grouped by trade — framing,
  roofing, plumbing, etc.), each filterable by project/party/status.
- **Parse Email** — paste an email and Claude pulls out the action item(s):
  who it's for, what it is, the category, and the due date — for you to
  review and save.
- **Export PDF** — builds a clean printable list from whatever you're
  currently looking at and opens your browser's print dialog; choose "Save
  as PDF" there to get a file to send out.
- **Projects** tab to group tasks by job.

---

## 1. Put the code on GitHub

You already have the repo: **https://github.com/tscarlisle-ghub/ca**

From this folder:

```bash
cd construction-admin-tasks
git init
git remote add origin https://github.com/tscarlisle-ghub/ca.git
git add .
git commit -m "Initial CA task ledger"
git branch -M main
git push -u origin main
```

If the repo already has a `main` branch with content, use `git pull --rebase
origin main` first, or push to a different branch name and update it in
Settings inside the app (see below).

## 2. Turn on GitHub Pages

In the repo on GitHub: **Settings → Pages → Build and deployment → Source:
Deploy from a branch → Branch: `main`, folder `/ (root)` → Save.**

GitHub will give you a URL like `https://tscarlisle-ghub.github.io/ca/` —
that's the app. It can take a minute or two to go live after the first push.

> **Because this repo will hold client names, addresses, and task details,
> consider making the repo private.** GitHub Pages can still serve a private
> repo on paid plans; check your plan's Pages settings. If Pages from a
> private repo isn't available to you, weigh that against keeping the repo
> public before you put real client data in it.

## 3. Make your fine-grained GitHub token

You mentioned you're already creating one — here's exactly what it needs:

1. **github.com → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token.**
2. **Repository access:** "Only select repositories" → choose `tscarlisle-ghub/ca`.
3. **Permissions → Repository permissions → Contents: Read and write.**
   (GitHub will auto-add "Metadata: Read-only" — that's fine, it's required.)
4. Set an expiration you're comfortable with (you'll just generate a new one
   and paste it into Settings when it expires).
5. Generate, copy the token (starts with `github_pat_…`) — GitHub only shows
   it once.

Paste it into the app's **Settings → GitHub Sync → Personal Access Token**
field, confirm Owner/Repo/Branch/Path match your repo, then click **Test
Connection**. The token is saved only in this browser's local storage — it
is never written into a file or committed.

## 4. Make a Claude API key (for email parsing)

1. Go to **console.anthropic.com → API Keys → Create Key.**
2. Copy the key (starts with `sk-ant-…`).
3. Paste it into **Settings → Claude API → API Key.**

This key is billed per use on your Anthropic account (email parsing is a
small, cheap request). It's also only stored in this browser.

## 5. Using it day to day

- Open your GitHub Pages URL. On first load it pulls the latest `tasks.db`
  from GitHub (or falls back to the starter file bundled in the repo).
- Every add/edit is auto-saved to *this browser* immediately, so you won't
  lose work by closing the tab. The header shows **● unsaved** until you
  click **Save to GitHub** (top right, always visible) — that's the only
  step that actually updates the file in your repo.
- If you work from more than one computer, click **Pull Latest** in Settings
  before you start editing on the second machine, so you don't overwrite
  each other's changes. (If you do save over a stale copy, GitHub will
  reject it and tell you to pull first — nothing gets silently lost.)
- **Delete the four "SAMPLE —" rows** (one project, four tasks) once you've
  seen how the format works.

## What's in this folder

```
index.html          the whole app shell
css/style.css        the Editorial design system, translated to plain CSS
js/constants.js       shared vocabulary (categories, parties, priorities…)
js/db.js              SQLite (sql.js/WASM) wrapper + CRUD
js/github.js           reads/writes tasks.db to GitHub via the Contents API
js/parse.js            calls Claude's API to extract tasks from pasted text
js/app.js              UI state, rendering, event wiring
data/schema.sql         the table definitions, for reference
tasks.db                the database file itself — this is what gets updated
assets/                 CMA logo + house mark
vendor/sqljs/            the in-browser SQLite engine, bundled locally
```

## Notes / limitations

- This is a **single-browser-profile tool** by design (per your setup
  choice) — there's no login, and two people editing at the same moment
  will conflict the same way two people editing a spreadsheet would.
- Both your GitHub token and Claude API key live in this browser's local
  storage only. Clearing your browser data, or switching browsers/devices,
  means re-pasting them from wherever you saved them.
- The SQLite engine (sql.js) ships in the repo (`vendor/sqljs/`), so opening
  the app doesn't depend on a CDN being up. The Editorial typeface (Typekit)
  and the GitHub/Claude APIs are still loaded live — if Typekit is
  unreachable the page just falls back to system fonts; GitHub sync and
  email parsing need a working connection when you use them. The task data
  itself lives in the `tasks.db` file in this repo, not on any third-party
  server.
