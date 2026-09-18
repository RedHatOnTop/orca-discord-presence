import { existsSync } from "node:fs"
import net from "node:net"
import { discordIpcCandidates } from "./paths.ts"

const OPCODE = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 } as const
const MAX_FRAME = 1024 * 1024

export type ActivityPayload = Record<string, unknown> | null

function encodeFrame(opcode: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), "utf8")
  const header = Buffer.allocUnsafe(8)
  header.writeInt32LE(opcode, 0)
  header.writeInt32LE(body.length, 4)
  return Buffer.concat([header, body])
}

class Decoder {
  private buf = Buffer.alloc(0)
  push(chunk: Buffer, onFrame: (opcode: number, data: unknown) => void): void {
    this.buf = Buffer.concat([this.buf, chunk])
    for (;;) {
      if (this.buf.length < 8) return
      const opcode = this.buf.readInt32LE(0)
      const length = this.buf.readInt32LE(4)
      if (length < 0 || length > MAX_FRAME) throw new Error(`bad frame length ${length}`)
      if (this.buf.length < 8 + length) return
      const json = this.buf.subarray(8, 8 + length).toString("utf8")
      this.buf = this.buf.subarray(8 + length)
      onFrame(opcode, JSON.parse(json))
    }
  }
}

function nonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export class DiscordIpc {
  private socket: net.Socket | null = null
  private decoder = new Decoder()
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()

  private readonly clientId: string
  private readonly pid: number

  constructor(clientId: string, pid = process.pid) {
    this.clientId = clientId
    this.pid = pid
  }

  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed
  }

  async connect(candidates = discordIpcCandidates({
    platform: process.platform,
    env: process.env,
    uid: process.getuid?.()
  })): Promise<string> {
    this.close()
    const existing = candidates.filter((p) => process.platform === "win32" || existsSync(p))
    if (existing.length === 0) {
      throw new Error("no Discord/Vesktop IPC socket (is Vesktop running with arRPC?)")
    }
    let lastErr: unknown
    for (const path of existing) {
      try {
        await this.connectPath(path)
        return path
      } catch (err) {
        lastErr = err
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
  }

  private connectPath(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(path)
      const decoder = new Decoder()
      let settled = false
      const fail = (err: Error) => {
        if (settled) return
        settled = true
        socket.destroy()
        reject(err)
      }
      socket.setTimeout(3000)
      socket.once("timeout", () => fail(new Error(`timeout ${path}`)))
      socket.once("error", (err) => fail(err))
      socket.once("connect", () => {
        socket.write(encodeFrame(OPCODE.HANDSHAKE, { v: 1, client_id: this.clientId }))
      })
      socket.on("data", (chunk) => {
        try {
          decoder.push(chunk, (opcode, data) => {
            if (!settled && opcode === OPCODE.FRAME) {
              const frame = data as { evt?: string }
              if (frame.evt === "READY") {
                settled = true
                socket.setTimeout(0)
                this.socket = socket
                this.decoder = decoder
                this.attach(socket)
                resolve()
                return
              }
            }
            if (opcode === OPCODE.PING) {
              socket.write(encodeFrame(OPCODE.PONG, data))
            }
          })
        } catch (err) {
          fail(err instanceof Error ? err : new Error(String(err)))
        }
      })
    })
  }

  private attach(socket: net.Socket): void {
    socket.on("data", (chunk) => {
      try {
        this.decoder.push(chunk, (opcode, data) => {
          if (opcode === OPCODE.PING) {
            socket.write(encodeFrame(OPCODE.PONG, data))
            return
          }
          if (opcode !== OPCODE.FRAME || data === null || typeof data !== "object") return
          const frame = data as { nonce?: string; evt?: string }
          if (frame.nonce && this.pending.has(frame.nonce)) {
            const pending = this.pending.get(frame.nonce)!
            clearTimeout(pending.timer)
            this.pending.delete(frame.nonce)
            pending.resolve(data)
          }
        })
      } catch {
        this.close()
      }
    })
    socket.on("error", () => this.close())
    socket.on("close", () => this.close())
  }

  setActivity(activity: ActivityPayload): Promise<unknown> {
    if (!this.socket) return Promise.reject(new Error("not connected"))
    const id = nonce()
    const payload = {
      cmd: "SET_ACTIVITY",
      nonce: id,
      args: { pid: this.pid, activity }
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error("SET_ACTIVITY timeout"))
      }, 8000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket!.write(encodeFrame(OPCODE.FRAME, payload))
    })
  }

  async clear(): Promise<void> {
    if (!this.connected) return
    await this.setActivity(null)
  }

  close(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error("ipc closed"))
    }
    this.pending.clear()
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.destroy()
      this.socket = null
    }
  }
}
