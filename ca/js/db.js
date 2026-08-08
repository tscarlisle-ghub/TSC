// db.js — sql.js (SQLite compiled to WASM) wrapper + CRUD helpers.
// The whole database lives in memory as a Uint8Array that we load at startup
// (from GitHub, from the browser's local save, or from the bundled tasks.db)
// and re-export any time we want to persist a change.

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  address       TEXT,
  phase         TEXT DEFAULT 'CA',
  status        TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','On Hold','Complete')),
  owner_name    TEXT,
  contractor_name TEXT,
  interior_designer_name TEXT,
  created_date  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id        INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  description       TEXT,
  category          TEXT NOT NULL DEFAULT 'General',
  responsible_party TEXT NOT NULL CHECK (responsible_party IN ('Owner','Architect','Interior Designer','Contractor')),
  assigned_name     TEXT,
  priority          TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('High','Medium','Low')),
  status            TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Blocked','Done')),
  task_type         TEXT DEFAULT 'General',
  due_date          TEXT,
  created_date      TEXT NOT NULL,
  completed_date    TEXT,
  source            TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','email')),
  source_text       TEXT,
  notes             TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
`;

const CATask_DB = (() => {
  let SQL = null;   // sql.js module
  let db = null;    // sql.js Database instance

  async function init(bytes) {
    if (!SQL) {
      SQL = await initSqlJs({
        // Bundled locally (vendor/sqljs/) so the app has no runtime dependency
        // on a CDN being reachable — everything it needs ships in the repo.
        locateFile: (file) => `vendor/sqljs/${file}`,
      });
    }
    db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    db.run(SCHEMA_SQL);
    return db;
  }

  function isReady() { return !!db; }

  function exportBytes() {
    return db.export(); // Uint8Array
  }

  // --- generic query helpers ---
  function all(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  function run(sql, params = []) {
    db.run(sql, params);
  }

  function lastId() {
    const r = all('SELECT last_insert_rowid() AS id');
    return r[0].id;
  }

  // --- projects ---
  function getProjects() {
    return all('SELECT * FROM projects ORDER BY name COLLATE NOCASE');
  }

  function getProject(id) {
    return all('SELECT * FROM projects WHERE id = ?', [id])[0] || null;
  }

  function insertProject(p) {
    run(
      `INSERT INTO projects (name, address, phase, status, owner_name, contractor_name, interior_designer_name, created_date)
       VALUES (?,?,?,?,?,?,?,?)`,
      [p.name, p.address || '', p.phase || 'CA', p.status || 'Active',
        p.owner_name || '', p.contractor_name || '', p.interior_designer_name || '', todayISO()]
    );
    return lastId();
  }

  function updateProject(id, p) {
    run(
      `UPDATE projects SET name=?, address=?, phase=?, status=?, owner_name=?, contractor_name=?, interior_designer_name=? WHERE id=?`,
      [p.name, p.address || '', p.phase || 'CA', p.status || 'Active',
        p.owner_name || '', p.contractor_name || '', p.interior_designer_name || '', id]
    );
  }

  function deleteProject(id) {
    run('UPDATE tasks SET project_id = NULL WHERE project_id = ?', [id]);
    run('DELETE FROM projects WHERE id = ?', [id]);
  }

  // --- tasks ---
  function getTasks() {
    return all(`
      SELECT t.*, p.name AS project_name
      FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
      ORDER BY t.due_date IS NULL, t.due_date ASC
    `);
  }

  function getTask(id) {
    return all('SELECT * FROM tasks WHERE id = ?', [id])[0] || null;
  }

  function insertTask(t) {
    run(
      `INSERT INTO tasks (project_id, title, description, category, responsible_party, assigned_name,
        priority, status, task_type, due_date, created_date, completed_date, source, source_text, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [t.project_id || null, t.title, t.description || '', t.category || 'General',
        t.responsible_party, t.assigned_name || '', t.priority || 'Medium', t.status || 'Open',
        t.task_type || 'General', t.due_date || null, todayISO(), t.completed_date || null,
        t.source || 'manual', t.source_text || null, t.notes || '']
    );
    return lastId();
  }

  function updateTask(id, t) {
    run(
      `UPDATE tasks SET project_id=?, title=?, description=?, category=?, responsible_party=?, assigned_name=?,
        priority=?, status=?, task_type=?, due_date=?, completed_date=?, notes=? WHERE id=?`,
      [t.project_id || null, t.title, t.description || '', t.category || 'General',
        t.responsible_party, t.assigned_name || '', t.priority || 'Medium', t.status || 'Open',
        t.task_type || 'General', t.due_date || null, t.completed_date || null, t.notes || '', id]
    );
  }

  function deleteTask(id) {
    run('DELETE FROM tasks WHERE id = ?', [id]);
  }

  function setStatus(id, status) {
    const completed = status === 'Done' ? todayISO() : null;
    run('UPDATE tasks SET status=?, completed_date=? WHERE id=?', [status, completed, id]);
  }

  return {
    init, isReady, exportBytes,
    getProjects, getProject, insertProject, updateProject, deleteProject,
    getTasks, getTask, insertTask, updateTask, deleteTask, setStatus,
  };
})();
