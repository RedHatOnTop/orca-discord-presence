import assert from "node:assert/strict"
import { test } from "node:test"
import type { AgentRow, FleetSnapshot } from "../src/activity.ts"
import { IDLE_GRACE_MS, nextIdleSince, slotOwner } from "../src/slot.ts"

function snap(states: string[], orcaRunning = true): FleetSnapshot {
  const agents: AgentRow[] = states.map((state) => ({ state, agentType: "claude", repo: "r", hostId: "local", branch: "" }))
  return { orcaRunning, agents, worktreeCount: 1, usage: [] }
}

test("live agents keep the slot for Orca", () => {
  assert.equal(nextIdleSince(snap(["working"]), 0, 1_000), null)
  assert.equal(nextIdleSince(snap(["idle", "needs_input"]), 0, 1_000), null)
  assert.equal(slotOwner(null, 1_000), "orca")
})

test("idle time starts at the first idle tick and is not reset by later ones", () => {
  const first = nextIdleSince(snap(["idle"]), null, 5_000)
  assert.equal(first, 5_000)
  assert.equal(nextIdleSince(snap(["idle"]), first, 20_000), 5_000)
})

test("Orca down counts as idle", () => {
  assert.equal(nextIdleSince(snap([], false), null, 7_000), 7_000)
})

test("the idle card waits out the grace period", () => {
  assert.equal(slotOwner(10_000, 10_000 + IDLE_GRACE_MS - 1), "orca")
  assert.equal(slotOwner(10_000, 10_000 + IDLE_GRACE_MS), "card")
})

test("a cold start with idleSince 0 hands the slot to the card at once", () => {
  assert.equal(slotOwner(nextIdleSince(snap(["idle"]), 0, Date.now()), Date.now()), "card")
})
