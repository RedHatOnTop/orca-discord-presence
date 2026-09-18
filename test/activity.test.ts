import assert from "node:assert/strict"
import { test } from "node:test"
import { agentLabel, buildActivity, classify, roster, shortBranch } from "../src/activity.ts"
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

test("agentLabel titles Codex and Grok", () => {
  assert.equal(agentLabel("codex"), "Codex")
  assert.equal(agentLabel("grok"), "Grok")
})

test("roster is a named count, not a formula", () => {
  assert.equal(
    roster([
      row({ state: "working", agentType: "grok" }),
      row({ state: "working", agentType: "grok" }),
      row({ state: "working", agentType: "codex" })
    ]),
    "2 Grok · Codex"
  )
})

test("details is the roster; no leading total and no overlay", () => {
  const activity = buildActivity(
    snap([
      row({ state: "working", agentType: "grok" }),
      row({ state: "working", agentType: "grok" }),
      row({ state: "working", agentType: "codex", hostId: "spectre" })
    ])
  )
  assert.ok(activity)
  assert.equal(activity.details, "2 Grok · Codex")
  assert.equal(activity.state, "local 2 · spectre 1")
  assert.equal("small_image" in activity.assets, false)
  assert.equal("timestamps" in activity, false)
})

test("token line is a single today total", () => {
  const activity = buildActivity(
    snap([row({ state: "working", agentType: "grok" })], {
      usage: [
        { provider: "codex", label: "Codex", totalTokens: 13261 },
        { provider: "grok", label: "Grok", totalTokens: 43649991 }
      ]
    })
  )
  assert.ok(activity)
  assert.equal(activity.details, "Grok")
  assert.equal(activity.state, "43.7M tokens today")
  assert.match(activity.assets.large_text, /Grok 43.6M/)
})

test("waiting still leads the details line", () => {
  const activity = buildActivity(
    snap([
      row({ state: "working", agentType: "grok" }),
      row({ state: "needs_input", agentType: "codex" })
    ])
  )
  assert.ok(activity)
  assert.equal(activity.details, "Needs you · Codex")
})

test("orca down clears presence", () => {
  assert.equal(buildActivity({ orcaRunning: false, agents: [], worktreeCount: 0, usage: [] }), null)
})

test("idle Orca shows worktree count and still surfaces usage", () => {
  const activity = buildActivity(
    snap([row({ state: "inactive", agentType: "grok" })], {
      usage: [{ provider: "codex", label: "Codex", totalTokens: 47000 }]
    })
  )
  assert.ok(activity)
  assert.equal(activity.details, "Idle · 8 worktrees")
  assert.equal(activity.state, "47k tokens today")
})

test("large image defaults to the Orca application asset", () => {
  const activity = buildActivity(snap([row({ state: "working", agentType: "grok" })]))
  assert.ok(activity)
  assert.equal(activity.assets.large_image, "orca")
})
