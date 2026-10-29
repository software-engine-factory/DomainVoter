import type Database from "better-sqlite3";
import { normalizeSetIds } from "../lib/sets";

/**
 * Forward-only migrations tracked with PRAGMA user_version.
 * Version 0 is the original schema created in index.ts; nothing here drops or rewrites existing rows.
 */
const MIGRATIONS: Array<{ version: number; name: string; sql: string; run?: (sqlite: Database.Database) => void }> = [
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
    version: 6,
    name: "pool explorer: derived price source / has-price / label length columns + indexes",
    sql: `
      -- VIRTUAL generated columns: computed on read, no data rewrite, nothing to backfill.
      -- price_source: where the price comes from (landing-page marketplace first, else best_source without its "lp:" prefix);
      -- NULL when the name has no price at all.
      ALTER TABLE pool ADD COLUMN price_source TEXT GENERATED ALWAYS AS (
        CASE
          WHEN lp_price IS NULL AND best_price IS NULL THEN NULL
          WHEN lp_price IS NOT NULL AND nullif(trim(lp_marketplace), '') IS NOT NULL THEN lower(trim(lp_marketplace))
          -- live data (2026-10-25): best_source is only ever NULL or the bare tag 'lp', so 'lp' itself is not a source
          ELSE coalesce(nullif(nullif(lower(trim(replace(replace(best_source, 'lp:', ''), 'LP:', ''))), ''), 'lp'), lower(nullif(trim(lp_marketplace), '')), 'unknown')
        END
      ) VIRTUAL;
      ALTER TABLE pool ADD COLUMN has_price INTEGER GENERATED ALWAYS AS (lp_price IS NOT NULL OR best_price IS NOT NULL) VIRTUAL;
      ALTER TABLE pool ADD COLUMN name_len INTEGER GENERATED ALWAYS AS (instr(name || '.', '.') - 1) VIRTUAL;
      CREATE INDEX IF NOT EXISTS pool_price_source_idx ON pool(price_source, price_usd);
      CREATE INDEX IF NOT EXISTS pool_has_price_idx ON pool(has_price);
      CREATE INDEX IF NOT EXISTS pool_name_len_idx ON pool(name_len);
      CREATE INDEX IF NOT EXISTS pool_lp_url_idx ON pool(lp_url IS NOT NULL);
      CREATE INDEX IF NOT EXISTS pool_currency_idx ON pool(lp_currency);
    `,
  },
  {
    version: 7,
    name: "round funnel: index the parent link, remember how a round was carried over",
    sql: `
      CREATE INDEX IF NOT EXISTS rounds_parent_idx ON rounds(parent_round_id);
      ALTER TABLE rounds ADD COLUMN next_rule TEXT;
    `,
  },
  {
    version: 8,
    name: "retire pool set 2: saved round/batch filters that name set 2 now name set 3",
    sql: "",
    run: (sqlite) => {
      for (const table of ["rounds", "round_batches"]) {
        const exists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
        if (!exists) continue;
        const rows = sqlite.prepare(`SELECT id, filter_json AS json FROM ${table} WHERE filter_json LIKE '%sets%'`).all() as Array<{ id: number; json: string }>;
        const update = sqlite.prepare(`UPDATE ${table} SET filter_json = ? WHERE id = ?`);
        for (const row of rows) {
          const next = remapSetsInFilterJson(row.json);
          if (next !== null) update.run(next, row.id);
        }
      }
    },
  },
  {
    version: 9,
    name: "multi-length pool: shape / set4_part / import_tag / best_currency + per-length set indexes",
    sql: `
      -- Additive only: nullable columns (no table rewrite) and new indexes. Existing rows keep NULLs.
      ALTER TABLE pool ADD COLUMN shape TEXT;
      ALTER TABLE pool ADD COLUMN set4_part TEXT;
      ALTER TABLE pool ADD COLUMN import_tag TEXT;
      ALTER TABLE pool ADD COLUMN best_currency TEXT;
      CREATE INDEX IF NOT EXISTS pool_import_tag_idx ON pool(import_tag) WHERE import_tag IS NOT NULL;
      CREATE INDEX IF NOT EXISTS pool_len_set1_idx ON pool(name_len) WHERE set_1 = 1;
      CREATE INDEX IF NOT EXISTS pool_len_set3_idx ON pool(name_len) WHERE set_3 = 1;
      CREATE INDEX IF NOT EXISTS pool_len_set4_idx ON pool(name_len) WHERE set_4 = 1;
      CREATE INDEX IF NOT EXISTS pool_len_set5_idx ON pool(name_len) WHERE set_5 = 1;
      CREATE INDEX IF NOT EXISTS pool_len_price_idx ON pool(name_len, price_usd);
    `,
  },
  {
    version: 10,
    name: "free_names: admin-only list of unregistered candidates (never shown to voters)",
    sql: `
      CREATE TABLE IF NOT EXISTS free_names (
        name TEXT PRIMARY KEY,
        name_len INTEGER GENERATED ALWAYS AS (instr(name || '.', '.') - 1) VIRTUAL,
        set_1 INTEGER NOT NULL DEFAULT 0,
        set_2 INTEGER NOT NULL DEFAULT 0,
        set_3 INTEGER NOT NULL DEFAULT 0,
        set_4 INTEGER NOT NULL DEFAULT 0,
        set_5 INTEGER NOT NULL DEFAULT 0,
        set4_part TEXT,
        shape TEXT,
        ord INTEGER,
        import_tag TEXT,
        imported_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS free_names_len_ord_idx ON free_names(name_len, ord);
      CREATE INDEX IF NOT EXISTS free_names_tag_idx ON free_names(import_tag) WHERE import_tag IS NOT NULL;
    `,
  },
  {
    version: 11,
    name: "supplement segment: late-imported names appended after a round's frozen order",
    sql: `
      -- NULL = core (the original frozen order). Non-NULL = the import_tag of a supplement appended after it.
      ALTER TABLE domains ADD COLUMN segment TEXT;
      CREATE INDEX IF NOT EXISTS domains_round_segment_idx ON domains(round_id, segment) WHERE segment IS NOT NULL;
      CREATE TABLE IF NOT EXISTS round_supplements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        round_id INTEGER NOT NULL,
        tag TEXT NOT NULL,
        first_position INTEGER NOT NULL,
        added INTEGER NOT NULL,
        seed TEXT,
        created_at INTEGER NOT NULL,
        created_by INTEGER,
        UNIQUE (round_id, tag)
      );
    `,
  },
  {
    version: 12,
    name: "free_names: registration price columns + partial indexes for len/set filters",
    sql: `
      ALTER TABLE free_names ADD COLUMN cf_checked_at INTEGER;
      ALTER TABLE free_names ADD COLUMN reg_price_usd REAL;
      ALTER TABLE free_names ADD COLUMN reg_registrar TEXT;
      -- One small partial index per set flag, so len+set filters on ~1.1M rows stay index-only.
      CREATE INDEX IF NOT EXISTS free_names_s1_idx ON free_names(name_len, ord) WHERE set_1 = 1;
      CREATE INDEX IF NOT EXISTS free_names_s2_idx ON free_names(name_len, ord) WHERE set_2 = 1;
      CREATE INDEX IF NOT EXISTS free_names_s3_idx ON free_names(name_len, ord) WHERE set_3 = 1;
      CREATE INDEX IF NOT EXISTS free_names_s4_idx ON free_names(name_len, ord) WHERE set_4 = 1;
      CREATE INDEX IF NOT EXISTS free_names_s5_idx ON free_names(name_len, ord) WHERE set_5 = 1;
    `,
  },
  {
    version: 13,
    name: "free_names: (name_len, ord, name) index so the browse ORDER BY is index-only (deep pages without a sort)",
    sql: `CREATE INDEX IF NOT EXISTS free_names_len_ord_name_idx ON free_names(name_len, ord, name);`,
  },
  {
    version: 14,
    name: "pool.avail: free-to-register names live in the pool next to the for-sale ones (free_names is drained by lib/free-move)",
    sql: `
      -- 'sale' = purchasable (every row before v14), 'free' = not registered yet (registrable at reg_price_usd).
      ALTER TABLE pool ADD COLUMN avail TEXT NOT NULL DEFAULT 'sale' CHECK (avail IN ('sale', 'free'));
      ALTER TABLE pool ADD COLUMN ord INTEGER;
      ALTER TABLE pool ADD COLUMN reg_price_usd REAL;
      ALTER TABLE pool ADD COLUMN reg_registrar TEXT;
      ALTER TABLE pool ADD COLUMN cf_checked_at INTEGER;
      -- Length (+ set) counts split by availability stay index-only.
      DROP INDEX IF EXISTS pool_name_len_idx;
      CREATE INDEX IF NOT EXISTS pool_len_avail_idx ON pool(name_len, avail);
      DROP INDEX IF EXISTS pool_len_set1_idx;
      DROP INDEX IF EXISTS pool_len_set3_idx;
      DROP INDEX IF EXISTS pool_len_set4_idx;
      DROP INDEX IF EXISTS pool_len_set5_idx;
      CREATE INDEX IF NOT EXISTS pool_len_set1_idx ON pool(name_len, avail) WHERE set_1 = 1;
      CREATE INDEX IF NOT EXISTS pool_len_set3_idx ON pool(name_len, avail) WHERE set_3 = 1;
      CREATE INDEX IF NOT EXISTS pool_len_set4_idx ON pool(name_len, avail) WHERE set_4 = 1;
      CREATE INDEX IF NOT EXISTS pool_len_set5_idx ON pool(name_len, avail) WHERE set_5 = 1;
      -- The free-names list order (length, ord, name), index-only for deep pages.
      CREATE INDEX IF NOT EXISTS pool_free_ord_idx ON pool(name_len, ord, name) WHERE avail = 'free';
      -- free_names is only read by the mover now (by name, its primary key).
      DROP INDEX IF EXISTS free_names_len_ord_idx;
      DROP INDEX IF EXISTS free_names_tag_idx;
      DROP INDEX IF EXISTS free_names_s1_idx;
      DROP INDEX IF EXISTS free_names_s2_idx;
      DROP INDEX IF EXISTS free_names_s3_idx;
      DROP INDEX IF EXISTS free_names_s4_idx;
      DROP INDEX IF EXISTS free_names_s5_idx;
      DROP INDEX IF EXISTS free_names_len_ord_name_idx;
    `,
  },
  {
    version: 15,
    name: "Persist creation jobs and hide incomplete rounds until publication",
    sql: `
      CREATE TABLE creation_jobs (
        id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id),
        request_key TEXT NOT NULL, input_hash TEXT NOT NULL, input_json TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'queued', phase TEXT NOT NULL DEFAULT 'selecting',
        total INTEGER NOT NULL DEFAULT 0, target INTEGER NOT NULL DEFAULT 0, staged INTEGER NOT NULL DEFAULT 0,
        inserted INTEGER NOT NULL DEFAULT 0, cancel_requested INTEGER NOT NULL DEFAULT 0,
        batch_id INTEGER, round_id INTEGER, manifest_sha TEXT, result_url TEXT, error TEXT,
        lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(owner_id, request_key)
      );
      CREATE UNIQUE INDEX creation_jobs_one_active ON creation_jobs((1))
        WHERE state IN ('queued', 'running', 'cancelling');
      ALTER TABLE rounds ADD COLUMN creation_job_id TEXT;
      ALTER TABLE round_batches ADD COLUMN creation_job_id TEXT;
      CREATE INDEX rounds_creation_job_idx ON rounds(creation_job_id) WHERE creation_job_id IS NOT NULL;
    `,
  },
  {
    version: 16,
    name: "Indexed filtering and compact shared round selections",
    sql: `
      CREATE INDEX pool_len_name_idx ON pool(name_len, name);
      CREATE INDEX pool_pos1_idx ON pool(name_len, substr(name,1,1), substr(name,2,1), name);
      CREATE INDEX pool_pos2_idx ON pool(name_len, substr(name,2,1), substr(name,3,1), name);
      CREATE INDEX pool_pos3_idx ON pool(name_len, substr(name,3,1), substr(name,4,1), name);
      CREATE INDEX pool_pos4_idx ON pool(name_len, substr(name,4,1), substr(name,5,1), name);
      CREATE INDEX pool_pos5_idx ON pool(name_len, substr(name,5,1), substr(name,6,1), name);
      CREATE INDEX pool_price_name_idx ON pool(price_usd IS NULL, price_usd, name);
      CREATE INDEX pool_price_desc_name_idx ON pool(price_usd IS NULL, price_usd DESC, name);
      CREATE INDEX pool_len_suffix_idx ON pool(name_len, lower(substr(name,instr(name,'.')+1)), name);
      -- Keeping old suffixes is harmless: candidates still join the current pool. Avoid an O(N) suffix scan per search.
      CREATE TABLE pool_suffixes(suffix TEXT PRIMARY KEY) WITHOUT ROWID;
      INSERT INTO pool_suffixes SELECT DISTINCT lower(substr(name,instr(name,'.')+1)) FROM pool;
      CREATE TRIGGER pool_suffix_insert AFTER INSERT ON pool BEGIN
        INSERT OR IGNORE INTO pool_suffixes VALUES(lower(substr(NEW.name,instr(NEW.name,'.')+1)));
      END;
      CREATE TRIGGER pool_suffix_update AFTER UPDATE OF name ON pool BEGIN
        INSERT OR IGNORE INTO pool_suffixes VALUES(lower(substr(NEW.name,instr(NEW.name,'.')+1)));
      END;
      DROP INDEX IF EXISTS domains_round_name_idx;

      CREATE TABLE domain_selections (
        id INTEGER PRIMARY KEY,
        creation_job_id TEXT UNIQUE,
        batch_id INTEGER UNIQUE REFERENCES round_batches(id) ON DELETE CASCADE
      );
      CREATE TABLE selection_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        selection_id INTEGER NOT NULL REFERENCES domain_selections(id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK(position > 0),
        name TEXT NOT NULL,
        price REAL,
        currency TEXT,
        UNIQUE(selection_id, position)
      );
      CREATE INDEX selection_items_name_idx ON selection_items(name);
      CREATE INDEX selection_items_virtual_id_idx ON selection_items((-id));
      CREATE TABLE round_domain_ranges (
        round_id INTEGER PRIMARY KEY REFERENCES rounds(id) ON DELETE CASCADE,
        selection_id INTEGER NOT NULL REFERENCES domain_selections(id) ON DELETE CASCADE,
        start_position INTEGER NOT NULL CHECK(start_position > 0),
        end_position INTEGER NOT NULL CHECK(end_position >= start_position),
        len_min INTEGER, len_max INTEGER, label_length INTEGER
      );
      CREATE INDEX round_domain_ranges_selection_idx ON round_domain_ranges(selection_id, start_position, end_position);
      CREATE TRIGGER round_ranges_no_overlap_insert BEFORE INSERT ON round_domain_ranges
        WHEN EXISTS (SELECT 1 FROM round_domain_ranges rr WHERE rr.selection_id=NEW.selection_id
          AND NEW.start_position<=rr.end_position AND rr.start_position<=NEW.end_position)
      BEGIN SELECT RAISE(ABORT,'selection_range_overlap'); END;
      CREATE TRIGGER round_ranges_no_overlap_update BEFORE UPDATE ON round_domain_ranges
        WHEN EXISTS (SELECT 1 FROM round_domain_ranges rr WHERE rr.round_id<>OLD.round_id AND rr.selection_id=NEW.selection_id
          AND NEW.start_position<=rr.end_position AND rr.start_position<=NEW.end_position)
      BEGIN SELECT RAISE(ABORT,'selection_range_overlap'); END;

      CREATE VIEW domain_catalog AS
        SELECT id, round_id, position, name, price, is_premium, source_domain_id, pool_name, currency, segment FROM domains
        UNION ALL
        SELECT -i.id, rr.round_id, i.position - rr.start_position + 1, i.name, i.price, 0, NULL, i.name, i.currency, NULL
        FROM round_domain_ranges rr
        JOIN rounds r ON r.id = rr.round_id AND r.creation_job_id IS NULL
        JOIN selection_items i ON i.selection_id = rr.selection_id
          AND i.position BETWEEN rr.start_position AND rr.end_position
        WHERE NOT EXISTS (SELECT 1 FROM domains hydrated WHERE hydrated.id = -i.id);

      -- A derived row may point at a virtual parent. Materialize only that parent to retain the existing FK.
      CREATE TRIGGER domains_materialize_source BEFORE INSERT ON domains
        WHEN NEW.source_domain_id < 0 AND NOT EXISTS (SELECT 1 FROM domains WHERE id = NEW.source_domain_id)
      BEGIN
        INSERT INTO domains(id, round_id, position, name, price, is_premium, source_domain_id, pool_name, currency, segment)
          SELECT id, round_id, position, name, price, is_premium, source_domain_id, pool_name, currency, segment
          FROM domain_catalog WHERE id = NEW.source_domain_id;
      END;
    `,
  },
  {
    version: 17,
    name: "Maintain pool totals and invalidate membership counts on catalog changes",
    sql: `
      CREATE TABLE pool_length_totals (
        name_len INTEGER NOT NULL, avail TEXT NOT NULL, n INTEGER NOT NULL,
        PRIMARY KEY(name_len, avail)
      ) WITHOUT ROWID;
      INSERT INTO pool_length_totals SELECT name_len, avail, COUNT(*) FROM pool GROUP BY name_len, avail;
      CREATE TRIGGER pool_totals_insert AFTER INSERT ON pool BEGIN
        INSERT INTO pool_length_totals VALUES(NEW.name_len, NEW.avail, 1)
          ON CONFLICT(name_len,avail) DO UPDATE SET n=n+1;
      END;
      CREATE TRIGGER pool_totals_delete AFTER DELETE ON pool BEGIN
        UPDATE pool_length_totals SET n=n-1 WHERE name_len=OLD.name_len AND avail=OLD.avail;
      END;
      CREATE TRIGGER pool_totals_update AFTER UPDATE OF name,avail ON pool
        WHEN OLD.name_len<>NEW.name_len OR OLD.avail<>NEW.avail BEGIN
        UPDATE pool_length_totals SET n=n-1 WHERE name_len=OLD.name_len AND avail=OLD.avail;
        INSERT INTO pool_length_totals VALUES(NEW.name_len, NEW.avail, 1)
          ON CONFLICT(name_len,avail) DO UPDATE SET n=n+1;
      END;

      CREATE TABLE catalog_revision(id INTEGER PRIMARY KEY CHECK(id=1), n INTEGER NOT NULL);
      INSERT INTO catalog_revision VALUES(1,0);
      CREATE TRIGGER catalog_domain_insert AFTER INSERT ON domains WHEN NEW.id>0 BEGIN
        UPDATE catalog_revision SET n=n+1 WHERE id=1;
      END;
      CREATE TRIGGER catalog_domain_delete AFTER DELETE ON domains WHEN OLD.id>0 BEGIN
        UPDATE catalog_revision SET n=n+1 WHERE id=1;
      END;
      CREATE TRIGGER catalog_domain_update AFTER UPDATE OF name,pool_name,round_id ON domains
        WHEN OLD.name IS NOT NEW.name OR OLD.pool_name IS NOT NEW.pool_name OR OLD.round_id IS NOT NEW.round_id BEGIN
        UPDATE catalog_revision SET n=n+1 WHERE id=1;
      END;
      CREATE TRIGGER catalog_round_insert AFTER INSERT ON rounds BEGIN
        UPDATE catalog_revision SET n=n+1 WHERE id=1;
      END;
      CREATE TRIGGER catalog_round_delete AFTER DELETE ON rounds BEGIN
        UPDATE catalog_revision SET n=n+1 WHERE id=1;
      END;
      CREATE TRIGGER catalog_round_publish AFTER UPDATE OF creation_job_id ON rounds
        WHEN OLD.creation_job_id IS NOT NEW.creation_job_id BEGIN
        UPDATE catalog_revision SET n=n+1 WHERE id=1;
      END;
      CREATE TRIGGER catalog_range_insert AFTER INSERT ON round_domain_ranges BEGIN
        UPDATE catalog_revision SET n=n+1 WHERE id=1;
      END;
      CREATE TRIGGER catalog_range_delete AFTER DELETE ON round_domain_ranges BEGIN
        UPDATE catalog_revision SET n=n+1 WHERE id=1;
      END;
      CREATE TRIGGER catalog_range_update AFTER UPDATE ON round_domain_ranges BEGIN
        UPDATE catalog_revision SET n=n+1 WHERE id=1;
      END;
    `,
  },
  {
    version: 18,
    name: "Seek price-ordered pages within one label length",
    sql: `
      CREATE INDEX pool_len_price_name_idx ON pool(name_len, price_usd IS NULL, price_usd, name);
      CREATE INDEX pool_len_price_desc_name_idx ON pool(name_len, price_usd IS NULL, price_usd DESC, name);
    `,
  },
];

/** Rewrites set ids 2 → 3 in a stored filter ({sets:[…]} or {explore:{sets:"1,2"}}); null when unchanged or unparseable. */
export function remapSetsInFilterJson(json: string): string | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  let changed = false;
  const fix = (holder: Record<string, unknown>) => {
    const v = holder.sets;
    const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",").filter(Boolean) : typeof v === "number" ? [v] : null;
    if (!list || !list.some((x) => Number(x) === 2)) return;
    const mapped = normalizeSetIds(list);
    holder.legacySets = v; // keep what was stored, for the record
    holder.sets = Array.isArray(v) ? mapped : mapped.join(",");
    changed = true;
  };
  fix(obj);
  if (obj.explore && typeof obj.explore === "object") fix(obj.explore as Record<string, unknown>);
  return changed ? JSON.stringify(obj) : null;
}

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
      if (migration.sql) sqlite.exec(migration.sql);
      migration.run?.(sqlite);
      sqlite.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(migration.version, Date.now());
      const top = sqlite.pragma("user_version", { simple: true }) as number;
      if (migration.version > top) sqlite.pragma(`user_version = ${migration.version}`);
    })();
  }
}

export const LATEST_SCHEMA_VERSION = Math.max(...MIGRATIONS.map((m) => m.version));
