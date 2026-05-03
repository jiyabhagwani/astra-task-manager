const Database = require('better-sqlite3');
const path = require('path');

// Railway/Production safe DB path
const dbPath =
  process.env.NODE_ENV === 'production'
    ? '/tmp/taskmanager.db'
    : path.join(__dirname, 'taskmanager.db');

// Connect DB
const db = new Database(dbPath);

// ─────────────────────────────────────────────
// CREATE TABLES
// ─────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'member'
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS project_members (
    project_id INTEGER,
    user_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending',
    project_id INTEGER,
    assigned_to INTEGER,
    due_date TEXT,
    priority TEXT DEFAULT 'medium',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ─────────────────────────────────────────────
// SAFE MIGRATION FOR OLD DATABASES
// Adds missing columns without crashing
// ─────────────────────────────────────────────
try {
  const taskColumns = db.prepare(`
    PRAGMA table_info(tasks)
  `).all();

  const hasPriority = taskColumns.some(
    col => col.name === 'priority'
  );

  if (!hasPriority) {
    db.exec(`
      ALTER TABLE tasks
      ADD COLUMN priority TEXT DEFAULT 'medium'
    `);
  }

} catch (err) {
  console.log(
    'Priority migration skipped:',
    err.message
  );
}

// ─────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────
module.exports = db;
