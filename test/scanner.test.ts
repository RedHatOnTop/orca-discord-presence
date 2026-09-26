import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { runScanner } from "../src/usage.ts"
import type { HostScan } from "../src/usage.ts"

const START = Date.UTC(2026, 8, 25, 15) / 1000
const END = START + 86_400
const iso = (secondsFromStart: number) => new Date((START + secondsFromStart) * 1000).toISOString()

function home(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "scanner-home-"))
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), body)
  }
  return root
}

const jsonl = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).join("\n") + "\n"

async function scan(files: Record<string, string>): Promise<Record<string, number>> {
  const result = (await runScanner("local", [START, END], { ...process.env, HOME: home(files) })) as HostScan
  assert.ok(result, "scanner produced no JSON")
  assert.deepEqual(result.errors, [])
  return Object.fromEntries(result.totals.map((row) => [row.harness, row.tokens]))
}

function claudeRow(id: string, at: number, usage: Record<string, number>) {
  return { type: "assistant", timestamp: iso(at), requestId: `req-${id}`, message: { id, usage } }
}

test("Claude counts every processed token, cut exactly at local midnight", async () => {
  const usage = { input_tokens: 1, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 1000 }
  const totals = await scan({
    ".claude/projects/p/s.jsonl": jsonl([
      claudeRow("before", -1, usage),
      claudeRow("first", 0, usage),
      claudeRow("last", 86_399, usage),
      claudeRow("after", 86_400, usage)
    ])
  })
  assert.equal(totals.claude, 2 * 1111)
})

test("Claude keeps the final line of a streamed response and counts copies once", async () => {
  const early = { input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 8 }
  const final = { input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 400 }
  const totals = await scan({
    ".claude/projects/p/a.jsonl": jsonl([claudeRow("m1", 60, early), claudeRow("m1", 61, final)]),
    ".claude/projects/p/b.jsonl": jsonl([claudeRow("m1", 61, final)])
  })
  assert.equal(totals.claude, 505)
})

test("Codex bills each request on its own day even when the session started yesterday", async () => {
  const record = (at: number, id: string, total: number) => ({
    type: "token_usage_record",
    timestamp: iso(at),
    payload: { response_id: id, usage: { total_tokens: total }, thread_token_usage: { total_tokens: 999_999 } }
  })
  const totals = await scan({
    ".codex/sessions/2026/09/25/rollout-a.jsonl": jsonl([record(-60, "r1", 7_000), record(120, "r2", 300), record(90_000, "r3", 5)])
  })
  assert.equal(totals.codex, 300)
})

test("Codex rollouts without per-request records fall back to cumulative deltas", async () => {
  const count = (at: number, total: number) => ({
    type: "event_msg",
    timestamp: iso(at),
    payload: { type: "token_count", info: { total_token_usage: { total_tokens: total } } }
  })
  const totals = await scan({
    ".codex/sessions/2026/09/25/rollout-old.jsonl": jsonl([count(-10, 1_000), count(30, 1_500), count(31, 1_500), count(40, 1_700)])
  })
  assert.equal(totals.codex, 700)
})

test("Grok bills each turn on the day it ended", async () => {
  const totals = await scan({
    ".grok/sessions/p/s/usage.json": JSON.stringify({
      updatedAt: iso(500),
      session: { totalTokens: 1_000_000 },
      turns: [
        { endedAt: iso(-5), totalTokens: 900_000 },
        { endedAt: iso(500).replace(".000Z", ".123456789+00:00"), totalTokens: 100_000 }
      ]
    })
  })
  assert.equal(totals.grok, 100_000)
})

test("a malformed ledger is skipped without blanking the rest", async () => {
  const totals = await scan({
    ".grok/sessions/p/s/usage.json": "{not json",
    ".claude/projects/p/s.jsonl": "garbage\n" + jsonl([claudeRow("ok", 10, { output_tokens: 3 })])
  })
  assert.deepEqual(totals, { claude: 3 })
})
