# 2026-09-26 — Vesktop presence service

- Observed the enabled user service connecting to the Vesktop Flatpak socket while publishing a null activity despite Orca ADE having active agents.
- Reproduced `env: ‘orca-ide’: No such file or directory` with the service's `/usr/local/bin:/usr/bin` PATH. The CLI is installed at `/home/person/.local/bin/orca-ide`.
- Added a regression test for the systemd unit's executable CLI path, then set `ORCA_CLI` to the absolute binary path. Kept the existing login-started service and 15-second republish loop.
- Restarted the user service and observed a non-null activity for the active Orca agents through the Vesktop IPC connection.
- Verified `npm test` (25 passed), `systemd-analyze verify`, and the service's `enabled`/`active` state. Subsequent service ticks published updated activity without errors.
- Direct screenshot inspection of Vesktop was unavailable in this Wayland session; the screenshot helper's ImageMagick fallback failed before capture.
