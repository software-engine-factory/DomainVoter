"""Audit saved study evidence without rerunning workloads or changing a database.

Expected counts come from the recorded replica eligibility queries and the
800,000-name stress input. Latency misses are retained as misses, not waived.
Run from the study root: python tools/perf/verify-evidence.py
"""

import json
import pathlib
import statistics

ROOT = pathlib.Path(__file__).resolve().parents[2]
REPORT = ROOT / "docs/research/performance-2026-10-28"


def read(relative):
    return json.loads((ROOT / relative).read_text(encoding="utf-8"))


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def latency(ping, write):
    return all(metric["n"] > 0 and metric["p95Ms"] < 250 and metric["maxMs"] < 1000 for metric in (ping, write))


initial = read("docs/research/performance-2026-10-28/source-inventory.json")
final = read("docs/research/performance-2026-10-28/source-final-inventory.json")
require(initial["sha256"] == final["sha256"], "Source checksum changed")
require(initial["table_counts"] == final["table_counts"], "Source row counts changed")
digests = {4: set(), 5: set()}
worker_cases = []
for length, runs in [(4, ["r1", "r2", "r3"]), (5, ["r1"])]:
    expected = 120084 if length == 4 else 800000
    for mode in ["baseline-batch", "worker"]:
        for run in runs:
            file = f"tools/perf/worker/result-{mode}-{length}-800000-{run}.json"
            r = read(file)
            require(r["count"]["n"] == r["count"]["distinctNames"] == r["expectedTotal"] == expected, file + ": count mismatch")
            require(r["conservationPass"] and r["voteCountPreserved"] and r["orderErrors"] == 0, file + ": conservation failure")
            require(r["writeFailures"] == 0 and not r["probeErrors"], file + ": lost HTTP write")
            require(r["probeDrain"]["startedCount"] == r["probeDrain"]["completedCount"], file + ": incomplete drain")
            require(r["rounds"] == (13 if length == 4 else 80), file + ": round count mismatch")
            digests[length].add(r["orderedNamesSha256"])
            worker_cases.append({"file": file, "latency_target_pass": latency(r["httpPing"], r["httpVoteShapedWrite"])})
compat = read("tools/perf/worker/result-worker-5-800000-compatibility.json")
require(compat["conservationPass"] and compat["voteCountPreserved"] and compat["count"]["n"] == 800000, "Compatibility conservation failure")
require(not compat["probeErrors"] and compat["writeFailures"] == 0 and compat["probeDrain"]["startedCount"] == compat["probeDrain"]["completedCount"], "Compatibility probe failure")
require(latency(compat["httpPing"], compat["httpVoteShapedWrite"]), "Compatibility latency miss")
digests[5].add(compat["orderedNamesSha256"])
sql_cases = []
for file, length, expected, rounds in [
    ("4l-sql-all-spool-1.json", 4, 120084, 13),
    ("5l-sql-all-spool-1.json", 5, 800000, 80),
    ("5l-sql-giant-spool-1.json", 5, 800000, 1),
]:
    relative = "tools/perf/sql/results/" + file
    r = read(relative)
    require(r["snapshotRows"] == r["materializedRows"] == r["expectedSnapshotRows"] == expected and r["roundRows"] == rounds, relative + ": count mismatch")
    checks = r["assertions"]
    require(all(checks[key] for key in ["positionsContinuous", "countMatchesResult", "independentSnapshotCountCorrect", "materializedCountCorrect"]), relative + ": assertion failure")
    require(checks["priceNameCurrencyMismatches"] == 0, relative + ": value mismatch")
    http = r["http"]
    require(not http["errors"] and http["writeFailures"] == 0 and http["voteCountPreserved"], relative + ": HTTP write failure")
    require(http["drain"]["startedCount"] == http["drain"]["completedCount"], relative + ": incomplete drain")
    passed = latency(http["ping"], http["voteShapedWrite"])
    require(passed == (length == 4), relative + ": recorded target verdict changed")
    digests[length].add(r["membershipSha256"])
    sql_cases.append({"file": relative, "latency_target_pass": passed})
require(all(len(values) == 1 for values in digests.values()), "Ordered membership differs across approaches")

browser = read("tools/perf/frontend/results/browser.json")
feedback = {}
for variant in ["f1", "f2"]:
    samples = [case for case in browser["cases"] if case["name"].startswith(variant + "-sample-")]
    require(len(samples) == 3, variant + ": missing timing samples")
    require(all(case["feedbackMs"] < 100 and case["metadataCountRequests"] == 0 and case["rapidFilterCountRequests"] == 1 and case["creationRequests"] == 1 for case in samples), variant + ": UI invariant failure")
    feedback[variant] = statistics.median(case["feedbackMs"] for case in samples)
audit = read("tools/perf/frontend/results/audit.json")
require(sum(case.get("verdict") == "RED" for case in audit["observations"]) == 2, "Missing deliberate negative controls")
for case in audit["observations"]:
    if case["name"].endswith("coalesce-submitter"):
        require(case["filterValues"] == ["1", "3"] and case["peakActive"] == 1 and case["createMode"] == "first", "Coalescing or submitter failure")
integrated = read("tools/perf/frontend/results/integrated.json")
require(integrated["result"] == {"count": 10000, "uniqueNames": 10000, "firstPosition": 1, "lastPosition": 10000}, "Integrated SQLite result mismatch")
require(integrated["creationRequests"] == 1 and integrated["reattachedAfterReload"], "Integrated resume failed")
result = {
    "artifact_integrity_pass": True,
    "source_checksum_unchanged": True,
    "source_sha256": final["sha256"],
    "ordered_digest_parity": {str(length): next(iter(values)) for length, values in digests.items()},
    "worker_primary_cases": worker_cases,
    "worker_existing_timeout_latency_pass": True,
    "spool_cases": sql_cases,
    "frontend_observations": len(browser["cases"]),
    "frontend_median_feedback_ms": feedback,
    "mutation_audit_observations": len(audit["observations"]),
    "consolidated_integration_rows": 10000,
    "consolidated_integration_result_visible_ms": integrated["completedVisibleMs"],
    "limits": "Audits recorded evidence only. Does not establish production deployment, power-loss durability, or untested inputs.",
}
(REPORT / "validation.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, indent=2))
