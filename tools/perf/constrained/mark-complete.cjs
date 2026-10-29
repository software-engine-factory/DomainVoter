const fs = require("node:fs");
const path = require("node:path");
const directory = process.env.DATA_DIR || "/app/data";
const jobId = process.argv[2];
if (!jobId) throw new Error("Pass a job id");
fs.writeFileSync(path.join(directory, ".constrained-bench-complete"), JSON.stringify({ jobId, completedAt: new Date().toISOString() }) + "\n", { flag: "wx" });
