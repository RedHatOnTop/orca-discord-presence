import { buildActivity, featuredRepo, focusPool } from "./activity.ts"
import { DiscordIpc } from "./ipc.ts"
import { readFleet } from "./snapshot.ts"

const DEFAULT_CLIENT_ID = "1545653843239374848"
const POLL_MS = 15_000

function log(msg: string, extra?: unknown): void {
  const line = extra === undefined ? msg : `${msg} ${JSON.stringify(extra)}`
  console.log(`[orca-discord-rpc] ${line}`)
}

function sameActivity(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function tick(
  ipc: DiscordIpc,
  cli: string,
  startedAt: number,
  last: { current: unknown; repo: string | null },
  assetBase: string
): Promise<void> {
  if (!ipc.connected) {
    const path = await ipc.connect()
    log("connected", { path })
    last.current = undefined
  }
  const fleet = await readFleet(cli)
  const activity = buildActivity(fleet, startedAt, {
    previousRepo: last.repo,
    assetBase
  })
  // Always republish. Vesktop arRPC clears presence when any other IPC
  // client for this app id disconnects, and a skipped tick leaves a blank card.
  await ipc.setActivity(activity)
  const changed = !sameActivity(activity, last.current)
  last.current = activity
  last.repo = activity ? featuredRepo(focusPool(fleet), last.repo) : null
  if (changed) {
    log("presence", activity ? { details: activity.details, state: activity.state } : { details: null })
  }
}

async function main(): Promise<void> {
  const once = process.argv.includes("--once")
  const clientId = process.env.ORCA_DISCORD_CLIENT_ID || DEFAULT_CLIENT_ID
  const cli = process.env.ORCA_CLI || "orca-ide"
  const assetBase = process.env.ORCA_PRESENCE_ASSET_BASE || ""
  const startedAt = Math.floor(Date.now() / 1000)
  const ipc = new DiscordIpc(clientId)
  const last = { current: undefined as unknown, repo: null as string | null }

  const run = async () => {
    try {
      await tick(ipc, cli, startedAt, last, assetBase)
    } catch (err) {
      ipc.close()
      log("tick failed", { err: err instanceof Error ? err.message : String(err) })
    }
  }

  const shutdown = async () => {
    try {
      await ipc.clear()
    } catch {
      /* ignore */
    }
    ipc.close()
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  await run()
  if (once) {
    ipc.close()
    return
  }
  setInterval(run, POLL_MS)
}

await main()
