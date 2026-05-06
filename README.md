# CMA Folder Reorganizer

A safe, visual tool for reorganizing folders on disk — Dropbox, iCloud, the Desktop, an external drive, anywhere — with full control over the new structure and a complete backup before any change happens.

This is a static web app. It runs entirely in your browser. Nothing is uploaded anywhere; the page reads and writes files directly on your computer through the browser's File System Access API.

---

## Quick start

1. Open the deployed site in **Google Chrome** or **Microsoft Edge** (any Chromium browser also works — Brave, Arc, Opera).
2. Click **Choose folder** and pick the folder you want to clean up.
3. The app walks the folder, identifies file types, duplicates, and likely junk.
4. Pick an organizing strategy (by type / by date / by project / hybrid). Customize the proposed tree by dragging, renaming, adding, or removing folders.
5. Review the move plan, tick the three confirmation boxes, and click **Execute**.
6. The app creates a timestamped backup folder inside your folder, copies every file into it (with a `manifest.json`), then performs the reorganization. Duplicates and junk go into `_Review-for-Deletion/` — never permanently deleted.

You can leave the backup in place as long as you like. Drag it to the Trash once you're satisfied.

---

## Browser requirements

The tool needs the **File System Access API**, which is available in:

- Chrome (89+)
- Edge (89+)
- Brave, Arc, Opera, and other recent Chromium builds

It does **not** work in Safari or Firefox. The app will detect this and show a notice rather than letting you proceed.

---

## Working with Dropbox / iCloud folders

Dropbox and iCloud are presented to you as ordinary folders on your filesystem when their desktop sync clients are installed. Point the tool at the *local sync folder*, not the web interface:

- **Dropbox:** typically `~/Dropbox` on macOS or `C:\Users\you\Dropbox` on Windows.
- **iCloud Drive:** `~/Library/Mobile Documents/com~apple~CloudDocs` on macOS.

The reorganization happens locally; Dropbox and iCloud will sync the changes after the fact, just as if you'd moved files in Finder.

### Cloud-friendly mode (for online-only files)

If your folder contains files marked as **online-only** in Dropbox or iCloud (a cloud icon in Finder, no local bytes), tick the **"My folder contains online-only Dropbox or iCloud files"** checkbox on the welcome screen before clicking *Choose folder*. With this on, the tool relocates files using the browser's native `FileSystemFileHandle.move()` — a metadata-only operation. The bytes are never read, so online-only placeholders stay online-only and Dropbox/iCloud just rename the cloud-side entry.

Trade-offs of cloud-friendly mode:

- **Duplicate detection by content is disabled** — finding duplicates would require reading file bytes, which would force every candidate file to download. The tool will still flag system noise (`.DS_Store`, etc.) and zero-byte files because those checks are name- or metadata-based.
- **The backup is reduced to a manifest only** — the timestamped `_Backup-…/` folder will contain just a `manifest.json` (the full mapping of original → new paths). No copies of the files themselves. Your cloud provider's version history is the rollback path: every Dropbox plan keeps 30 days of file history (longer on paid plans), and iCloud keeps 30 days of recently deleted files.
- Reorganizations are still fully reversible by reading the manifest and undoing each move, since `move()` is symmetric.

If your folder is fully local (everything downloaded), leave the checkbox off — you'll get the full safety net (content-hashed duplicate detection plus a complete file backup).

---

## Deploying to GitHub Pages

This is a static, three-file site (`index.html`, `styles.css`, `app.js`) plus this README. Deploy it like any GitHub Pages site:

1. Create a new repository on GitHub (public or private — GitHub Pages works on both for paid plans).
2. Copy `index.html`, `styles.css`, `app.js`, and `README.md` to the root of the repo.
3. Commit and push to the `main` branch.
4. In the repo's settings, go to **Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, and select **main** / **/(root)**.
5. Wait a minute or two. GitHub will give you a URL like `https://yourname.github.io/foldername/`.

Open that URL in Chrome or Edge and you're set.

### Custom domain (optional)

If you want this on a subdomain of `cma…com`, add a `CNAME` file at the root of the repo containing the domain (e.g. `tools.cma-architects.com`), then add a CNAME record in your DNS pointing to `yourname.github.io`.

---

## How the safety net works

The app's central commitment is **nothing is ever permanently deleted**. Every reorganization is structured as:

1. **Backup:** a folder named `_Backup-YYYY-MM-DD_HH-MM-SS/` is created inside the folder you chose. Every file in the original tree is *copied* into it, preserving its original relative path. A `manifest.json` is written alongside listing every file's original path, new path, size, hash, modification time, and category.

2. **Reorganize:** files are moved (copied to the new location, then removed from the original) into the structure you approved.

3. **Review folder:** anything flagged as a duplicate, system-junk file, or zero-byte file is moved to `_Review-for-Deletion/` (with subfolders `duplicates/`, `junk/`, `empty/`). You can browse it later in Finder/Explorer and decide what to delete by hand.

4. **Empty folders:** after moves complete, the app walks the folder again and deletes any *empty* leftover source folders. It refuses to delete the backup folder, the review folder, or any of the new top-level folders — so even if it has a bug, your data is never destroyed.

If anything goes wrong partway, the backup is already in place and you can reconstruct the original folder by copying its contents back out.

### The manifest

`_Backup-…/manifest.json` describes the entire operation. Its key fields:

```json
{
  "tool": "CMA Folder Reorganizer",
  "version": "1.0",
  "timestamp": "2026-05-04T18:30:00.000Z",
  "sourceFolder": "Projects",
  "strategy": "type",
  "files": [
    { "id": "f1", "originalPath": "old/foo.dwg", "size": 12345, "hash": "…", "category": "CAD & 3D", "flag": null }
  ],
  "moves": [
    { "fileId": "f1", "fromPath": "old/foo.dwg", "toPath": "CAD & 3D/foo.dwg" }
  ],
  "reviewMoves": [
    { "fileId": "f5", "fromPath": "old/.DS_Store", "toPath": "_Review-for-Deletion/junk/old/.DS_Store", "kind": "junk" }
  ]
}
```

Anyone with basic scripting skills can reverse the operation by reading the manifest. The simplest restore is to drag the backup contents back over the source.

---

## Strategies, in detail

- **By file type** — files grouped into top-level folders by category (`Documents`, `Spreadsheets`, `Images`, `CAD & 3D`, `Design Files`, `Audio`, `Video`, `Archives`, `Code`, `Fonts`, `eBooks`, `Other`). The CAD & 3D bucket recognizes Revit (`.rvt`/`.rfa`), AutoCAD (`.dwg`/`.dxf`), SketchUp (`.skp`), Rhino (`.3dm`), ArchiCAD (`.pln`), Vectorworks (`.vwx`), IFC, OBJ, STL, STP/STEP, IGES.
- **By date** — top-level folders by year (`2024/`, `2025/`, `2026/`), then `MM-Mon/` subfolders inside.
- **By project** — keeps your existing top-level folder names (treating each as a project). Files at the root of the chosen folder are routed into `_Loose-Files/`.
- **Hybrid (type + date)** — top-level folders by category, then year subfolders within each.

You can edit the resulting structure freely on the **Propose** screen before committing.

---

## What the tool does *not* do

- It does not open files (no preview, no thumbnails). Decisions are made on extension, size, and modification date.
- It does not rename files. Filenames are preserved exactly. If two files would collide in their new home, the second copy gets `.1`, `.2`, … appended to its name.
- It does not delete anything. The closest it comes is removing source folders that have become empty after their files were moved out.
- It does not transmit anything off your computer. The only network request the page makes is loading the Adobe Fonts kit at `use.typekit.net/ikf0hkb.css`. Everything else is local.

---

## Limitations & known caveats

- **Permission prompts:** Chrome will ask twice — once to read, once to write. You must allow both. Permission is granted only for the folder you picked and lasts for the tab's lifetime.
- **Speed on huge folders:** the analyze step hashes every file that shares a size with another file (the precondition for being a duplicate). Folders with tens of thousands of large media files may take a minute or two. The progress bar updates as it works.
- **Symlinks:** the File System Access API does not surface symlinks. Linked files appear as their targets; broken symlinks are invisible.
- **Permissions on weird filesystems:** the tool can fail to delete a source folder if the OS holds a temporary lock (Spotlight indexing, Time Machine, antivirus). The backup is still safe; just empty leftover folders by hand.

---

## Files

- `index.html` — page structure and phase shell
- `styles.css` — Tufte-inspired styling, Adobe Fonts kit `ikf0hkb`
- `app.js` — analysis, tree editor, and execution logic
- `README.md` — this file

— CMA Internal Tools, v1.0
