import assert from "node:assert/strict"
import { test } from "node:test"
import { inferAgentType, parseTerminals, parseWorktreePs } from "../src/snapshot.ts"

test("parses orca worktree ps envelope", () => {
  const snap = parseWorktreePs({
    ok: true,
    result: {
      worktrees: [
        {
          repo: "remote-agent",
          hostId: "local",
          status: "working",
          branch: "refs/heads/feat/x",
          agents: [
            { state: "working", agentType: "grok" },
            { state: "working", agentType: "grok" }
          ]
        },
        { repo: "ade-workbench", hostId: "local", status: "inactive", agents: [] }
      ]
    }
  })
  assert.equal(snap.worktreeCount, 2)
  assert.equal(snap.agents.length, 2)
  assert.equal(snap.agents[0].repo, "remote-agent")
  assert.equal(snap.agents[0].agentType, "grok")
  assert.equal(snap.agents[0].hostId, "local")
})

test("does not invent agents from an empty agents array", () => {
  const snap = parseWorktreePs({
    result: { worktrees: [{ repo: "x", hostId: "local", status: "working", agents: [] }] }
  })
  assert.equal(snap.agents.length, 0)
  assert.equal(snap.worktreeCount, 1)
})

test("stamps a remote host id onto ps rows", () => {
  const snap = parseWorktreePs(
    { result: { worktrees: [{ repo: "x", agents: [{ state: "working", agentType: "qoder" }] }] } },
    "spectre"
  )
  assert.equal(snap.agents[0].hostId, "spectre")
})

test("inferAgentType ignores ssh shell titles", () => {
  assert.equal(inferAgentType("", "person@spectre: ~/wt/release-readiness-spectre"), null)
  assert.equal(inferAgentType("gemini", "◇ Gemini CLI"), "gemini")
  assert.equal(inferAgentType("", "⠋ Grok"), "grok")
})

test("parseTerminals keeps identified agents and drops shells", () => {
  const rows = parseTerminals(
    {
      result: {
        terminals: [
          { title: "◇ Gemini CLI", agentIdentity: "gemini", connected: true, worktreePath: "/work/a", branch: "main" },
          { title: "person@spectre: ~/wt/x", agentIdentity: null, connected: true, worktreePath: "/work/x" },
          { title: "표시 정책", agentIdentity: "codex", connected: true, worktreePath: "/home/person/wt/release-readiness-spectre" },
          { title: "Gemini CLI", agentIdentity: "gemini", connected: false, worktreePath: "/work/b" }
        ]
      }
    },
    "spectre"
  )
  assert.equal(rows.length, 2)
  assert.equal(rows[0].agentType, "gemini")
  assert.equal(rows[0].hostId, "spectre")
  assert.equal(rows[1].agentType, "codex")
  assert.equal(rows[1].repo, "release-readiness-spectre")
})
