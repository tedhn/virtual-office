import type { Call, StreamVideoClient } from "@stream-io/video-react-sdk"

/**
 * An Office's call, for as long as somebody is standing in it.
 *
 * A call is not part of an Office the way its Layout is. It is created the first time
 * somebody walks in — `create: true` on the join — and it is held open by nothing but the
 * people on it, so when the last person leaves there is no session left running. That is
 * the whole lifecycle, and it lives here rather than scattered across the screen that
 * renders the Floor, because the failure it guards against is a connection nobody is
 * using and nobody remembers making.
 *
 * Deliberately NOT ended when the last Visitor leaves: ending a call is permanent as far
 * as Stream is concerned, and an Office whose link stops working the first time it empties
 * is worse than a call record sitting idle at no cost.
 */
export interface OfficeCall {
  client: StreamVideoClient
  call: Call
  /**
   * Leave and disconnect. Safe to call more than once — leaving by the button and then
   * unmounting is ordinary — and never throws: a connection to let go of is not something
   * to fail at.
   */
  release: () => Promise<void>
}

/**
 * Stream's stock call type. Nothing in this product configures one of its own, so an
 * Office's call is a `default` call whose id is the Office's.
 */
const CALL_TYPE = "default"

interface OpenOfficeCallOptions {
  /** Connects a Stream client for the person walking in. Injected so this module needs no
   *  Stream credentials, and no Stream at all in a test. */
  connect: () => Promise<StreamVideoClient>
  /** The Office's permanent id. One call per Office, and never shared with another. */
  callId: string
}

export async function openOfficeCall({
  connect,
  callId,
}: OpenOfficeCallOptions): Promise<OfficeCall> {
  const client = await connect()

  let call: Call
  try {
    call = client.call(CALL_TYPE, callId)
    // First arrival creates it; everyone after joins the one that is already there.
    await call.join({ create: true })
    // An audio-first office: you are heard on arrival and seen only if you decide to be.
    await call.camera.disable()
    await call.microphone.enable()
  } catch (err) {
    // A join that failed still leaves a connected client behind, and nobody holds a
    // reference to it once this throws.
    await quietly(() => client.disconnectUser())
    throw err
  }

  let released = false
  return {
    client,
    call,
    release: async () => {
      if (released) return
      released = true
      await quietly(() => call.leave())
      // Disconnect regardless: a call that had already dropped is exactly the case where
      // a connection would otherwise be left behind.
      await quietly(() => client.disconnectUser())
    },
  }
}

/** Run something we want done but will not fail over, reporting rather than throwing. */
async function quietly(action: () => Promise<unknown>): Promise<void> {
  try {
    await action()
  } catch (err) {
    console.error("leaving the office:", err)
  }
}
