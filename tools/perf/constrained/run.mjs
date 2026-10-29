import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const args = Object.fromEntries(process.argv.slice(2).map((item) => item.replace(/^--/, "").split("=")));
const baselineMode = process.argv.includes("--baseline");
const base = process.env.PERF_BASE_URL;
let cookie;
let roundId;
const names = Number(args.names ?? 2_000_000);
const rounds = Number(args.rounds ?? 10);
const sourceDir = process.env.PERF_SOURCE_DIR;
const output = args.out;
if (!base || !sourceDir || !output) throw new Error("Set PERF_BASE_URL, PERF_SOURCE_DIR and pass --out=<json>");
if (!Number.isSafeInteger(names) || names < 1 || !Number.isSafeInteger(rounds) || rounds < 1 || names % rounds) throw new Error("--names and --rounds must be positive integers with names divisible by rounds");
const origin = new URL(base);
if (!(["127.0.0.1", "localhost", "::1"].includes(origin.hostname))) throw new Error("PERF_BASE_URL must be loopback");
if (!fs.existsSync(path.join(path.resolve(sourceDir), "voting.db"))) throw new Error("PERF_SOURCE_DIR must contain voting.db");
const measurements = {};
const errors = [];

async function request(name, route, options = {}) {
  const start = performance.now();
  try {
    const response = await fetch(new URL(route, base), {
      ...options,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(options.headers ?? {}) },
      redirect: "manual",
      signal: AbortSignal.timeout(120_000),
    });
    const decoder=new TextDecoder();
    let body="", visibleMs=null;
    for await (const chunk of response.body) {
      body+=decoder.decode(chunk,{stream:true});
      if (visibleMs==null && body.includes('class="break-all font-mono font-semibold"')) visibleMs=performance.now()-start;
    }
    body+=decoder.decode();
    const ms = performance.now() - start;
    (measurements[name] ??= []).push({ ms, visibleMs, status: response.status });
    if (!response.ok) errors.push({ name, status: response.status });
    let json;
    try { json = JSON.parse(body); } catch { /* HTML route or empty body. */ }
    return { response, ms, json };
  } catch (error) {
    const ms = performance.now() - start;
    (measurements[name] ??= []).push({ ms, status: 0 });
    errors.push({ name, error: error?.code ?? error?.message ?? "request_error" });
    return { response: null, ms };
  }
}

async function containerId() {
  const profile = origin.port === "12543" ? "app-perf-1cpu" : origin.port === "12544" ? "app-perf-2cpu" : null;
  if (!profile) throw new Error("Use the documented local performance port 12543 or 12544");
  const id = await new Promise((resolve, reject) => {
    const composeProfile = origin.port === "12543" ? "perf-1cpu" : "perf-2cpu";
    const child = spawn("docker", ["compose", "-f", "docker-compose.perf.yml", "--profile", composeProfile, "ps", "-q", profile], { windowsHide: true });
    let stdout = ""; child.stdout.setEncoding("utf8"); child.stdout.on("data", (s) => stdout += s);
    child.on("error", reject); child.on("close", (code) => code === 0 && stdout.trim() ? resolve(stdout.trim()) : reject(new Error("Could not find the constrained Compose container")));
  });
  const inspect = JSON.parse(execFileSync("docker", ["inspect", id], { encoding: "utf8" }))[0];
  const expectedCpu = origin.port === "12543" ? 1 : 2;
  const expectedMemory = expectedCpu * 1024 ** 3;
  if (inspect.HostConfig.NanoCpus !== expectedCpu * 1e9 || inspect.HostConfig.Memory !== expectedMemory) {
    throw new Error(`Container hard caps do not match ${expectedCpu} CPU / ${expectedCpu} GiB: NanoCpus=${inspect.HostConfig.NanoCpus}, Memory=${inspect.HostConfig.Memory}`);
  }
  return id;
}
function stats(rows) {
  if (!rows.length) return { count: 0 };
  const values = rows.map((row) => row.ms).sort((a, b) => a - b);
  const percentile = (p) => values[Math.min(values.length - 1, Math.ceil(p * values.length) - 1)];
  const visible=rows.map(row=>row.visibleMs).filter(n=>Number.isFinite(n)).sort((a,b)=>a-b);
  return { count: values.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: values.at(-1), visibleRowsP95Ms:visible.length?visible[Math.min(visible.length-1,Math.ceil(visible.length*0.95)-1)]:null, statuses: rows.reduce((out, row) => (out[row.status] = (out[row.status] ?? 0) + 1, out), {}) };
}
async function timedRoute(name, route, n) {
  const before = measurements[name]?.length ?? 0;
  for (let i = 0; i < n; i++) await request(name, route);
  return stats(measurements[name].slice(before));
}
async function drainProbes() {
  let stopped = false;
  const voteRoute = `/api/rounds/${encodeURIComponent(roundId)}/votes`;
  const begin = performance.now();
  const votePage = `/vote/${encodeURIComponent(roundId)}`;
  const loops = [
    (async () => { while (!stopped) { await request("datasetVersion", "/api/dataset-version"); await new Promise((r) => setTimeout(r, 100)); } })(),
    (async () => { while (!stopped) { await request("voteRead", voteRoute); await new Promise((r) => setTimeout(r, 200)); } })(),
    (async () => { while (!stopped) { await request("votePage", votePage); await new Promise((r) => setTimeout(r, 400)); } })(),
  ];
  return { stop: async () => { stopped = true; await Promise.all(loops); return performance.now() - begin; } };
}
function execContainer(script, ...args) {
  return execFileSync("docker", ["exec", "--user", "1001:1001", container, "node", `/perf/${script}`, ...args], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
}
function execJson(script, ...args) { return JSON.parse(execContainer(script, ...args)); }

const container = await containerId();

  let ready=false;
  // Windows-to-Linux verification of the 1+ GiB offline seed can outlast one minute.
  for(let attempt=0;attempt<300;attempt++) {
    try { const health=await fetch(new URL('/health',base),{signal:AbortSignal.timeout(2000)});if(health.status===200){ready=true;break;} } catch {}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(!ready)throw new Error("Local app health check failed after five minutes of offline copy verification");
  await fetch(new URL("/login", base));
  await fetch(new URL("/api/dataset-version", base));
  const setup = execJson("setup.cjs");
  roundId = String(setup.roundId);
  cookie = execFileSync("docker", ["exec", container, "cat", "/app/data/.perf-cookie"], { encoding: "utf8" }).trim();
  if (!/^dv_session=/.test(cookie) || cookie.includes("\n")) throw new Error("In-container perf setup did not produce an isolated session cookie");
  const before = execJson("snapshot.cjs");
  if (before.benchmarkComplete) throw new Error("This profile volume already has a completed constrained creation run");
  const voteRoute = `/api/rounds/${encodeURIComponent(roundId)}/votes`;
  const voteBefore = await request("voteCountBefore", voteRoute);
  if (voteBefore.response?.status !== 200 || !(voteBefore.json?.count > 0)) throw new Error("isolated setup fixture must have an open round and one real vote");
  const batchPage = "/admin/rounds/batch";
  const votePage = `/vote/${encodeURIComponent(roundId)}`;
  const explorePage = "/admin/explore?lmin=5&lmax=5&used=never&sort=name";
  const randomExplorePage = "/admin/explore?lmin=5&lmax=5&used=never&sort=random&seed=perf-random-query-20261029";
  const cold = {
    batchPage: await timedRoute("batchPage", batchPage, 1),
    filteredExplorePage: await timedRoute("filteredExplorePage", explorePage, 1),
    randomFilteredExplorePage: await timedRoute("randomFilteredExplorePage", randomExplorePage, 1),
    votePage: await timedRoute("votePage", votePage, 1),
  };
  const warm = {
    batchPage: await timedRoute("batchPage", batchPage, 5),
    filteredExplorePage: await timedRoute("filteredExplorePage", explorePage, 5),
    randomFilteredExplorePage: await timedRoute("randomFilteredExplorePage", randomExplorePage, 5),
    votePage: await timedRoute("votePage", votePage, 5),
  };
  const creationResourceStart = execJson("snapshot.cjs");
  const form = new URLSearchParams({
    kind: "batch", title: `Constrained perf ${new Date().toISOString()}`, seed: "dv-constrained-2026-10-29",
    createMode: "all", order: "name", cap: String(names), rounds: String(rounds), perRound: String(names / rounds),
    remainderMode: "drop", excludeUsed: "1", includeUnpriced: "1", avail:"any", length:"5",
  });
  const key = `perf-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
  const creationStart = Date.now();
  const accepted = await request("creationAccept", "/api/creation-jobs", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base, "Idempotency-Key": key }, body: form,
  });
  if (accepted.response?.status !== 202) throw new Error(`Creation was not accepted (HTTP ${accepted.response?.status ?? 0})`);
  const acceptedPayload = accepted.json;
  if (!acceptedPayload?.id) throw new Error("Creation response is missing its job id");
  const browserOutput=path.resolve(output.replace(/\.json$/,"-browser.json"));
  const browserProcess=spawn("python",["tools/perf/constrained/browser-probe.py",container,base,acceptedPayload.id,browserOutput],{windowsHide:true,stdio:["ignore","ignore","pipe"]});
  let browserError="";
  browserProcess.stderr.on("data",chunk=>browserError+=chunk);
  const browserDone=new Promise(resolve=>{browserProcess.on("error",error=>resolve({code:-1,error:error.message}));browserProcess.on("close",code=>resolve({code,error:browserError}));});
  const probe = await drainProbes();
  let job, failedPolls = 0;
  const snapshots=[];
  for (;;) {
    if (Date.now()-creationStart>30*60_000) throw new Error("Creation exceeded the 30-minute local benchmark bound; inspect the retained job before rerunning");
    const response = await request("creationStatus", `/api/creation-jobs/${encodeURIComponent(acceptedPayload.id)}`);
    if (!response.response?.ok || !response.json?.state) {
      if (++failedPolls >= 30) { job = { state: "failed", error: "status_poll_error" }; break; }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    failedPolls = 0;
    job = response.json;
    snapshots.push({elapsedSeconds:(Date.now()-creationStart)/1000,state:job.state,phase:job.phase,processed:job.processed,total:job.total});
    if (snapshots.length===1 || snapshots.at(-2).phase!==job.phase) console.log(JSON.stringify({progress:snapshots.at(-1)}));
    if (["completed", "failed", "cancelled"].includes(job.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const probeDurationMs = await probe.stop();
  const completionSeconds = (Date.now() - creationStart) / 1000;
  const browserExit=await browserDone;
  const browserVotes=fs.existsSync(browserOutput)?JSON.parse(fs.readFileSync(browserOutput,"utf8")):{errors:["browser probe did not produce evidence"],actions:0};
  const creationResourceEnd = execJson("snapshot.cjs");
  const voteAfter = await request("voteCountAfter", voteRoute);
  const parity = job.state === "completed" ? execJson("verify.cjs", acceptedPayload.id, ...(baselineMode ? ["--baseline"] : []), `--names=${names}`, `--rounds=${rounds}`) : { passed: false, skipped: true, reason: `job_${job.state}`, error: job.error ?? null };
  const votePreserved = voteAfter.response?.status === 200 && voteAfter.json?.count === voteBefore.json.count && before.votes === creationResourceEnd.votes && before.votesSha256 === creationResourceEnd.votesSha256;
  const integrityFailures = [];
  if (job.state !== "completed") integrityFailures.push(`creation_${job.state}`);
  if (!parity.passed) integrityFailures.push("compact_selection_parity");
  if (!votePreserved) integrityFailures.push("existing_votes_changed");
  if (errors.length) integrityFailures.push("http_errors");
  if (browserExit.code!==0) integrityFailures.push("browser_vote_probe");
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    caps: origin.port === "12543" ? { cpuCores: 1, memoryBytes: 1024 ** 3 } : { cpuCores: 2, memoryBytes: 2 * 1024 ** 3 },
    containerId: container,
    fixture: { roundId: setup.roundId, probeUserId: setup.probeUserId, domainIds: setup.domainIds },
    dbStorage: { before: before.files, after: creationResourceEnd.files, tempFilesAfter: creationResourceEnd.tempFiles, walTempAndManifestIncluded: true },
    routes: { cold, warm, all: Object.fromEntries(Object.entries(measurements).map(([name, rows]) => [name, stats(rows)])) },
    creation: { acceptedMs: measurements.creationAccept?.[0]?.ms, completionSeconds, probeDurationMs, order: "alphabetical", requestedNames: names, requestedRounds: rounds, requestedPerRound: names / rounds, baseline: baselineMode, snapshots, job: { state: job.state, phase: job.phase, total: job.total, processed: job.processed, resultUrl: job.resultUrl }, exactOrderedParity: parity },
    votePreservation: { roundId: Number(roundId), beforeCount: voteBefore.json.count, afterCount: voteAfter.json?.count ?? null, wholeDatabaseBefore: before.votes, wholeDatabaseAfter: creationResourceEnd.votes, wholeDatabaseBeforeSha256: before.votesSha256, wholeDatabaseAfterSha256: creationResourceEnd.votesSha256, passed: votePreserved },
    resources: {
      creationCpuTimeSeconds: Number.isFinite(creationResourceStart.cgroup.cpuUsageUsec) && Number.isFinite(creationResourceEnd.cgroup.cpuUsageUsec) ? (creationResourceEnd.cgroup.cpuUsageUsec - creationResourceStart.cgroup.cpuUsageUsec) / 1e6 : null,
      peakMemoryBytesSinceContainerStart: creationResourceEnd.cgroup.memoryPeakBytes,
      memoryCurrentBytesAfterCreation: creationResourceEnd.cgroup.memoryCurrentBytes,
      hardcaps: creationResourceEnd.cgroup,
    },
    errors,
    browserVotes,
    integrityFailures,
  };
  const outputPath = path.resolve(output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  execContainer("mark-complete.cjs", acceptedPayload.id);
  process.stdout.write(`${JSON.stringify({ output: outputPath, completionSeconds,acceptedMs:result.creation.acceptedMs,parity:parity.passed,browserVotes,resources:result.resources,errors:errors.length,integrityFailures })}\n`);
  if (integrityFailures.length) process.exitCode = 1;
