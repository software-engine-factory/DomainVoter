import { test } from "node:test";
import assert from "node:assert/strict";

// Migration 20: users.display_name is shown instead of the username when set; login still matches username.
const j = globalThis.__dvJiti;
const { getSqlite } = await j.import("@/db");
const { runMigrations } = await j.import("@/db/migrations");
const { shownNameSql, shownNameFor } = await j.import("@/lib/display-name");
const { listAssignableUsers } = await j.import("@/lib/assignees");
const { getUser } = await j.import("@/lib/insights");
const db = getSqlite();

test("migration 20 adds a nullable users.display_name; replay applies nothing", () => {
  const info = db.prepare("PRAGMA table_info(users)").all().find((c) => c.name === "display_name");
  assert.ok(info);
  assert.equal(info.notnull, 0);
  assert.equal(info.dflt_value, null);
  const before = db.prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version").all();
  assert.ok(before.some((r) => r.version === 20));
  runMigrations(db);
  assert.deepEqual(db.prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version").all(), before);
});

test("shown name: display_name when set, else username; blank counts as unset", () => {
  const id = Number(db.prepare("INSERT INTO users (username, password_hash, role, created_at) VALUES ('zdn_user', 'x', 'voter', 1)").run().lastInsertRowid);
  const shown = () => db.prepare(`SELECT ${shownNameSql("u")} AS n FROM users u WHERE u.id = ?`).get(id).n;
  assert.equal(shown(), "zdn_user");
  assert.equal(shownNameFor(id, "fallback"), "zdn_user");
  db.prepare("UPDATE users SET display_name = '  ' WHERE id = ?").run(id);
  assert.equal(shown(), "zdn_user");
  db.prepare("UPDATE users SET display_name = 'مختاری' WHERE id = ?").run(id);
  assert.equal(shown(), "مختاری");
  assert.equal(shownNameFor(id, "fallback"), "مختاری");
  assert.equal(shownNameFor(999_999, "fallback"), "fallback");
  const picker = listAssignableUsers().find((u) => u.id === id);
  assert.deepEqual([picker.username, picker.login], ["مختاری", "zdn_user"]);
  const user = getUser(id);
  assert.deepEqual([user.username, user.login], ["مختاری", "zdn_user"]);
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
});
