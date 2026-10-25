import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { hashSync } from "bcryptjs";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { dataDir as resolveDataDir } from "@/lib/paths";
import { runMigrations } from "./migrations";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  sqlite?: Database.Database;
};

function createSqlite() {
  const dataDir = resolveDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(path.join(dataDir, "voting.db"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'voter')),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
      parent_round_id INTEGER REFERENCES rounds(id),
      filter_json TEXT,
      sort_mode TEXT,
      created_at INTEGER NOT NULL,
      opened_at INTEGER,
      closed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS domains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id INTEGER NOT NULL REFERENCES rounds(id),
      position INTEGER NOT NULL,
      name TEXT NOT NULL,
      price REAL,
      is_premium INTEGER NOT NULL DEFAULT 0,
      source_domain_id INTEGER REFERENCES domains(id),
      UNIQUE (round_id, position),
      UNIQUE (round_id, name)
    );

    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id INTEGER NOT NULL REFERENCES rounds(id),
      domain_id INTEGER NOT NULL REFERENCES domains(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      UNIQUE (domain_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id INTEGER NOT NULL REFERENCES rounds(id),
      domain_id INTEGER NOT NULL REFERENCES domains(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      viewed_at INTEGER NOT NULL,
      UNIQUE (domain_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS votes_round_idx ON votes(round_id);
    CREATE INDEX IF NOT EXISTS views_round_idx ON views(round_id);
    CREATE INDEX IF NOT EXISTS domains_round_idx ON domains(round_id);
  `);

  runMigrations(sqlite);

  const existing = sqlite.prepare("SELECT id FROM users WHERE username = ?").get("admin");
  if (!existing) {
    sqlite
      .prepare(
        "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, 'admin', ?)",
      )
      .run("admin", hashSync("admin", 10), Date.now());
  }

  return sqlite;
}

export function getSqlite() {
  if (!globalForDb.sqlite) {
    globalForDb.sqlite = createSqlite();
  }
  return globalForDb.sqlite;
}

export function getDb() {
  return drizzle(getSqlite(), { schema });
}
