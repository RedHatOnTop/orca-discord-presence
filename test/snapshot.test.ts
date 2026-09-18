import assert from "node:assert/strict"
import { test } from "node:test"
import { parseWorktreePs } from "../src/snapshot.ts"

test("parses orca worktree ps envelope", () => {
  const snap = parseWorktreePs({
    ok: true,
    result: {
      worktrees: [
        {
          repo: "remote-agent",
          hostId: "local",
          status: "working",
          agents: [
            { state: "working", agentType: "grok" },
            { state: "working", agentType: "grok" }
          ]
        },
        { repo: "ade-workbench", hostId: "local", status: "inactive", agents: [] }
      ]
    }
  })
  assert.equal(snap.orcaRunning, true)
  assert.equal(snap.agents.length, 2)
  assert.equal(snap.agents[0].repo, "remote-agent")
  assert.equal(snap.agents[0].agentType, "grok")
})

test("falls back to worktree status when agents array is empty", () => {
  const snap = parseWorktreePs({
    result: { worktrees: [{ repo: "x", hostId: "local", status: "working", agents: [] }] }
  })
  assert.equal(snap.agents.length, 1)
  assert.equal(snap.agents[0].state, "working")
})
