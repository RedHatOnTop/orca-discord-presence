import assert from "node:assert/strict"
import { test } from "node:test"
import { buildActivity, classify, roster, shortBranch } from "../src/activity.ts"
import type { AgentRow, FleetSnapshot } from "../src/activity.ts"

function row(partial: Partial<AgentRow> & Pick<AgentRow, "state" | "agentType">): AgentRow {
  return {
    repo: "remote-agent",
    hostId: "local",
    branch: "refs/heads/feat/status-http-claude-health",
    ...partial
  }
}

function snap(agents: AgentRow[], extra: Partial<FleetSnapshot> = {}): FleetSnapshot {
  return { orcaRunning: true, worktreeCount: 8, usage: [], agents, ...extra }
}

test("classify maps needs_input to waiting", () => {
  assert.equal(classify("needs_input"), "waiting")
  assert.equal(classify("working"), "working")
  assert.equal(classify("inactive"), "idle")
})

test("shortBranch strips refs/heads", () => {
  assert.equal(shortBranch("refs/heads/feat/status-http-claude-health"), "feat/status-http-claude-health")
})

test("roster uses ×N instead of a separate live count", () => {
  assert.equal(
    roster([
      row({ state: "working", agentType: "grok" }),
      row({ state: "working", agentType: "grok" }),
      row({ state: "working", agentType: "codex" })
    ]),
    "grok ×2 · codex"
  )
})

test("details is summed agent count and types", () => {
  const activity = buildActivity(
    snap([
      row({ state: "working", agentType: "grok" }),
      row({ state: "working", agentType: "grok" }),
      row({ state: "working", agentType: "codex", hostId: "spectre" })
    ]),
    1_700_000_000
  )
  assert.ok(activity)
  assert.equal(activity.details, "3 · grok ×2 · codex")
  assert.equal(activity.state, "local 2 · spectre 1")
  assert.match(activity.assets.large_text, /local 2/)
  assert.match(activity.assets.large_text, /spectre 1/)
})

test("token usage takes the state line", () => {
  const activity = buildActivity(
    snap([row({ state: "working", agentType: "grok" })], {
      usage: [
        { provider: "codex", label: "Codex", totalTokens: 13261 },
        { provider: "grok", label: "Grok", totalTokens: 43649991 }
      ]
    }),
    1
  )
  assert.ok(activity)
  assert.equal(activity.details, "1 · grok")
  assert.equal(activity.state, "Grok 43.6M · Codex 13k")
})

test("waiting still leads the details line", () => {
  const activity = buildActivity(
    snap([
      row({ state: "working", agentType: "grok" }),
      row({ state: "needs_input", agentType: "codex" })
    ]),
    1
  )
  assert.ok(activity)
  assert.equal(activity.details, "2 · needs you · codex")
  assert.equal(activity.assets.small_image, "state-waiting")
})

test("orca down clears presence", () => {
  assert.equal(buildActivity({ orcaRunning: false, agents: [], worktreeCount: 0, usage: [] }, 1), null)
})

test("idle Orca shows worktree count and still surfaces usage", () => {
  const activity = buildActivity(
    snap([row({ state: "inactive", agentType: "grok" })], {
      usage: [{ provider: "codex", label: "Codex", totalTokens: 47000 }]
    }),
    1
  )
  assert.ok(activity)
  assert.equal(activity.details, "Idle · 8 worktrees")
  assert.equal(activity.state, "Codex 47k")
  assert.equal(activity.assets.small_image, "state-idle")
})

test("default assets are application keys Discord already hosts", () => {
  const activity = buildActivity(snap([row({ state: "working", agentType: "grok" })]), 1)
  assert.ok(activity)
  assert.equal(activity.assets.small_image, "state-working")
  assert.equal(activity.assets.large_image, "orca")
})

test("HTTPS assets only when an asset base is set", () => {
  const activity = buildActivity(snap([row({ state: "working", agentType: "grok" })]), 1, {
    assetBase: "https://example.test/assets"
  })
  assert.ok(activity)
  assert.equal(activity.assets.small_image, "https://example.test/assets/state-working.png")
})
