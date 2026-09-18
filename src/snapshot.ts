import { spawn } from "node:child_process"
import type { AgentRow, FleetSnapshot } from "./activity.ts"
import { parseRateLimits } from "./usage.ts"

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null
}

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function repoFromPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "")
  const name = trimmed.split("/").filter(Boolean).pop()
  return name || "workspace"
}

const TITLE_TYPES: [RegExp, string][] = [
  [/gemini/i, "gemini"],
  [/\bgrok\b/i, "grok"],
  [/codex/i, "codex"],
  [/claude/i, "claude"],
  [/qoder/i, "qoder"],
  [/opencode/i, "opencode"],
  [/cursor/i, "cursor"],
  [/copilot/i, "copilot"],
  [/deepseek/i, "deepseek"],
  [/\bpi\b/i, "pi"]
]

const SHELL_TITLE = /^[\w.-]+@[\w.-]+:/

export function inferAgentType(identity: string, title: string): string | null {
  if (identity.trim()) return identity.trim()
  if (!title || SHELL_TITLE.test(title)) return null
  for (const [re, name] of TITLE_TYPES) {
    if (re.test(title)) return name
  }
  return null
}

export function parseWorktreePs(payload: unknown, hostId = "local"): { agents: AgentRow[]; worktreeCount: number } {
  const root = asRecord(payload)
  const result = asRecord(root?.result) ?? root
  const list = result?.worktrees
  if (!Array.isArray(list)) return { agents: [], worktreeCount: 0 }

  const agents: AgentRow[] = []
  let worktreeCount = 0
  for (const item of list) {
    const wt = asRecord(item)
    if (!wt) continue
    worktreeCount += 1
    const repo = str(wt.repo) || str(wt.displayName) || "workspace"
    const branch = str(wt.branch) || str(wt.displayName)
    const nested = wt.agents
    if (!Array.isArray(nested)) continue
    for (const raw of nested) {
      const agent = asRecord(raw)
      if (!agent) continue
      const agentType = str(agent.agentType)
      if (!agentType) continue
      agents.push({
        state: str(agent.state) || "working",
        agentType,
        repo,
        hostId,
        branch
      })
    }
  }
  return { agents, worktreeCount }
}

export function parseTerminals(payload: unknown, hostId: string): AgentRow[] {
  const root = asRecord(payload)
  const result = asRecord(root?.result) ?? root
  const list = result?.terminals
  if (!Array.isArray(list)) return []
  const agents: AgentRow[] = []
  for (const raw of list) {
    const term = asRecord(raw)
    if (!term || term.connected === false) continue
    const agentType = inferAgentType(str(term.agentIdentity), str(term.title))
    if (!agentType) continue
    agents.push({
      state: "working",
      agentType,
      repo: repoFromPath(str(term.worktreePath)),
      hostId,
      branch: str(term.branch)
    })
  }
  return agents
}

export function parseEnvironmentNames(payload: unknown): string[] {
  const root = asRecord(payload)
  const result = asRecord(root?.result) ?? root
  const list = result?.environments
  if (!Array.isArray(list)) return []
  const names: string[] = []
  for (const raw of list) {
    const env = asRecord(raw)
    const name = str(env?.name) || str(env?.id)
    if (name) names.push(name)
  }
  return names
}

export function emptyFleet(): FleetSnapshot {
  return { orcaRunning: false, agents: [], worktreeCount: 0, usage: [] }
}

export function runOrcaJson(cli: string, args: string[], timeoutMs = 12000): Promise<unknown> {
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

async function settle<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise
  } catch {
    return null
  }
}

export async function readFleet(cli: string): Promise<FleetSnapshot> {
  const [localPs, envList, accounts] = await Promise.all([
    settle(runOrcaJson(cli, ["worktree", "ps", "--limit", "40", "--json"])),
    settle(runOrcaJson(cli, ["environment", "list", "--json"])),
    settle(runOrcaJson(cli, ["account", "list", "--json"]))
  ])
  if (!localPs) return emptyFleet()

  const local = parseWorktreePs(localPs, "local")
  const agents = [...local.agents]
  let worktreeCount = local.worktreeCount

  const envNames = envList ? parseEnvironmentNames(envList) : []
  await Promise.all(
    envNames.map(async (name) => {
      const ps = await settle(
        runOrcaJson(cli, ["worktree", "ps", "--limit", "40", "--json", "--environment", name])
      )
      const parsed = ps ? parseWorktreePs(ps, name) : { agents: [], worktreeCount: 0 }
      worktreeCount += parsed.worktreeCount
      if (parsed.agents.length > 0) {
        agents.push(...parsed.agents)
        return
      }
      const terms = await settle(
        runOrcaJson(cli, ["terminal", "list", "--limit", "80", "--json", "--environment", name])
      )
      if (terms) agents.push(...parseTerminals(terms, name))
    })
  )

  return {
    orcaRunning: true,
    agents,
    worktreeCount,
    usage: accounts ? parseRateLimits(accounts) : []
  }
}
