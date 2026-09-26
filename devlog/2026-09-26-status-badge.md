# 2026-09-26 — Status badge and card title

- Picked up an unfinished Codex change that re-added `small_image` using the application's `state-*` asset keys. On the borrowed application `1545653843239374848` those keys are whale art, so the card would have shown the whale-on-whale badge dropped on 2026-09-18.
- Badges now always load the ring PNGs in `assets/` by public URL (`DEFAULT_ASSET_BASE`, or `ORCA_PRESENCE_ASSET_BASE`). Teal working, amber waiting, red blocked, grey idle.
- The card sends `name: "Orca ADE"`. Vesktop's arRPC spreads the activity after its defaults and the Vencord bridge only fills `name` when it is empty, so the title changes without a new Discord application. The official client still shows the application name.
- Verified in Vesktop 1.6.7 over a CDP screenshot of the account popout: title `Orca ADE`, teal ring badge, `6 Claude`, `4.1M tokens today`. `npm test` 29 passed.
- The card still shows a gamepad and an elapsed clock (`0:41`) although no `timestamps` are sent. The client adds it; not investigated further.
- Token totals still come only from Grok and Codex ledgers. Claude and Gemini agents are counted in the roster but not in `tokens today`.
