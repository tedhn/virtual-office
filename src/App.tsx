import { useCallback, useRef, useState } from "react"
import {
  StreamCall,
  StreamVideo,
  type Call,
  type StreamVideoClient,
} from "@stream-io/video-react-sdk"
import { Toaster } from "sonner"
import { JoinScreen } from "./JoinScreen"
import { OfficeRoom } from "./office/OfficeRoom"
import { createClient, makeUserId } from "./lib/stream"

const CALL_TYPE = "default"
const CALL_ID = "office-main"

type Session = {
  client: StreamVideoClient
  call: Call
  userId: string
  name: string
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)

  const handleJoin = useCallback(async (name: string) => {
    if (busy.current) return
    busy.current = true
    setConnecting(true)
    setError(null)
    let client: StreamVideoClient | undefined
    try {
      const userId = makeUserId(name)
      client = await createClient(userId, name)
      const call = client.call(CALL_TYPE, CALL_ID)
      setSession({ client, call, userId, name })
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : "Failed to connect")
      await client?.disconnectUser().catch(() => {})
    } finally {
      setConnecting(false)
      busy.current = false
    }
  }, [])

  const handleLeave = useCallback(async () => {
    if (!session) return
    const { client, call } = session
    setSession(null)
    try {
      await call.leave()
    } catch {
      /* not joined yet — ignore */
    }
    await client.disconnectUser().catch(() => {})
  }, [session])

  return (
    <>
      <Toaster />
      {session ? (
        <StreamVideo client={session.client}>
          <StreamCall call={session.call}>
            <OfficeRoom
              localUserId={session.userId}
              localName={session.name}
              onLeave={handleLeave}
            />
          </StreamCall>
        </StreamVideo>
      ) : (
        <JoinScreen onJoin={handleJoin} connecting={connecting} error={error} />
      )}
    </>
  )
}

export default App
