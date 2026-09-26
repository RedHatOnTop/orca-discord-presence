import assert from "node:assert/strict"
import { accessSync, constants, readFileSync } from "node:fs"
import { isAbsolute } from "node:path"
import { test } from "node:test"

test("systemd service uses an absolute Orca CLI path", () => {
  const unit = readFileSync(new URL("../systemd/orca-discord-presence.service", import.meta.url), "utf8")
  const cli = unit.match(/^Environment=ORCA_CLI=(.+)$/m)?.[1]?.trim()

  assert.ok(cli, "ORCA_CLI must be set in the systemd unit")
  assert.ok(isAbsolute(cli), "ORCA_CLI must not rely on the systemd user PATH")
  assert.doesNotThrow(() => accessSync(cli, constants.X_OK), "ORCA_CLI must be executable")
})
