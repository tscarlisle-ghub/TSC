/* ==============================================================
   Folder Reorganizer — main application logic
   --------------------------------------------------------------
   Sections in order:
     1. Configuration (categories, junk patterns, etc.)
     2. State container
     3. Tiny DOM + utility helpers
     4. Phase navigation
     5. Folder picking + walking + analysis
     6. Strategies that turn an analysis into a proposed tree
     7. Tree renderer (interactive: drag/drop, rename, +/–)
     8. Move-plan generation
     9. Execution (backup → move → review folder)
    10. Bootstrap / event wiring
   ============================================================== */


/* ─── 1. Configuration ─── */

// Extensions grouped into human-friendly categories. The order of categories
// in this object is also the default top-level folder order in the proposed
// tree, so put them in the order Scott will most likely want to see.
const CATEGORIES = {
  'Documents':     ['pdf','doc','docx','txt','rtf','md','odt','pages','tex','wpd'],
  'Spreadsheets':  ['xls','xlsx','csv','tsv','ods','numbers'],
  'Presentations': ['ppt','pptx','key','odp'],
  'Images':        ['jpg','jpeg','png','gif','heic','heif','webp','tif','tiff','bmp','svg','psd','ai','raw','cr2','nef','dng'],
  'CAD & 3D':      ['dwg','dxf','rvt','rfa','skp','3dm','ifc','pln','vwx','stp','step','iges','igs','obj','stl','dwf','dgn'],
  'Design Files':  ['indd','idml','afpub','sketch','fig','xd'],
  'Audio':         ['mp3','wav','m4a','flac','aiff','aif','ogg','wma'],
  'Video':         ['mp4','mov','avi','mkv','webm','m4v','wmv','m2ts'],
  'Archives':      ['zip','rar','7z','tar','gz','bz2','dmg','iso'],
  'Code':          ['js','ts','tsx','jsx','html','css','py','rb','go','rs','c','cc','cpp','h','hpp','swift','java','kt','php','sql','sh','json','xml','yaml','yml'],
  'Fonts':         ['ttf','otf','woff','woff2','eot'],
  'eBooks':        ['epub','mobi','azw','azw3'],
  'Other':         []
};

// Macros that match files we treat as system noise / safely-routable junk.
// These never get permanently deleted — they go to _Review-for-Deletion/junk/.
const JUNK_PATTERNS = [
  /^\.DS_Store$/i,
  /^Thumbs\.db$/i,
  /^desktop\.ini$/i,
  /^\._/,                     // macOS resource forks (._foo)
  /^~\$/,                     // Office lockfiles  (~$Document.docx)
  /\.tmp$/i,
  /\.crdownload$/i,
  /\.part$/i
];

// Folders we never descend into (system clutter, our own backup folders, etc.).
const SKIP_DIRS = new Set([
  '.DS_Store', '.Spotlight-V100', '.Trashes', '.fseventsd',
  '.TemporaryItems', '$RECYCLE.BIN', 'System Volume Information',
  'node_modules', '.git'
]);

const REVIEW_FOLDER = '_Review-for-Deletion';
const BACKUP_PREFIX = '_Backup-';

// File-by-file analysis is async work — yield to the UI every N files
// so the page stays responsive on huge folders.
const YIELD_EVERY = 50;
// Files are considered for hash-based dup detection only if size <= this.
// Massive video files share-size + same-name + same-mtime rarely deserve a 2 GB read.
const MAX_HASH_BYTES = 256 * 1024;     // 256 KB sample
const MAX_FULL_HASH_FILES = 0;         // 0 = only sample everything


/* ─── 2. State container ───
   One mutable object that represents everything the app currently knows.
   Phases read from it, render from it, and mutate it. Resetting the app
   means re-creating this object. */

const state = {
  rootHandle: null,        // FileSystemDirectoryHandle (the chosen folder)
  rootName: '',
  files: [],               // [{ id, handle, parentHandle, originalPath, name, ext, size, modified, hash, category, flag }]
  folders: [],             // [{ path }]
  totalBytes: 0,
  duplicates: [],          // groups of file-id arrays sharing a hash
  junkIds: new Set(),      // ids of files matching junk patterns
  emptyIds: new Set(),     // ids of zero-byte files
  proposedTree: null,      // root TreeNode for the proposed structure
  strategy: 'type',
  movePlan: [],            // [{ fileId, fromPath, toPath, reason }]
  reviewMoves: []          // [{ fileId, fromPath, toPath, kind }]  duplicates / junk
};


/* ─── 3. Tiny DOM + utility helpers ─── */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
};

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '—';
  const units = ['B','KB','MB','GB','TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function fmtNum(n) { return Number(n).toLocaleString(); }

function nowStamp() {
  const d = new Date();
  const pad = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function extOf(name) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

function categoryFor(ext) {
  for (const [cat, exts] of Object.entries(CATEGORIES)) {
    if (exts.includes(ext)) return cat;
  }
  return 'Other';
}

function isJunkName(name) {
  return JUNK_PATTERNS.some(p => p.test(name));
}

// Stable IDs for the in-memory model.
let _idCounter = 0;
const nextId = (prefix) => `${prefix}${++_idCounter}`;

// Compute a sample hash of the first MAX_HASH_BYTES of a file.
// We combine size + sampled bytes so that two files of different sizes can
// never collide, even if their first chunk matches.
async function sampleHash(fileHandle, size) {
  const file = await fileHandle.getFile();
  const slice = file.slice(0, Math.min(size, MAX_HASH_BYTES));
  const buf = await slice.arrayBuffer();
  // Prepend size as 8-byte little-endian so it is part of the hash.
  const sizeBuf = new ArrayBuffer(8);
  new DataView(sizeBuf).setBigUint64(0, BigInt(size), true);
  const combined = new Uint8Array(sizeBuf.byteLength + buf.byteLength);
  combined.set(new Uint8Array(sizeBuf), 0);
  combined.set(new Uint8Array(buf), sizeBuf.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', combined);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Yield to the browser so the spinner / progress bar can repaint.
const tick = () => new Promise(r => setTimeout(r, 0));


/* ─── 4. Phase navigation ─── */

const PHASES = ['welcome','analyzing','analysis','propose','review','executing','done'];

function setPhase(name) {
  $$('.phase').forEach(s => s.classList.toggle('is-active', s.dataset.phase === name));
  // Update the indicator at the top — Choose / Analyze / Propose / Review / Done
  // (analyzing & executing are transient, mapped to Analyze / Review respectively).
  const visible = ({analyzing:'analysis', executing:'review'})[name] || name;
  $$('.phase-indicator li').forEach(li => {
    const idx = PHASES.indexOf(li.dataset.phase);
    const cur = PHASES.indexOf(visible);
    li.classList.toggle('is-active', li.dataset.phase === visible);
    li.classList.toggle('is-done', idx > -1 && cur > -1 && idx < cur);
  });
}


/* ─── 5. Folder picking + walking + analysis ─── */

async function pickFolder() {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' });
    // Permission may need to be re-granted explicitly for write mode.
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      const req = await handle.requestPermission({ mode: 'readwrite' });
      if (req !== 'granted') {
        alert('This tool needs read+write access to the folder you chose. Please try again and allow it.');
        return;
      }
    }
    state.rootHandle = handle;
    state.rootName = handle.name;
    $('#active-folder').textContent = handle.name;
    setPhase('analyzing');
    await runAnalysis();
  } catch (err) {
    if (err && err.name === 'AbortError') return; // user cancelled
    console.error(err);
    alert(`Could not open folder: ${err.message || err}`);
  }
}

// Recursively walk the chosen folder, building state.files and state.folders.
async function* walk(handle, relPath = '') {
  for await (const entry of handle.values()) {
    if (entry.kind === 'directory') {
      if (SKIP_DIRS.has(entry.name)) continue;
      // Skip our own previously-created folders so re-runs don't recurse into them.
      if (entry.name.startsWith(BACKUP_PREFIX) || entry.name === REVIEW_FOLDER) continue;
      const sub = `${relPath}${entry.name}/`;
      yield { kind: 'directory', path: sub };
      yield* walk(entry, sub);
    } else if (entry.kind === 'file') {
      yield { kind: 'file', entry, parent: handle, path: `${relPath}${entry.name}` };
    }
  }
}

async function runAnalysis() {
  const status = $('#analyze-status');
  const bar = $('#analyze-progress');
  bar.value = 0;
  status.textContent = 'Walking folder…';
  await tick();

  // Reset state.
  state.files = [];
  state.folders = [];
  state.totalBytes = 0;
  state.duplicates = [];
  state.junkIds = new Set();
  state.emptyIds = new Set();

  // Phase 5a: walk the tree.
  let count = 0;
  for await (const item of walk(state.rootHandle)) {
    if (item.kind === 'directory') {
      state.folders.push({ path: item.path });
    } else {
      const id = nextId('f');
      const f = {
        id,
        handle: item.entry,
        parentHandle: item.parent,
        originalPath: item.path,
        name: item.entry.name,
        ext: extOf(item.entry.name),
        size: 0,
        modified: 0,
        hash: null,
        category: 'Other',
        flag: null               // 'junk' | 'empty' | 'duplicate' | null
      };
      state.files.push(f);
      count++;
      if (count % YIELD_EVERY === 0) {
        status.textContent = `Walking folder… (${fmtNum(count)} files)`;
        await tick();
      }
    }
  }

  // Phase 5b: stat (size + mtime) and categorize.
  status.textContent = `Reading file info for ${fmtNum(state.files.length)} files…`;
  await tick();
  for (let i = 0; i < state.files.length; i++) {
    const f = state.files[i];
    try {
      const file = await f.handle.getFile();
      f.size = file.size;
      f.modified = file.lastModified;
      f.category = categoryFor(f.ext);
      state.totalBytes += f.size;
      if (isJunkName(f.name)) { f.flag = 'junk'; state.junkIds.add(f.id); }
      else if (f.size === 0) { f.flag = 'empty'; state.emptyIds.add(f.id); }
    } catch (err) {
      // File may be cloud-only / inaccessible. Mark as unreadable but keep going.
      f.unreadable = true;
    }
    if (i % YIELD_EVERY === 0) {
      bar.value = (i / state.files.length) * 50;     // 0–50% during stat
      await tick();
    }
  }

  // Phase 5c: hash files for duplicate detection.
  // To keep things fast, we only hash files that share an exact size with
  // at least one other file — same size is a precondition for being a duplicate.
  status.textContent = 'Looking for duplicates…';
  await tick();
  const bySize = new Map();
  for (const f of state.files) {
    if (f.unreadable || f.size === 0) continue;
    if (!bySize.has(f.size)) bySize.set(f.size, []);
    bySize.get(f.size).push(f);
  }
  const candidates = [];
  for (const arr of bySize.values()) if (arr.length > 1) candidates.push(...arr);
  for (let i = 0; i < candidates.length; i++) {
    const f = candidates[i];
    try { f.hash = await sampleHash(f.handle, f.size); }
    catch { f.hash = null; }
    if (i % YIELD_EVERY === 0) {
      bar.value = 50 + (i / Math.max(1, candidates.length)) * 50;
      status.textContent = `Hashing… (${fmtNum(i)}/${fmtNum(candidates.length)})`;
      await tick();
    }
  }

  // Phase 5d: group by hash to find dup sets.
  const byHash = new Map();
  for (const f of state.files) {
    if (!f.hash) continue;
    if (!byHash.has(f.hash)) byHash.set(f.hash, []);
    byHash.get(f.hash).push(f);
  }
  for (const grp of byHash.values()) {
    if (grp.length > 1) {
      // Sort: keep the one with the shortest path as canonical.
      grp.sort((a, b) => a.originalPath.length - b.originalPath.length);
      state.duplicates.push(grp.map(f => f.id));
      // Mark the rest as duplicate.
      for (let i = 1; i < grp.length; i++) grp[i].flag = 'duplicate';
    }
  }

  bar.value = 100;
  status.textContent = 'Done.';
  renderAnalysis();
  setPhase('analysis');
}


function renderAnalysis() {
  $('#analysis-folder-name').textContent = state.rootName;
  $('#stat-files').textContent = fmtNum(state.files.length);
  $('#stat-folders').textContent = fmtNum(state.folders.length);
  $('#stat-size').textContent = fmtBytes(state.totalBytes);
  const dupCount = state.duplicates.reduce((acc, grp) => acc + grp.length - 1, 0);
  $('#stat-duplicates').textContent = fmtNum(dupCount);
  $('#stat-junk').textContent = fmtNum(state.junkIds.size);
  $('#stat-empty').textContent = fmtNum(state.emptyIds.size);

  // By-type ledger
  const byCat = {};
  for (const f of state.files) {
    if (!byCat[f.category]) byCat[f.category] = { files: 0, size: 0, exts: {} };
    byCat[f.category].files++;
    byCat[f.category].size += f.size;
    byCat[f.category].exts[f.ext] = (byCat[f.category].exts[f.ext] || 0) + 1;
  }
  const tbody = $('#type-ledger tbody');
  tbody.innerHTML = '';
  const ordered = Object.entries(byCat).sort((a, b) => b[1].size - a[1].size);
  for (const [cat, info] of ordered) {
    const topExts = Object.entries(info.exts).sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([e, n]) => `${e || '(none)'} · ${fmtNum(n)}`).join(',  ');
    tbody.append(el('tr', {},
      el('td', {}, cat),
      el('td', {class:'num'}, fmtNum(info.files)),
      el('td', {class:'num'}, fmtBytes(info.size)),
      el('td', {}, topExts)
    ));
  }

  // Findings list — inline, narrative.
  const findings = $('#findings');
  findings.innerHTML = '';
  const findingItem = (kind, text) =>
    el('li', {}, el('span', {class:'badge ' + kind}, kind), text);

  if (dupCount > 0) {
    findings.append(findingItem('warn',
      `${fmtNum(dupCount)} duplicate file(s) detected across ${fmtNum(state.duplicates.length)} group(s). The first copy of each will keep its place; the rest will be moved to ${REVIEW_FOLDER}/duplicates/.`));
  }
  if (state.junkIds.size > 0) {
    findings.append(findingItem('warn',
      `${fmtNum(state.junkIds.size)} system / temporary file(s) detected (e.g. .DS_Store, Thumbs.db, ~$ Office locks). They'll be routed to ${REVIEW_FOLDER}/junk/ — not deleted.`));
  }
  if (state.emptyIds.size > 0) {
    findings.append(findingItem('info',
      `${fmtNum(state.emptyIds.size)} empty (0-byte) file(s) detected. These will be routed to ${REVIEW_FOLDER}/empty/.`));
  }
  if (state.files.some(f => f.unreadable)) {
    findings.append(findingItem('note',
      `Some files could not be read — likely cloud-only (Dropbox Smart Sync, iCloud "Optimize Storage"). Download them locally before re-running if you want them included.`));
  }
  if (findings.children.length === 0) {
    findings.append(findingItem('info', 'No duplicates or junk files detected.'));
  }
}


/* ─── 6. Strategies ─── */

// Each strategy returns a TreeNode (the proposed root). TreeNodes look like:
//   { id, name, isFolder: true, expanded: true, children: TreeNode[], fileIds: string[] }
// File leaves are NOT separate nodes — instead each folder carries a list of
// fileIds it owns. We render files inline beneath the folder for clarity.
function makeFolder(name) {
  return { id: nextId('n'), name, isFolder: true, expanded: true, children: [], fileIds: [] };
}

function buildProposedTree(strategy) {
  const root = makeFolder(state.rootName);
  // Files flagged as junk/duplicate/empty are NOT placed in the proposed tree.
  // They are routed to _Review-for-Deletion/ at execute time. So strategy logic
  // only operates on "good" files.
  const goodFiles = state.files.filter(f => !f.flag && !f.unreadable);

  if (strategy === 'type') {
    const byCat = groupBy(goodFiles, f => f.category);
    for (const cat of Object.keys(CATEGORIES)) {
      const list = byCat[cat] || [];
      if (!list.length) continue;
      const folder = makeFolder(cat);
      folder.fileIds = list.map(f => f.id);
      root.children.push(folder);
    }
  }

  else if (strategy === 'date') {
    const byYear = groupBy(goodFiles, f => String(new Date(f.modified).getFullYear() || 'Undated'));
    const years = Object.keys(byYear).sort();
    for (const y of years) {
      const yfolder = makeFolder(y);
      const byMonth = groupBy(byYear[y], f => {
        const d = new Date(f.modified);
        const mn = d.toLocaleString('en-US', { month: '2-digit' });
        const ml = d.toLocaleString('en-US', { month: 'short' });
        return `${mn}-${ml}`;
      });
      for (const m of Object.keys(byMonth).sort()) {
        const mfolder = makeFolder(m);
        mfolder.fileIds = byMonth[m].map(f => f.id);
        yfolder.children.push(mfolder);
      }
      root.children.push(yfolder);
    }
  }

  else if (strategy === 'project') {
    // Keep top-level folder names from the original layout. Files at the root
    // go into "_Loose-Files".
    const looseFiles = [];
    const groupsByTop = new Map();
    for (const f of goodFiles) {
      const segs = f.originalPath.split('/');
      if (segs.length === 1) {
        looseFiles.push(f);
      } else {
        const top = segs[0];
        if (!groupsByTop.has(top)) groupsByTop.set(top, []);
        groupsByTop.get(top).push(f);
      }
    }
    for (const [top, list] of groupsByTop) {
      const folder = makeFolder(top);
      folder.fileIds = list.map(f => f.id);
      root.children.push(folder);
    }
    if (looseFiles.length) {
      const folder = makeFolder('_Loose-Files');
      folder.fileIds = looseFiles.map(f => f.id);
      root.children.push(folder);
    }
  }

  else if (strategy === 'hybrid') {
    const byCat = groupBy(goodFiles, f => f.category);
    for (const cat of Object.keys(CATEGORIES)) {
      const list = byCat[cat] || [];
      if (!list.length) continue;
      const cfolder = makeFolder(cat);
      const byYear = groupBy(list, f => String(new Date(f.modified).getFullYear() || 'Undated'));
      for (const y of Object.keys(byYear).sort()) {
        const yfolder = makeFolder(y);
        yfolder.fileIds = byYear[y].map(f => f.id);
        cfolder.children.push(yfolder);
      }
      root.children.push(cfolder);
    }
  }

  state.proposedTree = root;
  return root;
}

function groupBy(arr, keyFn) {
  const out = {};
  for (const x of arr) {
    const k = keyFn(x);
    (out[k] ||= []).push(x);
  }
  return out;
}


/* ─── 7. Tree renderer (interactive) ─── */

const treeHost = () => $('#tree-host');

function renderTree() {
  const host = treeHost();
  host.innerHTML = '';
  if (!state.proposedTree) return;
  const ul = el('ul');
  ul.append(renderNode(state.proposedTree, true));
  host.append(ul);
}

function renderNode(node, isRoot) {
  const li = el('li', { dataset: { id: node.id } });

  const row = el('div', {
    class: 'tree-node ' + (node.isFolder ? 'is-folder' : 'is-file'),
    draggable: !isRoot,
    dataset: { id: node.id }
  });

  if (node.isFolder) {
    const toggle = el('span', { class: 'toggle' }, node.expanded ? '▾' : '▸');
    toggle.addEventListener('click', () => {
      node.expanded = !node.expanded;
      renderTree();
    });
    row.append(toggle);
  } else {
    row.append(el('span', { class: 'toggle' }, '·'));
  }

  // Name (editable for folders, except the very root which is the source folder name)
  const name = el('span', { class: 'name' }, node.name);
  if (node.isFolder && !isRoot) {
    name.addEventListener('click', (e) => {
      e.stopPropagation();
      name.contentEditable = 'true';
      name.focus();
      // Select all text on first click.
      const range = document.createRange();
      range.selectNodeContents(name);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    name.addEventListener('blur', () => {
      const newName = name.textContent.trim().replace(/[\\\/]/g, '_');
      node.name = newName || node.name;
      name.textContent = node.name;
      name.contentEditable = 'false';
    });
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); name.blur(); }
      if (e.key === 'Escape') { name.textContent = node.name; name.blur(); }
    });
  }
  row.append(name);

  // Meta — file count summary for folders, size for files
  if (node.isFolder) {
    const counts = countDescendantFiles(node);
    const meta = el('span', { class: 'meta' },
      `${fmtNum(counts.files)} file${counts.files === 1 ? '' : 's'}`
      + (counts.folders ? ` · ${fmtNum(counts.folders)} subfolder${counts.folders === 1 ? '' : 's'}` : '')
    );
    row.append(meta);
  }

  // Controls (visible on hover) — only for non-root folders
  if (node.isFolder && !isRoot) {
    const controls = el('div', { class: 'controls' });
    controls.append(el('button', { title: 'Add subfolder', onclick: () => addSubfolder(node) }, '+'));
    controls.append(el('button', { title: 'Delete folder (files revert to parent)', onclick: () => deleteFolder(node) }, '×'));
    row.append(controls);
  } else if (node.isFolder && isRoot) {
    const controls = el('div', { class: 'controls' });
    controls.append(el('button', { title: 'Add subfolder', onclick: () => addSubfolder(node) }, '+'));
    row.append(controls);
  }

  // DnD wiring on folders.
  if (node.isFolder) {
    if (!isRoot) {
      row.addEventListener('dragstart', (ev) => {
        ev.dataTransfer.setData('text/plain', node.id);
        ev.dataTransfer.effectAllowed = 'move';
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
    }
    row.addEventListener('dragover', (ev) => {
      const draggedId = ev.dataTransfer.types.includes('text/plain') ? null : null;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (ev) => {
      ev.preventDefault();
      row.classList.remove('drop-target');
      const draggedId = ev.dataTransfer.getData('text/plain');
      if (!draggedId || draggedId === node.id) return;
      moveNode(draggedId, node.id);
    });
  }

  li.append(row);

  // Children
  if (node.isFolder) {
    if (node.expanded) {
      const ul = el('ul');
      for (const c of node.children) ul.append(renderNode(c, false));
      // Files belonging directly to this folder
      for (const fid of node.fileIds) {
        const f = state.files.find(x => x.id === fid);
        if (!f) continue;
        const fli = el('li');
        const frow = el('div', { class: 'tree-node is-file' });
        frow.append(el('span', { class: 'toggle' }, '·'));
        frow.append(el('span', { class: 'icon' }, (f.ext || 'file').slice(0, 4)));
        frow.append(el('span', { class: 'name' }, f.name));
        frow.append(el('span', { class: 'meta' }, fmtBytes(f.size)));
        fli.append(frow);
        ul.append(fli);
      }
      // Empty folder hint
      if (!node.children.length && !node.fileIds.length) {
        ul.append(el('li', {},
          el('div', { class: 'tree-node is-file', style: 'color: var(--ink-3); font-style: italic;' }, '(empty)')
        ));
      }
      li.append(ul);
    } else {
      row.classList.add('collapsed');
    }
  }

  return li;
}

function countDescendantFiles(node) {
  let files = node.fileIds.length;
  let folders = 0;
  for (const c of node.children) {
    folders++;
    const sub = countDescendantFiles(c);
    files += sub.files;
    folders += sub.folders;
  }
  return { files, folders };
}

// Find a node and its parent in the tree.
function findNodeWithParent(root, id, parent = null) {
  if (root.id === id) return { node: root, parent };
  for (const c of root.children) {
    const found = findNodeWithParent(c, id, root);
    if (found) return found;
  }
  return null;
}

function addSubfolder(parent) {
  const folder = makeFolder('New Folder');
  parent.children.push(folder);
  parent.expanded = true;
  renderTree();
  // Focus the new folder for renaming.
  setTimeout(() => {
    const row = $(`.tree-node[data-id="${folder.id}"] .name`);
    if (row) row.click();
  }, 0);
}

function deleteFolder(node) {
  // Move any contained files up to the parent folder, then remove this node.
  const found = findNodeWithParent(state.proposedTree, node.id);
  if (!found || !found.parent) return;
  // Hoist files from this folder + recursively from descendants up to the parent.
  const hoist = (n) => {
    found.parent.fileIds.push(...n.fileIds);
    for (const c of n.children) hoist(c);
  };
  hoist(node);
  found.parent.children = found.parent.children.filter(c => c.id !== node.id);
  renderTree();
}

function moveNode(draggedId, targetId) {
  if (draggedId === targetId) return;
  const draggedFound = findNodeWithParent(state.proposedTree, draggedId);
  const targetFound = findNodeWithParent(state.proposedTree, targetId);
  if (!draggedFound || !targetFound) return;
  // Prevent moving a node into one of its own descendants.
  if (isDescendant(draggedFound.node, targetId)) {
    alert(`Cannot move a folder into one of its own descendants.`);
    return;
  }
  // Detach.
  if (draggedFound.parent) {
    draggedFound.parent.children = draggedFound.parent.children.filter(c => c.id !== draggedId);
  }
  // Attach.
  targetFound.node.children.push(draggedFound.node);
  targetFound.node.expanded = true;
  renderTree();
}

function isDescendant(node, id) {
  if (node.id === id) return true;
  return node.children.some(c => isDescendant(c, id));
}

function expandAll(node = state.proposedTree, val = true) {
  if (!node) return;
  node.expanded = val;
  for (const c of node.children) expandAll(c, val);
  renderTree();
}


/* ─── 8. Move-plan generation ─── */

function generateMovePlan() {
  const moves = [];
  const reviewMoves = [];

  // Walk the proposed tree and emit moves for every file mentioned.
  const walk = (node, pathSegs) => {
    for (const fid of node.fileIds) {
      const f = state.files.find(x => x.id === fid);
      if (!f) continue;
      const newRel = [...pathSegs, f.name].join('/');
      moves.push({ fileId: fid, fromPath: f.originalPath, toPath: newRel, reason: 'reorganize' });
    }
    for (const c of node.children) walk(c, [...pathSegs, c.name]);
  };
  // The root node's name is the source folder; we don't include it in
  // move targets — the proposed children become top-level folders inside the root.
  for (const c of state.proposedTree.children) {
    walk(c, [c.name]);
  }

  // Files flagged as junk / duplicate / empty go to _Review-for-Deletion/.
  for (const f of state.files) {
    if (!f.flag) continue;
    const sub = f.flag === 'junk' ? 'junk'
              : f.flag === 'duplicate' ? 'duplicates'
              : f.flag === 'empty' ? 'empty'
              : 'other';
    reviewMoves.push({
      fileId: f.id,
      fromPath: f.originalPath,
      toPath: `${REVIEW_FOLDER}/${sub}/${f.originalPath}`,
      kind: f.flag
    });
  }

  state.movePlan = moves;
  state.reviewMoves = reviewMoves;
  return { moves, reviewMoves };
}

function renderReview() {
  const stamp = nowStamp();
  const backupName = `${BACKUP_PREFIX}${stamp}`;
  state._backupName = backupName;

  $('#review-folder-name').textContent = state.rootName;
  $('#review-backup-name').textContent = backupName;
  $('#review-move-count').textContent = fmtNum(state.movePlan.length);
  $('#review-deletion-count').textContent = fmtNum(state.reviewMoves.length);

  // Top 200 moves — keep DOM light.
  const tbody = $('#move-plan tbody');
  tbody.innerHTML = '';
  const preview = state.movePlan.slice(0, 200);
  for (const m of preview) {
    tbody.append(el('tr', {},
      el('td', {}, m.fromPath),
      el('td', {}, '→'),
      el('td', {}, m.toPath)
    ));
  }
  // Reset confirmations
  for (const c of $$('.confirmations input')) c.checked = false;
  $('#btn-execute').disabled = true;
}


/* ─── 9. Execution ─── */

// Resolve a relative path inside a directory handle, creating directories as needed.
async function ensureDir(rootHandle, relPath) {
  const parts = relPath.split('/').filter(Boolean);
  let dir = rootHandle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}

async function getDir(rootHandle, relPath) {
  const parts = relPath.split('/').filter(Boolean);
  let dir = rootHandle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: false });
  }
  return dir;
}

// Resolve a directory handle for the parent of the given relative file path,
// creating directories along the way. Returns { parentDir, fileName }.
async function ensureParent(rootHandle, relFilePath) {
  const segs = relFilePath.split('/');
  const fileName = segs.pop();
  const parentDir = segs.length ? await ensureDir(rootHandle, segs.join('/')) : rootHandle;
  return { parentDir, fileName };
}

// Copy a file by streaming.
async function copyFile(srcHandle, dstParent, dstName) {
  const file = await srcHandle.getFile();
  const writable = await dstParent.getFileHandle(dstName, { create: true })
    .then(h => h.createWritable());
  await writable.write(file);
  await writable.close();
}

// Move a file: copy then delete original.
async function moveFile(srcParent, srcName, dstParent, dstName) {
  const srcHandle = await srcParent.getFileHandle(srcName);
  await copyFile(srcHandle, dstParent, dstName);
  await srcParent.removeEntry(srcName);
}

// If the destination already has a file with the same name, append ".1", ".2", ...
async function uniqueName(parentDir, name) {
  let candidate = name;
  let i = 1;
  while (await fileExists(parentDir, candidate)) {
    const dot = name.lastIndexOf('.');
    if (dot > 0) candidate = `${name.slice(0, dot)}.${i}${name.slice(dot)}`;
    else candidate = `${name}.${i}`;
    i++;
    if (i > 1000) break;
  }
  return candidate;
}

async function fileExists(parentDir, name) {
  try { await parentDir.getFileHandle(name); return true; }
  catch { return false; }
}

function logExec(msg, isErr = false) {
  const ul = $('#execute-log');
  ul.append(el('li', { class: isErr ? 'err' : '' }, msg));
  ul.scrollTop = ul.scrollHeight;
}

async function executeReorganization() {
  setPhase('executing');
  const status = $('#execute-status');
  const bar = $('#execute-progress');
  $('#execute-log').innerHTML = '';
  bar.value = 0;

  const root = state.rootHandle;
  const backupName = state._backupName;
  const totalSteps = state.files.length + state.movePlan.length + state.reviewMoves.length;
  let stepsDone = 0;
  const advance = () => { stepsDone++; bar.value = (stepsDone / totalSteps) * 100; };

  try {
    // ── 9a. Backup snapshot ─────────────────────────────
    status.textContent = `Creating backup ${backupName}…`;
    logExec(`Creating ${backupName}/`);
    const backupRoot = await ensureDir(root, backupName);

    // Copy every file (including ones flagged as junk/duplicate — backup is exhaustive).
    let copied = 0;
    for (const f of state.files) {
      if (f.unreadable) { advance(); continue; }
      try {
        const { parentDir, fileName } = await ensureParent(backupRoot, f.originalPath);
        await copyFile(f.handle, parentDir, fileName);
        copied++;
      } catch (err) {
        logExec(`× backup failed: ${f.originalPath} (${err.message})`, true);
      }
      advance();
      if (copied % 25 === 0) {
        status.textContent = `Backing up… ${fmtNum(copied)}/${fmtNum(state.files.length)}`;
        await tick();
      }
    }
    logExec(`Backed up ${fmtNum(copied)} of ${fmtNum(state.files.length)} files.`);

    // Save manifest.json into the backup folder.
    const manifest = {
      tool: 'CMA Folder Reorganizer',
      version: '1.0',
      timestamp: new Date().toISOString(),
      sourceFolder: state.rootName,
      strategy: state.strategy,
      backupFolder: backupName,
      reviewFolder: REVIEW_FOLDER,
      files: state.files.map(f => ({
        id: f.id,
        originalPath: f.originalPath,
        size: f.size,
        modified: f.modified,
        ext: f.ext,
        category: f.category,
        flag: f.flag,
        hash: f.hash
      })),
      moves: state.movePlan,
      reviewMoves: state.reviewMoves
    };
    const manifestStr = JSON.stringify(manifest, null, 2);
    const manifestHandle = await backupRoot.getFileHandle('manifest.json', { create: true });
    const writable = await manifestHandle.createWritable();
    await writable.write(new Blob([manifestStr], { type: 'application/json' }));
    await writable.close();
    logExec(`Wrote ${backupName}/manifest.json (${fmtBytes(manifestStr.length)}).`);

    // ── 9b. Apply the reorganization moves ──────────────
    status.textContent = 'Moving files into the new structure…';
    let moved = 0;
    for (const m of state.movePlan) {
      const f = state.files.find(x => x.id === m.fileId);
      if (!f || f.unreadable) { advance(); continue; }
      try {
        const { parentDir: dstParent, fileName: dstName } = await ensureParent(root, m.toPath);
        const finalName = await uniqueName(dstParent, dstName);
        await moveFile(f.parentHandle, f.name, dstParent, finalName);
        moved++;
      } catch (err) {
        logExec(`× move failed: ${m.fromPath} → ${m.toPath} (${err.message})`, true);
      }
      advance();
      if (moved % 25 === 0) {
        status.textContent = `Moving… ${fmtNum(moved)}/${fmtNum(state.movePlan.length)}`;
        await tick();
      }
    }
    logExec(`Moved ${fmtNum(moved)} of ${fmtNum(state.movePlan.length)} files into the new structure.`);

    // ── 9c. Route flagged files to the review folder ────
    status.textContent = 'Routing duplicates / junk to review folder…';
    let routed = 0;
    for (const m of state.reviewMoves) {
      const f = state.files.find(x => x.id === m.fileId);
      if (!f || f.unreadable) { advance(); continue; }
      try {
        const { parentDir: dstParent, fileName: dstName } = await ensureParent(root, m.toPath);
        const finalName = await uniqueName(dstParent, dstName);
        await moveFile(f.parentHandle, f.name, dstParent, finalName);
        routed++;
      } catch (err) {
        logExec(`× review-move failed: ${m.fromPath} (${err.message})`, true);
      }
      advance();
    }
    logExec(`Moved ${fmtNum(routed)} flagged files to ${REVIEW_FOLDER}/.`);

    // ── 9d. Best-effort cleanup of newly-emptied source folders ────
    status.textContent = 'Cleaning up empty source folders…';
    await pruneEmptyDirs(root, '', new Set([backupName, REVIEW_FOLDER, ...state.proposedTree.children.map(c => c.name)]));

    bar.value = 100;
    status.textContent = 'Done.';
    showDoneScreen({ moved, copied, routed, backupName });

  } catch (err) {
    console.error(err);
    logExec(`Fatal error: ${err.message}`, true);
    alert(`Reorganization failed partway through.\n\n${err.message}\n\nYour backup at ${backupName}/ has the originals.`);
  }
}

// Recursively delete empty directories beneath rootHandle, BUT never touch
// directories whose name is in `protect` and never traverse into them either.
async function pruneEmptyDirs(rootHandle, relPath, protect) {
  const names = [];
  for await (const entry of rootHandle.values()) names.push(entry);
  for (const entry of names) {
    if (entry.kind !== 'directory') continue;
    if (relPath === '' && protect.has(entry.name)) continue;
    const sub = await rootHandle.getDirectoryHandle(entry.name, { create: false });
    await pruneEmptyDirs(sub, `${relPath}${entry.name}/`, protect);
    // Re-check whether it's now empty.
    let empty = true;
    for await (const _ of sub.values()) { empty = false; break; }
    if (empty) {
      try {
        await rootHandle.removeEntry(entry.name);
        logExec(`Removed empty folder: ${relPath}${entry.name}/`);
      } catch (err) {
        logExec(`× could not remove empty folder: ${relPath}${entry.name}/ (${err.message})`, true);
      }
    }
  }
}

function showDoneScreen({ moved, copied, routed, backupName }) {
  $('#done-summary').innerHTML =
    `Reorganization complete. Backed up ${fmtNum(copied)} files, ` +
    `moved ${fmtNum(moved)} into the new structure, and routed ${fmtNum(routed)} duplicates / junk files into <code>${REVIEW_FOLDER}/</code>.`;
  $('#done-backup-path').textContent = `${state.rootName}/${backupName}/`;
  $('#done-review-path').textContent = `${state.rootName}/${REVIEW_FOLDER}/`;
  setPhase('done');
}


/* ─── 10. Bootstrap / event wiring ─── */

function checkBrowserSupport() {
  if (!window.showDirectoryPicker || !window.crypto?.subtle) {
    $('#browser-warning').hidden = false;
    $('#app').hidden = true;
    return false;
  }
  $('#browser-warning').hidden = true;
  $('#app').hidden = false;
  return true;
}

function wireEvents() {
  $('#btn-pick-folder').addEventListener('click', pickFolder);

  $('#btn-back-to-welcome').addEventListener('click', () => setPhase('welcome'));
  $('#btn-go-propose').addEventListener('click', () => {
    state.strategy = $('input[name="strategy"]:checked')?.value || 'type';
    buildProposedTree(state.strategy);
    renderTree();
    setPhase('propose');
  });

  $$('input[name="strategy"]').forEach(r => r.addEventListener('change', () => {
    state.strategy = r.value;
    buildProposedTree(state.strategy);
    renderTree();
  }));

  $('#btn-tree-add-root').addEventListener('click', () => addSubfolder(state.proposedTree));
  $('#btn-tree-expand-all').addEventListener('click', () => expandAll(state.proposedTree, true));
  $('#btn-tree-collapse-all').addEventListener('click', () => expandAll(state.proposedTree, false));

  $('#btn-back-to-analysis').addEventListener('click', () => setPhase('analysis'));
  $('#btn-go-review').addEventListener('click', () => {
    generateMovePlan();
    renderReview();
    setPhase('review');
  });

  $('#btn-back-to-propose').addEventListener('click', () => setPhase('propose'));

  // Enable Execute only when all three confirmations are checked.
  for (const c of $$('.confirmations input')) {
    c.addEventListener('change', () => {
      const allChecked = $$('.confirmations input').every(x => x.checked);
      $('#btn-execute').disabled = !allChecked;
    });
  }

  $('#btn-execute').addEventListener('click', () => {
    if (!confirm(`This will create the backup folder, move ${state.movePlan.length} files, and route ${state.reviewMoves.length} duplicates/junk files to ${REVIEW_FOLDER}/.\n\nProceed?`)) return;
    executeReorganization();
  });

  $('#btn-restart').addEventListener('click', () => location.reload());
}

function init() {
  if (!checkBrowserSupport()) return;
  wireEvents();
  setPhase('welcome');
}

init();
