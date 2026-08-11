import { useEffect, useRef } from "react"
import { useCallStateHooks } from "@stream-io/video-react-sdk"
import { roomAt, seatedTableAt } from "./layout"
import type { PeerState } from "./useRealtime"
import { AVATAR_SIZE, distance, proximityVolume, type Position, type Size } from "./types"

const EPSILON = 0.02
const HALF = AVATAR_SIZE / 2

/**
 * Sets each remote participant's playback volume.
 *
 * Rooms A/B/C are private zones: while you're inside a room you hear everyone in
 * the SAME room at full volume and no one else; while you're in the open you hear
 * open-floor peers by proximity (full within INNER_RADIUS, silent past OUTER_RADIUS)
 * and can't hear anyone shut inside a room. Only re-applies a volume when it changes.
 *
 * Watching a screen opens a two-way channel, both directions exempt from the distance falloff:
 * you hear the person whose screen you have open (`watchingId`), and you hear anyone whose
 * broadcast `watching` flag points at YOU — so a presenter can take questions from the whole
 * audience, not just whoever happens to stand next to them. Their screen is visible from
 * anywhere in your room-context (video is gated by room, never by distance), so fading the
 * audio out at OUTER_RADIUS left you watching a silent presentation.
 *
 * Volume here is per-participant, covering their mic and their shared screen's audio alike —
 * which is why the exemption is keyed on WATCHING and not on sharing: a sharer exempted by
 * the mere act of sharing is heard by the whole floor, including everyone who never opened
 * the screen. Screen audio reaches only watchers because OfficeRoom mounts the
 * screenShareAudioTrack element for the watched sharer alone.
 * Room isolation still applies, in both directions: a sharer sealed in a room stays inaudible
 * from outside, and the watch exemptions only fire inside your own room-context.
 *
 * When `deafened` is set, every remote is forced silent regardless of proximity/room;
 * clearing it re-applies the proximity volumes (the effect re-runs on the toggle).
 */
export function useProximityAudio(
  localPos: Position,
  positions: Record<string, PeerState>,
  floor: Size,
  deafened: boolean,
  /** User id of the screen we currently have open, or null. */
  watchingId: string | null,
  /** Our own id, to spot peers whose `watching` flag points back at us. */
  localUserId: string,
): void {
  const { useParticipants, useSpeakerState } = useCallStateHooks()
  const participants = useParticipants()
  const { speaker } = useSpeakerState()

  const applied = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    const liveSessionIds = new Set<string>()
    const localRoom = roomAt(localPos, floor)

    for (const p of participants) {
      if (p.isLocalParticipant) continue
      liveSessionIds.add(p.sessionId)

      const remotePos = positions[p.userId]
      // Unknown position (relay slow/down): fail open ONLY on the open floor so a relay
      // problem doesn't mute everyone. Inside a room, unknown peers stay silent so room
      // isolation never leaks while positions are catching up.
      let vol = localRoom ? 0 : 1
      if (deafened) {
        // Deafened: silence everyone, skip all proximity/room math.
        vol = 0
      } else if (p.userId === watchingId) {
        // Watching their screen: full volume wherever they are on the floor. The modal is
        // already gated to your room-context, so this can't cross a room boundary.
        vol = 1
      } else if (remotePos) {
        const remoteRoom = roomAt(remotePos, floor)
        if (remoteRoom !== localRoom) {
          // Different room-context: rooms seal both ways — inside one you hear only that room,
          // outside you can't hear anyone shut in one.
          vol = 0
        } else if (remotePos.watching === localUserId) {
          // They have OUR screen open: full volume back, so questions from the far side of the
          // floor reach the presenter. Same-context already checked, so this can't leak a room.
          vol = 1
        } else if (localRoom) {
          // Same room: everyone in it at full volume.
          vol = 1
        } else {
          // Both in the open: tablemates (same table) hear each other full; else distance falloff.
          const lt = seatedTableAt(localPos, floor, HALF)
          const rt = seatedTableAt(remotePos, floor, HALF)
          vol = lt && lt === rt ? 1 : proximityVolume(distance(localPos, remotePos))
        }
      }

      const prev = applied.current.get(p.sessionId)
      if (prev === undefined || Math.abs(prev - vol) >= EPSILON) {
        speaker.setParticipantVolume(p.sessionId, vol)
        applied.current.set(p.sessionId, vol)
      }
    }

    // Forget participants who left so their session ids don't linger.
    for (const sid of applied.current.keys()) {
      if (!liveSessionIds.has(sid)) applied.current.delete(sid)
    }
  }, [participants, positions, localPos, floor, speaker, deafened, watchingId, localUserId])
}
