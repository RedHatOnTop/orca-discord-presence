export type AgentRow = {
  state: string
  agentType: string
  repo: string
  hostId: string
}

export type FleetSnapshot = {
  orcaRunning: boolean
  agents: AgentRow[]
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

function uniqueTypes(agents: AgentRow[]): string[] {
  const counts = new Map<string, number>()
  for (const agent of agents) {
    const name = (agent.agentType || "agent").trim() || "agent"
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)
}

function typeLabel(types: string[]): string {
  if (types.length === 0) return "agent"
  if (types.length === 1) return types[0]
  if (types.length === 2) return `${types[0]}, ${types[1]}`
  return `${types[0]}, ${types[1]} +${types.length - 2}`
}

function primaryRepo(agents: AgentRow[]): string {
  const live = agents.filter((a) => classify(a.state) !== "idle")
  const pool = live.length > 0 ? live : agents
  const counts = new Map<string, number>()
  for (const agent of pool) {
    const repo = agent.repo.trim() || "workspace"
    counts.set(repo, (counts.get(repo) ?? 0) + 1)
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  return ranked[0]?.[0] ?? "Orca ADE"
}

function remoteHint(agents: AgentRow[]): string | null {
  const remote = agents.find((a) => a.hostId && a.hostId !== "local")
  return remote ? remote.hostId : null
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

  const repo = snapshot.agents.length > 0 ? primaryRepo(snapshot.agents) : "Orca ADE"
  const host = remoteHint(live.length > 0 ? live : snapshot.agents)
  const where = host ? `${repo} · ${host}` : repo

  let details: string
  let state: string
  if (kind === "waiting") {
    details = `needs you · ${waiting.length} waiting`
    const rest = typeLabel(uniqueTypes(waiting.length > 0 ? waiting : live))
    state = working.length > 0 ? `${rest} · ${working.length} live` : rest
  } else if (kind === "working") {
    const n = working.length
    details = `${n} live · ${typeLabel(uniqueTypes(working))}`
    state = where
  } else {
    details = "Idle"
    state = where
  }

  return {
    type: 0,
    details: clip(details),
    state: clip(state),
    timestamps: { start: startedAtSec },
    assets: {
      large_image: largeImage,
      large_text: "Orca ADE",
      small_image: SMALL_KEY[kind],
      small_text: SMALL_TEXT[kind]
    }
  }
}
