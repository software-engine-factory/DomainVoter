// Local test data only: node scripts/seed-synthetic.mjs <data-dir> [lengths, e.g. 4 or 3,4,5]
// Requires the app to have started once against <data-dir> (so the schema and migrations exist).
import path from "path";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

const dir = process.argv[2] || "data";
const LENGTHS = (process.argv[3] || "4").split(",").map(Number).filter((n) => n >= 1 && n <= 63);
const db = new Database(path.join(dir, "voting.db"));
let seed = 42;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const L = "abcdefghijklmnopqrstuvwxyz";
const providers = [["marketplace", "afternic"], ["marketplace", "sedo"], ["investor", "namefind"], ["marketplace", "atom"], ["parking", "bodis"], [null, null]];
const now = Date.now();
const DAY = 86400000;

db.transaction(() => {
  const ins = db.prepare(`INSERT OR IGNORE INTO pool (name,set_1,set_2,set_3,set_4,set_5,evidence,dns_ns_class,dns_parking_provider,lp_marketplace,lp_price,lp_currency,lp_url,best_price,best_source,price_usd,imported_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (let i = 0; i < 20000; i++) {
    const name = Array.from({ length: pick(LENGTHS) }, () => pick(L)).join("") + ".com";
    const [cls, prov] = pick(providers);
    const sale = rnd() < 0.7;
    const price = sale && rnd() < 0.2 ? Math.round(500 + rnd() * 20000) : null;
    ins.run(name, +(rnd() < 0.5), +(rnd() < 0.3), +(rnd() < 0.2), +(rnd() < 0.1), +(rnd() < 0.15), sale ? "sale_page" : "nameserver",
      cls, prov, sale ? prov ?? "escrow" : null, price, price ? "USD" : null, sale ? `https://example.com/${name}` : null, price, price ? `lp:${prov}` : null, price, now);
  }
  const hash = bcrypt.hashSync("test", 10);
  const users = ["sara", "reza", "mina", "ali", "nima", "leila"].map((u) => {
    db.prepare("INSERT OR IGNORE INTO users (username,password_hash,role,created_at) VALUES (?,?,'voter',?)").run(u, hash, now - 20 * DAY);
    return db.prepare("SELECT id FROM users WHERE username=?").get(u).id;
  });
  const names = db.prepare("SELECT name FROM pool ORDER BY name").all().map((r) => r.name);
  for (let r = 0; r < 3; r++) {
    const created = now - (14 - r * 5) * DAY;
    const id = Number(db.prepare(`INSERT INTO rounds (title,status,parent_round_id,filter_json,sort_mode,created_at,opened_at,source) VALUES (?,?,NULL,'{}','name',?,?,'pool')`)
      .run(`Synthetic round ${r + 1}`, "open", created, created).lastInsertRowid);
    const slice = names.slice(r * 1500, r * 1500 + 1500);
    const insD = db.prepare("INSERT INTO domains (round_id,position,name,price,is_premium,pool_name,currency) SELECT ?,?,name,lp_price,0,name,lp_currency FROM pool WHERE name=?");
    slice.forEach((n, i) => insD.run(id, i + 1, n));
    const doms = db.prepare("SELECT id FROM domains WHERE round_id=? ORDER BY position").all(id).map((d) => d.id);
    for (const u of users) {
      if (rnd() < 0.2) continue;
      const seen = Math.floor(rnd() * doms.length * 0.8);
      for (let k = 0; k < seen; k++) {
        const t = created + Math.floor((k / seen) * (now - created) * rnd() + rnd() * DAY);
        db.prepare("INSERT OR IGNORE INTO views (round_id,domain_id,user_id,viewed_at) VALUES (?,?,?,?)").run(id, doms[k], u, Math.min(t, now));
        if (rnd() < 0.04) db.prepare("INSERT OR IGNORE INTO votes (round_id,domain_id,user_id,created_at) VALUES (?,?,?,?)").run(id, doms[k], u, Math.min(t + 5000, now));
      }
    }
  }
})();
console.log(db.prepare("SELECT (SELECT COUNT(*) FROM pool) p,(SELECT COUNT(*) FROM views) v,(SELECT COUNT(*) FROM votes) vo").get());
