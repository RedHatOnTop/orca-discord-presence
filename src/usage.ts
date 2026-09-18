import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type TokenTotal = {
  provider: string
  label: string
  totalTokens: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null
}

export function localDay(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function dayOf(iso: string): string | null {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  return localDay(new Date(ms))
}

export function formatTokens(n: number): string {
  const sign = n < 0 ? "-" : ""
  const abs = Math.abs(n)
  const trim = (value: number, suffix: string, digits: number) => {
    const compact = value.toFixed(digits).replace(/\.0+$/, "")
    return `${sign}${compact}${suffix}`
  }
  if (abs >= 1_000_000_000) return trim(abs / 1_000_000_000, "B", 1)
  if (abs >= 1_000_000) return trim(abs / 1_000_000, "M", 1)
  if (abs >= 10_000) return trim(abs / 1_000, "k", 0)
  if (abs >= 1_000) return trim(abs / 1_000, "k", 1)
  return `${sign}${Math.round(abs)}`
}

export function usageLine(totals: TokenTotal[]): string {
  return totals
    .filter((row) => row.totalTokens > 0)
    .sort((a, b) => b.totalTokens - a.totalTokens || a.label.localeCompare(b.label))
    .map((row) => `${row.label} ${formatTokens(row.totalTokens)}`)
    .join(" · ")
}

export function hostLine(hostCounts: Record<string, number>): string {
  const parts = Object.entries(hostCounts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([host, n]) => `${host} ${n}`)
  return parts.join(" · ")
}

function walkNamed(root: string, name: string, out: string[] = [], depth = 0): string[] {
  if (depth > 8 || !existsSync(root)) return out
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return out
  }
  for (const entry of entries) {
    const path = join(root, entry)
    let st
    try {
      st = statSync(path)
    } catch {
      continue
    }
    if (st.isDirectory()) walkNamed(path, name, out, depth + 1)
    else if (st.isFile() && entry === name) out.push(path)
  }
  return out
}

export function sumGrokTokens(root: string, day: string): number {
  let total = 0
  for (const file of walkNamed(root, "usage.json")) {
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"))
    } catch {
      continue
    }
    const row = asRecord(parsed)
    const updated = typeof row?.updatedAt === "string" ? dayOf(row.updatedAt) : null
    if (updated !== day) continue
    const session = asRecord(row?.session)
    const n = session?.totalTokens
    if (typeof n === "number" && Number.isFinite(n)) total += n
  }
  return total
}

function lastThreadTokens(file: string): number {
  let last = 0
  let text: string
  try {
    text = readFileSync(file, "utf8")
  } catch {
    return 0
  }
  for (const line of text.split("\n")) {
    if (!line.includes("token_usage_record")) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const row = asRecord(parsed)
    if (row?.type !== "token_usage_record") continue
    const payload = asRecord(row.payload)
    const thread = asRecord(payload?.thread_token_usage) ?? asRecord(payload?.usage)
    const n = thread?.total_tokens
    if (typeof n === "number" && Number.isFinite(n)) last = n
  }
  return last
}

export function sumCodexTokens(root: string, day: string): number {
  const dir = join(root, ...day.split("-"))
  if (!existsSync(dir)) return 0
  let total = 0
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return 0
  }
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue
    total += lastThreadTokens(join(dir, entry))
  }
  return total
}

export function collectTodayTokens(
  home = homedir(),
  day = localDay()
): TokenTotal[] {
  const grok = sumGrokTokens(join(home, ".grok", "sessions"), day)
  const copilot = sumCodexTokens(join(home, ".codex", "sessions"), day)
  const out: TokenTotal[] = []
  if (grok > 0) out.push({ provider: "grok", label: "Grok", totalTokens: grok })
  if (copilot > 0) out.push({ provider: "codex", label: "Codex", totalTokens: copilot })
  return out.sort((a, b) => b.totalTokens - a.totalTokens)
}
