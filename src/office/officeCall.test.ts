import { describe, expect, it, vi } from "vitest"
import type { Call, StreamVideoClient } from "@stream-io/video-react-sdk"
import { openOfficeCall } from "./officeCall"

/**
 * A stand-in for Stream's client and call, recording what was asked of it in order. Only
 * the handful of methods this module touches exist on it, which is the point: the rest of
 * Stream's surface is not this module's business.
 */
function fakeStream({ joinFails = false }: { joinFails?: boolean } = {}) {
  const did: string[] = []
  const call = {
    join: vi.fn(async (options: { create: boolean }) => {
      did.push(options.create ? "join(create)" : "join")
      if (joinFails) throw new Error("call is full")
    }),
    leave: vi.fn(async () => void did.push("leave")),
    camera: { disable: vi.fn(async () => void did.push("camera off")) },
    microphone: { enable: vi.fn(async () => void did.push("mic on")) },
  }
  const asked: Array<[string, string]> = []
  const client = {
    call: vi.fn((type: string, id: string) => {
      asked.push([type, id])
      return call
    }),
    disconnectUser: vi.fn(async () => void did.push("disconnect")),
  }
  return {
    did,
    asked,
    call,
    client,
    connect: async () => client as unknown as StreamVideoClient,
  }
}

describe("Walking into an Office's call", () => {
  it("creates the call on the way in, so an Office nobody has entered has none", async () => {
    const stream = fakeStream()
    await openOfficeCall({ connect: stream.connect, callId: "office-uuid" })

    expect(stream.call.join).toHaveBeenCalledWith({ create: true })
  })

  it("joins this Office's own call and no other", async () => {
    const stream = fakeStream()
    await openOfficeCall({ connect: stream.connect, callId: "office-uuid" })

    expect(stream.asked).toEqual([["default", "office-uuid"]])
  })

  it("arrives with the mic live and the camera off", async () => {
    // An office you can be heard in, and a camera you turn on deliberately.
    const stream = fakeStream()
    await openOfficeCall({ connect: stream.connect, callId: "office-uuid" })

    expect(stream.did).toEqual(["join(create)", "camera off", "mic on"])
  })

  it("hands back the client and call the video components need", async () => {
    const stream = fakeStream()
    const opened = await openOfficeCall({ connect: stream.connect, callId: "office-uuid" })

    expect(opened.client).toBe(stream.client as unknown as StreamVideoClient)
    expect(opened.call).toBe(stream.call as unknown as Call)
  })
})

describe("Leaving an Office", () => {
  it("leaves the call and disconnects, so an empty Office holds nothing open", async () => {
    const stream = fakeStream()
    const opened = await openOfficeCall({ connect: stream.connect, callId: "office-uuid" })
    stream.did.length = 0

    await opened.release()

    expect(stream.did).toEqual(["leave", "disconnect"])
  })

  it("releases once, however many times it is asked", async () => {
    // Leaving by the button and then unmounting is the ordinary case, not a mistake.
    const stream = fakeStream()
    const opened = await openOfficeCall({ connect: stream.connect, callId: "office-uuid" })

    await opened.release()
    await opened.release()

    expect(stream.call.leave).toHaveBeenCalledTimes(1)
    expect(stream.client.disconnectUser).toHaveBeenCalledTimes(1)
  })

  it("still disconnects when leaving the call fails", async () => {
    // A call that has already dropped is exactly when a connection would be left behind.
    const stream = fakeStream()
    const opened = await openOfficeCall({ connect: stream.connect, callId: "office-uuid" })
    stream.call.leave.mockRejectedValueOnce(new Error("not joined"))

    await opened.release()

    expect(stream.client.disconnectUser).toHaveBeenCalledTimes(1)
  })

  it("leaves nothing connected when the join itself fails", async () => {
    const stream = fakeStream({ joinFails: true })

    await expect(openOfficeCall({ connect: stream.connect, callId: "office-uuid" })).rejects.toThrow(
      "call is full",
    )
    expect(stream.client.disconnectUser).toHaveBeenCalledTimes(1)
  })
})
