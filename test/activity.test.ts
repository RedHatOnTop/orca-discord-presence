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
  return { orcaRunning: true, worktreeCount: 8, agents, ...extra }
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

test("working fleet shows roster and branch, not the prompt", () => {
  const activity = buildActivity(
    snap([
      row({ state: "working", agentType: "grok" }),
      row({ state: "working", agentType: "grok" }),
      row({ state: "working", agentType: "grok" })
    ]),
    1_700_000_000
  )
  assert.ok(activity)
  assert.equal(activity.details, "grok ×3")
  assert.equal(activity.state, "remote-agent · feat/status-http-claude-health")
  assert.equal(activity.assets.small_image, "state-working")
  assert.match(activity.assets.large_text, /3 working/)
  assert.match(activity.assets.large_text, /8 worktrees/)
})

test("waiting wins over working and keeps the workspace on state", () => {
  const activity = buildActivity(
    snap([
      row({ state: "working", agentType: "grok" }),
      row({
        state: "needs_input",
        agentType: "codex",
        repo: "ade-workbench",
        branch: "refs/heads/fix/terminal-grade-surface"
      })
    ]),
    1
  )
  assert.ok(activity)
  assert.equal(activity.details, "needs you · codex")
  assert.match(activity.state, /ade-workbench/)
  assert.match(activity.state, /1 working/)
  assert.equal(activity.assets.small_image, "state-waiting")
})

test("mixed types share one details line", () => {
  const activity = buildActivity(
    snap([
      row({ state: "working", agentType: "grok" }),
      row({ state: "working", agentType: "grok" }),
      row({ state: "working", agentType: "codex" })
    ]),
    1
  )
  assert.ok(activity)
  assert.equal(activity.details, "grok ×2 · codex")
})

test("second live repo is counted on the state line", () => {
  const activity = buildActivity(
    snap([
      row({ state: "working", agentType: "grok" }),
      row({
        state: "working",
        agentType: "codex",
        repo: "ade-workbench",
        branch: "refs/heads/fix/terminal-grade-surface"
      })
    ]),
    1
  )
  assert.ok(activity)
  assert.match(activity.state, /\+1 repo/)
})

test("orca down clears presence", () => {
  assert.equal(buildActivity({ orcaRunning: false, agents: [], worktreeCount: 0 }, 1), null)
})

test("idle Orca shows worktree count", () => {
  const activity = buildActivity(
    snap([row({ state: "inactive", agentType: "grok" })]),
    1
  )
  assert.ok(activity)
  assert.equal(activity.details, "Idle · 8 worktrees")
  assert.equal(activity.state, "remote-agent · feat/status-http-claude-health")
  assert.equal(activity.assets.small_image, "state-idle")
})

test("remote host is appended", () => {
  const activity = buildActivity(
    snap([row({ state: "working", agentType: "qoder", hostId: "spectre" })]),
    1
  )
  assert.ok(activity)
  assert.equal(activity.details, "qoder")
  assert.match(activity.state, /spectre/)
})
