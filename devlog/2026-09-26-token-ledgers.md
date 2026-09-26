# 2026-09-26 — Token ledgers

The card read `4.1M tokens today` while roughly 290M tokens had gone through Claude on the two hosts. Reviewed against independent counts from the raw logs:

- Claude was never counted. Local Claude alone was 142.6M at the time of the review, Spectre Claude 147.0M.
- Codex summed the last `thread_token_usage` of rollouts in the session's start-date folder, so a session running past midnight vanished the next day. Replayed history: 2026-09-14 had 40.2M of Codex usage and would have read 0.
- Grok added a whole session total when `usage.json` was updated that day. A session spanning 2026-09-09 and 2026-09-10 put 46.5M of 09-09 usage into 09-10.
- The remote scanner compared a UTC timestamp prefix with the local day.

Now one stdlib Python scanner (`scanner/tokens.py`) runs on every host: directly on this one, over `ssh host python3 -` elsewhere. The daemon passes local midnight and the next local midnight as epoch seconds, and every record is billed by its own timestamp: per response for Claude and Codex, per turn (`endedAt`) for Grok.

- A token is everything the model processed: input including cached reads, cache writes, output. That matches Codex `total_tokens` and Grok `totalTokens`; for Claude it is the sum of the four usage fields.
- Claude writes one line per content block, and early lines carry partial `output_tokens` (226 of 1,634 responses on 2026-09-26). Each `message.id` + `requestId` keeps its largest value.
- `codex-handoff` copies rollouts between hosts (two shared sessions in the last two weeks), so Codex records go out keyed and are unioned across hosts.
- Rollouts from older Codex builds carry only cumulative `token_count` events; their deltas are billed at the event time.
- Scans are reused for 60 seconds. A failed scan keeps the last good result from the same day; midnight starts fresh.

Verified: the scanner equals the independent Claude count on this host (166,830,738 / 1,353 responses) and matches Spectre to within one in-flight response; Codex equals the per-request sum (4,056,837). `npm test` 42 passed.
