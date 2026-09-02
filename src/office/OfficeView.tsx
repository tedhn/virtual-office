import { NotFound } from "@/NotFound"
import { FloorPreview } from "./FloorPreview"
import { usePublishedOffice } from "./usePublishedOffice"

interface OfficeViewProps {
  /** The Office's permanent address, taken from the URL. */
  slug: string
}

/**
 * An Office at its own URL: the Floor exactly as its Owner published it.
 *
 * Nobody is on it yet. Presence — walking in, proximity audio, Room-isolated chat — is
 * the next piece of work; the parts that did it for the one hardcoded office are still
 * here in `OfficeRoom.tsx` and `useRealtime.ts`, waiting to be pointed at an Office
 * rather than at a constant.
 */
export function OfficeView({ slug }: OfficeViewProps) {
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

  const { office } = lookup
  return (
    <div className="flex h-svh flex-col">
      <header className="flex items-baseline justify-between gap-4 border-b px-6 py-3">
        <h1 className="truncate text-lg font-semibold tracking-tight">{office.name}</h1>
        <p className="text-muted-foreground shrink-0 text-sm">/{office.slug}</p>
      </header>
      <main className="min-h-0 flex-1 p-4">
        <FloorPreview layout={office.published_layout} />
      </main>
    </div>
  )
}
