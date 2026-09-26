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
- Every installed harness with a ledger is read. Local: Claude, Codex, Grok, Antigravity, OpenCode, MiMo, Kimi, Cline. Spectre: Claude, Codex (its Cline has never written usage).
  - Antigravity: one SQLite file per conversation, `steps.metadata` protobuf. Field 1.1 is the start time, field 9 the usage (2 uncached input, 5 cached read, 4 cache write, 3 output incl. thinking, 11 response id). The WAL file's mtime counts as a change.
  - OpenCode and MiMo: `message` rows, `tokens.total` (already includes reasoning and cache). MiMo imports Claude Code transcripts into its own database; sessions listed in `external_import` are skipped so Claude is not counted twice.
  - Kimi: `usage.record` lines in `wire.jsonl`; `inputOther + inputCacheRead + inputCacheCreation + output`.
  - Cline: `*.messages.json` messages with `metrics`; `inputTokens` already includes cached reads. A resumed session copies earlier messages, so ids dedupe them. `cacheWriteTokens` is always 0 in the data, so whether it is inside `inputTokens` is unverified.
- Qoder (both hosts) and Kiro write token fields but every value is 0; they meter credits only. They are not counted.
- Scans are reused for 60 seconds. A failed scan keeps the last good result from the same day; midnight starts fresh.

Verified against counts computed separately from the raw files, on days that have records:

| Day | Harness | Tokens |
| --- | --- | --- |
| 2026-09-26 | Claude, this host | 166,830,738 (1,353 responses) |
| 2026-09-26 | Codex | 4,056,837 |
| 2026-09-20 | Antigravity | 77,467 |
| 2026-09-22 | OpenCode / MiMo | 62,194 / 50,477,052 |
| 2026-09-23 | MiMo | 6,231,322 |
| 2026-08-26 | Kimi / Cline / OpenCode | 20,720,037 / 90,883 / 1,040,108 |
| 2026-09-15 | Cline | 146,982,157 |

Spectre Claude matched to within one in-flight response. A full scan takes 0.5 s here and 1.6 s over ssh. `npm test` 47 passed.
