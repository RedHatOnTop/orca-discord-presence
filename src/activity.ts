export type AgentRow = {
  state: string
  agentType: string
  repo: string
  hostId: string
  branch: string
}

export type FleetSnapshot = {
  orcaRunning: boolean
  agents: AgentRow[]
  worktreeCount: number
}

export type DiscordActivity = {
  type: number
  details: string
  state: string
  timestamps: { start: number }
  assets: {
    large_image: string
    large_text: string
    small_image: string
    small_text: string
  }
}

export const DEFAULT_LARGE_IMAGE =
  "https://raw.githubusercontent.com/stablyai/orca/main/resources/build/icon.png"

const ATTENTION = new Set([
  "waiting",
  "needs_input",
  "needs-input",
  "needs you",
  "blocked",
  "error",
  "failed"
])

const WORKING = new Set(["working", "running", "active", "streaming"])

export type Kind = "waiting" | "working" | "idle"

export function classify(state: string): Kind {
  const s = state.trim().toLowerCase()
  if (ATTENTION.has(s) || s.includes("wait") || s.includes("need")) return "waiting"
  if (WORKING.has(s)) return "working"
  return "idle"
}

function clip(value: string, max = 128): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

export function shortBranch(branch: string): string {
  return branch.replace(/^refs\/heads\//, "").trim()
}

function countBy(values: string[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const raw of values) {
    const key = raw.trim() || "agent"
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/** `grok ×2 · copilot` — counts live in the string, so details can drop the extra "N live". */
export function roster(agents: AgentRow[]): string {
  const parts = countBy(agents.map((a) => a.agentType || "agent")).map(([name, n]) =>
    n > 1 ? `${name} ×${n}` : name
  )
  if (parts.length === 0) return "agent"
  if (parts.length <= 3) return parts.join(" · ")
  return `${parts[0]} · ${parts[1]} · +${parts.length - 2}`
}

function primaryRepo(agents: AgentRow[]): string {
  const ranked = countBy(agents.map((a) => a.repo || "workspace"))
  return ranked[0]?.[0] ?? "Orca ADE"
}

function primaryBranch(agents: AgentRow[], repo: string): string | null {
  const ranked = countBy(agents.map((a) => shortBranch(a.branch)).filter((b) => b.length > 0 && b !== repo))
  return ranked[0]?.[0] ?? null
}

function extraRepoCount(agents: AgentRow[], repo: string): number {
  return new Set(agents.map((a) => a.repo || "workspace")).size - (repo ? 1 : 0)
}

function remoteHint(agents: AgentRow[]): string | null {
  const remote = agents.find((a) => a.hostId && a.hostId !== "local")
  return remote ? remote.hostId : null
}

function whereLine(agents: AgentRow[]): string {
  if (agents.length === 0) return "Orca ADE"
  const repo = primaryRepo(agents)
  const branch = primaryBranch(agents, repo)
  const host = remoteHint(agents)
  const extra = extraRepoCount(agents, repo)
  const parts = [repo]
  if (branch) parts.push(branch)
  if (host) parts.push(host)
  if (extra > 0) parts.push(`+${extra}`)
  return parts.join(" · ")
}

const SMALL_KEY: Record<Kind, string> = {
  waiting: "state-waiting",
  working: "state-working",
  idle: "state-idle"
}

const SMALL_TEXT: Record<Kind, string> = {
  waiting: "needs you",
  working: "working",
  idle: "idle"
}

export function buildActivity(
  snapshot: FleetSnapshot,
  startedAtSec: number,
  largeImage = DEFAULT_LARGE_IMAGE
): DiscordActivity | null {
  if (!snapshot.orcaRunning) return null

  const waiting = snapshot.agents.filter((a) => classify(a.state) === "waiting")
  const working = snapshot.agents.filter((a) => classify(a.state) === "working")
  const live = [...waiting, ...working]
  const kind: Kind = waiting.length > 0 ? "waiting" : working.length > 0 ? "working" : "idle"
  const place = whereLine(live.length > 0 ? live : snapshot.agents)

  let details: string
  let state: string
  if (kind === "waiting") {
    details = `needs you · ${roster(waiting)}`
    state = working.length > 0 ? `${place} · ${working.length} working` : place
  } else if (kind === "working") {
    details = roster(working)
    state = place
  } else {
    details = snapshot.worktreeCount > 1 ? `Idle · ${snapshot.worktreeCount} worktrees` : "Idle"
    state = place
  }

  const hoverBits = [
    "Orca ADE",
    working.length > 0 ? `${working.length} working` : null,
    waiting.length > 0 ? `${waiting.length} waiting` : null,
    snapshot.worktreeCount > 0 ? `${snapshot.worktreeCount} worktrees` : null
  ].filter((bit): bit is string => bit !== null)

  return {
    type: 0,
    details: clip(details),
    state: clip(state),
    timestamps: { start: startedAtSec },
    assets: {
      large_image: largeImage,
      large_text: clip(hoverBits.join(" · "), 128),
      small_image: SMALL_KEY[kind],
      small_text: SMALL_TEXT[kind]
    }
  }
}
