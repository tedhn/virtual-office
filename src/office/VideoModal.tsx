import { useEffect, useRef, useState } from "react"
import { Eye, Maximize, Minimize, X } from "lucide-react"
import {
  ParticipantView,
  SfuModels,
  type StreamVideoParticipant,
} from "@stream-io/video-react-sdk"

interface VideoModalProps {
  participant: StreamVideoParticipant
  name: string
  /** Which track fills the large view — camera ("videoTrack") by default, or a shared screen. */
  trackType?: "videoTrack" | "screenShareTrack"
  /** This is the local user: mirror their camera (matching the avatar circle). Screens and
   *  remote cameras are never mirrored. */
  isSelf?: boolean
  /** How many people are watching this screen right now (0 hides the pill). */
  watchers?: number
  onClose: () => void
}

/**
 * Full-screen overlay showing a single participant's camera or shared screen uncropped.
 * Opened by clicking an avatar that's sharing video or a screen; closes on backdrop click,
 * the X, or Esc. Visibility is gated by the caller (OfficeRoom) to the same room-context
 * rule as the inline video.
 *
 * The box is sized to the feed's TRUE aspect ratio (measured off the <video> element, since
 * Stream's reported screenShareDimension can be wrong for windows/multi-monitor), so the feed
 * fills it with no letterbox bars — any black beside it is just the modal backdrop, not bars.
 *
 * When the large view is a screen share AND the same participant also has their camera on,
 * their camera rides along as a picture-in-picture thumbnail in the bottom-right corner. The
 * caller suspends the avatar circle's camera feed while this is open (one element per track).
 */
export function VideoModal({
  participant,
  name,
  trackType = "videoTrack",
  isSelf,
  watchers = 0,
  onClose,
}: VideoModalProps) {
  // Real fullscreen (screen, not just viewport). We request it on the BACKDROP rather than the
  // sized box: the backdrop becomes the screen, vw/vh then resolve to the screen, and the box
  // keeps its measured-aspect sizing untouched. Requesting it on the box instead would pit our
  // inline width/aspect-ratio against the UA's `:fullscreen` rules.
  const backdropRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  // Unavailable in some embeds (iframe without allowfullscreen) — hide the control, don't offer
  // a button that silently does nothing.
  const canFullscreen = typeof document !== "undefined" && document.fullscreenEnabled

  useEffect(() => {
    // Captured, not read off the ref in cleanup: the element is what we compare against, and
    // reading `.current` at teardown races ref detachment.
    const backdrop = backdropRef.current
    const onChange = () => setIsFullscreen(document.fullscreenElement === backdrop)
    document.addEventListener("fullscreenchange", onChange)
    return () => {
      document.removeEventListener("fullscreenchange", onChange)
      // Closing the modal shouldn't strand the browser in fullscreen with nothing in it — but
      // only exit if WE'RE the fullscreen element; something else's fullscreen isn't ours to end.
      if (backdrop && document.fullscreenElement === backdrop) void document.exitFullscreen()
    }
  }, [])

  const toggleFullscreen = () => {
    const backdrop = backdropRef.current
    if (!backdrop) return
    if (document.fullscreenElement === backdrop) void document.exitFullscreen()
    // Requesting while a different element holds fullscreen moves it to ours, which is what the
    // button should do. Rejects if the gesture isn't user-activated or the embed forbids it;
    // nothing to do but stay windowed.
    else void backdrop.requestFullscreen().catch(() => {})
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // In fullscreen, Esc is the browser's own exit gesture — let it just exit, so one press
      // doesn't both leave fullscreen and close the modal.
      if (e.key === "Escape" && !document.fullscreenElement) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // Camera picture-in-picture: only when the big view is a screen and the sharer's cam is on.
  const showCameraPip =
    trackType === "screenShareTrack" &&
    participant.publishedTracks.includes(SfuModels.TrackType.VIDEO)

  // Measure the feed's real aspect ratio from the rendered <video>. Stream's video element
  // may mount late or be swapped, so we (re)attach via a MutationObserver and read on
  // loadedmetadata/resize. Until it's known we fall back to 16:9 for the first paint.
  const boxRef = useRef<HTMLDivElement>(null)
  const [ratio, setRatio] = useState(16 / 9)
  useEffect(() => {
    // New feed: drop the previous feed's measurement so we fall back to 16:9 rather than
    // painting the new video at the old aspect while it waits for metadata.
    setRatio(16 / 9)
    const box = boxRef.current
    if (!box) return
    let video: HTMLVideoElement | null = null
    const read = () => {
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        setRatio(video.videoWidth / video.videoHeight)
      }
    }
    const attach = () => {
      // The main feed is the first video; the PiP (if any) is a later sibling.
      const v = box.querySelector("video")
      if (v && v !== video) {
        video?.removeEventListener("loadedmetadata", read)
        video?.removeEventListener("resize", read)
        video = v
        v.addEventListener("loadedmetadata", read)
        v.addEventListener("resize", read)
        read()
      }
    }
    attach()
    const mo = new MutationObserver(attach)
    mo.observe(box, { childList: true, subtree: true })
    return () => {
      mo.disconnect()
      video?.removeEventListener("loadedmetadata", read)
      video?.removeEventListener("resize", read)
    }
  }, [participant.sessionId, trackType])

  // Largest box of that aspect fitting the caps: screens get near-fullscreen, a lone camera a
  // modest 80%. Both max dims are enforced so the box never overflows the viewport. In real
  // fullscreen the whole screen is ours, so the inset caps (and the backdrop's padding) would
  // just read as a black frame — go edge to edge instead.
  const maxVw = isFullscreen ? 100 : trackType === "screenShareTrack" ? 97 : 80
  const maxVh = isFullscreen ? 100 : trackType === "screenShareTrack" ? 95 : 80

  return (
    <div
      ref={backdropRef}
      className={`absolute inset-0 z-50 flex items-center justify-center bg-black/80 ${
        isFullscreen ? "" : "p-4"
      }`}
      onClick={onClose}
    >
      <div
        ref={boxRef}
        className={`relative ${isFullscreen ? "max-h-full max-w-full" : "max-h-[95vh] max-w-[97vw]"}`}
        style={
          isFullscreen
            ? // Fullscreen means fullscreen: take the whole screen and let the video cover it.
              // Aspect-locking here can't fill a screen the feed doesn't match — a tab capture is
              // ~2.3:1 (viewport minus browser chrome), which leaves 16:9 displays banded.
              { width: "100vw", height: "100vh" }
            : {
                aspectRatio: String(ratio),
                width: `min(${maxVw}vw, ${(maxVh * ratio).toFixed(3)}vh)`,
              }
        }
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute right-2 top-2 z-10 rounded-full bg-black/60 p-1.5 text-white/80 hover:text-white"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="size-5" />
        </button>
        <div
          className={`vo-video-fit flex h-full w-full items-center justify-center overflow-hidden bg-black [&_video]:h-full [&_video]:w-full ${
            isFullscreen ? "vo-video-cover" : "rounded-xl shadow-2xl"
          }`}
        >
          <ParticipantView
            participant={participant}
            trackType={trackType}
            ParticipantViewUI={null}
            mirror={trackType === "videoTrack" && isSelf}
            // Video only — OfficeRoom's audio rig is the single playback path, and it decides
            // who hears the screen (watchers only). Without this, opening the modal would add a
            // second copy of the mic and screen-share audio.
            muteAudio
            className="h-full w-full"
          />
        </div>
        {/* Fullscreen toggle, bottom-right. Sits below the camera PiP, which shifts up to clear it. */}
        {canFullscreen && (
          <button
            className="absolute bottom-3 right-3 z-10 rounded-full bg-black/60 p-1.5 text-white/80 hover:text-white"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
          </button>
        )}
        {/* Camera PiP: the sharer's face, over the bottom-right of the screen view. */}
        {showCameraPip && (
          <div className="absolute bottom-14 right-3 aspect-video w-1/4 min-w-[120px] max-w-[240px] overflow-hidden rounded-lg border border-white/25 bg-black shadow-lg [&_video]:h-full [&_video]:w-full [&_video]:object-cover">
            <ParticipantView
              participant={participant}
              trackType="videoTrack"
              ParticipantViewUI={null}
              mirror={isSelf}
              muteAudio
              className="h-full w-full"
            />
          </div>
        )}
        <div className="absolute bottom-3 left-3 rounded-md bg-black/60 px-2.5 py-1 text-sm text-white">
          {name}
        </div>
        {/* Watcher count: how many people are viewing this screen right now (incl. you). */}
        {watchers > 0 && (
          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-md bg-black/60 px-2.5 py-1 text-sm text-white">
            <Eye className="size-4" />
            {watchers} watching
          </div>
        )}
      </div>
    </div>
  )
}
