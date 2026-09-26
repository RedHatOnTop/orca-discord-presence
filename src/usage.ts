import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

export type TokenTotal = {
  provider: string
  label: string
  totalTokens: number
}

export type HarnessScan = {
  harness: string
  label: string
  tokens: number
  records: number
  keyed?: Record<string, number>
}

export type HostScan = {
  totals: HarnessScan[]
  errors: { harness: string; error: string }[]
}

const SCANNER = fileURLToPath(new URL("../scanner/tokens.py", import.meta.url))
const SCAN_TTL_MS = 60_000
const SCAN_TIMEOUT_MS = 20_000

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null
}

/** Local midnight to the next local midnight, in epoch seconds. */
export function dayWindow(now = new Date()): [number, number] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return [start.getTime() / 1000, end.getTime() / 1000]
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
  const live = totals.filter((row) => row.totalTokens > 0)
  const sum = live.reduce((acc, row) => acc + row.totalTokens, 0)
  if (sum <= 0) return ""
  return `${formatTokens(sum)} tokens today`
}

export function usageHover(totals: TokenTotal[]): string {
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

export function parseScan(text: string): HostScan | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const root = asRecord(parsed)
  if (!root || !Array.isArray(root.totals)) return null
  const totals: HarnessScan[] = []
  for (const raw of root.totals) {
    const row = asRecord(raw)
    if (!row || typeof row.harness !== "string" || typeof row.tokens !== "number") continue
    const keyed = asRecord(row.keyed)
    totals.push({
      harness: row.harness,
      label: typeof row.label === "string" ? row.label : row.harness,
      tokens: row.tokens,
      records: typeof row.records === "number" ? row.records : 0,
      ...(keyed ? { keyed: keyed as Record<string, number> } : {})
    })
  }
  const errors = Array.isArray(root.errors) ? (root.errors as HostScan["errors"]) : []
  return { totals, errors }
}

/** Sums hosts per harness; keyed records (copied between hosts) count once. */
export function mergeScans(scans: HostScan[]): TokenTotal[] {
  const merged = new Map<string, { label: string; loose: number; keyed: Map<string, number> }>()
  for (const scan of scans) {
    for (const row of scan.totals) {
      const entry = merged.get(row.harness) ?? { label: row.label, loose: 0, keyed: new Map<string, number>() }
      if (row.keyed) {
        for (const [key, tokens] of Object.entries(row.keyed)) {
          entry.keyed.set(key, Math.max(entry.keyed.get(key) ?? 0, tokens))
        }
      } else {
        entry.loose += row.tokens
      }
      merged.set(row.harness, entry)
    }
  }
  return [...merged.entries()]
    .map(([provider, entry]) => ({
      provider,
      label: entry.label,
      totalTokens: entry.loose + [...entry.keyed.values()].reduce((a, b) => a + b, 0)
    }))
    .filter((row) => row.totalTokens > 0)
    .sort((a, b) => b.totalTokens - a.totalTokens || a.label.localeCompare(b.label))
}

export function runScanner(host: string, window: [number, number], env = process.env): Promise<HostScan | null> {
  const [start, end] = window.map(String)
  const local = host === "local"
  const child = local
    ? spawn("python3", [SCANNER, start, end], { stdio: ["ignore", "pipe", "ignore"], env })
    : spawn("ssh", ["-o", "ConnectTimeout=8", "-o", "BatchMode=yes", host, "python3", "-", start, end], {
        stdio: ["pipe", "pipe", "ignore"]
      })
  return new Promise((resolve) => {
    const stdout: Buffer[] = []
    const timer = setTimeout(() => child.kill("SIGKILL"), SCAN_TIMEOUT_MS)
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.on("error", () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve(code === 0 ? parseScan(Buffer.concat(stdout).toString("utf8")) : null)
    })
    if (!local) child.stdin?.end(readFileSync(SCANNER))
  })
}

type CachedScan = {
  windowStart: number
  at: number
  result: Promise<HostScan | null>
  good: HostScan | null
}

const scans = new Map<string, CachedScan>()

/**
 * Today's scan for a host, reused for a minute. A failed scan falls back to
 * the last good one from the same day; midnight always starts fresh.
 */
export function collectTokens(host: string, now = new Date()): Promise<HostScan | null> {
  const window = dayWindow(now)
  const previous = scans.get(host)
  const sameDay = previous?.windowStart === window[0]
  if (previous && sameDay && now.getTime() - previous.at < SCAN_TTL_MS) return previous.result
  const entry: CachedScan = {
    windowStart: window[0],
    at: now.getTime(),
    good: sameDay && previous ? previous.good : null,
    result: Promise.resolve(null)
  }
  entry.result = runScanner(host, window).then((scan) => {
    if (scan) entry.good = scan
    return entry.good
  })
  scans.set(host, entry)
  return entry.result
}
