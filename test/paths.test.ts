import assert from "node:assert/strict"
import { test } from "node:test"
import { discordIpcCandidates } from "../src/paths.ts"

test("linux lists Vesktop Flatpak sockets before bare discord-ipc", () => {
  const paths = discordIpcCandidates({
    platform: "linux",
    env: { XDG_RUNTIME_DIR: "/run/user/1000" },
    uid: 1000
  })
  assert.equal(paths[0], "/run/user/1000/.flatpak/dev.vencord.Vesktop/xdg-run/discord-ipc-0")
  const bare = paths.indexOf("/run/user/1000/discord-ipc-0")
  const vesktop = paths.indexOf("/run/user/1000/.flatpak/dev.vencord.Vesktop/xdg-run/discord-ipc-0")
  assert.ok(vesktop >= 0 && bare > vesktop)
})

test("uid reconstructs /run/user when XDG_RUNTIME_DIR is missing", () => {
  const paths = discordIpcCandidates({ platform: "linux", env: {}, uid: 1000 })
  assert.ok(paths.includes("/run/user/1000/.flatpak/dev.vencord.Vesktop/xdg-run/discord-ipc-0"))
})
