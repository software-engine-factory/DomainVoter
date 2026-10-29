# Creation job checks

The preview must use the real authenticated app and a copy of the newest backup. Research fixtures alone do not establish that the app is connected.

| Case | Independent expectation | Fault that must fail |
| --- | --- | --- |
| Admission and replay | One request key creates one job; changed input conflicts; a second active job is rejected | Remove key comparison or admission check |
| Batch conservation | 2,005 selected names split as 1,000 + 1,000 + 5, positions restart at one, all distinct | Drop the final partial chunk or use global round positions |
| Selection parity | All six batch orders retain the legacy selector's exact ordered names | Change seed, tie breaker, cap placement or provider/set order |
| Publication and assignees | Partially written rounds are absent from voter/admin lists; published rounds inherit requested users | Clear the job marker before completion or omit assignment copies |
| Cancellation | Cancel after some domain inserts removes only the job's unfinished rows | Delete by title or skip partial-domain cleanup |
| Resume | Kill the worker after a committed checkpoint, restart it, finish without duplicates | Restart positions at zero or discard the sealed selection |
| Empty selection | Explicit failed job, no empty published round | Publish a zero-row round |
| Single-round entry points | Pool and explorer jobs retain filters and continuous positions | Ignore the substring/price filter or accidentally create a batch |
| Local browser origin | A browser using 127.0.0.1 works even when Next normalizes its internal URL to localhost; foreign origins fail | Compare only the normalized URL or remove origin validation |
| Oversized client plan | A plan exceeding 2,000 rounds displays an error and disables creation without allocating millions of array entries | Call the unbounded planner before the limit check |
| Browser integration | Actual form returns a ticket, duplicate submission sends one POST, reload retains the ticket; result rows match SQLite | Leave the old synchronous form action wired in |

The small fixtures check correctness and lifecycle. The local full-data run separately measures responsiveness under creation. Neither establishes production recovery or power-loss durability.
