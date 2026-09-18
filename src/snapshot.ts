import { spawn } from "node:child_process"
import type { AgentRow, FleetSnapshot } from "./activity.ts"

type WorktreePs = {
  ok?: boolean
  result?: { worktrees?: unknown[] }
  worktrees?: unknown[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null
}

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

export function parseWorktreePs(payload: unknown): FleetSnapshot {
  const root = asRecord(payload)
  if (!root) return { orcaRunning: false, agents: [], worktreeCount: 0 }

  const result = asRecord(root.result)
  const list = (result?.worktrees ?? root.worktrees) as unknown
  if (!Array.isArray(list)) return { orcaRunning: true, agents: [], worktreeCount: 0 }

  const agents: AgentRow[] = []
  let worktreeCount = 0
  for (const item of list) {
    const wt = asRecord(item)
    if (!wt) continue
    worktreeCount += 1
    const repo = str(wt.repo) || str(wt.displayName) || "workspace"
    const hostId = str(wt.hostId) || "local"
    const branch = str(wt.branch) || str(wt.displayName)
    const nested = wt.agents
    if (Array.isArray(nested) && nested.length > 0) {
      for (const raw of nested) {
        const agent = asRecord(raw)
        if (!agent) continue
        agents.push({
          state: str(agent.state) || str(wt.status) || "idle",
          agentType: str(agent.agentType) || "agent",
          repo,
          hostId,
          branch
        })
      }
      continue
    }
    const status = str(wt.status)
    if (status && status !== "inactive") {
      agents.push({ state: status, agentType: "agent", repo, hostId, branch })
    }
  }
  return { orcaRunning: true, agents, worktreeCount }
}

export function runOrcaJson(cli: string, args: string[], timeoutMs = 8000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, { stdio: ["ignore", "pipe", "pipe"] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`${cli} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.on("data", (chunk) => stdout.push(chunk))
    child.stderr.on("data", (chunk) => stderr.push(chunk))
    child.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      const text = Buffer.concat(stdout).toString("utf8")
      if (code !== 0) {
        reject(new Error(`${cli} exited ${code}: ${Buffer.concat(stderr).toString("utf8").slice(0, 400)}`))
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch (err) {
        reject(err)
      }
    })
  })
}

export async function readFleet(cli: string): Promise<FleetSnapshot> {
  try {
    const payload = await runOrcaJson(cli, ["worktree", "ps", "--limit", "40", "--json"])
    return parseWorktreePs(payload)
  } catch {
    return { orcaRunning: false, agents: [], worktreeCount: 0 }
  }
}
