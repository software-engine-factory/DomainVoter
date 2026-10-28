"""Read-only inventory for the local performance study. Never prints user records.

Usage: python tools/perf/inventory.py SOURCE.db --out data/perf-inventory.json
Research tooling, not an application migration or production maintenance command.
"""

import argparse
import hashlib
import json
import pathlib
import sqlite3
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=pathlib.Path)
    parser.add_argument("--out", type=pathlib.Path, required=True)
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    output = args.out.resolve()
    if source == output:
        parser.error("output must differ from the source database")
    started = time.perf_counter()
    db = sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)
    db.execute("PRAGMA query_only=ON")
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    result = {
        "bytes": source.stat().st_size,
        "user_version": db.execute("PRAGMA user_version").fetchone()[0],
        "journal_mode": db.execute("PRAGMA journal_mode").fetchone()[0],
        "table_counts": {},
    }
    # Identifiers come only from this allowlist, never from user input.
    for table in ["pool", "free_names", "domains", "rounds", "round_batches", "round_batch_items", "votes", "views", "imports"]:
        if table in tables:
            result["table_counts"][table] = db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]
    if "pool" in tables:
        columns = {row[1] for row in db.execute("PRAGMA table_xinfo(pool)")}
        if {"name_len", "avail"} <= columns:
            result["pool_availability"] = [
                dict(zip(["avail", "length", "rows"], row))
                for row in db.execute("SELECT avail,name_len,COUNT(*) FROM pool GROUP BY avail,name_len")
            ]
    db.close()
    with source.open("rb") as stream:
        result["sha256"] = hashlib.file_digest(stream, "sha256").hexdigest()
    result["inventory_ms"] = round((time.perf_counter() - started) * 1000, 1)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
