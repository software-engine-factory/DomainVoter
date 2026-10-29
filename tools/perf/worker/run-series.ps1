# Run only while holding the shared benchmark slot. Source is a readonly replica.
$ErrorActionPreference = 'Stop'
if (-not $env:PERF_SOURCE) { throw 'Set PERF_SOURCE to the canonical local replica file first.' }
$env:PERF_STANDARD = '1'
$env:PERF_BUSY_MS = '0'
$env:PERF_BRIEF = '1'
# Continuation after the recorded baseline warmup and failed worker warmup.
# Deliberately one fresh full pair. The owner's rough comparison request caps repeats.
foreach ($sample in @('r1')) {
    foreach ($mode in @('baseline-batch', 'worker')) {
        node tools/perf/worker/measure.mjs $mode 5 800000 $sample
        if ($LASTEXITCODE -ne 0) { throw "Benchmark failed: $mode $sample" }
    }
}
foreach ($sample in @('warmup', 'r1', 'r2', 'r3')) {
    foreach ($mode in @('baseline-batch', 'worker')) {
        node tools/perf/worker/measure.mjs $mode 4 800000 $sample
        if ($LASTEXITCODE -ne 0) { throw "Control failed: $mode $sample" }
    }
}
$env:PERF_BUSY_MS = '5000'
node tools/perf/worker/measure.mjs worker 5 800000 compatibility
if ($LASTEXITCODE -ne 0) { throw 'Compatibility sample failed' }
