const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const requireApp = createRequire('/app/server.js');
const Database = requireApp('better-sqlite3');
const data = process.env.DATA_DIR || '/app/data';
const db = new Database(path.join(data, 'voting.db'));
const statePath = path.join(data, '.perf-setup.json');
let state;
if (fs.existsSync(statePath)) {
  state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
} else {
  const now = Date.now();
  let user = db.prepare("SELECT id FROM users WHERE username='local_perfadmin'").get();
  if (!user) {
    const result = db.prepare("INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?, 'admin',?)").run('local_perfadmin', 'local-only-unused-password-hash', now);
    user = { id: Number(result.lastInsertRowid) };
  }
  let probeUser = db.prepare("SELECT id FROM users WHERE username='local_perfprobe'").get();
  if (!probeUser) {
    const result = db.prepare("INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?, 'voter',?)").run('local_perfprobe', 'local-only-unused-password-hash', now);
    probeUser = { id: Number(result.lastInsertRowid) };
  }
  const result = db.prepare("INSERT INTO rounds(title,status,created_at,opened_at) VALUES('Local constrained benchmark fixture','open',?,?)").run(now, now);
  const roundId = Number(result.lastInsertRowid);
  const insertDomain = db.prepare('INSERT INTO domains(round_id,position,name,price,is_premium,pool_name,currency) VALUES(?,?,?,?,0,?,?)');
  const domainIds = [];
  for (const [i, name] of ['perf-fixture-a.test', 'perf-fixture-b.test', 'perf-fixture-c.test'].entries()) {
    const inserted = insertDomain.run(roundId, i + 1, name, 1, name, 'USD');
    domainIds.push(Number(inserted.lastInsertRowid));
  }
  db.prepare('INSERT INTO votes(round_id,domain_id,user_id,created_at) VALUES(?,?,?,?)').run(roundId, domainIds[0], user.id, now);
  state = { roundId, userId: Number(user.id), probeUserId: Number(probeUser.id), domainIds };
  fs.writeFileSync(statePath, JSON.stringify(state));
}
let secretPath = path.join(data, 'session.secret');
if (!fs.existsSync(secretPath)) fs.writeFileSync(secretPath, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const secret = fs.readFileSync(secretPath, 'utf8');
const body = Buffer.from(JSON.stringify({ userId: state.userId, username: 'local_perfadmin', role: 'admin', exp: Date.now() + 14 * 86400_000 })).toString('base64url');
const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
fs.writeFileSync(path.join(data, '.perf-cookie'), `dv_session=${body}.${signature}`, { mode: 0o600 });
const probeBody = Buffer.from(JSON.stringify({ userId: state.probeUserId, username: 'local_perfprobe', role: 'voter', exp: Date.now() + 14 * 86400_000 })).toString('base64url');
const probeSignature = crypto.createHmac('sha256', secret).update(probeBody).digest('base64url');
fs.writeFileSync(path.join(data, '.perf-probe-cookie'), `dv_session=${probeBody}.${probeSignature}`, { mode: 0o600 });
db.close();
process.stdout.write(JSON.stringify(state));
