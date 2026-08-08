# Session Notes

A running log of changes to the Folder Reorganizer. Newest entry at the top.

---

## 2026-05-06 — Cloud-friendly mode + native move()

**Why:** the previous build downloaded every file in the folder during analysis (for duplicate detection) and again during backup (for the file copy). For folders containing online-only Dropbox or iCloud files, that forced every placeholder to hydrate, defeating the purpose of online-only storage.

- `app.js` · `moveFile()` now tries `FileSystemFileHandle.move()` first and falls back to copy+delete only if the native call throws. Native move is a metadata operation — no bytes are read — so online-only files can be relocated without forcing download. It's also significantly faster than copy+delete for any large local file.
- `app.js` · added `state.cloudMode` flag. When on, the analyzer skips content hashing entirely (so duplicate-by-content detection is disabled), and the executor skips the full file backup (manifest only). Manifest now records the cloudMode flag so it's clear from the manifest alone whether the run was a full or metadata-only backup.
- `index.html` · welcome screen has a new "My folder contains online-only Dropbox or iCloud files" checkbox in a bordered fieldset, with a plain-language explanation of trade-offs. Review screen has a new prominent hint that surfaces when cloud-friendly mode is on.
- `styles.css` · added styles for the new fieldset and the review-screen cloud-mode hint, both with the slate accent color so they read as informational rather than alarming.
- `README.md` · expanded the Dropbox/iCloud section with a "Cloud-friendly mode" subsection covering trade-offs and rollback paths.

**Caveat:** native `move()` requires Chrome 110+ (Feb 2023). Anything older falls back to copy+delete. The user is on Chrome 147 so this is fine.

---

## 2026-05-06 — Fix [hidden] CSS specificity bug (the real cause of "Browser not supported")

**Why:** even though the user's Chrome had the File System Access API (confirmed via the standalone `check.html`), the warning page kept showing. We chased GitHub deploy issues, browser caches, Incognito mode — all dead ends.

The actual cause: `styles.css` had `#browser-warning { display: grid; }`. An ID selector beats the user-agent `[hidden] { display: none }` rule on specificity. So when `app.js` set `hidden=true` on the warning, the CSS kept it visible at full viewport height (`min-height: 100vh`), hiding the welcome screen below it.

- `styles.css` · added a defensive `[hidden] { display: none !important; }` rule near the top of the reset block. This makes the HTML `hidden` attribute always win regardless of which other element-specific display rules are in play.

**Caveat:** users will need to hard-refresh (⌘+Shift+R) once to bust their browser cache of the old `styles.css`. Cache-busters were added to the script and stylesheet tags (`?v=4`).

---

## 2026-05-06 — Diagnostic instrumentation (later removed)

**Why:** to chase the "Browser not supported" mystery before we found the [hidden] specificity bug.

- Added a `console.warn` + on-page diagnostic block to `app.js`'s `checkBrowserSupport` so anyone hitting the warning could see exactly which API was missing.
- Added a standalone `check.html` page that runs the API checks in plain inline script with no module loading or caching concerns. Confirmed the user's Chrome had everything required.
- Added a temporary preflight banner at the top of `index.html` that ran before `app.js` and reported the API state visibly. Removed once the actual bug was fixed.

The `check.html` file is still in place — it's a useful self-service diagnostic if anyone ever hits a similar issue again.

---

## 2026-05-06 — Local server launcher

**Why:** the File System Access API requires a "secure context" (https or localhost). Opening `index.html` directly via `file://` disables the API. The user double-clicked `index.html` and saw the "Browser not supported" page; the fix was to serve over localhost.

- Added `start-local.command` to the project folder. Double-click in Finder (right-click → Open the first time to bypass Gatekeeper) and it starts `python3 -m http.server 8765`, then opens Chrome at `http://localhost:8765/`. Closing the Terminal stops the server.

---

## 2026-05-04 — Initial build

**Why:** Scott asked for a static GitHub-Pages-hosted tool to reorganize folders (Dropbox, iCloud, Desktop, anywhere) with a visual structure builder and a complete safety net.

- `index.html` · five-phase shell (Choose → Analyze → Propose → Review → Done), browser-compatibility gate at load, Adobe Fonts kit `ikf0hkb` linked.
- `styles.css` · Tufte aesthetic. Warm `#fffff8` paper background. Warnock Pro for prose. Interstate for UI controls. DIN Condensed for headings, labels, numerals. Hairline rules. Deep-red action accents.
- `app.js` · folder picker via File System Access API. Recursive walk. Categorization across 12 buckets (including `CAD & 3D` for `.dwg`, `.dxf`, `.rvt`, `.rfa`, `.skp`, `.3dm`, `.ifc`, `.pln`, `.vwx`, `.stp`/`.step`, `.iges`, `.obj`, `.stl`). Sample-hash duplicate detection. Junk pattern matching for `.DS_Store`, `Thumbs.db`, `~$` Office locks, `.tmp`, `.crdownload`. Four organizing strategies (type / date / project / hybrid). Interactive tree editor with drag-drop, inline rename, add/remove folder. Three-checkbox confirmation gate before execute. Timestamped backup folder + `manifest.json` describing the entire operation. Duplicates and junk routed to `_Review-for-Deletion/` rather than deleted. Empty source folders pruned at the end (never the backup, review folder, or new top-level folders).
- `README.md` · deployment instructions for GitHub Pages, browser requirements, Dropbox/iCloud guidance, restore instructions, full strategy reference.

Verified locally: JS parses with `node --check`, all four strategies produce correct trees against synthetic test data, move-plan generator routes flagged files correctly, HTML/CSS well-formed.
