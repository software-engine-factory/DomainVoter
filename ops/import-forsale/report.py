import json, sys, os
W, tags = sys.argv[1], sys.argv[2:]
L = lambda f: json.load(open(os.path.join(W, f)))
b, a, u = L("stats-before.json"), L("stats-after.json"), L("stats-undone.json")
frozen = [k for k in b["hashes"] if k not in ("users",)]
print("== rehearsal", W)
for t in tags:
    d, i, x = L(f"dry-{t}.json"), L(f"import-{t}.json"), L(f"undo-{t}.json")
    for k, r in i["result"].items():
        rej = {kk: vv for kk, vv in r["rejected"].items() if vv}
        print(f"{t} {k:12s} -> {r['table']:10s} read={r['read']:>8} added={r['added']:>8} dup_skipped={r['dup']:>6} rejected={rej or 0} null_price={r['nullPrice']} {r['ms']}ms (dry added={d['result'][k]['added']})")
    print(f"{t} import ok={i['ok']} bytes {i['bytesBefore']/1e6:.1f}MB -> {i['bytesAfter']/1e6:.1f}MB, total {i['ms']/1000:.1f}s")
    print(f"{t} undo: pool -{x['poolDeleted']} free -{x['freeDeleted']} kept(in a round)={x['poolKeptBecauseInARound']} {x['ms']}ms")
print("counts before", b["counts"]); print("counts after ", a["counts"]); print("counts undone", u["counts"])
print("frozen tables identical after import:", all(b["hashes"][k] == a["hashes"][k] for k in frozen), frozen)
print("frozen tables identical after undo:  ", all(b["hashes"][k] == u["hashes"][k] for k in frozen))
print("pool/free counts back to start after undo:", b["counts"]["pool"] == u["counts"]["pool"] and b["counts"]["free_names"] == u["counts"]["free_names"])
print("integrity before/after/undone:", b["integrity"], a["integrity"], u["integrity"])
print("db size before/after/undone (MB): %.1f / %.1f / %.1f" % (b["bytes"]/1e6, a["bytes"]/1e6, u["bytes"]/1e6))
print("domains sha256", b["hashes"]["domains"]["sha256"][:16], "->", a["hashes"]["domains"]["sha256"][:16], "->", u["hashes"]["domains"]["sha256"][:16])
print("rounds  sha256", b["hashes"]["rounds"]["sha256"][:16], "->", a["hashes"]["rounds"]["sha256"][:16], "->", u["hashes"]["rounds"]["sha256"][:16])
