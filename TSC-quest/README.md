# CMA Design Questionnaire

A single-file, client-facing design questionnaire for Carlisle Moore Architects.
Tufte-styled, single-page scroll, with a free-form notes box at the top and
eight structured sections below.

No build step. No server. One self-contained HTML file. Same architecture as
the construction cost estimator (TSC-SQF) — the URL itself is the data store.

---

## Quick start

Open `index.html` directly in any browser, or deploy via **GitHub Pages**:

1. Create a public repo with `index.html` (and this `README.md`).
2. In the repo's **Settings → Pages**, set the source to your default branch
   and the `/` (root) folder. Save.
3. The tool is available at `https://<your-username>.github.io/<repo-name>/`.

---

## How it works

The questionnaire is a single HTML page with eight structured sections (§1
through §8) plus a §0 free-form notes box at the top. As the client types,
the page silently updates the URL with a compressed snapshot of every answer.
That URL *is* the share link.

Three independent ways state moves around:

**1. Auto-save (this device).** Every keystroke writes to the browser's
`localStorage`. Close the tab, come back tomorrow on the same device, and the
draft is restored.

**2. Share link (any device).** The URL silently updates as the client types
to encode the full state via LZ-string compression. Click **Copy share link**
to grab that URL. Open it on another device — the receiving browser loads the
exact configuration from the URL itself, with no prior state required.

**3. Download my answers.** Saves a JSON file the client can email manually
as a backup.

---

## The flow

**Scott sends a starter link to a prospective client:**

1. Open the deployed page (`https://<you>.github.io/<repo>/`).
2. Optional: add `?client=Greenwich+Residence` to the URL — that pre-fills
   the name field as a personal touch.
3. Click **Copy share link** and paste into an email to the client.

**Client fills it out:**

1. Opens the link, sees their name pre-filled.
2. Fills in any of the eight sections; the §0 box at the top is for anything
   else they want to share. Auto-saves on every keystroke.
3. Clicks **Send back to Scott**. Their default mail client opens with:
   - **To:** `scott@carlislemoorearchitects.com`
   - **Subject:** `Design Questionnaire — {their name}`
   - **Body:** the share link with all their answers, plus a plain-text
     summary of the answers below it as a fallback.
4. They click Send.

**Scott reads it:**

1. Opens the email, clicks the share link.
2. The questionnaire loads with every answer populated. Read it on screen,
   print it, or download a JSON archive.

The "database" is Scott's email inbox. Each share link is a complete record.

---

## Sections

`§0 Opening` — big free-form notes box  
`§1 Contact` — name, partner, email, phone, location, referral  
`§2 You` — household, weekly rhythm, lifestyle chips  
`§3 Project` — type, sqft, stories, builder, prior architect  
`§4 Character` — style cards, references, words, what to avoid  
`§5 Spaces` — bedrooms, bathrooms, spaces checklist, key-spaces detail, storage  
`§6 Site` — strengths, challenges + constraints, arrival + outdoor  
`§7 Budget` — budget range, fee preference, timeline  
`§8 Last` — priority, concerns, feeling, anything else

---

## Files

| File | Description |
|---|---|
| `index.html` | The questionnaire. HTML + CSS + JS in one file. |
| `README.md`  | This file. |
| `.gitignore` | Keeps private files out of the repo. |

The repo's `.gitignore` excludes the `intake/` folder (private reference
plans) and OS noise. Those live in the working folder for development context
but should not be pushed to GitHub.

---

## Dependencies

- **ET Book** typeface (Edward Tufte's open-source serif) loaded from
  jsDelivr's CDN.
- **LZ-string 1.4.4** by Pieroxy (MIT) — inlined at the top of the script
  for compact share links. No CDN dependency.

That's it. No JavaScript framework. The questionnaire runs offline once
loaded (the only network request is for the ET Book font, which falls back
to Palatino if blocked).

---

## Tuning the questions

All questions are inline in `index.html`. Edit the markup for each `<section>`
to add, remove, or rephrase. Make sure any new field gets matching entries in:

- `collect()` — to include the field in the snapshot
- `apply()` — to restore it from a snapshot

(Both are at the bottom of the file in the `<script>` block.)

---

## Privacy

Answers travel via the URL share link, the JSON download, and the client's
email — never to any third-party server. Local drafts live in the client's
browser `localStorage` only.

---

## License

© Carlisle Moore Architects, Inc. All rights reserved.
