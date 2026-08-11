import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  LogOut,
  MessageCircle,
  LogIn,
  Armchair,
  Headphones,
  HeadphoneOff,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { FloatingJoystick } from "./FloatingJoystick"

/** A single contextual floor action surfaced by proximity (see OfficeRoom). */
export interface FloorAction {
  kind: "join" | "leave" | "sit" | "stand"
  label: string
  run: () => void
}

interface MobileControlsProps {
  move: (dx: number, dy: number) => void
  isMute: boolean
  onMuteToggle: () => void
  deafened: boolean
  onDeafenToggle: () => void
  cameraOff: boolean
  onCameraToggle: () => void
  onLeave: () => void
  chatOpen: boolean
  onChatToggle: () => void
  /** Contextual join/leave/sit/stand action for where the avatar is, or null. */
  action: FloorAction | null
}

const ACTION_ICON = {
  join: LogIn,
  leave: LogOut,
  sit: Armchair,
  stand: Armchair,
} as const

/**
 * Floating mobile HUD over the full-screen office: a vertical toolbar of round icon-only
 * buttons (mute / video / leave) top-right, a chat FAB bottom-right, and the floating joystick
 * covering the bottom half. Buttons sit at z-40, above the joystick zone (z-30), so a touch on
 * a button never spawns the stick.
 */
export function MobileControls({
  move,
  isMute,
  onMuteToggle,
  deafened,
  onDeafenToggle,
  cameraOff,
  onCameraToggle,
  onLeave,
  chatOpen,
  onChatToggle,
  action,
}: MobileControlsProps) {
  const ActionIcon = action ? ACTION_ICON[action.kind] : null
  return (
    <>
      <FloatingJoystick onMove={move} />

      {/* Contextual proximity action, bottom-center. Above the joystick zone (z-30) so a press
          never spawns the stick; hidden while the chat bar occupies the bottom. */}
      {action && ActionIcon && !chatOpen && (
        <Button
          className="absolute bottom-16 left-1/2 z-40 -translate-x-1/2 touch-none rounded-full shadow-lg"
          onClick={action.run}
        >
          <ActionIcon className="size-5" />
          {action.label}
        </Button>
      )}

      {/* Toolbar: round, icon-only, vertically stacked. */}
      <div className="absolute right-3 top-3 z-40 flex flex-col gap-2">
        <Button
          variant={isMute ? "secondary" : "default"}
          size="icon-lg"
          className="touch-none rounded-full shadow-lg"
          aria-label={isMute ? "Unmute" : "Mute"}
          onClick={onMuteToggle}
        >
          {isMute ? <MicOff className="size-5" /> : <Mic className="size-5" />}
        </Button>
        <Button
          variant={deafened ? "secondary" : "default"}
          size="icon-lg"
          className="touch-none rounded-full shadow-lg"
          aria-label={deafened ? "Undeafen" : "Deafen"}
          onClick={onDeafenToggle}
        >
          {deafened ? <HeadphoneOff className="size-5" /> : <Headphones className="size-5" />}
        </Button>
        <Button
          variant={cameraOff ? "secondary" : "default"}
          size="icon-lg"
          className="touch-none rounded-full shadow-lg"
          aria-label={cameraOff ? "Start video" : "Stop video"}
          onClick={onCameraToggle}
        >
          {cameraOff ? <VideoOff className="size-5" /> : <Video className="size-5" />}
        </Button>
        <Button
          variant="destructive"
          size="icon-lg"
          className="touch-none rounded-full shadow-lg"
          aria-label="Leave"
          onClick={onLeave}
        >
          <LogOut className="size-5" />
        </Button>
      </div>

      {/* Chat FAB, bottom-right. Hidden while the chat panel is open (it takes that corner). */}
      {!chatOpen && (
        <Button
          variant="secondary"
          size="icon-lg"
          className="absolute bottom-3 right-3 z-40 touch-none rounded-full shadow-lg"
          aria-label="Open chat"
          onClick={onChatToggle}
        >
          <MessageCircle className="size-5" />
        </Button>
      )}
    </>
  )
}
