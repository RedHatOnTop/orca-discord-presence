import assert from "node:assert/strict"
import { test } from "node:test"
import { dayWindow, formatTokens, mergeScans, parseScan, usageLine } from "../src/usage.ts"

test("formatTokens uses compact units", () => {
  assert.equal(formatTokens(43649991), "43.6M")
  assert.equal(formatTokens(1_000_000), "1M")
  assert.equal(formatTokens(12_261), "12k")
  assert.equal(formatTokens(1326), "1.3k")
  assert.equal(formatTokens(900), "900")
})

test("usageLine is a single today total", () => {
  assert.equal(
    usageLine([
      { provider: "codex", label: "Codex", totalTokens: 13261 },
      { provider: "grok", label: "Grok", totalTokens: 43649991 }
    ]),
    "43.7M tokens today"
  )
})

test("dayWindow runs from local midnight to the next local midnight", () => {
  const [start, end] = dayWindow(new Date(2026, 8, 26, 21, 30))
  assert.equal(start, new Date(2026, 8, 26).getTime() / 1000)
  assert.equal(end, new Date(2026, 8, 27).getTime() / 1000)
})

test("mergeScans sums hosts but counts a copied record once", () => {
  const merged = mergeScans([
    {
      totals: [
        { harness: "claude", label: "Claude", tokens: 100, records: 1 },
        { harness: "codex", label: "Codex", tokens: 30, records: 2, keyed: { "codex:a": 10, "codex:b": 20 } }
      ],
      errors: []
    },
    {
      totals: [
        { harness: "claude", label: "Claude", tokens: 50, records: 1 },
        { harness: "codex", label: "Codex", tokens: 25, records: 2, keyed: { "codex:b": 20, "codex:c": 5 } }
      ],
      errors: []
    }
  ])
  assert.deepEqual(merged, [
    { provider: "claude", label: "Claude", totalTokens: 150 },
    { provider: "codex", label: "Codex", totalTokens: 35 }
  ])
})

test("parseScan rejects output that is not a scan", () => {
  assert.equal(parseScan("Traceback (most recent call last):"), null)
  assert.equal(parseScan('{"nope":1}'), null)
  assert.deepEqual(parseScan('{"totals":[{"harness":"grok","label":"Grok","tokens":7,"records":1}],"errors":[]}'), {
    totals: [{ harness: "grok", label: "Grok", tokens: 7, records: 1 }],
    errors: []
  })
})
