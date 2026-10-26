import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "voter"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const rounds = sqliteTable("rounds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  status: text("status", { enum: ["open", "closed"] }).notNull(),
  parentRoundId: integer("parent_round_id"),
  filterJson: text("filter_json"),
  sortMode: text("sort_mode"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  openedAt: integer("opened_at", { mode: "timestamp_ms" }),
  closedAt: integer("closed_at", { mode: "timestamp_ms" }),
  source: text("source", { enum: ["csv", "pool"] }).notNull().default("csv"),
  batchId: integer("batch_id"),
  batchIndex: integer("batch_index"),
  nextRule: text("next_rule"),
});

export const domains = sqliteTable(
  "domains",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roundId: integer("round_id").notNull(),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    price: real("price"),
    isPremium: integer("is_premium", { mode: "boolean" }).notNull().default(false),
    sourceDomainId: integer("source_domain_id"),
    poolName: text("pool_name"),
    currency: text("currency"),
    segment: text("segment"),
  },
  (table) => [
    uniqueIndex("domains_round_position").on(table.roundId, table.position),
    uniqueIndex("domains_round_name").on(table.roundId, table.name),
  ],
);

export const votes = sqliteTable(
  "votes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roundId: integer("round_id").notNull(),
    domainId: integer("domain_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("votes_domain_user").on(table.domainId, table.userId)],
);

export const views = sqliteTable(
  "views",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roundId: integer("round_id").notNull(),
    domainId: integer("domain_id").notNull(),
    userId: integer("user_id").notNull(),
    viewedAt: integer("viewed_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("views_domain_user").on(table.domainId, table.userId)],
);

export const pool = sqliteTable("pool", {
  name: text("name").primaryKey(),
  set1: integer("set_1").notNull(),
  set2: integer("set_2").notNull(),
  set3: integer("set_3").notNull(),
  set4: integer("set_4").notNull(),
  set5: integer("set_5").notNull(),
  evidence: text("evidence"),
  dnsNsClass: text("dns_ns_class"),
  dnsParkingProvider: text("dns_parking_provider"),
  lpMarketplace: text("lp_marketplace"),
  lpPrice: real("lp_price"),
  lpCurrency: text("lp_currency"),
  lpUrl: text("lp_url"),
  bestPrice: real("best_price"),
  bestSource: text("best_source"),
  priceUsd: real("price_usd"),
  shape: text("shape"),
  set4Part: text("set4_part"),
  importTag: text("import_tag"),
  bestCurrency: text("best_currency"),
  importedAt: integer("imported_at").notNull(),
});

export const picks = sqliteTable("picks", {
  name: text("name").primaryKey(),
  note: text("note"),
  createdAt: integer("created_at").notNull(),
  createdBy: integer("created_by"),
  status: text("status").notNull().default("shortlist"),
  sourceUserId: integer("source_user_id"),
  bonusUserId: integer("bonus_user_id"),
  updatedAt: integer("updated_at"),
});
