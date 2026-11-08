import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('backlog','todo','agent_ready','in_progress','blocked','review','done')),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),
  labels TEXT NOT NULL DEFAULT '[]',
  due_date TEXT,
  linked_path TEXT,
  toggles TEXT NOT NULL,
  model TEXT,
  session_id TEXT,
  workspace TEXT,
  branch TEXT,
  run_state TEXT NOT NULL DEFAULT 'idle' CHECK (run_state IN ('idle','queued','running','waiting_limit')),
  run_started_at TEXT,
  ready_at TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author TEXT NOT NULL CHECK (author IN ('user','agent','system')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_ticket ON comments(ticket_id);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL,
  mime TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_ticket ON attachments(ticket_id);

CREATE TABLE IF NOT EXISTS spend_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  service TEXT NOT NULL,
  unit TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  estimate REAL NOT NULL CHECK (estimate >= 0),
  max REAL NOT NULL CHECK (max >= 0),
  used REAL NOT NULL DEFAULT 0 CHECK (used >= 0),
  UNIQUE (ticket_id, service)
);

CREATE TABLE IF NOT EXISTS log_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS log_lines_ticket ON log_lines(ticket_id, id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export type Db = DatabaseSync;

/** Rebuilds the tickets table when its status CHECK predates a new status (SQLite can't alter a CHECK). */
function migrateStatusCheck(db: DatabaseSync) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tickets'").get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'in_progress'")) return;
  const newSql = row.sql.replace("'agent_ready',", "'agent_ready','in_progress',").replace(/CREATE TABLE "?tickets"?/, "CREATE TABLE tickets_new");
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN");
  try {
    db.exec(newSql);
    db.exec("INSERT INTO tickets_new SELECT * FROM tickets");
    db.exec("DROP TABLE tickets");
    db.exec("ALTER TABLE tickets_new RENAME TO tickets");
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

export function openDb(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  migrateStatusCheck(db);
  db.exec(SCHEMA);
  return db;
}

/** Runs fn inside a transaction; rolls back if it throws. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
