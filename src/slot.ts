import { classify } from "./activity.ts"
import type { FleetSnapshot } from "./activity.ts"

/** Idle this long before the idle card takes over, so a turn boundary does not swap cards. */
export const IDLE_GRACE_MS = 5 * 60_000

export type SlotOwner = "orca" | "card"

export function hasLiveAgents(snapshot: FleetSnapshot): boolean {
  return snapshot.agents.some((agent) => classify(agent.state) !== "idle")
}

export function nextIdleSince(snapshot: FleetSnapshot, previous: number | null, now: number): number | null {
  if (hasLiveAgents(snapshot)) return null
  return previous ?? now
}

export function slotOwner(idleSince: number | null, now: number): SlotOwner {
  return idleSince !== null && now - idleSince >= IDLE_GRACE_MS ? "card" : "orca"
}
