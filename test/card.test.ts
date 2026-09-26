import assert from "node:assert/strict"
import { test } from "node:test"
import { parseIdleCard } from "../src/card.ts"

const valid = {
  clientId: "1526558650032853052",
  name: "퍼슨냥",
  details: "마크서버 개발중",
  state: "personnya.dev",
  image: "https://cdn.example/card.png",
  imageText: "Full Moon",
  buttons: [
    { label: "웹사이트", url: "https://personnya.dev/" },
    { label: "디코 서버", url: "https://discord.gg/C5CnftJhcs" }
  ]
}

test("idle card maps to a Playing activity with image and buttons", () => {
  const card = parseIdleCard(valid)
  assert.equal(card.clientId, "1526558650032853052")
  assert.deepEqual(card.activity, {
    type: 0,
    name: "퍼슨냥",
    details: "마크서버 개발중",
    state: "personnya.dev",
    assets: { large_image: "https://cdn.example/card.png", large_text: "Full Moon" },
    buttons: valid.buttons
  })
})

test("optional fields are left out rather than sent empty", () => {
  const card = parseIdleCard({ clientId: valid.clientId, name: "퍼슨냥" })
  assert.deepEqual(card.activity, { type: 0, name: "퍼슨냥" })
})

test("idle card rejects what Discord would refuse", () => {
  assert.throws(() => parseIdleCard({ ...valid, clientId: "abc" }), /application id/)
  assert.throws(() => parseIdleCard({ ...valid, name: "" }), /name/)
  assert.throws(() => parseIdleCard({ ...valid, details: "x".repeat(129) }), /details/)
  assert.throws(() => parseIdleCard({ ...valid, image: "http://insecure/png" }), /https/)
  assert.throws(() => parseIdleCard({ ...valid, buttons: [...valid.buttons, valid.buttons[0]] }), /at most 2/)
  assert.throws(() => parseIdleCard({ ...valid, buttons: [{ label: "x".repeat(33), url: "https://a.b" }] }), /label/)
})
