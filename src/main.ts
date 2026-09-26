import { buildActivity, featuredRepo, focusPool } from "./activity.ts"
import { loadIdleCard } from "./card.ts"
import { DiscordIpc } from "./ipc.ts"
import type { ActivityPayload } from "./ipc.ts"
import { nextIdleSince, slotOwner } from "./slot.ts"
import { readFleet } from "./snapshot.ts"

const DEFAULT_CLIENT_ID = "1545653843239374848"
const POLL_MS = 15_000

type Channel = {
  label: string
  ipc: DiscordIpc
  current: unknown
}

type IdleChannel = {
  channel: Channel
  activity: ActivityPayload
}

function log(msg: string, extra?: unknown): void {
  const line = extra === undefined ? msg : `${msg} ${JSON.stringify(extra)}`
  console.log(`[orca-discord-rpc] ${line}`)
}

function sameActivity(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function publish(channel: Channel, activity: ActivityPayload): Promise<void> {
  if (!channel.ipc.connected) {
    if (activity === null) return
    const path = await channel.ipc.connect()
    log("connected", { channel: channel.label, path })
    channel.current = undefined
  }
  // Always republish. Vesktop arRPC clears presence when any other IPC
  // client for this app id disconnects, and a skipped tick leaves a blank card.
  await channel.ipc.setActivity(activity)
  if (!sameActivity(activity, channel.current)) {
    log("presence", {
      channel: channel.label,
      details: activity ? (activity.details ?? null) : null,
      state: activity ? (activity.state ?? null) : null
    })
  }
  channel.current = activity
}

async function publishOrClose(channel: Channel, activity: ActivityPayload): Promise<void> {
  try {
    await publish(channel, activity)
  } catch (err) {
    channel.ipc.close()
    log("publish failed", { channel: channel.label, err: err instanceof Error ? err.message : String(err) })
  }
}

async function tick(
  orca: Channel,
  idle: IdleChannel | null,
  cli: string,
  last: { repo: string | null; idleSince: number | null },
  assetBase: string
): Promise<void> {
  const fleet = await readFleet(cli)
  const now = Date.now()
  last.idleSince = nextIdleSince(fleet, last.idleSince, now)
  const owner = idle ? slotOwner(last.idleSince, now) : "orca"
  const activity = owner === "orca" ? buildActivity(fleet, { previousRepo: last.repo, assetBase }) : null
  last.repo = activity ? featuredRepo(focusPool(fleet), last.repo) : null

  // Discord publishes only the first Playing activity it holds, so the card
  // giving up the slot is cleared before the other one is set.
  if (idle && owner === "card") {
    await publishOrClose(orca, null)
    await publishOrClose(idle.channel, idle.activity)
  } else {
    if (idle) await publishOrClose(idle.channel, null)
    await publishOrClose(orca, activity)
  }
}

function idleChannel(path: string): IdleChannel | null {
  try {
    const card = loadIdleCard(path)
    log("idle card", { path, clientId: card.clientId })
    return { channel: { label: "idle", ipc: new DiscordIpc(card.clientId), current: undefined }, activity: card.activity }
  } catch (err) {
    log("idle card disabled", { path, err: err instanceof Error ? err.message : String(err) })
    return null
  }
}

async function main(): Promise<void> {
  const once = process.argv.includes("--once")
  const clientId = process.env.ORCA_DISCORD_CLIENT_ID || DEFAULT_CLIENT_ID
  const cli = process.env.ORCA_CLI || "orca-ide"
  const assetBase = process.env.ORCA_PRESENCE_ASSET_BASE || ""
  const cardPath = process.env.ORCA_PRESENCE_IDLE_CARD || ""
  const orca: Channel = { label: "orca", ipc: new DiscordIpc(clientId), current: undefined }
  const idle = cardPath ? idleChannel(cardPath) : null
  // Start as long idle so a cold start with no live agents shows the idle card at once.
  const last = { repo: null as string | null, idleSince: 0 as number | null }
  const channels = idle ? [orca, idle.channel] : [orca]

  const run = async () => {
    try {
      await tick(orca, idle, cli, last, assetBase)
    } catch (err) {
      log("tick failed", { err: err instanceof Error ? err.message : String(err) })
    }
  }

  const shutdown = async () => {
    for (const channel of channels) {
      try {
        if (channel.ipc.connected) await channel.ipc.clear()
      } catch {
        /* ignore */
      }
      channel.ipc.close()
    }
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  await run()
  if (once) {
    for (const channel of channels) channel.ipc.close()
    return
  }
  setInterval(run, POLL_MS)
}

await main()
