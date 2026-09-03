import { execFile } from "node:child_process"
import { createServer } from "node:http"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import { WebSocket, WebSocketServer } from "ws"
import { attachRelay } from "./relay.mjs"
import { EXAMPLE_LAYOUT } from "../src/office/exampleLayout.ts"

// Points in the example Floor, in world px. The same coordinates the geometry tests use,
// so both suites agree on what "inside room C" means.
const ON_FLOOR = { x: 400, y: 1200 }
const ALSO_ON_FLOOR = { x: 300, y: 1300 }
const IN_ROOM_A = { x: 200, y: 1900 }
const ALSO_IN_ROOM_A = { x: 300, y: 1850 }
const IN_ROOM_B = { x: 700, y: 1900 }
const IN_STALL = { x: 70, y: 70 } // T1 — a non-private Room

/**
 * A second Office, laid out differently on purpose: where the example Floor has open
 * corridor, this one has a private Room. A relay that reached for one Layout for everybody
 * would judge the same point two different ways depending on whose it used.
 */
const OTHER_LAYOUT = {
  floor: EXAMPLE_LAYOUT.floor,
  zones: [
    { id: "spawn", kind: "spawn", rect: { x: 0.08, y: 0.66, w: 0.24, h: 0.08 } },
    { id: "vault", kind: "room", private: true, label: "Vault", rect: { x: 0, y: 0.5, w: 1, h: 0.2 } },
  ],
}

/** Everything is local, so a short tick is enough for the relay to fan a message out. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 80))

/** Torn down after each test, whichever harness started them. */
const running = []
afterEach(async () => {
  for (const harness of running.splice(0)) await harness.stop()
})

/**
 * A relay on a real WebSocket server, with a stand-in office directory.
 *
 * `layoutFor` is the whole of what the relay is given, so a test says which Offices exist
 * and what is on their Floors by answering it — including by refusing to answer, which is
 * how the "cannot reach the directory" case is written.
 */
function relayHarness(layoutFor) {
  const httpServer = createServer()
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" })
  const relay = attachRelay(wss, { layoutFor })
  const clients = []
  const listening = new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve))

  const harness = {
    /** The relay's own handle — what the HTTP side of the server holds. */
    handle: relay,

    /** Connect a Visitor, join an Office and (unless told otherwise) report a position. */
    async visitor(id, pos, office = "office-test") {
      await listening
      const sock = new WebSocket(`ws://127.0.0.1:${httpServer.address().port}/ws`)
      const received = []
      const closed = []
      sock.on("message", (raw) => received.push(JSON.parse(raw.toString())))
      sock.on("close", (code) => closed.push(code))
      await new Promise((resolve, reject) => {
        sock.once("open", resolve)
        sock.once("error", reject)
      })
      const client = {
        sock,
        received,
        closed,
        send: (m) => sock.send(JSON.stringify(m)),
        chats: () => received.filter((m) => m.t === "chat"),
        states: () => received.filter((m) => m.t === "state"),
        layouts: () => received.filter((m) => m.t === "layout").map((m) => m.layout),
      }
      clients.push(client)
      client.send({ t: "join", office, id, name: id })
      if (pos) client.send({ t: "move", ...pos })
      return client
    },

    async stop() {
      for (const c of clients) c.sock.close()
      relay.closeAll()
      wss.close()
      await new Promise((resolve) => httpServer.close(resolve))
    },
  }

  running.push(harness)
  return harness
}

/** Three Offices on the example Floor, which is what most of these tests want. */
function exampleRelay() {
  const published = new Set(["office-test", "office-one", "office-two"])
  return relayHarness(async (slug) => (published.has(slug) ? EXAMPLE_LAYOUT : null))
}

describe("Chat isolation", () => {
  it("delivers open-Floor chat to the open Floor, and not into a private Room", async () => {
    const relay = exampleRelay()
    const alice = await relay.visitor("alice", ON_FLOOR)
    const bob = await relay.visitor("bob", ALSO_ON_FLOOR)
    const carol = await relay.visitor("carol", IN_ROOM_A)
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
    const relay = exampleRelay()
    const alice = await relay.visitor("alice", IN_ROOM_A)
    const bob = await relay.visitor("bob", ALSO_IN_ROOM_A)
    const carol = await relay.visitor("carol", ON_FLOOR)
    await settle()

    alice.send({ t: "chat", text: "just between us" })
    await settle()

    expect(bob.chats().map((m) => m.text)).toEqual(["just between us"])
    expect(bob.chats()[0].room).toBe("A")
    expect(carol.chats()).toEqual([])
  })

  it("separates two private Rooms from each other", async () => {
    const relay = exampleRelay()
    const alice = await relay.visitor("alice", IN_ROOM_A)
    const bob = await relay.visitor("bob", IN_ROOM_B)
    await settle()

    alice.send({ t: "chat", text: "hello room B" })
    await settle()

    expect(bob.chats()).toEqual([])
  })

  it("leaves a non-private Room's occupant on the open Floor", async () => {
    const relay = exampleRelay()
    const alice = await relay.visitor("alice", IN_STALL)
    const bob = await relay.visitor("bob", ON_FLOOR)
    const carol = await relay.visitor("carol", IN_ROOM_A)
    await settle()

    alice.send({ t: "chat", text: "back in a sec" })
    await settle()

    expect(bob.chats().map((m) => m.text)).toEqual(["back in a sec"])
    expect(bob.chats()[0].room).toBeNull()
    expect(carol.chats()).toEqual([])
  })

  it("follows a Visitor's position, message by message", async () => {
    const relay = exampleRelay()
    const alice = await relay.visitor("alice", ON_FLOOR)
    const bob = await relay.visitor("bob", IN_ROOM_A)
    await settle()

    alice.send({ t: "chat", text: "from the floor" })
    alice.send({ t: "move", ...IN_ROOM_A })
    alice.send({ t: "chat", text: "from room A" })
    await settle()

    expect(bob.chats().map((m) => m.text)).toEqual(["from room A"])
  })

  it("judges a message from where its sender stood, not from where they went next", async () => {
    // Looking the Layout up is asynchronous, and a walk into a private Room lands in that
    // gap. A message posted from the open Floor must not be carried into the Room by its
    // sender's next step — that is a private conversation gaining a line nobody sent to it.
    const slow = async (slug) => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return slug === "office-test" ? EXAMPLE_LAYOUT : null
    }
    const relay = relayHarness(slow)
    const alice = await relay.visitor("alice", ON_FLOOR)
    const bob = await relay.visitor("bob", IN_ROOM_A)
    await settle()

    alice.send({ t: "chat", text: "out on the floor" })
    alice.send({ t: "move", ...IN_ROOM_A })
    await settle()

    expect(bob.chats()).toEqual([])
  })

  it("ignores a client's own claim about which Room it is in", async () => {
    // ADR-0002: a client that says it is in room A must not thereby receive room A's chat,
    // and must not be able to post into it from outside.
    const relay = exampleRelay()
    const alice = await relay.visitor("alice", ON_FLOOR)
    const bob = await relay.visitor("bob", IN_ROOM_A)
    await settle()

    alice.send({ t: "chat", text: "let me in", room: "A" })
    bob.send({ t: "chat", text: "secret", room: null })
    await settle()

    expect(bob.chats()).toEqual([])
    expect(alice.chats()).toEqual([])
  })

  it("streams positions to everyone, Room-context or not", async () => {
    const relay = exampleRelay()
    const alice = await relay.visitor("alice", IN_ROOM_A)
    const bob = await relay.visitor("bob", ON_FLOOR)
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

  it("keeps the position a client sends before its Office has been looked up", async () => {
    // A client sends its position straight after joining and does not wait for the
    // database round trip the join takes. Dropping that message leaves an avatar standing
    // at the origin — and, worse, judged against the Room-context of the origin.
    const relay = exampleRelay()
    const alice = await relay.visitor("alice", IN_ROOM_A)
    const bob = await relay.visitor("bob", ALSO_IN_ROOM_A)
    await settle()

    alice.send({ t: "chat", text: "just between us" })
    await settle()

    expect(bob.chats().map((m) => m.text)).toEqual(["just between us"])
  })

  it("ignores a join that names no Office", async () => {
    const relay = exampleRelay()
    const stray = await relay.visitor("stray", ON_FLOOR, "")
    const bob = await relay.visitor("bob", ALSO_ON_FLOOR)
    await settle()

    stray.send({ t: "chat", text: "hello?" })
    await settle()

    expect(bob.chats()).toEqual([])
    expect(bob.received.find((m) => m.t === "snapshot").peers).toEqual([])
  })

  it("never crosses Offices, even on the open Floor", async () => {
    const relay = exampleRelay()
    const alice = await relay.visitor("alice", ON_FLOOR, "office-one")
    const bob = await relay.visitor("bob", ON_FLOOR, "office-two")
    await settle()

    alice.send({ t: "chat", text: "hello?" })
    await settle()

    expect(bob.chats()).toEqual([])
    expect(bob.states()).toEqual([])
  })
})

describe("Which Office's Layout privacy is judged against", () => {
  // A point that is open Floor in the example Office and inside a private Room in the
  // other one. Same coordinates, two different answers — which is the whole point.
  const CONTESTED = { x: 400, y: 1200 }
  const ALSO_CONTESTED = { x: 500, y: 1250 }

  const twoOffices = () =>
    relayHarness(async (slug) =>
      slug === "other-office" ? OTHER_LAYOUT : slug === "office-test" ? EXAMPLE_LAYOUT : null,
    )

  it("tags a message with the Room of the Office the sender is actually in", async () => {
    const relay = twoOffices()
    const alice = await relay.visitor("alice", CONTESTED, "other-office")
    const bob = await relay.visitor("bob", ALSO_CONTESTED, "other-office")
    await settle()

    alice.send({ t: "chat", text: "in the vault" })
    await settle()

    // The example Office calls this spot open Floor. This Office calls it the Vault, and
    // this Office is the one being stood in.
    expect(bob.chats().map((m) => m.room)).toEqual(["vault"])
  })

  it("turns away a Visitor at an address no published Office answers to", async () => {
    const relay = twoOffices()
    const stray = await relay.visitor("stray", ON_FLOOR, "not-an-office")
    await settle()

    expect(stray.closed).toEqual([4404])
  })

  it("closes for a retry when the directory cannot be asked, rather than refusing", async () => {
    // Not knowing whether an Office exists is not the same as knowing it does not: the
    // client's reconnect loop should get another go, not a locked door.
    const relay = relayHarness(async () => {
      throw new Error("database unreachable")
    })
    const stray = await relay.visitor("stray", ON_FLOOR)
    await settle()

    expect(stray.closed).toEqual([1013])
  })

  it("stops carrying chat for an Office that has since been unpublished", async () => {
    // Unpublishing locks people out (ADR-0006). Anyone already standing inside has no
    // Layout to judge Room-context by any more, and guessing is not an option privacy has.
    let live = true
    const relay = relayHarness(async () => (live ? EXAMPLE_LAYOUT : null))
    const alice = await relay.visitor("alice", ON_FLOOR)
    const bob = await relay.visitor("bob", ALSO_ON_FLOOR)
    await settle()

    live = false
    alice.send({ t: "chat", text: "still here?" })
    await settle()

    expect(bob.chats()).toEqual([])
  })
})

describe("Telling an Office its Layout has been republished", () => {
  it("counts the Visitors standing in one Office, and nobody from another", async () => {
    const relay = exampleRelay()
    await relay.visitor("alice", ON_FLOOR, "office-one")
    await relay.visitor("bob", ALSO_ON_FLOOR, "office-one")
    await relay.visitor("carol", ON_FLOOR, "office-two")
    await settle()

    expect(relay.handle.visitorCount("office-one")).toBe(2)
    expect(relay.handle.visitorCount("office-two")).toBe(1)
    expect(relay.handle.visitorCount("office-test")).toBe(0)
  })

  it("hands the new Layout to everyone standing in that Office", async () => {
    const relay = exampleRelay()
    const alice = await relay.visitor("alice", ON_FLOOR, "office-one")
    const bob = await relay.visitor("bob", ALSO_ON_FLOOR, "office-one")
    await settle()

    relay.handle.announceLayout("office-one", OTHER_LAYOUT)
    await settle()

    // The one each of them was handed on the way in, then the one just published.
    for (const client of [alice, bob]) {
      expect(client.layouts()).toEqual([EXAMPLE_LAYOUT, OTHER_LAYOUT])
    }
  })

  it("does not hand it to the people in a different Office", async () => {
    const relay = exampleRelay()
    const alice = await relay.visitor("alice", ON_FLOOR, "office-one")
    const carol = await relay.visitor("carol", ON_FLOOR, "office-two")
    await settle()

    relay.handle.announceLayout("office-one", OTHER_LAYOUT)
    await settle()

    expect(alice.layouts()).toEqual([EXAMPLE_LAYOUT, OTHER_LAYOUT])
    // Carol has only ever been handed the one she arrived on.
    expect(carol.layouts()).toEqual([EXAMPLE_LAYOUT])
  })

  it("hands the Layout to a Visitor as they arrive", async () => {
    // The one path back to a current Layout when an announcement never landed — a server
    // that was not the one told, or a browser that could not reach it. A reconnect is a
    // join, so this is also what makes the client's reconnect loop a backstop.
    const relay = exampleRelay()
    const alice = await relay.visitor("alice", ON_FLOOR, "office-one")
    await settle()

    expect(alice.layouts()).toEqual([EXAMPLE_LAYOUT])
  })

  it("hands nothing to a Visitor it turns away", async () => {
    const relay = exampleRelay()
    const stray = await relay.visitor("stray", ON_FLOOR, "not-an-office")
    await settle()

    expect(stray.received).toEqual([])
  })

  it("shrugs at an Office nobody is standing in", () => {
    const relay = exampleRelay()
    expect(() => relay.handle.announceLayout("office-one", OTHER_LAYOUT)).not.toThrow()
  })
})

describe("Shared modules loaded from source", () => {
  const run = promisify(execFile)

  // Every server module that imports TypeScript from `src/`: the relay for the geometry
  // and the close codes, the Layout cache for the schema, the token and publishing routes
  // for the slug shape. Add to this list whenever another server module starts doing the same.
  for (const module of ["./relay.mjs", "./officeLayouts.mjs", "./token.mjs", "./publishing.mjs"]) {
    it(`loads ${module} in plain Node, the way the server actually starts`, async () => {
      // Vitest resolves extensionless imports through Vite; plain Node does not. A runtime
      // import inside the shared graph that loses its `.ts` passes every test above and
      // fails only here — and, without this, only in production. See ADR-0004.
      const href = new URL(module, import.meta.url).href
      await run(process.execPath, [
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(href)})`,
      ])
    })
  }
})
