import { Armchair, Eye, HeadphoneOff, MicOff, MonitorUp, Volume2 } from "lucide-react"
import {
  ParticipantView,
  SfuModels,
  type StreamVideoParticipant,
} from "@stream-io/video-react-sdk"
import { AVATAR_SIZE, colorForId, type Position } from "./types"

interface AvatarProps {
  userId: string
  name: string
  pos: Position
  isSelf?: boolean
  speaking?: boolean
  muted?: boolean
  deafened?: boolean
  seated?: boolean
  /** Stream participant, so we can render their video in the circle when the cam is on. */
  participant?: StreamVideoParticipant
  /** Ephemeral chat message to float above the avatar as a speech bubble. */
  bubble?: string
  /** How many people are watching this avatar's shared screen (0 hides the badge). */
  watchers?: number
  /** Click the avatar to open a track in a large dialog. Only wired when the participant is
   *  sharing something; the track passed is the screen (if shared) else the camera. */
  onExpand?: (track: "videoTrack" | "screenShareTrack") => void
  /** This avatar's CAMERA is currently open in the dialog; suspend the inline feed so the
   *  same track isn't bound to two elements (Stream binds a track to one element only). A
   *  screen expansion uses a different track, so it never suspends the circle. */
  isExpanded?: boolean
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? "?"
  const second = parts.length > 1 ? parts[parts.length - 1][0] : ""
  return (first + second).toUpperCase()
}

export function Avatar({
  userId,
  name,
  pos,
  isSelf,
  speaking,
  muted,
  deafened,
  seated,
  participant,
  bubble,
  watchers = 0,
  onExpand,
  isExpanded,
}: AvatarProps) {
  const color = colorForId(userId)
  const hasVideo = !!participant?.publishedTracks.includes(SfuModels.TrackType.VIDEO)
  const sharingScreen = !!participant?.publishedTracks.includes(SfuModels.TrackType.SCREEN_SHARE)
  // Deafen implies mute, so a deafened peer shows the headphone badge instead of the mic one.
  const StatusIcon = deafened ? HeadphoneOff : muted ? MicOff : null
  // Clickable when sharing something (camera or screen); otherwise fully click-through so
  // clicks still reach the floor (rooms/seats) beneath the avatar. A screen-only sharer (cam
  // off) is clickable too — the circle stays initials but opens the screen when clicked.
  const canExpand = (hasVideo || sharingScreen) && !!onExpand
  // A click opens the screen if one is shared (that's the point of sharing), else the camera.
  const expandTrack = sharingScreen ? "screenShareTrack" : "videoTrack"
  // Suspend the inline camera feed while it's expanded in the dialog (single-element binding);
  // the circle falls back to initials and re-binds when the dialog closes and this remounts.
  // Only the camera lives in the circle, so only a camera expansion (isExpanded) suspends it.
  const showVideo = hasVideo && !!participant && !isExpanded
  return (
    <div
      className="absolute flex flex-col items-center pointer-events-none select-none"
      style={{
        left: 0,
        top: 0,
        // Anchor by the circle's centre (translateX(-50%)) so a long name label — which
        // widens this column — never shifts the avatar off its position.
        transform: `translate(${pos.x}px, ${pos.y - AVATAR_SIZE / 2}px) translateX(-50%)`,
        transition: isSelf ? "none" : "transform 80ms linear",
        zIndex: isSelf ? 20 : 10,
      }}
    >
      <div className="relative" style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}>
        {/* Chat speech bubble, floated above the circle without shifting the avatar. */}
        {bubble && (
          <div className="absolute bottom-full left-1/2 mb-1.5 w-max max-w-[180px] -translate-x-1/2 rounded-2xl border bg-popover px-2.5 py-1 text-center text-[11px] leading-snug break-words whitespace-pre-wrap text-popover-foreground shadow-md">
            {bubble}
            <span className="absolute top-full left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-r border-b bg-popover" />
          </div>
        )}
        {/* Talking indicator: expanding pulse ring while speaking. */}
        {speaking && (
          <span className="absolute inset-0 rounded-full border-2 border-green-400 animate-ping" />
        )}
        <div
          className={[
            "rounded-full flex h-full w-full items-center justify-center overflow-hidden font-semibold text-white shadow-md [&_video]:h-full [&_video]:w-full [&_video]:object-cover",
            canExpand ? "pointer-events-auto cursor-pointer" : "",
          ].join(" ")}
          onClick={canExpand ? () => onExpand?.(expandTrack) : undefined}
          style={{
            background: showVideo ? "#000" : color,
            outline: isSelf ? "3px solid white" : "none",
            boxShadow: speaking
              ? "0 0 0 3px #4ade80, 0 2px 6px rgba(0,0,0,.35)"
              : "0 2px 6px rgba(0,0,0,.3)",
            fontSize: AVATAR_SIZE * 0.36,
          }}
        >
          {hasVideo && participant ? (
            <ParticipantView
              participant={participant}
              trackType="videoTrack"
              ParticipantViewUI={null}
              mirror={isSelf}
              // Video only. ParticipantView otherwise mounts its own mic + screen-share audio
              // elements, which would play the same tracks a second time alongside OfficeRoom's
              // single audio rig — doubled volume and echo, worse per extra view — and would
              // leak screen audio to people who never opened the screen.
              muteAudio
              className="h-full w-full"
            />
          ) : (
            initials(name)
          )}
        </div>
        {/* Status badge. Deafen implies mute, so it takes over the badge slot when set. */}
        {StatusIcon && (
          <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-red-600 text-white ring-2 ring-white dark:ring-neutral-900">
            <StatusIcon className="size-2.5" />
          </span>
        )}
        {/* Screen-share badge (bottom-left, opposite the mic badge): this avatar is sharing a
            screen — click to open it. Only set when the screen is visible to you (same room). */}
        {sharingScreen && (
          <span className="absolute -bottom-0.5 -left-0.5 flex size-4 items-center justify-center rounded-full bg-blue-600 text-white ring-2 ring-white dark:ring-neutral-900">
            <MonitorUp className="size-2.5" />
          </span>
        )}
        {/* Watcher count (top-right): how many people are currently viewing this screen. */}
        {watchers > 0 && (
          <span className="absolute -top-1 -right-1 flex items-center gap-0.5 rounded-full bg-black/75 px-1 py-px text-[9px] font-semibold leading-none text-white ring-2 ring-white dark:ring-neutral-900">
            <Eye className="size-2.5" />
            {watchers}
          </span>
        )}
      </div>
      <span
        className={[
          "mt-1 flex max-w-[160px] items-center gap-1 rounded px-1.5 py-0.5 text-[11px] leading-none text-white",
          speaking ? "bg-green-600/80" : "bg-black/60",
        ].join(" ")}
      >
        {speaking && <Volume2 className="size-3 shrink-0" />}
        {!speaking && seated && <Armchair className="size-3 shrink-0 opacity-80" />}
        <span className="truncate">
          {name}
          {isSelf && " (you)"}
        </span>
      </span>
    </div>
  )
}
