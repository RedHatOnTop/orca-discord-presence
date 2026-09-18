import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  collectTodayTokens,
  formatTokens,
  localDay,
  sumCodexTokens,
  sumGrokTokens,
  usageLine
} from "../src/usage.ts"

test("formatTokens uses compact units", () => {
  assert.equal(formatTokens(43649991), "43.6M")
  assert.equal(formatTokens(1_000_000), "1M")
  assert.equal(formatTokens(12_261), "12k")
  assert.equal(formatTokens(1326), "1.3k")
  assert.equal(formatTokens(900), "900")
})

test("usageLine is cumulative tokens not percents", () => {
  assert.equal(
    usageLine([
      { provider: "codex", label: "Codex", totalTokens: 13261 },
      { provider: "grok", label: "Grok", totalTokens: 43649991 }
    ]),
    "Grok 43.6M · Codex 13k"
  )
})

test("sumGrokTokens only counts sessions updated that local day", () => {
  const root = mkdtempSync(join(tmpdir(), "grok-usage-"))
  const a = join(root, "a")
  const b = join(root, "b")
  mkdirSync(a)
  mkdirSync(b)
  writeFileSync(
    join(a, "usage.json"),
    JSON.stringify({
      updatedAt: "2026-09-18T14:22:12.000Z",
      session: { totalTokens: 1000 }
    })
  )
  writeFileSync(
    join(b, "usage.json"),
    JSON.stringify({
      updatedAt: "2026-09-17T14:22:12.000Z",
      session: { totalTokens: 999999 }
    })
  )
  const day = localDay(new Date("2026-09-18T14:22:12.000Z"))
  assert.equal(sumGrokTokens(root, day), 1000)
})

test("sumCodexTokens uses last thread_token_usage per jsonl", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-usage-"))
  const dir = join(root, "2026", "09", "18")
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "rollout.jsonl"),
    [
      JSON.stringify({
        type: "token_usage_record",
        payload: { thread_token_usage: { total_tokens: 10 } }
      }),
      JSON.stringify({
        type: "token_usage_record",
        payload: { thread_token_usage: { total_tokens: 2500 } }
      })
    ].join("\n")
  )
  assert.equal(sumCodexTokens(root, "2026-09-18"), 2500)
  assert.equal(sumCodexTokens(root, "2026-09-17"), 0)
})

test("collectTodayTokens reads grok and copilot homes", () => {
  const home = mkdtempSync(join(tmpdir(), "token-home-"))
  const grokDir = join(home, ".grok", "sessions", "proj")
  const copexDir = join(home, ".codex", "sessions", "2026", "09", "18")
  mkdirSync(grokDir, { recursive: true })
  mkdirSync(copexDir, { recursive: true })
  writeFileSync(
    join(grokDir, "usage.json"),
    JSON.stringify({
      updatedAt: "2026-09-18T01:00:00.000Z",
      session: { totalTokens: 2_000_000 }
    })
  )
  writeFileSync(
    join(copexDir, "a.jsonl"),
    JSON.stringify({
      type: "token_usage_record",
      payload: { thread_token_usage: { total_tokens: 4000 } }
    })
  )
  const rows = collectTodayTokens(home, "2026-09-18")
  assert.deepEqual(
    rows.map((r) => r.label),
    ["Grok", "Codex"]
  )
  assert.equal(rows[0].totalTokens, 2_000_000)
  assert.equal(rows[1].totalTokens, 4000)
})
