import { buildActivity } from "./activity.ts"
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
  last: { current: unknown }
): Promise<void> {
  if (!ipc.connected) {
    const path = await ipc.connect()
    log("connected", { path })
    last.current = undefined
  }
  const fleet = await readFleet(cli)
  const activity = buildActivity(fleet, startedAt)
  if (sameActivity(activity, last.current)) return
  await ipc.setActivity(activity)
  last.current = activity
  log("presence", activity ? { details: activity.details, state: activity.state } : { details: null })
}

async function main(): Promise<void> {
  const once = process.argv.includes("--once")
  const clientId = process.env.ORCA_DISCORD_CLIENT_ID || DEFAULT_CLIENT_ID
  const cli = process.env.ORCA_CLI || "orca-ide"
  const startedAt = Math.floor(Date.now() / 1000)
  const ipc = new DiscordIpc(clientId)
  const last = { current: undefined as unknown }

  const run = async () => {
    try {
      await tick(ipc, cli, startedAt, last)
    } catch (err) {
      ipc.close()
      log("tick failed", { err: err instanceof Error ? err.message : String(err) })
    }
  }

  process.on("SIGINT", async () => {
    try {
      await ipc.clear()
    } catch {
      /* ignore */
    }
    ipc.close()
    process.exit(0)
  })
  process.on("SIGTERM", async () => {
    try {
      await ipc.clear()
    } catch {
      /* ignore */
    }
    ipc.close()
    process.exit(0)
  })

  await run()
  if (once) {
    ipc.close()
    return
  }
  setInterval(run, POLL_MS)
}

await main()
