import { execFile } from "node:child_process"
import { createServer } from "node:http"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { WebSocket, WebSocketServer } from "ws"
import { attachRelay } from "./relay.mjs"
import { DEFAULT_LAYOUT } from "../src/office/defaultLayout.ts"

// Points in the default office's Floor, in world px. The same coordinates the geometry
// tests use, so both suites agree on what "inside room C" means.
const ON_FLOOR = { x: 400, y: 1200 }
const ALSO_ON_FLOOR = { x: 300, y: 1300 }
const IN_ROOM_A = { x: 200, y: 1900 }
const ALSO_IN_ROOM_A = { x: 300, y: 1850 }
const IN_ROOM_B = { x: 700, y: 1900 }
const IN_STALL = { x: 70, y: 70 } // T1 — a non-private Room

/** Everything is local, so a short tick is enough for the relay to fan a message out. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 80))

describe("Chat isolation", () => {
  let httpServer
  let wss
  let relay
  let port
  const clients = []

  beforeEach(async () => {
    httpServer = createServer()
    wss = new WebSocketServer({ server: httpServer, path: "/ws" })
    relay = attachRelay(wss, DEFAULT_LAYOUT)
    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve))
    port = httpServer.address().port
  })

  afterEach(async () => {
    for (const c of clients) c.sock.close()
    clients.length = 0
    relay.closeAll()
    wss.close()
    await new Promise((resolve) => httpServer.close(resolve))
  })

  /** Connect a Visitor, join an Office and report a position. */
  async function visitor(id, pos, office = "office-test", joinField = "office") {
    const sock = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    const received = []
    sock.on("message", (raw) => received.push(JSON.parse(raw.toString())))
    await new Promise((resolve, reject) => {
      sock.once("open", resolve)
      sock.once("error", reject)
    })
    const client = {
      sock,
      received,
      send: (m) => sock.send(JSON.stringify(m)),
      chats: () => received.filter((m) => m.t === "chat"),
      states: () => received.filter((m) => m.t === "state"),
    }
    clients.push(client)
    client.send({ t: "join", [joinField]: office, id, name: id })
    client.send({ t: "move", ...pos })
    return client
  }

  it("delivers open-Floor chat to the open Floor, and not into a private Room", async () => {
    const alice = await visitor("alice", ON_FLOOR)
    const bob = await visitor("bob", ALSO_ON_FLOOR)
    const carol = await visitor("carol", IN_ROOM_A)
    await settle()

    alice.send({ t: "chat", text: "anyone for coffee" })
    await settle()

    expect(bob.chats()).toEqual([
      { t: "chat", id: "alice", name: "alice", text: "anyone for coffee", room: null },
    ])
    expect(carol.chats()).toEqual([])
    // The sender local-echoes, so the relay must never send it back to them.
    expect(alice.chats()).toEqual([])
  })

  it("keeps a private Room's chat inside that Room", async () => {
    const alice = await visitor("alice", IN_ROOM_A)
    const bob = await visitor("bob", ALSO_IN_ROOM_A)
    const carol = await visitor("carol", ON_FLOOR)
    await settle()

    alice.send({ t: "chat", text: "just between us" })
    await settle()

    expect(bob.chats().map((m) => m.text)).toEqual(["just between us"])
    expect(bob.chats()[0].room).toBe("A")
    expect(carol.chats()).toEqual([])
  })

  it("separates two private Rooms from each other", async () => {
    const alice = await visitor("alice", IN_ROOM_A)
    const bob = await visitor("bob", IN_ROOM_B)
    await settle()

    alice.send({ t: "chat", text: "hello room B" })
    await settle()

    expect(bob.chats()).toEqual([])
  })

  it("leaves a non-private Room's occupant on the open Floor", async () => {
    const alice = await visitor("alice", IN_STALL)
    const bob = await visitor("bob", ON_FLOOR)
    const carol = await visitor("carol", IN_ROOM_A)
    await settle()

    alice.send({ t: "chat", text: "back in a sec" })
    await settle()

    expect(bob.chats().map((m) => m.text)).toEqual(["back in a sec"])
    expect(bob.chats()[0].room).toBeNull()
    expect(carol.chats()).toEqual([])
  })

  it("follows a Visitor's position, message by message", async () => {
    const alice = await visitor("alice", ON_FLOOR)
    const bob = await visitor("bob", IN_ROOM_A)
    await settle()

    alice.send({ t: "chat", text: "from the floor" })
    alice.send({ t: "move", ...IN_ROOM_A })
    alice.send({ t: "chat", text: "from room A" })
    await settle()

    expect(bob.chats().map((m) => m.text)).toEqual(["from room A"])
  })

  it("ignores a client's own claim about which Room it is in", async () => {
    // ADR-0002: a client that says it is in room A must not thereby receive room A's chat,
    // and must not be able to post into it from outside.
    const alice = await visitor("alice", ON_FLOOR)
    const bob = await visitor("bob", IN_ROOM_A)
    await settle()

    alice.send({ t: "chat", text: "let me in", room: "A" })
    bob.send({ t: "chat", text: "secret", room: null })
    await settle()

    expect(bob.chats()).toEqual([])
    expect(alice.chats()).toEqual([])
  })

  it("streams positions to everyone, Room-context or not", async () => {
    const alice = await visitor("alice", IN_ROOM_A)
    const bob = await visitor("bob", ON_FLOOR)
    await settle()

    // The arrival snapshot already shows a peer shut inside a private Room.
    const snapshot = bob.received.find((m) => m.t === "snapshot")
    expect(snapshot.peers.map((p) => ({ id: p.id, x: p.x, y: p.y }))).toEqual([
      { id: "alice", ...IN_ROOM_A },
    ])

    alice.send({ t: "move", ...ALSO_IN_ROOM_A })
    await settle()

    expect(bob.states().map((m) => ({ id: m.id, x: m.x, y: m.y }))).toEqual([
      { id: "alice", ...ALSO_IN_ROOM_A },
    ])
  })

  it("still honours the join field older bundles send", async () => {
    // A page cached across a redeploy reconnects with the previous bundle, which named the
    // Office `room`. It has to land in the same Office as everyone else, not beside it.
    const alice = await visitor("alice", ON_FLOOR, "office-test", "room")
    const bob = await visitor("bob", ALSO_ON_FLOOR)
    await settle()

    alice.send({ t: "chat", text: "still here" })
    await settle()

    expect(bob.chats().map((m) => m.text)).toEqual(["still here"])
  })

  it("ignores a join that names no Office", async () => {
    const stray = await visitor("stray", ON_FLOOR, "", "office")
    const bob = await visitor("bob", ALSO_ON_FLOOR)
    await settle()

    stray.send({ t: "chat", text: "hello?" })
    await settle()

    expect(bob.chats()).toEqual([])
    expect(bob.received.find((m) => m.t === "snapshot").peers).toEqual([])
  })

  it("never crosses Offices, even on the open Floor", async () => {
    const alice = await visitor("alice", ON_FLOOR, "office-one")
    const bob = await visitor("bob", ON_FLOOR, "office-two")
    await settle()

    alice.send({ t: "chat", text: "hello?" })
    await settle()

    expect(bob.chats()).toEqual([])
    expect(bob.states()).toEqual([])
  })
})

describe("Shared geometry module", () => {
  const run = promisify(execFile)

  it("loads in plain Node, the way the server actually starts", async () => {
    // Vitest resolves extensionless imports through Vite; plain Node does not. A runtime
    // import inside the shared graph that loses its `.ts` passes every test above and
    // fails only here — and, without this, only in production. See ADR-0004.
    const relay = new URL("./relay.mjs", import.meta.url).href
    await run(process.execPath, [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(relay)})`,
    ])
  })
})
