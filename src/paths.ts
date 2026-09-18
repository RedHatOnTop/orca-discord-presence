const SOCKET_INDEX_LIMIT = 10

/** Sandbox nests, most-likely first for this machine (Vesktop Flatpak + arRPC). */
const SANDBOX_SUBDIRS = [
  ".flatpak/dev.vencord.Vesktop/xdg-run",
  "app/com.discordapp.Discord",
  "snap.discord",
  ""
] as const

export type PathInput = {
  platform: string
  env: Record<string, string | undefined>
  uid?: number
}

function trimSlash(value: string): string {
  return value.replace(/[/\\]+$/, "")
}

export function discordIpcCandidates({ platform, env, uid }: PathInput): string[] {
  if (platform === "win32") {
    return Array.from({ length: SOCKET_INDEX_LIMIT }, (_, i) => `\\\\.\\pipe\\discord-ipc-${i}`)
  }

  const prefixes = [
    env.XDG_RUNTIME_DIR,
    typeof uid === "number" ? `/run/user/${uid}` : undefined,
    env.TMPDIR,
    env.TMP,
    "/tmp"
  ]
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .map(trimSlash)

  const seen = new Set<string>()
  const out: string[] = []
  for (const prefix of prefixes) {
    for (const subdir of SANDBOX_SUBDIRS) {
      const base = subdir ? `${prefix}/${subdir}` : prefix
      for (let i = 0; i < SOCKET_INDEX_LIMIT; i++) {
        const candidate = `${base}/discord-ipc-${i}`
        if (!seen.has(candidate)) {
          seen.add(candidate)
          out.push(candidate)
        }
      }
    }
  }
  return out
}
