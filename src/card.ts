import { readFileSync } from "node:fs"

export type IdleCard = {
  clientId: string
  activity: Record<string, unknown>
}

const TEXT_MAX = 128
const LABEL_MAX = 32
const URL_MAX = 512
const MAX_BUTTONS = 2

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown, field: string, max = TEXT_MAX): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} must be a non-empty string`)
  if (value.length > max) throw new Error(`${field} is longer than ${max} characters`)
  return value
}

function optionalText(value: unknown, field: string, max = TEXT_MAX): string | null {
  return value === undefined ? null : text(value, field, max)
}

function httpsUrl(value: unknown, field: string): string {
  const url = text(value, field, URL_MAX)
  if (!url.startsWith("https://")) throw new Error(`${field} must be an https URL`)
  return url
}

function buttons(value: unknown): { label: string; url: string }[] | null {
  if (value === undefined) return null
  if (!Array.isArray(value)) throw new Error("buttons must be an array")
  if (value.length > MAX_BUTTONS) throw new Error(`Discord shows at most ${MAX_BUTTONS} buttons`)
  return value.map((raw, i) => {
    const button = asRecord(raw)
    if (!button) throw new Error(`buttons[${i}] must be an object`)
    return {
      label: text(button.label, `buttons[${i}].label`, LABEL_MAX),
      url: httpsUrl(button.url, `buttons[${i}].url`)
    }
  })
}

export function parseIdleCard(raw: unknown): IdleCard {
  const root = asRecord(raw)
  if (!root) throw new Error("idle card must be a JSON object")
  const clientId = text(root.clientId, "clientId")
  if (!/^\d{17,20}$/.test(clientId)) throw new Error("clientId must be a Discord application id")

  const details = optionalText(root.details, "details")
  const state = optionalText(root.state, "state")
  const image = root.image === undefined ? null : httpsUrl(root.image, "image")
  const imageText = optionalText(root.imageText, "imageText")
  const links = buttons(root.buttons)

  return {
    clientId,
    activity: {
      type: 0,
      name: text(root.name, "name"),
      ...(details ? { details } : {}),
      ...(state ? { state } : {}),
      ...(image ? { assets: { large_image: image, ...(imageText ? { large_text: imageText } : {}) } } : {}),
      ...(links ? { buttons: links } : {})
    }
  }
}

export function loadIdleCard(path: string): IdleCard {
  return parseIdleCard(JSON.parse(readFileSync(path, "utf8")))
}
