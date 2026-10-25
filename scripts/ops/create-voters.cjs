// Runs INSIDE the app container: reads "username<TAB>password" lines on stdin, creates missing voter
// accounts with the app's bcryptjs settings (hashSync, cost 10). Prints usernames and status only — never passwords.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { hashSync } = require("bcryptjs");

const dbFile = process.env.DV_DB || path.join(process.env.DATA_DIR || "/app/data", "voting.db");
if (!fs.existsSync(dbFile)) {
  console.error(`no database at ${dbFile}`);
  process.exit(1);
}
const db = new Database(dbFile);
const lines = fs.readFileSync(0, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
const exists = db.prepare("SELECT role FROM users WHERE username = ?");
const insert = db.prepare("INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, 'voter', ?)");
const results = [];
db.transaction(() => {
  for (const line of lines) {
    const [username, password] = line.split("\t");
    if (!/^user\d+$/.test(username ?? "") || !password || password.length < 16) throw new Error(`bad input line for ${username ?? "?"}`);
    const row = exists.get(username);
    if (row) results.push(`${username}: already exists (${row.role}), left unchanged`);
    else {
      insert.run(username, hashSync(password, 10), Date.now());
      results.push(`${username}: created (voter)`);
    }
  }
})();
console.log(results.join("\n"));
