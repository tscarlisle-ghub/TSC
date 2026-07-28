-- CMA Construction Administration — Task Manager
-- SQLite schema. Applied once when tasks.db is first built; kept here for reference
-- and so the schema can be regenerated or migrated by hand later.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,              -- short project name, e.g. "Davis – Liberty Park"
  address       TEXT,
  phase         TEXT DEFAULT 'CA',          -- SD / DD / CD / CA
  status        TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','On Hold','Complete')),
  owner_name    TEXT,
  contractor_name TEXT,
  interior_designer_name TEXT,
  created_date  TEXT NOT NULL               -- ISO date, set at insert time
);

CREATE TABLE IF NOT EXISTS tasks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id        INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  description       TEXT,
  category          TEXT NOT NULL DEFAULT 'General',
    -- construction category / trade, see CATEGORY list in js/app.js
  responsible_party TEXT NOT NULL CHECK (responsible_party IN ('Owner','Architect','Interior Designer','Contractor')),
  assigned_name     TEXT,                   -- optional specific person's name
  priority          TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('High','Medium','Low')),
  status            TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Blocked','Done')),
  task_type         TEXT DEFAULT 'General', -- RFI / Submittal / Change Order / Punch List / Payment / Inspection / Site Visit / General
  due_date          TEXT,                   -- ISO date, nullable
  created_date      TEXT NOT NULL,          -- ISO date
  completed_date    TEXT,
  source            TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','email')),
  source_text       TEXT,                   -- original pasted email text, if parsed
  notes             TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
