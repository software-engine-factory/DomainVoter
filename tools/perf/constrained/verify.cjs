const { createRequire } = require("node:module");
const { createHash } = require("node:crypto");
const requireApp = createRequire("/app/server.js");
const Database = requireApp("better-sqlite3");
const db = new Database(`${process.env.DATA_DIR || "/app/data"}/voting.db`, { readonly: true, fileMustExist: true });
const jobId = process.argv[2];
const baseline = process.argv.includes("--baseline");
const namesExpected = Number(process.argv.find((x) => x.startsWith("--names="))?.split("=")[1] || 2_000_000);
const roundsExpected = Number(process.argv.find((x) => x.startsWith("--rounds="))?.split("=")[1] || 10);
if (!jobId) throw new Error("Pass a job id");
try {
  if (baseline) {
    const job = db.prepare("SELECT batch_id,total,target,inserted,state,manifest_sha FROM creation_jobs WHERE id=?").get(jobId);
    if (!job?.batch_id || job.state !== "completed") throw new Error("completed baseline creation job was not found");
    const hash = createHash("sha256");
    let itemCount = 0;
    for (const row of db.prepare("SELECT name FROM round_batch_items WHERE batch_id=? ORDER BY position").iterate(job.batch_id)) { hash.update(`${JSON.stringify(row.name)}\n`); itemCount++; }
    const orderedSelectionSha256 = hash.digest("hex");
    const priceMismatches = db.prepare(`SELECT COUNT(*) AS n FROM round_batch_items i JOIN pool p ON p.name=i.name JOIN domains d ON d.round_id IN (SELECT id FROM rounds WHERE batch_id=i.batch_id) AND d.name=i.name WHERE i.batch_id=? AND (d.price IS NOT COALESCE(p.lp_price,p.best_price) OR d.currency IS NOT p.lp_currency)`).get(job.batch_id).n;
    const roundRows = db.prepare(`SELECT r.id,r.batch_index,COUNT(d.id) AS size,MIN(d.position) AS minPosition,MAX(d.position) AS maxPosition
      FROM rounds r LEFT JOIN domains d ON d.round_id=r.id WHERE r.batch_id=? GROUP BY r.id ORDER BY r.batch_index`).all(job.batch_id);
    const domainRows = db.prepare("SELECT COUNT(*) AS n FROM domains WHERE round_id IN (SELECT id FROM rounds WHERE batch_id=?)").get(job.batch_id).n;
    const assignees = db.prepare("SELECT user_id FROM round_batch_assignees WHERE batch_id=? ORDER BY user_id").all(job.batch_id).map((r)=>r.user_id);
    const assignmentChecks = db.prepare("SELECT id FROM rounds WHERE batch_id=? ORDER BY batch_index").all(job.batch_id).map((round)=>({roundId:round.id,matchesBatch:JSON.stringify(db.prepare("SELECT user_id FROM round_assignees WHERE round_id=? ORDER BY user_id").all(round.id).map((r)=>r.user_id))===JSON.stringify(assignees)}));
    const passed = job.total===namesExpected && job.target===namesExpected && job.inserted===namesExpected && itemCount===namesExpected && orderedSelectionSha256===job.manifest_sha && priceMismatches===0 && roundRows.length===roundsExpected && roundRows.every((r,i)=>r.batch_index===i+1 && r.size===namesExpected/roundsExpected && r.minPosition===1 && r.maxPosition===namesExpected/roundsExpected) && domainRows===namesExpected && assignmentChecks.every((x)=>x.matchesBatch);
    process.stdout.write(JSON.stringify({passed,baseline:true,job:{...job},selection:{count:itemCount,orderedSelectionSha256,manifestShaMatches:orderedSelectionSha256===job.manifest_sha,priceCurrencyMismatches:priceMismatches},compact:{ranges:roundRows.length,memberCount:domainRows,physicalDomainRows:domainRows,domainCatalogRows:null,catalogMismatches:null},roundRanges:roundRows.map(({batch_index,size,minPosition,maxPosition})=>({batchIndex:batch_index,size,minPosition,maxPosition})),assignments:assignmentChecks}));
    process.exitCode = passed ? 0 : 1;
    return;
  }
  const job = db.prepare("SELECT batch_id,total,target,inserted,state,manifest_sha FROM creation_jobs WHERE id=?").get(jobId);
  if (!job?.batch_id || job.state !== "completed") throw new Error("completed creation job was not found");
  const selection = db.prepare("SELECT id FROM domain_selections WHERE creation_job_id=?").get(jobId);
  if (!selection) throw new Error("frozen selection was not found");
  const hash = createHash("sha256");
  let selectionCount = 0, priceCurrencyMismatches = 0;
  for (const row of db.prepare("SELECT name FROM selection_items WHERE selection_id=? ORDER BY position").iterate(selection.id)) {
    hash.update(`${JSON.stringify(row.name)}\n`);
    selectionCount++;
  }
  priceCurrencyMismatches = db.prepare(`SELECT COUNT(*) AS n FROM selection_items s JOIN pool p ON p.name=s.name
    WHERE s.selection_id=? AND (s.price IS NOT COALESCE(p.lp_price,p.best_price) OR s.currency IS NOT p.lp_currency)`).get(selection.id).n;
  const ranges = db.prepare(`SELECT r.id,r.batch_index,x.start_position,x.end_position,COUNT(s.position) AS size,
      MIN(s.position) AS minPosition,MAX(s.position) AS maxPosition
    FROM rounds r JOIN round_domain_ranges x ON x.round_id=r.id
    JOIN selection_items s ON s.selection_id=x.selection_id AND s.position BETWEEN x.start_position AND x.end_position
    WHERE r.batch_id=? GROUP BY r.id ORDER BY r.batch_index`).all(job.batch_id);
  const physicalDomains = db.prepare("SELECT COUNT(*) AS n FROM domains WHERE round_id IN (SELECT id FROM rounds WHERE batch_id=?)").get(job.batch_id).n;
  const catalogExists = db.prepare("SELECT 1 FROM sqlite_master WHERE name='domain_catalog'").get();
  const compactCatalog = catalogExists ? db.prepare("SELECT COUNT(*) AS n FROM domain_catalog WHERE round_id IN (SELECT id FROM rounds WHERE batch_id=?)").get(job.batch_id).n : null;
  const catalogMismatches = catalogExists ? db.prepare(`SELECT COUNT(*) AS n
    FROM rounds r JOIN round_domain_ranges x ON x.round_id=r.id
    JOIN selection_items i ON i.selection_id=x.selection_id AND i.position BETWEEN x.start_position AND x.end_position
    LEFT JOIN domain_catalog d ON d.id=-i.id AND d.round_id=r.id
    WHERE r.batch_id=? AND (d.id IS NULL OR d.position != i.position-x.start_position+1 OR d.name IS NOT i.name OR d.price IS NOT i.price OR d.currency IS NOT i.currency)`)
    .get(job.batch_id).n : null;
  const batchAssignees = db.prepare("SELECT user_id FROM round_batch_assignees WHERE batch_id=? ORDER BY user_id").all(job.batch_id).map((r) => r.user_id);
  const assignmentChecks = db.prepare("SELECT id FROM rounds WHERE batch_id=? ORDER BY batch_index").all(job.batch_id).map((round) => {
    const assigned = db.prepare("SELECT user_id FROM round_assignees WHERE round_id=? ORDER BY user_id").all(round.id).map((r) => r.user_id);
    return { roundId: round.id, matchesBatch: JSON.stringify(assigned) === JSON.stringify(batchAssignees), count: assigned.length };
  });
  const orderedSelectionSha256 = hash.digest("hex");
  const passed = job.total === namesExpected && job.target === namesExpected && job.inserted === namesExpected &&
    selectionCount === namesExpected && orderedSelectionSha256 === job.manifest_sha && priceCurrencyMismatches === 0 &&
    ranges.length === roundsExpected && ranges.every((r, i) => r.batch_index === i + 1 && r.size === namesExpected / roundsExpected && r.start_position === i * (namesExpected / roundsExpected) + 1 && r.end_position === (i + 1) * (namesExpected / roundsExpected) && r.minPosition === r.start_position && r.maxPosition === r.end_position) &&
    physicalDomains === 0 && compactCatalog === namesExpected && catalogMismatches === 0 && assignmentChecks.length === 10 && assignmentChecks.every((x) => x.matchesBatch);
  process.stdout.write(JSON.stringify({ passed, job: { ...job }, selection: { count: selectionCount, orderedSelectionSha256, manifestShaMatches: orderedSelectionSha256 === job.manifest_sha, priceCurrencyMismatches }, compact: { ranges: ranges.length, memberCount: ranges.reduce((sum, r) => sum + r.size, 0), physicalDomainRows: physicalDomains, domainCatalogRows: compactCatalog, catalogMismatches }, roundRanges: ranges.map(({ batch_index, start_position, end_position, size, minPosition, maxPosition }) => ({ batchIndex: batch_index, startPosition: start_position, endPosition: end_position, size, minPosition, maxPosition })), assignments: assignmentChecks }));
} finally { db.close(); }
