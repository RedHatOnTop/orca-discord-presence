import { spawn } from "node:child_process"
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

export function mergeTokenTotals(groups: TokenTotal[][]): TokenTotal[] {
  const map = new Map<string, TokenTotal>()
  for (const group of groups) {
    for (const row of group) {
      const prev = map.get(row.provider)
      if (prev) prev.totalTokens += row.totalTokens
      else map.set(row.provider, { ...row })
    }
  }
  return [...map.values()]
    .filter((row) => row.totalTokens > 0)
    .sort((a, b) => b.totalTokens - a.totalTokens || a.label.localeCompare(b.label))
}

const REMOTE_SCANNER = `
import json, sys
from pathlib import Path
day = sys.argv[1]
home = Path.home()

def last_thread(path):
    last = 0
    try:
        text = path.read_text(errors="ignore")
    except Exception:
        return 0
    for line in text.splitlines():
        if "token_usage_record" not in line:
            continue
        try:
            data = json.loads(line)
        except Exception:
            continue
        if data.get("type") != "token_usage_record":
            continue
        payload = data.get("payload") or {}
        thread = payload.get("thread_token_usage") or payload.get("usage") or {}
        n = thread.get("total_tokens")
        if isinstance(n, (int, float)):
            last = int(n)
    return last

def grok_sum():
    total = 0
    root = home / ".grok" / "sessions"
    if not root.exists():
        return 0
    for path in root.rglob("usage.json"):
        try:
            data = json.loads(path.read_text())
        except Exception:
            continue
        updated = str(data.get("updatedAt") or "")
        if not updated.startswith(day):
            continue
        session = data.get("session") or {}
        n = session.get("totalTokens")
        if isinstance(n, (int, float)):
            total += int(n)
    return total

n_codex = 0
root = home / ".codex" / "sessions" / Path(*day.split("-"))
if root.is_dir():
    for path in root.glob("*.jsonl"):
        n_codex += last_thread(path)
print(json.dumps({"codex": n_codex, "grok": grok_sum()}))
`

export function collectHostTokens(host: string, day = localDay()): Promise<TokenTotal[]> {
  if (!host || host === "local") return Promise.resolve([])
  return new Promise((resolve) => {
    const child = spawn(
      "ssh",
      ["-o", "ConnectTimeout=8", "-o", "BatchMode=yes", host, "python3", "-", day],
      { stdio: ["pipe", "pipe", "pipe"] }
    )
    const stdout: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      resolve([])
    }, 12000)
    child.stdin.write(REMOTE_SCANNER)
    child.stdin.end()
    child.stdout.on("data", (chunk) => stdout.push(chunk))
    child.on("error", () => {
      clearTimeout(timer)
      resolve([])
    })
    child.on("close", () => {
      clearTimeout(timer)
      try {
        const parsed = JSON.parse(Buffer.concat(stdout).toString("utf8")) as Record<string, unknown>
        const out: TokenTotal[] = []
        const nCodex = typeof parsed.codex === "number" ? parsed.codex : 0
        const nGrok = typeof parsed.grok === "number" ? parsed.grok : 0
        if (nCodex > 0) out.push({ provider: "codex", label: "Codex", totalTokens: nCodex })
        if (nGrok > 0) out.push({ provider: "grok", label: "Grok", totalTokens: nGrok })
        resolve(out)
      } catch {
        resolve([])
      }
    })
  })
}
