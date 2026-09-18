import assert from "node:assert/strict"
import { test } from "node:test"
import { buildActivity, classify } from "../src/activity.ts"

test("classify maps needs_input to waiting", () => {
  assert.equal(classify("needs_input"), "waiting")
  assert.equal(classify("working"), "working")
  assert.equal(classify("inactive"), "idle")
})

test("working fleet shows count and agent type, not the prompt", () => {
  const activity = buildActivity(
    {
      orcaRunning: true,
      agents: [
        { state: "working", agentType: "grok", repo: "remote-agent", hostId: "local" },
        { state: "working", agentType: "grok", repo: "remote-agent", hostId: "local" },
        { state: "working", agentType: "grok", repo: "remote-agent", hostId: "local" }
      ]
    },
    1_700_000_000
  )
  assert.ok(activity)
  assert.equal(activity.details, "3 live · grok")
  assert.equal(activity.state, "remote-agent")
  assert.equal(activity.assets.small_image, "state-working")
  assert.equal(activity.assets.small_text, "working")
})

test("waiting wins over working", () => {
  const activity = buildActivity(
    {
      orcaRunning: true,
      agents: [
        { state: "working", agentType: "grok", repo: "remote-agent", hostId: "local" },
        { state: "needs_input", agentType: "codex", repo: "ade-workbench", hostId: "local" }
      ]
    },
    1
  )
  assert.ok(activity)
  assert.equal(activity.details, "needs you · 1 waiting")
  assert.match(activity.state, /codex/)
  assert.equal(activity.assets.small_image, "state-waiting")
})

test("mixed types use commas under the live count", () => {
  const activity = buildActivity(
    {
      orcaRunning: true,
      agents: [
        { state: "working", agentType: "grok", repo: "remote-agent", hostId: "local" },
        { state: "working", agentType: "grok", repo: "remote-agent", hostId: "local" },
        { state: "working", agentType: "codex", repo: "remote-agent", hostId: "local" }
      ]
    },
    1
  )
  assert.ok(activity)
  assert.equal(activity.details, "3 live · grok, codex")
})

test("orca down clears presence", () => {
  assert.equal(buildActivity({ orcaRunning: false, agents: [] }, 1), null)
})

test("idle Orca still shows the workspace", () => {
  const activity = buildActivity(
    {
      orcaRunning: true,
      agents: [{ state: "inactive", agentType: "grok", repo: "remote-agent", hostId: "local" }]
    },
    1
  )
  assert.ok(activity)
  assert.equal(activity.details, "Idle")
  assert.equal(activity.state, "remote-agent")
  assert.equal(activity.assets.small_image, "state-idle")
})

test("remote host is appended", () => {
  const activity = buildActivity(
    {
      orcaRunning: true,
      agents: [{ state: "working", agentType: "qoder", repo: "remote-agent", hostId: "spectre" }]
    },
    1
  )
  assert.ok(activity)
  assert.equal(activity.state, "remote-agent · spectre")
})
