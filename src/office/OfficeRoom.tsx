import { useEffect, useMemo, useRef, useState } from "react"
import {
  // Aliased: the bare name would shadow the DOM's `new Audio(...)` used for the jeff sound.
  Audio as ParticipantAudio,
  CallingState,
  SfuModels,
  hasAudio,
  hasScreenShareAudio,
  useCall,
  useCallStateHooks,
} from "@stream-io/video-react-sdk"
import {
  Mic,
  MicOff,
  LogOut,
  Armchair,
  Volume2,
  Info,
  X,
  Video,
  VideoOff,
  Headphones,
  HeadphoneOff,
  ScreenShare,
  ScreenShareOff,
} from "lucide-react"
import type { StreamVideoParticipant } from "@stream-io/video-react-sdk"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useIsMobile } from "@/lib/useIsMobile"
import { OfficeFloor } from "./OfficeFloor"
import { ChatBar } from "./ChatBar"
import { MobileControls, type FloorAction } from "./MobileControls"
import { VideoModal } from "./VideoModal"
import { useMovement } from "./useMovement"
import { useRealtime, type ChatMessage } from "./useRealtime"
import { useChat } from "./useChat"
import { useInterpolatedPositions } from "./usePositions"
import { useProximityAudio } from "./useProximityAudio"
import {
  exitSpot,
  freeSeatNear,
  isRoomLike,
  isSeatTaken,
  joinSpot,
  rectToPx,
  roomAt,
  roomLikeNear,
  zoneAt,
  seatedTableAt,
  standSpot,
  type Zone,
} from "./layout"
import { DEFAULT_LAYOUT } from "./defaultLayout"
import { AVATAR_SIZE, type Position, type Size } from "./types"

// Env-specific so dev (localhost) and prod (Railway) are independent offices — separate
// Stream call AND separate relay room, so they never see or hear each other.
const ROOM = `office-${import.meta.env.MODE}`

// World-px of width shown across a phone screen (~2x zoom vs the full 900px floor).
const MOBILE_VIEW_WIDTH = 430

// Proximity thresholds for the mobile contextual action button.
const ROOM_PROXIMITY = AVATAR_SIZE // px from a room wall that counts as "near"
const SEAT_PROXIMITY = 80 // px from a chair that counts as "near"

// Mobile: while the avatar sits under the top-left HUD (clamped camera parks it there),
// fade the HUD out. Fractions of the floor that count as "top-left".
const HUD_FADE_X = 0.34
const HUD_FADE_Y = 0.28

// Sound that plays when you walk past the table beside room C (t4).
const jeffUrl = new URL("../jeff.mp3", import.meta.url).href

interface OfficeRoomProps {
  localUserId: string
  localName: string
  onLeave: () => void
}

// Spawn everyone in the open left corridor beside the tables (below room C, above
// A/B, left of the tables), spread by user id so nobody starts trapped in a room.
function spawnFor(userId: string, floor: Size): Position {
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0
  const h = Math.abs(hash)
  const fx = 0.08 + (h % 240) / 1000 // 0.08 .. 0.32, clear of the tables (start at 0.42)
  const fy = 0.66 + ((h >> 5) % 80) / 1000 // 0.66 .. 0.74, tight cluster so lobby-mates are within earshot
  return { x: fx * floor.width, y: fy * floor.height }
}

export function OfficeRoom({ localUserId, localName, onLeave }: OfficeRoomProps) {
  const call = useCall()
  const {
    useCallCallingState,
    useParticipants,
    useLocalParticipant,
    useMicrophoneState,
    useCameraState,
    useScreenShareState,
  } = useCallStateHooks()
  const callingState = useCallCallingState()
  const participants = useParticipants()
  const localParticipant = useLocalParticipant()
  const { isMute, microphone } = useMicrophoneState()
  const { camera, isMute: cameraOff } = useCameraState()
  // Screen share: independent of the camera, off by default (audio-first office). Reflects
  // the browser's own "Stop sharing" bar too, so the button label stays correct either way.
  const { screenShare, isEnabled: sharingScreen } = useScreenShareState()

  // The office being rendered. One fixed layout for now; later this is fetched per office.
  const layout = DEFAULT_LAYOUT
  const floor = layout.floor
  const initial = useMemo(() => spawnFor(localUserId, floor), [localUserId, floor])
  const joinedRef = useRef(false)

  // Join once, publish mic, keep camera off (audio-only office).
  useEffect(() => {
    if (!call || joinedRef.current) return
    joinedRef.current = true
    ;(async () => {
      try {
        if (call.state.callingState === CallingState.IDLE) {
          await call.join({ create: true })
        }
        await call.camera.disable()
        await call.microphone.enable()
      } catch (err) {
        console.error("failed to join call:", err)
      }
    })()
  }, [call])

  // Positions ride a WebSocket relay (Stream's event endpoint is rate-limited);
  // interpolation smooths the discrete updates into fluid motion. Chat rides the same
  // relay; a ref bridges the socket's incoming handler to the chat hook created below
  // (the socket is set up before the hook, so this breaks the ordering cycle).
  const chatIncomingRef = useRef<(m: ChatMessage) => void>(() => {})
  const rt = useRealtime(ROOM, localUserId, localName, (m) => chatIncomingRef.current(m))
  const { pos: localPos, teleport, walkTo, move } = useMovement(rt.send, initial, layout)
  const isMobile = useIsMobile()
  const positions = useInterpolatedPositions(rt.targetsRef)

  // Deafen: silence all incoming audio and mute your own mic (Discord-style). While
  // deafened, unmuting the mic also lifts the deafen. preMuteRef remembers whether the
  // mic was already muted before deafening, so undeafening only re-enables it if you
  // hadn't muted yourself first.
  const [deafened, setDeafened] = useState(false)
  const preMuteRef = useRef(false)

  // Set local deafen state and broadcast it in one step so the two never drift.
  const applyDeafen = (on: boolean) => {
    setDeafened(on)
    rt.sendDeafen(on)
  }

  const toggleDeafen = () => {
    if (deafened) {
      applyDeafen(false)
      if (!preMuteRef.current) void microphone.enable()
    } else {
      preMuteRef.current = !!isMute
      applyDeafen(true)
      if (!isMute) void microphone.disable()
    }
  }

  // Unmuting while deafened also lifts the deafen; otherwise a plain mic toggle.
  const toggleMic = () => {
    if (deafened && isMute) applyDeafen(false)
    void microphone.toggle()
  }

  // Screen share, with its failures made visible. Publishing throws for reasons the user can't
  // guess at — notably "No publish options found for SCREEN_SHARE_AUDIO" when the call type
  // doesn't declare that track — and a bare `void toggle()` swallowed all of them silently.
  const toggleScreenShare = async () => {
    if (sharingScreen) {
      try {
        await screenShare.disable()
      } catch (e) {
        toast.error(`Couldn't stop sharing: ${(e as Error).message}`)
      }
      return
    }
    try {
      // No-op on current SDK versions (the flag already defaults on), but the documented way to
      // ask for it, so an SDK default flip can't silently drop audio.
      screenShare.enableScreenShareAudio()
      await screenShare.enable()
    } catch (e) {
      // The user cancelling the picker is not an error worth reporting.
      const err = e as Error
      if (err.name !== "NotAllowedError" && err.name !== "AbortError") {
        toast.error(`Screen share failed: ${err.message}`)
      }
      return
    }
    // Sharing without audio is the common case and easy to do by accident: the picker's audio
    // toggle is off by default, and a tab that IS this app is excluded on purpose
    // (restrictOwnAudio). Say so rather than letting people wonder why it's silent.
    const shared = call?.state.localParticipant?.publishedTracks ?? []
    if (!shared.includes(SfuModels.TrackType.SCREEN_SHARE_AUDIO)) {
      toast("Sharing without audio", {
        description:
          "Tick “Also share tab audio” in the picker. Only tab audio can be shared on Linux/macOS, and this app's own tab is excluded.",
      })
    }
  }

  const half = AVATAR_SIZE / 2
  const currentRoom = roomAt(layout, localPos) // private room (A/B/C) — drives chat/audio/video
  const insideZone = zoneAt(layout, localPos) // room-like enclosure (adds toilets) — drives Join/Leave label
  const seatedTable = seatedTableAt(layout, localPos, half)
  // Avatar drifted into the top-left corner (toilet wing / top of the spawn corridor), where
  // the clamped mobile camera parks it under the top-left HUD — fade that HUD out so it isn't
  // covered. Only mobile clamps the camera there; desktop centers, so it never applies.
  const hudFaded =
    isMobile && localPos.x < floor.width * HUD_FADE_X && localPos.y < floor.height * HUD_FADE_Y
  const hudFadeClass = `transition-opacity duration-300 ${
    hudFaded ? "opacity-0 pointer-events-none" : "opacity-100"
  }`
  const [showInfo, setShowInfo] = useState(false)

  // Which avatar's feed is expanded into a large dialog, and which of their tracks (camera or
  // shared screen). Resolved to a viewable target by `expanded` below.
  const [expandTarget, setExpandTarget] = useState<
    { userId: string; track: "videoTrack" | "screenShareTrack" } | null
  >(null)

  const chat = useChat({ sendChat: rt.sendChat, localUserId, localName, currentRoom })
  const { open: chatOpen, openChat } = chat
  // Bridge the socket's incoming handler to the chat hook — in an effect, not during
  // render, so the render stays pure.
  useEffect(() => {
    chatIncomingRef.current = chat.ingest
  }, [chat.ingest])

  // Enter opens the chat bar (Esc/send are handled inside it). Ignore it when focus is on
  // a field or an interactive control so it doesn't reopen the chat or swallow the key
  // that would type / activate that element.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const interactive =
        !!el &&
        (el.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(el.tagName))
      if (e.key === "Enter" && !interactive && !chatOpen) {
        e.preventDefault()
        openChat()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [chatOpen, openChat])

  // Play jeff.mp3 once each time you walk into the vicinity of the table beside room C (t4).
  const jeffRef = useRef<HTMLAudioElement | null>(null)
  const wasNearT4 = useRef(false)
  useEffect(() => {
    const t4 = layout.zones.find((z) => z.id === "t4")
    if (!t4) return
    const r = rectToPx(t4.rect, layout.floor)
    const pad = 60 // px around the table that counts as "passing" it
    const near =
      localPos.x > r.left - pad &&
      localPos.x < r.left + r.width + pad &&
      localPos.y > r.top - pad &&
      localPos.y < r.top + r.height + pad
    if (near && !wasNearT4.current) {
      if (!jeffRef.current) jeffRef.current = new Audio(jeffUrl)
      jeffRef.current.currentTime = 0
      void jeffRef.current.play().catch(() => {})
    }
    wasNearT4.current = near
  }, [localPos, layout])

  // Which remote users are currently speaking (Stream drives the flags).
  const speakingIds = useMemo(
    () => new Set(participants.filter((p) => p.isSpeaking).map((p) => p.userId)),
    [participants],
  )

  // Muted = not publishing an audio track.
  const mutedIds = useMemo(
    () =>
      new Set(
        participants
          .filter((p) => !p.publishedTracks.includes(SfuModels.TrackType.AUDIO))
          .map((p) => p.userId),
      ),
    [participants],
  )

  // userId -> Stream participant, so each avatar can render that person's video.
  const participantsById = useMemo(() => {
    const m: Record<string, StreamVideoParticipant> = {}
    for (const p of participants) m[p.userId] = p
    return m
  }, [participants])

  // Resolve the expanded avatar into a viewable target, gated by the SAME rule as the inline
  // video: it must still publish the requested track (camera or screen) and share your
  // room-context, so the dialog closes if they stop sharing or walk into a private room.
  const expanded = (() => {
    if (!expandTarget) return null
    const { userId, track } = expandTarget
    const p = participantsById[userId]
    const needed =
      track === "screenShareTrack" ? SfuModels.TrackType.SCREEN_SHARE : SfuModels.TrackType.VIDEO
    if (!p?.publishedTracks.includes(needed)) return null
    if (userId !== localUserId) {
      const peerPos = positions[userId]
      if (!peerPos || roomAt(layout, peerPos) !== currentRoom) return null
      return { participant: p, name: peerPos.name || p.name || userId, isSelf: false, track }
    }
    return { participant: p, name: localName, isSelf: true, track }
  })()
  // Forget the target once it's no longer viewable so it can't silently reopen later.
  const expandStale = !!expandTarget && !expanded
  useEffect(() => {
    if (expandStale) setExpandTarget(null)
  }, [expandStale])
  // Suspend the inline circle camera whenever the dialog binds that user's camera track (a
  // track binds to one element only). That's a camera expansion, and also a screen expansion
  // when the sharer's camera rides along as the modal's picture-in-picture. Reduces to: the
  // dialog target has a camera on. Screen-only expansions leave every circle untouched.
  const cameraExpandedId = expanded?.participant.publishedTracks.includes(
    SfuModels.TrackType.VIDEO,
  )
    ? expanded.participant.userId
    : null

  // Broadcast whose screen we're watching (only someone else's — self-preview doesn't count),
  // so their avatar/modal shows a live watcher count. Derived from the RESOLVED target, so it
  // clears automatically when the modal closes, they stop sharing, or we leave their room.
  const watchingId =
    expanded?.track === "screenShareTrack" && !expanded.isSelf
      ? expanded.participant.userId
      : null
  // Keep the sender in a ref so this fires only when the watched id changes — `rt` is a fresh
  // object each render and OfficeRoom re-renders every frame (positions), which would
  // otherwise re-broadcast the watch flag continuously.
  const sendWatchRef = useRef(rt.sendWatch)
  useEffect(() => {
    sendWatchRef.current = rt.sendWatch
  })
  useEffect(() => {
    sendWatchRef.current(watchingId)
  }, [watchingId])

  // Playback volumes. Lives here, below the resolved watch target, because whoever's screen
  // you have open is heard at full volume wherever they stand.
  useProximityAudio(localPos, positions, layout, deafened, watchingId, localUserId)

  // Watchers per screen-sharer, keyed by user id. Peers broadcast who they watch; add our own
  // watch too (we're not in `positions`) so every client renders the same count.
  const watchersById = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of Object.values(positions)) {
      if (p.watching) counts[p.watching] = (counts[p.watching] ?? 0) + 1
    }
    if (watchingId) counts[watchingId] = (counts[watchingId] ?? 0) + 1
    return counts
  }, [positions, watchingId])

  // Click a room to join it (or leave if already inside — teleport through the doorway).
  // Use zoneAt (room-like: rooms + toilets), not currentRoom (private rooms only), so the
  // join/leave toggle works for toilets even though they carry no privacy.
  const onEnter = (zone: Zone) => {
    if (!isRoomLike(zone.kind)) return
    const inside = zoneAt(layout, localPos)
    if (inside !== zone.id) {
      // Toilets are single stalls: refuse entry if a peer is already inside.
      if (zone.kind === "toilet") {
        const taken = Object.values(positions).some((p) => zoneAt(layout, p) === zone.id)
        if (taken) {
          toast(`${zone.label} is occupied`)
          return
        }
      }
      teleport(joinSpot(layout, zone, localPos, half))
      return
    }
    // Leaving. Toilets are tightly walled, so exitSpot can land in a wall — send them to a
    // hardcoded open spot in the corridor between the two stalls: the male stall (top) exits
    // just below it, the female stall (bottom) exits just above it.
    // Room C exits into the open gap beside the bottom wall and C; others use the nearest wall.
    if (zone.kind === "toilet") {
      teleport(
        zone.id === "T1"
          ? { x: 0.08 * floor.width, y: 0.09 * floor.height } // Male: below the stall, in the wing
          : { x: 0.12 * floor.width, y: 0.09 * floor.height }, // Female: above the stall, in the wing
      )
      return
    }
    teleport(
      zone.id === "C"
        ? { x: 0.4 * floor.width, y: 0.5 * floor.height }
        : exitSpot(layout, zone, localPos, half),
    )
  }

  // Click a specific chair: walk over and sit; if it's the chair you're already on, stand.
  const onSit = (zone: Zone, seat: Position) => {
    if (Math.hypot(localPos.x - seat.x, localPos.y - seat.y) < half) {
      walkTo(standSpot(layout, zone, localPos, half))
      return
    }
    if (!isSeatTaken(seat, Object.values(positions), half)) walkTo(seat)
  }

  // Stand up from the current table (HUD button).
  const standUp = () => {
    const z = layout.zones.find((x) => x.id === seatedTable)
    if (z) walkTo(standSpot(layout, z, localPos, half))
  }

  // Single contextual action for where the avatar is standing, surfaced as the mobile
  // bottom-center button. Priority: seated > inside a room > near a free chair > near a room.
  // Reuses the same handlers as the click-on-floor path. Computed inline (not memoized):
  // `localPos` changes every animation frame, so a memo would recompute constantly anyway
  // while also having to omit the (non-stable) run handlers from its deps.
  const floorAction: FloorAction | null = (() => {
    if (seatedTable) return { kind: "stand", label: "Stand up", run: standUp }
    if (insideZone) {
      const z = layout.zones.find((x) => x.id === insideZone)
      if (z) return { kind: "leave", label: `Leave ${z.label}`, run: () => onEnter(z) }
    }
    const seat = freeSeatNear(layout, localPos, half, SEAT_PROXIMITY, Object.values(positions))
    if (seat) return { kind: "sit", label: "Sit", run: () => onSit(seat.zone, seat.seat) }
    const room = roomLikeNear(layout, localPos, ROOM_PROXIMITY)
    if (room) return { kind: "join", label: `Join ${room.label}`, run: () => onEnter(room) }
    return null
  })()

  if (!call || callingState !== CallingState.JOINED) {
    return (
      <div className="min-h-svh flex items-center justify-center text-muted-foreground">
        Entering the office…
      </div>
    )
  }

  const remotes = participants.filter((p) => !p.isLocalParticipant)

  // The one sharer whose screen audio we're entitled to hear: the screen we have OPEN.
  // Nobody else's screen audio is ever bound to an element, so it can't reach the speakers.
  const watchedSharer = watchingId ? participantsById[watchingId] : undefined

  return (
    <div className="relative h-svh w-full overflow-hidden">
      <OfficeFloor
        localUserId={localUserId}
        localName={localName}
        localPos={localPos}
        localSpeaking={!!localParticipant?.isSpeaking}
        localMuted={!!isMute}
        localDeafened={deafened}
        localSeated={!!seatedTable}
        layout={layout}
        viewWidth={isMobile ? MOBILE_VIEW_WIDTH : undefined}
        positions={positions}
        currentRoom={insideZone}
        speakingIds={speakingIds}
        mutedIds={mutedIds}
        participantsById={participantsById}
        watchersById={watchersById}
        bubbles={chat.bubbles}
        expandedId={cameraExpandedId}
        onEnter={onEnter}
        onSit={onSit}
        onExpand={(userId, track) => setExpandTarget({ userId, track })}
      />

      {/* Off-screen: actually plays remote audio (volume set by proximity hook). Mics for every
          remote, plus the screen audio of the ONE screen we have open. Stream's ParticipantsAudio
          can't express that split — it binds every sharer's screenShareAudioTrack unconditionally,
          so the whole floor heard presentations nobody had opened — and volume is per-participant,
          so it can't separate a sharer's mic from their screen either. The split has to be here,
          in which elements exist at all. */}
      <div className="sr-only" aria-hidden>
        {remotes.map((p) =>
          hasAudio(p) && p.audioStream ? (
            <ParticipantAudio key={p.sessionId} participant={p} trackType="audioTrack" />
          ) : null,
        )}
        {watchedSharer &&
          hasScreenShareAudio(watchedSharer) &&
          watchedSharer.screenShareAudioStream && (
            <ParticipantAudio
              key={`${watchedSharer.sessionId}-screen`}
              participant={watchedSharer}
              trackType="screenShareAudioTrack"
            />
          )}
      </div>

      {/* HUD */}
      <div
        className={[
          isMobile
            ? "absolute left-2 top-2 z-40 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white"
            : "absolute left-4 top-4 rounded-md bg-black/60 px-3 py-2 text-sm text-white",
          hudFadeClass,
        ].join(" ")}
      >
        <div className="font-medium">Virtual Rooftop Energy Office</div>
      </div>

      {/* Roster. On mobile it sits top-left under the title (top-right is the toolbar). */}
      <div
        className={[
          isMobile
            ? "absolute left-2 top-11 z-40 max-h-[45%] w-36 overflow-auto rounded-md bg-black/60 px-2 py-1 text-[10px] text-white"
            : "absolute right-4 top-4 max-h-[60vh] w-48 overflow-auto rounded-md bg-black/60 px-3 py-2 text-white",
          hudFadeClass,
        ].join(" ")}
      >
        <div className="mb-1 text-sm font-medium">In the office ({participants.length})</div>
        <ul className="space-y-0.5">
          {participants.map((p) => {
            const isSelf = p.userId === localUserId
            const name = isSelf
              ? `${localName} (you)`
              : positions[p.userId]?.name || p.name || p.userId
            const muted = isSelf ? !!isMute : mutedIds.has(p.userId)
            const isDeafened = isSelf ? deafened : !!positions[p.userId]?.deafened
            return (
              <li key={p.userId} className="flex items-center gap-1.5 text-xs text-white/85">
                {isDeafened ? (
                  <HeadphoneOff className="size-3 shrink-0 text-red-400" />
                ) : muted ? (
                  <MicOff className="size-3 shrink-0 text-red-400" />
                ) : p.isSpeaking ? (
                  <Volume2 className="size-3 shrink-0 text-green-400" />
                ) : (
                  <span className="inline-block size-3 shrink-0" />
                )}
                <span className="truncate">{name}</span>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Chat overlay. Desktop opens it with Enter; mobile toggles it with the chat FAB. */}
      {chat.open && (
        <ChatBar
          floating={isMobile}
          onSend={chat.send}
          onClose={chat.closeChat}
          currentRoom={currentRoom}
          log={chat.log}
          localUserId={localUserId}
        />
      )}

      {/* Mobile: floating joystick + icon toolbar + chat FAB. Desktop: floating control bar. */}
      {isMobile ? (
        <MobileControls
          move={move}
          isMute={!!isMute}
          onMuteToggle={toggleMic}
          deafened={deafened}
          onDeafenToggle={toggleDeafen}
          cameraOff={!!cameraOff}
          onCameraToggle={() => void camera.toggle()}
          onLeave={onLeave}
          chatOpen={chat.open}
          onChatToggle={chat.open ? chat.closeChat : chat.openChat}
          action={floorAction}
        />
      ) : (
      /* preventDefault on mousedown so a click fires the action but never parks focus on
          the button — otherwise Enter would re-toggle the last-clicked control (or worse,
          re-trigger Leave) instead of opening the chat. Keyboard Tab-focus is unaffected. */
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) e.preventDefault()
        }}
      >
        <Button variant="secondary" onClick={() => setShowInfo(true)}>
          <Info className="size-4" />
          Info
        </Button>
        <Button
          variant={isMute ? "secondary" : "default"}
          onClick={toggleMic}
        >
          {isMute ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          {isMute ? "Unmute" : "Mute"}
        </Button>
        <Button
          variant={deafened ? "secondary" : "default"}
          onClick={toggleDeafen}
        >
          {deafened ? <HeadphoneOff className="size-4" /> : <Headphones className="size-4" />}
          {deafened ? "Undeafen" : "Deafen"}
        </Button>
        <Button
          variant={cameraOff ? "secondary" : "default"}
          onClick={() => void camera.toggle()}
        >
          {cameraOff ? <VideoOff className="size-4" /> : <Video className="size-4" />}
          {cameraOff ? "Start video" : "Stop video"}
        </Button>
        <Button
          variant={sharingScreen ? "default" : "secondary"}
          onClick={() => void toggleScreenShare()}
        >
          {sharingScreen ? <ScreenShareOff className="size-4" /> : <ScreenShare className="size-4" />}
          {sharingScreen ? "Stop sharing" : "Share screen"}
        </Button>
        {seatedTable && (
          <Button variant="secondary" onClick={standUp}>
            <Armchair className="size-4" />
            Stand up
          </Button>
        )}
        <Button variant="destructive" onClick={onLeave}>
          <LogOut className="size-4" />
          Leave
        </Button>
      </div>
      )}

      {expanded && (
        <VideoModal
          participant={expanded.participant}
          name={expanded.name}
          trackType={expanded.track}
          isSelf={expanded.isSelf}
          watchers={watchersById[expanded.participant.userId] ?? 0}
          onClose={() => setExpandTarget(null)}
        />
      )}

      {showInfo && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowInfo(false)}
        >
          <div
            className="relative max-h-[80vh] w-full max-w-md overflow-auto rounded-lg bg-white p-5 text-sm text-neutral-800 shadow-xl dark:bg-neutral-900 dark:text-neutral-100"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="absolute right-3 top-3 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              onClick={() => setShowInfo(false)}
              aria-label="Close"
            >
              <X className="size-5" />
            </button>
            <h2 className="mb-3 text-base font-semibold">How the office works</h2>
            <dl className="space-y-3">
              <div>
                <dt className="font-medium">Moving</dt>
                <dd className="text-neutral-600 dark:text-neutral-400">
                  WASD or arrow keys. Tables and walls are solid — you can't walk through them.
                </dd>
              </div>
              <div>
                <dt className="font-medium">Proximity voice</dt>
                <dd className="text-neutral-600 dark:text-neutral-400">
                  Out in the open you hear people near you at full volume; it fades with
                  distance and goes silent once they're far away.
                </dd>
              </div>
              <div>
                <dt className="font-medium">Rooms are private (A, B, C)</dt>
                <dd className="text-neutral-600 dark:text-neutral-400">
                  Inside a room you only hear <strong>and see</strong> people in that same
                  room. People outside <strong>cannot</strong> hear or see into the room,
                  and you <strong>cannot</strong> hear or see out. Click a room to enter;
                  click it again (or “Leave”) to step out — walls seal it, so entering and
                  leaving teleports you through the doorway.
                </dd>
              </div>
              <div>
                <dt className="font-medium">Tables &amp; seats</dt>
                <dd className="text-neutral-600 dark:text-neutral-400">
                  Click an empty chair to walk over and sit. People at the{" "}
                  <strong>same table</strong> hear each other clearly. Taken chairs are
                  filled in; a full table can't be joined. Click your own chair (or “Stand
                  up”) to leave.
                </dd>
              </div>
              <div>
                <dt className="font-medium">Video</dt>
                <dd className="text-neutral-600 dark:text-neutral-400">
                  Camera is off by default — hit “Start video” to share it in your avatar
                  circle. You only see the video of people who share your space: same room,
                  or both out in the open. Room video stays private to that room.
                </dd>
              </div>
              <div>
                <dt className="font-medium">Screen sharing</dt>
                <dd className="text-neutral-600 dark:text-neutral-400">
                  Hit “Share screen” (desktop) to present a window or your whole screen. A
                  blue monitor badge appears on your avatar; anyone sharing your space can
                  click that avatar to watch the screen full-size. It follows the same privacy
                  as video — a screen shared inside a room stays in that room.
                </dd>
              </div>
              <div>
                <dt className="font-medium">Chat</dt>
                <dd className="text-neutral-600 dark:text-neutral-400">
                  Press <strong>Enter</strong> to start typing, then <strong>Enter</strong> to
                  send (empty <strong>Enter</strong> or <strong>Esc</strong> closes it).
                  Messages float above your avatar as a speech bubble and stay private to your
                  space — same room, or the open floor — just like voice.
                </dd>
              </div>
              <div>
                <dt className="font-medium">Mic &amp; who's here</dt>
                <dd className="text-neutral-600 dark:text-neutral-400">
                  Toggle Mute anytime. A speaking avatar shows a green pulse; a muted one a
                  red mic badge. <strong>Deafen</strong> silences everyone else and mutes you
                  too; unmuting lifts it. The list top-right shows everyone in the office.
                </dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </div>
  )
}
