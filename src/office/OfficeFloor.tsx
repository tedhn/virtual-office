import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Avatar } from "./Avatar"
import { FloorLayout } from "./FloorLayout"
import type { StreamVideoParticipant } from "@stream-io/video-react-sdk"
import { roomAt, seatedTableAt, type Zone } from "./layout"
import type { PeerState } from "./useRealtime"
import { AVATAR_SIZE, INNER_RADIUS, OUTER_RADIUS, type Position, type Size } from "./types"

interface OfficeFloorProps {
  localUserId: string
  localName: string
  localPos: Position
  localSpeaking: boolean
  localMuted: boolean
  localDeafened: boolean
  localSeated: boolean
  /** Fixed office floor size in px (same for every client). */
  floor: Size
  /** World-px width to fit across the viewport (zoom). Defaults to floor.width (width-fit). */
  viewWidth?: number
  /** Interpolated peer positions (from the relay), keyed by user id. */
  positions: Record<string, PeerState>
  /** Room id the local avatar is currently inside, or null. */
  currentRoom: string | null
  /** User ids of remote participants currently speaking. */
  speakingIds: Set<string>
  /** User ids of remote participants currently muted. */
  mutedIds: Set<string>
  /** Stream participants keyed by user id, for rendering their video. */
  participantsById: Record<string, StreamVideoParticipant>
  /** How many people are watching each user's shared screen, keyed by user id. */
  watchersById: Record<string, number>
  /** Latest ephemeral chat message per user id, shown as a speech bubble. */
  bubbles: Record<string, string>
  /** User id whose CAMERA is expanded into the dialog (its inline circle feed is suspended).
   *  Null when nothing — or only a screen — is expanded, since a screen uses another track. */
  expandedId: string | null
  /** Join/leave a clicked room. */
  onEnter: (zone: Zone) => void
  /** Sit at (or stand from) a clicked chair. */
  onSit: (zone: Zone, seat: Position) => void
  /** Open a participant's camera or shared screen in a large dialog (clicked their avatar). */
  onExpand: (userId: string, track: "videoTrack" | "screenShareTrack") => void
}

export function OfficeFloor({
  localUserId,
  localName,
  localPos,
  localSpeaking,
  localMuted,
  localDeafened,
  localSeated,
  floor,
  viewWidth,
  positions,
  currentRoom,
  speakingIds,
  mutedIds,
  participantsById,
  watchersById,
  bubbles,
  expandedId,
  onEnter,
  onSit,
  onExpand,
}: OfficeFloorProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  // Scale the office so `viewWidth` world-px fit across the viewport (defaults to the full
  // floor width = width-fit; a smaller value zooms in). Logic (positions, rooms, collision,
  // audio) stays in the fixed floor coordinate space; only the rendering is scaled. The
  // overflow in both axes is followed by the camera below.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const target = viewWidth ?? floor.width
    const measure = () => setScale(el.clientWidth / target)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [floor.width, viewWidth])

  // Keep the local avatar centered as it moves. With width-fit (desktop) only the vertical
  // overflow scrolls; when zoomed in (mobile viewWidth) both axes overflow and both follow.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({
      left: localPos.x * scale - el.clientWidth / 2,
      top: localPos.y * scale - el.clientHeight / 2,
      behavior: "auto",
    })
  }, [localPos, scale])

  // Video follows the same isolation as audio: you only see a peer's camera if you share
  // their room-context (same room, or both out in the open). People outside a private
  // room can't see the video of people inside it, and vice-versa.
  const localRoom = roomAt(localPos, floor)

  return (
    <div
      ref={scrollRef}
      className="relative h-full w-full overflow-hidden bg-neutral-200 dark:bg-neutral-900"
    >
      {/* Sizer takes the scaled footprint so scrolling/camera math is correct. */}
      <div style={{ width: floor.width * scale, height: floor.height * scale }}>
        <div
          className="relative overflow-hidden rounded-xl border-2 border-black/40 dark:border-white/25"
          style={{
            width: floor.width,
            height: floor.height,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            backgroundImage:
              "linear-gradient(to right, rgba(0,0,0,.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,.06) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        >
          <FloorLayout
            floor={floor}
            currentRoom={currentRoom}
            occupied={Object.values(positions)}
            onEnter={onEnter}
            onSit={onSit}
          />

          {/* Hearing range around self: outer = fade-to-silence edge, inner = full-volume zone */}
          <div
            className="absolute rounded-full border border-dashed border-black/15 pointer-events-none"
            style={{
              width: OUTER_RADIUS * 2,
              height: OUTER_RADIUS * 2,
              transform: `translate(${localPos.x - OUTER_RADIUS}px, ${localPos.y - OUTER_RADIUS}px)`,
            }}
          />
          <div
            className="absolute rounded-full border border-dashed border-black/25 bg-black/5 pointer-events-none"
            style={{
              width: INNER_RADIUS * 2,
              height: INNER_RADIUS * 2,
              transform: `translate(${localPos.x - INNER_RADIUS}px, ${localPos.y - INNER_RADIUS}px)`,
            }}
          />

          {Object.entries(positions).map(([userId, peer]) => {
            if (userId === localUserId) return null
            return (
              <Avatar
                key={userId}
                userId={userId}
                name={peer.name || userId}
                pos={peer}
                speaking={speakingIds.has(userId)}
                muted={mutedIds.has(userId)}
                deafened={peer.deafened}
                seated={!!seatedTableAt(peer, floor, AVATAR_SIZE / 2)}
                participant={
                  roomAt(peer, floor) === localRoom ? participantsById[userId] : undefined
                }
                // Bubble only shows for peers sharing your room-context, like their video.
                bubble={roomAt(peer, floor) === localRoom ? bubbles[userId] : undefined}
                watchers={watchersById[userId] ?? 0}
                isExpanded={expandedId === userId}
                onExpand={(track) => onExpand(userId, track)}
              />
            )
          })}

          <Avatar
            userId={localUserId}
            name={localName}
            pos={localPos}
            isSelf
            speaking={localSpeaking}
            muted={localMuted}
            deafened={localDeafened}
            seated={localSeated}
            participant={participantsById[localUserId]}
            bubble={bubbles[localUserId]}
            watchers={watchersById[localUserId] ?? 0}
            isExpanded={expandedId === localUserId}
            onExpand={(track) => onExpand(localUserId, track)}
          />
        </div>
      </div>
    </div>
  )
}
