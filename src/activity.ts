import type { TokenTotal } from "./usage.ts"
import { hostLine, usageLine } from "./usage.ts"

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
  usage: TokenTotal[]
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

export type BuildOptions = {
  previousRepo?: string | null
  largeImage?: string
  assetBase?: string
}

export const DEFAULT_LARGE_IMAGE =
  "https://raw.githubusercontent.com/stablyai/orca/main/resources/build/icon.png"

/** Public PNGs Discord can fetch. Override with ORCA_PRESENCE_ASSET_BASE. */
export const DEFAULT_ASSET_BASE =
  "https://raw.githubusercontent.com/RedHatOnTop/orca-discord-presence/main/assets"

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
  return parts.join(" · ")
}

export function focusPool(snapshot: FleetSnapshot): AgentRow[] {
  const waiting = snapshot.agents.filter((a) => classify(a.state) === "waiting")
  if (waiting.length > 0) return waiting
  const working = snapshot.agents.filter((a) => classify(a.state) === "working")
  if (working.length > 0) return working
  return snapshot.agents
}

export function featuredRepo(agents: AgentRow[], previous: string | null | undefined): string {
  const ranked = countBy(agents.map((a) => a.repo || "workspace"))
  if (ranked.length === 0) return "Orca ADE"
  if (previous && ranked.some(([name]) => name === previous)) return previous
  return ranked[0][0]
}

function branchForRepo(agents: AgentRow[], repo: string): string | null {
  const mine = agents.filter((a) => (a.repo || "workspace") === repo)
  const ranked = countBy(mine.map((a) => shortBranch(a.branch)).filter((b) => b.length > 0 && b !== repo))
  return ranked[0]?.[0] ?? null
}

function extraRepoCount(agents: AgentRow[]): number {
  return Math.max(0, new Set(agents.map((a) => a.repo || "workspace")).size - 1)
}

function remoteHint(agents: AgentRow[], repo: string): string | null {
  const row = agents.find((a) => (a.repo || "workspace") === repo && a.hostId && a.hostId !== "local")
  return row ? row.hostId : null
}

export function whereLine(agents: AgentRow[], repo: string): string {
  const branch = branchForRepo(agents, repo)
  const host = remoteHint(agents, repo)
  const extra = extraRepoCount(agents)
  const parts = [repo]
  if (branch) parts.push(branch)
  if (host) parts.push(host)
  if (extra > 0) parts.push(extra === 1 ? "+1 repo" : `+${extra} repos`)
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

function smallImage(kind: Kind, assetBase: string): string {
  const key = SMALL_KEY[kind]
  if (!assetBase) return key
  return `${assetBase.replace(/\/$/, "")}/${key}.png`
}

export function buildActivity(
  snapshot: FleetSnapshot,
  startedAtSec: number,
  options: BuildOptions = {}
): DiscordActivity | null {
  if (!snapshot.orcaRunning) return null

  const waiting = snapshot.agents.filter((a) => classify(a.state) === "waiting")
  const working = snapshot.agents.filter((a) => classify(a.state) === "working")
  const live = [...waiting, ...working]
  const kind: Kind = waiting.length > 0 ? "waiting" : working.length > 0 ? "working" : "idle"
  const focus = focusPool(snapshot)
  const repo = featuredRepo(focus, options.previousRepo)
  const hosts: Record<string, number> = {}
  for (const agent of live.length > 0 ? live : snapshot.agents) {
    const host = agent.hostId || "local"
    hosts[host] = (hosts[host] ?? 0) + 1
  }
  const usage = usageLine(snapshot.usage)
  const hostsText = hostLine(hosts)
  const place = whereLine(kind === "idle" ? snapshot.agents : live, repo)
  const assetBase = options.assetBase ?? ""
  const largeImage = options.largeImage ?? (assetBase ? DEFAULT_LARGE_IMAGE : "orca")

  let details: string
  if (kind === "waiting") {
    details = `${live.length} · needs you · ${roster(waiting)}`
  } else if (kind === "working") {
    details = `${live.length} · ${roster(live)}`
  } else {
    details = snapshot.worktreeCount > 1 ? `Idle · ${snapshot.worktreeCount} worktrees` : "Idle"
  }
  const state = usage || hostsText || place

  const hoverBits = [
    hostsText || null,
    usage || null,
    waiting.length > 0 ? `${waiting.length} waiting` : null
  ].filter((bit): bit is string => bit !== null)

  return {
    type: 0,
    details: clip(details),
    state: clip(state),
    timestamps: { start: startedAtSec },
    assets: {
      large_image: largeImage,
      large_text: clip(hoverBits.join(" · ") || "Orca ADE", 128),
      small_image: smallImage(kind, assetBase),
      small_text: SMALL_TEXT[kind]
    }
  }
}
