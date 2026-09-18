import assert from "node:assert/strict"
import { test } from "node:test"
import { parseRateLimits, usageLine } from "../src/usage.ts"

test("parses session over weekly and skips unavailable providers", () => {
  const windows = parseRateLimits({
    ok: true,
    result: {
      rateLimits: {
        claude: { provider: "claude", status: "unavailable", session: null, weekly: null },
        codex: {
          provider: "codex",
          status: "ok",
          session: { usedPercent: 100, resetDescription: "23:43" },
          weekly: { usedPercent: 47, resetDescription: "20:12 on 19 Sep" }
        },
        grok: {
          provider: "grok",
          status: "ok",
          session: null,
          weekly: { usedPercent: 25.4, resetDescription: "Sun 12:40 AM" }
        }
      }
    }
  })
  assert.equal(windows.length, 2)
  assert.equal(windows[0].label, "Codex")
  assert.equal(windows[0].usedPercent, 100)
  assert.equal(windows[0].kind, "session")
  assert.equal(windows[1].label, "Grok")
  assert.equal(windows[1].usedPercent, 25)
  assert.equal(usageLine(windows), "Codex 100% · Grok 25%")
})
