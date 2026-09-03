import { useCallback, useEffect, useRef, useState } from "react"
import { StreamCall, StreamVideo } from "@stream-io/video-react-sdk"
import { NotFound } from "@/NotFound"
import { JoinScreen } from "@/JoinScreen"
import { Button } from "@/components/ui/button"
import type { AuthGateway } from "@/auth/useAuthSession"
import type { PublishedOffice } from "@/lib/offices"
import { isAnonymous } from "@/auth/session"
import { editPath } from "@/lib/routes"
import { createClient } from "@/lib/stream"
import { navigate } from "@/lib/useRoute"
import { InsideOffice } from "./InsideOffice"
import type { Layout } from "./layout"
import { openOfficeCall, type OfficeCall } from "./officeCall"
import { usePublishedOffice } from "./usePublishedOffice"

interface OfficeViewProps {
  /** The Office's permanent address, taken from the URL. */
  slug: string
  auth: AuthGateway
}

/**
 * An Office at its own URL: what is there, and then standing in it.
 *
 * Two steps, because they fail differently. Finding the Office is a question about an
 * address and can answer "nowhere"; walking into it is a question about media permissions
 * and a call, and can answer "not right now". Keeping them apart is what lets a Visitor
 * retry the second without re-asking the first.
 */
export function OfficeView({ slug, auth }: OfficeViewProps) {
  const lookup = usePublishedOffice(slug)

  if (lookup.status === "loading") {
    return (
      <div className="min-h-svh flex items-center justify-center p-6">
        <p className="text-muted-foreground text-sm">Opening the office…</p>
      </div>
    )
  }

  if (lookup.status === "missing") return <NotFound />

  if (lookup.status === "error") {
    return (
      <div className="min-h-svh flex flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight">This office would not open</h1>
        <p className="text-destructive max-w-sm text-sm">{lookup.message}</p>
      </div>
    )
  }

  return <OfficeDoor office={lookup.value} auth={auth} />
}

/**
 * Turned out: the Office stopped being reachable while this Visitor was standing in it
 * (CONTEXT.md, Office).
 *
 * Its own screen rather than a message on the way back to the join screen, because the
 * join screen offers to walk in — and there is nowhere to walk into. Deliberately says
 * nothing about which of deleting and unpublishing happened: that is the Owner's business,
 * and the relay does not know either (see `NotFound`, which draws the same line).
 */
function TurnedOut({ officeName }: { officeName: string }) {
  return (
    <div className="min-h-svh flex flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{officeName} is gone</h1>
        <p className="text-muted-foreground max-w-sm text-sm">
          Its owner took it down while you were inside, so you have been turned out. This
          address doesn't lead to an office any more.
        </p>
      </div>
      <Button variant="secondary" onClick={() => navigate("/")}>
        Go to the start
      </Button>
    </div>
  )
}

/** A Visitor who has been let in: their call, and the name they are wearing. */
interface Presence {
  call: OfficeCall
  userId: string
  name: string
}

/**
 * The door of one Office, and what is behind it.
 *
 * The call is opened when somebody walks in, and released when they leave by the button or
 * navigate away. A closed tab is Stream's to notice — its own socket drops with the page —
 * which is why there is no unload handler here pretending to do it more tidily.
 */
function OfficeDoor({ office, auth }: { office: PublishedOffice; auth: AuthGateway }) {
  // The Layout being stood on right now. It starts as the one this Office was loaded with
  // and is replaced when its Owner publishes: the relay hands the new one down the socket
  // rather than everyone inside going back to the database for it (see `useRealtime`).
  // Held here rather than inside, because it is the Office's, not the standing-in-it's.
  const [layout, setLayout] = useState<Layout>(office.published_layout)
  const [presence, setPresence] = useState<Presence | null>(null)
  // Set when the relay turns this Visitor out: no Office answers to this address any more,
  // its Owner having deleted or unpublished it while they were standing in it. One-way —
  // there is no Office to walk back into, so nothing clears it.
  const [turnedOut, setTurnedOut] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The call to let go of on the way out, reachable from an unmount cleanup that must not
  // re-run every time `presence` changes.
  const openCall = useRef<OfficeCall | null>(null)
  const { ensureIdentity } = auth

  useEffect(() => {
    return () => {
      void openCall.current?.release()
      openCall.current = null
    }
  }, [])

  const join = useCallback(
    async (name: string) => {
      if (connecting || openCall.current) return
      setConnecting(true)
      setError(null)
      try {
        // The Stream user is the Supabase identity, not something invented from the display
        // name: the same person walking back in is the same person, refresh after refresh.
        const identity = await ensureIdentity()
        if (!identity) throw new Error("There is no identity to walk in with")

        const userId = identity.user.id
        const call = await openOfficeCall({
          // The token server mints only for a published Office, and this is the slug it
          // checks (ADR-0006).
          connect: () => createClient(userId, name, office.slug),
          callId: office.id,
        })
        openCall.current = call
        setPresence({ call, userId, name })
      } catch (err) {
        console.error(err)
        setError(err instanceof Error ? err.message : "Could not join this office")
      } finally {
        setConnecting(false)
      }
    },
    [connecting, ensureIdentity, office.id, office.slug],
  )

  const leave = useCallback(() => {
    const call = openCall.current
    openCall.current = null
    setPresence(null)
    void call?.release()
  }, [])

  // Being turned out is leaving, plus being told why: the call goes the same way it does
  // when somebody presses the button, because a call into an Office that is gone is a call
  // to nowhere.
  const turnOut = useCallback(() => {
    leave()
    setTurnedOut(true)
  }, [leave])

  if (turnedOut) return <TurnedOut officeName={office.name} />

  if (!presence) {
    // Only the Owner is offered the editor, and only when they are signed in as an account
    // rather than as the anonymous Visitor they also are. This is an offer, not a gate: the
    // editor's address is guessable, and what stops a stranger opening it is the database
    // returning them no Office, not this line.
    const owns =
      !!auth.session && !isAnonymous(auth.session) && auth.session.user.id === office.owner_id

    return (
      <JoinScreen
        officeName={office.name}
        layout={layout}
        onJoin={(name) => void join(name)}
        connecting={connecting}
        error={error ?? auth.error}
        auth={auth}
        onEdit={owns ? () => navigate(editPath(office.slug)) : undefined}
      />
    )
  }

  return (
    <StreamVideo client={presence.call.client}>
      <StreamCall call={presence.call.call}>
        <InsideOffice
          layout={layout}
          officeSlug={office.slug}
          officeName={office.name}
          localUserId={presence.userId}
          localName={presence.name}
          onLeave={leave}
          onRepublished={setLayout}
          onTurnedOut={turnOut}
        />
      </StreamCall>
    </StreamVideo>
  )
}
