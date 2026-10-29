const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const requireApp = createRequire("/app/server.js");
const Database = requireApp("better-sqlite3");
const directory = process.env.DATA_DIR || "/app/data";
const dbPath = path.join(directory, "voting.db");
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
function fileSizes(dir, prefix = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(prefix, entry.name);
    const absolute = path.join(dir, entry.name);
    return entry.isDirectory() ? fileSizes(absolute, name) : [{ path: name, bytes: fs.statSync(absolute).size }];
  });
}
function optionalFileSizes(dir) {
  try { return fileSizes(dir); } catch { return []; }
}
const voteHash = require("node:crypto").createHash("sha256");
let votes = 0;
for (const vote of db.prepare("SELECT round_id,domain_id,user_id,created_at FROM votes ORDER BY round_id,domain_id,user_id").iterate()) {
  voteHash.update(`${vote.round_id},${vote.domain_id},${vote.user_id},${vote.created_at}\n`);
  votes++;
}
db.close();
const read = (file) => { try { return fs.readFileSync(file, "utf8").trim(); } catch { return null; } };
const cpuStat = read("/sys/fs/cgroup/cpu.stat");
const memoryCurrent = Number(read("/sys/fs/cgroup/memory.current"));
const memoryPeak = Number(read("/sys/fs/cgroup/memory.peak"));
const cpuMax = read("/sys/fs/cgroup/cpu.max");
const memoryMax = Number(read("/sys/fs/cgroup/memory.max"));
const usage = Number(cpuStat?.match(/usage_usec\s+(\d+)/)?.[1]);
const nodeStatus=read('/proc/1/status') ?? '';
const nodeHighWaterRssBytes=Number(nodeStatus.match(/VmHWM:\s+(\d+)/)?.[1])*1024;
const memoryStat=read('/sys/fs/cgroup/memory.stat') ?? '';
const anonymousBytes=Number(memoryStat.match(/^anon\s+(\d+)/m)?.[1]);
const fileCacheBytes=Number(memoryStat.match(/^file\s+(\d+)/m)?.[1]);
const completedFile = path.join(directory, ".constrained-bench-complete");
process.stdout.write(JSON.stringify({ votes, votesSha256: voteHash.digest("hex"), benchmarkComplete: fs.existsSync(completedFile), files: fileSizes(directory), tempFiles: optionalFileSizes("/tmp"), cgroup: { cpuMax, memoryMaxBytes: memoryMax, cpuUsageUsec: usage, memoryCurrentBytes: Number.isFinite(memoryCurrent) ? memoryCurrent : null, memoryPeakBytes: Number.isFinite(memoryPeak) ? memoryPeak : null, nodeHighWaterRssBytes,anonymousBytes,fileCacheBytes } }));
