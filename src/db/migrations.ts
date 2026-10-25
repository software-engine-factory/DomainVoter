import type Database from "better-sqlite3";

/**
 * Forward-only migrations tracked with PRAGMA user_version.
 * Version 0 is the original schema created in index.ts; nothing here drops or rewrites existing rows.
 */
const MIGRATIONS: Array<{ version: number; name: string; sql: string }> = [
  {
    version: 1,
    name: "for-sale pool",
    sql: `
      CREATE TABLE IF NOT EXISTS pool (
        name TEXT PRIMARY KEY,
        set_1 INTEGER NOT NULL DEFAULT 0,
        set_2 INTEGER NOT NULL DEFAULT 0,
        set_3 INTEGER NOT NULL DEFAULT 0,
        set_4 INTEGER NOT NULL DEFAULT 0,
        set_5 INTEGER NOT NULL DEFAULT 0,
        evidence TEXT,
        dns_ns_class TEXT,
        dns_parking_provider TEXT,
        lp_marketplace TEXT,
        lp_price REAL,
        lp_currency TEXT,
        lp_url TEXT,
        best_price REAL,
        best_source TEXT,
        price_usd REAL,
        imported_at INTEGER NOT NULL
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS pool_class_idx ON pool(dns_ns_class);
      CREATE INDEX IF NOT EXISTS pool_provider_idx ON pool(dns_parking_provider);
      CREATE INDEX IF NOT EXISTS pool_evidence_idx ON pool(evidence);
      CREATE INDEX IF NOT EXISTS pool_price_usd_idx ON pool(price_usd);
      CREATE INDEX IF NOT EXISTS pool_set1_idx ON pool(set_1) WHERE set_1 = 1;
      CREATE INDEX IF NOT EXISTS pool_set2_idx ON pool(set_2) WHERE set_2 = 1;
      CREATE INDEX IF NOT EXISTS pool_set3_idx ON pool(set_3) WHERE set_3 = 1;
      CREATE INDEX IF NOT EXISTS pool_set4_idx ON pool(set_4) WHERE set_4 = 1;
      CREATE INDEX IF NOT EXISTS pool_set5_idx ON pool(set_5) WHERE set_5 = 1;

      CREATE TABLE IF NOT EXISTS imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        rows_read INTEGER NOT NULL DEFAULT 0,
        rows_upserted INTEGER NOT NULL DEFAULT 0,
        rows_skipped INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );

      ALTER TABLE rounds ADD COLUMN source TEXT NOT NULL DEFAULT 'csv';
      ALTER TABLE domains ADD COLUMN pool_name TEXT;
      ALTER TABLE domains ADD COLUMN currency TEXT;
      CREATE INDEX IF NOT EXISTS domains_pool_name_idx ON domains(pool_name);
      CREATE INDEX IF NOT EXISTS domains_round_price_idx ON domains(round_id, price);
      CREATE INDEX IF NOT EXISTS domains_round_name_idx ON domains(round_id, name);
      CREATE INDEX IF NOT EXISTS votes_domain_idx ON votes(domain_id);
      CREATE INDEX IF NOT EXISTS views_domain_idx ON views(domain_id);
    `,
  },
  {
    version: 2,
    name: "curated picks",
    sql: `
      CREATE TABLE IF NOT EXISTS picks (
        name TEXT PRIMARY KEY,
        note TEXT,
        created_at INTEGER NOT NULL,
        created_by INTEGER REFERENCES users(id)
      );
    `,
  },
  {
    version: 3,
    name: "admin insights: bookmark provenance, round batches, activity indexes",
    sql: `
      ALTER TABLE picks ADD COLUMN status TEXT NOT NULL DEFAULT 'shortlist';
      ALTER TABLE picks ADD COLUMN source_user_id INTEGER;
      ALTER TABLE picks ADD COLUMN bonus_user_id INTEGER;
      ALTER TABLE picks ADD COLUMN updated_at INTEGER;

      -- Who had chosen a name when the admin bookmarked it. Kept even if the voter later removes the vote.
      CREATE TABLE IF NOT EXISTS pick_provenance (
        name TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        round_id INTEGER NOT NULL,
        domain_id INTEGER NOT NULL,
        voted_at INTEGER NOT NULL,
        captured_at INTEGER NOT NULL,
        PRIMARY KEY (name, user_id, round_id)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS pick_provenance_user_idx ON pick_provenance(user_id);

      CREATE TABLE IF NOT EXISTS round_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        filter_json TEXT NOT NULL,
        order_mode TEXT NOT NULL,
        seed TEXT,
        block_total INTEGER NOT NULL,
        per_round INTEGER NOT NULL,
        rounds_planned INTEGER NOT NULL,
        remainder_mode TEXT NOT NULL DEFAULT 'extra',
        created_at INTEGER NOT NULL,
        created_by INTEGER
      );
      -- Frozen, ordered block so later rounds of a batch are cut from exactly the same list.
      CREATE TABLE IF NOT EXISTS round_batch_items (
        batch_id INTEGER NOT NULL,
        position INTEGER NOT NULL,
        name TEXT NOT NULL,
        PRIMARY KEY (batch_id, position)
      ) WITHOUT ROWID;
      ALTER TABLE rounds ADD COLUMN batch_id INTEGER;
      ALTER TABLE rounds ADD COLUMN batch_index INTEGER;
      CREATE INDEX IF NOT EXISTS rounds_batch_idx ON rounds(batch_id, batch_index);

      CREATE INDEX IF NOT EXISTS views_user_time_idx ON views(user_id, viewed_at);
      CREATE INDEX IF NOT EXISTS views_time_idx ON views(viewed_at);
      CREATE INDEX IF NOT EXISTS votes_user_time_idx ON votes(user_id, created_at);
      CREATE INDEX IF NOT EXISTS votes_time_idx ON votes(created_at);
      CREATE INDEX IF NOT EXISTS domains_name_idx ON domains(name);
    `,
  },
  {
    version: 4,
    name: "app settings (admin UI settings, e.g. names per page)",
    sql: `
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by INTEGER
      ) WITHOUT ROWID;
    `,
  },
  {
    version: 5,
    name: "optional round assignees (who may see a round; none = everyone)",
    sql: `
      CREATE TABLE IF NOT EXISTS round_assignees (
        round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (round_id, user_id)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS round_assignees_user_idx ON round_assignees(user_id);
      -- Batch-level default so rounds opened later from the same batch get the same people.
      CREATE TABLE IF NOT EXISTS round_batch_assignees (
        batch_id INTEGER NOT NULL REFERENCES round_batches(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (batch_id, user_id)
      ) WITHOUT ROWID;
    `,
  },
  {
    // 7, not 6: W3 (explore) claims 6. Idempotent so the order they land in doesn't matter.
    version: 7,
    name: "round funnel: index the parent link, remember how a round was carried over",
    sql: `
      CREATE INDEX IF NOT EXISTS rounds_parent_idx ON rounds(parent_round_id);
      ALTER TABLE rounds ADD COLUMN next_rule TEXT;
    `,
  },
];

/**
 * Applies every migration not yet recorded in schema_migrations, so parallel branches can land
 * numbered migrations in any order (e.g. 7 before 6). user_version stays the highest applied number.
 */
export function runMigrations(sqlite: Database.Database) {
  const current = sqlite.pragma("user_version", { simple: true }) as number;
  sqlite.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const known = sqlite.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number };
  if (known.n === 0 && current > 0) {
    // Databases from before this table: everything up to user_version was applied in order.
    const mark = sqlite.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)");
    for (const m of MIGRATIONS) if (m.version <= current) mark.run(m.version, Date.now());
  }
  const applied = new Set((sqlite.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map((r) => r.version));
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    sqlite.transaction(() => {
      sqlite.exec(migration.sql);
      sqlite.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(migration.version, Date.now());
      const top = sqlite.pragma("user_version", { simple: true }) as number;
      if (migration.version > top) sqlite.pragma(`user_version = ${migration.version}`);
    })();
  }
}

export const LATEST_SCHEMA_VERSION = Math.max(...MIGRATIONS.map((m) => m.version));
