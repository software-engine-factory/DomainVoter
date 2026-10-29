const fs=require('node:fs');
const Database=require('node:module').createRequire('/app/server.js')('better-sqlite3');
const f=JSON.parse(fs.readFileSync('/app/data/.perf-setup.json','utf8'));
const db=new Database('/app/data/voting.db');
db.pragma('busy_timeout=5000');
const user=db.prepare("SELECT id FROM users WHERE username='local_perfprobe'").get();
if(!user || user.id!==f.probeUserId)throw new Error('Not a disposable benchmark fixture');
db.prepare('DELETE FROM votes WHERE user_id=? AND round_id=?').run(user.id,f.roundId);
db.close();
