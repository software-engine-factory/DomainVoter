# Frontend experiment cases

These cases precede prototype code. Oracle: the reported idle creation UI, plus user-visible invariants below. The author of the prototypes also wrote the runner. This is an experiment, not a production regression suite.

1. Feedback. With a deliberately delayed creation response, submit a valid form. Within 100 ms show pending feedback and disable both creation choices. Expected from the reported symptom. The unchanged application forms should fail this requirement.
2. Count scope. Type five title changes and change order, rounds, and per-round size. Send zero count requests because none changes membership. Five membership edits 50 ms apart should send one request after a 250 ms debounce.
3. Stale counts. Request filter 1, then change to filter 2 before 1 returns. Never display count 111 as current for filter 2. Filter 2 independently maps to count 222 in the fixture contract. Preserve the previous value only with an explicit updating label. While filter 1 is active, edit 2 then 3, each beyond the debounce interval. Keep peak active count one and dispatch only 1 then 3; final count is independently 333.
4. Duplicate clicks. Submit twice in the same browser task. The variants send one creation request. This protects one mounted form only; backend idempotency is required across reloads or tabs.
5. Recovery. A count 503 shows an error and retry. A rejected create returns editable controls. A lost create response shows an unknown outcome and blocks blind replay.
6. Job resume. Accept a ticket, reload, and reattach to that ticket without another create. Job progress may only come from a server snapshot, with phase, processed, total, and age. An unknown total must render an indeterminate progress element. Completion enables a result link. Cancellation waits for server acknowledgement. If acceptance succeeds but its acknowledgement is unreadable, reload and recover using the identical key/payload, creating no additional job.
7. Polling. Stop polling at terminal status, retry status failures with backoff, and refresh after visibility returns. Measure worst observed snapshot age during a four-second local stub job. Never claim this is an 800,000-row benchmark.
8. Bounded rendering. With a symbolic 800,000-item result, mount at most 50 result rows, with next/previous navigation. This is an invariant already present in production voting and explorer paging, not evidence of faster SQL.

Negative controls: unchanged production forms must reveal missing submit feedback and metadata recounts. Temporarily allowing old responses in F1 must make case 3 fail. Temporarily removing the submission latch must make case 4 fail.
