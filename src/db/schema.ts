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
