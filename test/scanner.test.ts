import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"
import { runScanner } from "../src/usage.ts"
import type { HostScan } from "../src/usage.ts"

const START = Date.UTC(2026, 8, 25, 15) / 1000
const END = START + 86_400
const iso = (secondsFromStart: number) => new Date((START + secondsFromStart) * 1000).toISOString()

type Fixture = string | ((path: string) => void)

function home(files: Record<string, Fixture>): string {
  const root = mkdtempSync(join(tmpdir(), "scanner-home-"))
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    if (typeof body === "string") writeFileSync(join(root, path), body)
    else body(join(root, path))
  }
  return root
}

const jsonl = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).join("\n") + "\n"

async function scan(files: Record<string, Fixture>): Promise<Record<string, number>> {
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

function varint(n: number): number[] {
  const out: number[] = []
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80)
    n = Math.floor(n / 128)
  }
  out.push(n)
  return out
}

function proto(fields: [number, number | Uint8Array][]): Uint8Array {
  const bytes: number[] = []
  for (const [field, value] of fields) {
    if (typeof value === "number") bytes.push(...varint(field << 3), ...varint(value))
    else bytes.push(...varint((field << 3) | 2), ...varint(value.length), ...value)
  }
  return Uint8Array.from(bytes)
}

test("Antigravity decodes step usage from its conversation databases", async () => {
  const step = (at: number, response: string, usage: [number, number][]) =>
    proto([
      [1, proto([[1, START + at]])],
      [9, proto([...usage, [11, new TextEncoder().encode(response)]])]
    ])
  const totals = await scan({
    ".gemini/antigravity-cli/conversations/c.db": (path) => {
      const db = new DatabaseSync(path)
      db.exec("create table steps (idx integer, metadata blob)")
      const insert = db.prepare("insert into steps values (?, ?)")
      insert.run(1, step(-30, "r0", [[2, 1_000_000]]))
      insert.run(2, step(30, "r1", [[2, 100], [5, 2_000], [3, 50]]))
      insert.run(3, step(40, "r1", [[2, 100], [5, 2_000], [3, 50]]))
      insert.run(4, proto([[1, proto([[1, START + 50]])]]))
      db.close()
    }
  })
  assert.equal(totals.antigravity, 2_150)
})

function opencodeDb(path: string, rows: [string, string, number, unknown][], imported: string[] = []): void {
  const db = new DatabaseSync(path)
  db.exec("create table message (id text primary key, session_id text, time_created integer, data text)")
  const insert = db.prepare("insert into message values (?, ?, ?, ?)")
  for (const [id, session, at, data] of rows) insert.run(id, session, (START + at) * 1000, JSON.stringify(data))
  if (imported.length > 0) {
    db.exec("create table external_import (source text, session_id text)")
    for (const session of imported) db.prepare("insert into external_import values ('cc', ?)").run(session)
  }
  db.close()
}

test("OpenCode sums tokens.total of assistant messages in the window", async () => {
  const totals = await scan({
    ".local/share/opencode/opencode.db": (path) =>
      opencodeDb(path, [
        ["m1", "s", 10, { role: "assistant", tokens: { total: 900 } }],
        ["m2", "s", 11, { role: "user" }],
        ["m3", "s", 12, { role: "assistant", tokens: { input: 0 } }],
        ["m4", "s", 86_400, { role: "assistant", tokens: { total: 5 } }]
      ])
  })
  assert.equal(totals.opencode, 900)
})

test("MiMo skips Claude Code sessions it imported", async () => {
  const totals = await scan({
    ".config/orca/mimocode-hooks/shared/data/mimocode.db": (path) =>
      opencodeDb(
        path,
        [
          ["own", "mimo-session", 10, { role: "assistant", tokens: { total: 700 } }],
          ["copy", "cc-session", 20, { role: "assistant", tokens: { total: 80_000 } }]
        ],
        ["cc-session"]
      )
  })
  assert.equal(totals.mimo, 700)
})

test("Kimi sums fresh, cached and output tokens per usage record", async () => {
  const record = (at: number) => ({
    type: "usage.record",
    time: (START + at) * 1000,
    usage: { inputOther: 1, inputCacheRead: 10, inputCacheCreation: 100, output: 1000 }
  })
  const totals = await scan({
    ".kimi-code/sessions/wd/session_a/agents/main/wire.jsonl": jsonl([record(-1), record(0), { type: "step.end" }])
  })
  assert.equal(totals.kimi, 1111)
})

test("Cline counts a message copied into a resumed session once", async () => {
  const message = { id: "msg_1", role: "assistant", ts: (START + 60) * 1000, metrics: { inputTokens: 500, cacheReadTokens: 400, cacheWriteTokens: 0, outputTokens: 20 } }
  const session = (messages: unknown[]) => JSON.stringify({ messages })
  const totals = await scan({
    ".cline/data/sessions/a/a.messages.json": session([message]),
    ".cline/data/sessions/b/b.messages.json": session([message, { id: "u", role: "user", ts: (START + 61) * 1000 }])
  })
  assert.equal(totals.cline, 520)
})
