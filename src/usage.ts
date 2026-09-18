export type UsageWindow = {
  provider: string
  label: string
  usedPercent: number
  kind: "session" | "weekly" | "monthly"
  resetDescription: string
}

const LABELS: Record<string, string> = {
  copilot: "Codex",
  grok: "Grok",
  claude: "Claude",
  gemini: "Gemini",
  kimi: "Kimi",
  minimax: "MiniMax",
  antigravity: "Antigravity",
  opencodeGo: "OpenCode"
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null
}

function windowOf(
  raw: unknown,
  kind: UsageWindow["kind"]
): { usedPercent: number; resetDescription: string } | null {
  const row = asRecord(raw)
  if (!row || typeof row.usedPercent !== "number" || !Number.isFinite(row.usedPercent)) return null
  return {
    usedPercent: Math.round(row.usedPercent),
    resetDescription: typeof row.resetDescription === "string" ? row.resetDescription : ""
  }
}

/** Hottest window per provider with status ok. Session beats weekly beats monthly. */
export function parseRateLimits(payload: unknown): UsageWindow[] {
  const root = asRecord(payload)
  const result = asRecord(root?.result) ?? root
  const limits = asRecord(result?.rateLimits)
  if (!limits) return []

  const out: UsageWindow[] = []
  for (const [provider, raw] of Object.entries(limits)) {
    const row = asRecord(raw)
    if (!row || row.status !== "ok") continue
    const session = windowOf(row.session, "session")
    const weekly = windowOf(row.weekly, "weekly")
    const monthly = windowOf(row.monthly, "monthly")
    const picked = session ?? weekly ?? monthly
    if (!picked) continue
    const kind: UsageWindow["kind"] = session ? "session" : weekly ? "weekly" : "monthly"
    out.push({
      provider,
      label: LABELS[provider] ?? provider,
      usedPercent: picked.usedPercent,
      kind,
      resetDescription: picked.resetDescription
    })
  }
  return out.sort((a, b) => b.usedPercent - a.usedPercent || a.label.localeCompare(b.label))
}

export function usageLine(windows: UsageWindow[]): string {
  return windows.map((w) => `${w.label} ${w.usedPercent}%`).join(" · ")
}

export function hostLine(hostCounts: Record<string, number>): string {
  const parts = Object.entries(hostCounts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([host, n]) => `${host} ${n}`)
  return parts.join(" · ")
}
