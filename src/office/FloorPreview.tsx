import { FloorCanvas } from "./FloorCanvas"
import { FloorLayout } from "./FloorLayout"
import type { Layout } from "./layout"

interface FloorPreviewProps {
  /** The Office being drawn: floor dimensions plus every Zone on it. */
  layout: Layout
}

/**
 * An Office's Floor, whole, with nobody on it.
 *
 * The fitting and the chrome are `FloorCanvas`'s; all this adds is the Zones, drawn with
 * no callbacks — you are looking at the Office rather than standing in it, so there is no
 * Room to enter and no chair to take.
 */
export function FloorPreview({ layout }: FloorPreviewProps) {
  return (
    <FloorCanvas floor={layout.floor}>
      {() => <FloorLayout layout={layout} insideRoom={null} occupied={[]} />}
    </FloorCanvas>
  )
}
