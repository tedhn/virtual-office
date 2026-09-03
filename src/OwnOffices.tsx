import { useState } from "react"
import { Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { deleteOffice, renameOffice, type OfficeSummary } from "@/lib/offices"
import { listOwnOffices, supabaseOfficeRows } from "@/lib/officeRows"
import { people } from "@/lib/people"
import { announceDeleted, visitorsInside } from "@/lib/publishing"
import { officePath } from "@/lib/routes"
import { supabase } from "@/lib/supabase"
import { useSupabaseLookup } from "@/lib/useSupabaseLookup"
import { navigate } from "@/lib/useRoute"

/**
 * The Offices an account owns, and the two things an Owner can do to one from outside it.
 *
 * Renaming and deleting live here rather than in the editor because they are not authoring:
 * the editor is about what is on a Floor, and these are about the Office itself. They are
 * also the two operations you want when you are looking at a list of them and one of them
 * is a mistake.
 *
 * Nothing here is a permission check. The list is what the database hands this account, and
 * a rename or a delete of somebody else's Office is refused by it: every policy on the table
 * names the Owner, so there is no row for anybody else to change and the write comes back
 * with nothing to show (ADR-0005).
 */
export function OwnOffices({ ownerId }: { ownerId: string }) {
  const lookup = useSupabaseLookup<OfficeSummary[]>(
    (client) => listOwnOffices(client, ownerId),
    ownerId,
  )

  if (lookup.status === "error") {
    return (
      <p className="text-destructive max-w-sm text-center text-sm">
        Your offices could not be listed: {lookup.message}
      </p>
    )
  }

  // Nothing to say while the list is on its way, and nothing to say to somebody who owns no
  // Offices — the card would be an empty box under a form that explains itself. Owning none
  // arrives as an empty list rather than as `missing`, which is why that answer is not
  // singled out: it cannot happen here, and it would mean this same nothing if it did.
  if (lookup.status !== "found" || lookup.value.length === 0) return null

  // Keyed on the account, so signing in as somebody else starts the list again rather than
  // editing the one that was loaded for the last person.
  return <OfficeList key={ownerId} initial={lookup.value} />
}

/**
 * The list proper, once there is one to show.
 *
 * Its own component so the loaded Offices can seed React state directly — the same reason
 * the editor's draft does. After that the list is kept here rather than refetched: a rename
 * and a delete each change exactly one row, and this screen already knows which.
 */
function OfficeList({ initial }: { initial: OfficeSummary[] }) {
  const [offices, setOffices] = useState<OfficeSummary[]>(initial)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const renamed = (office: OfficeSummary, name: string) => {
    setOffices((current) => current.map((o) => (o.id === office.id ? { ...o, name } : o)))
  }

  const removed = (office: OfficeSummary) => {
    setOffices((current) => current.filter((o) => o.id !== office.id))
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Your offices</CardTitle>
        <CardDescription>
          Each one keeps the address it was created with, whatever you rename it to.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {offices.map((office) => (
          <OfficeRow
            key={office.id}
            office={office}
            onRenamed={(name) => renamed(office, name)}
            onDeleted={() => removed(office)}
            onError={setError}
            onNotice={setNotice}
          />
        ))}
        {error && <p className="text-destructive text-sm">{error}</p>}
        {notice && <p className="text-muted-foreground text-sm">{notice}</p>}
      </CardContent>
    </Card>
  )
}

/**
 * One Office: where it is, what it is called, and the two ways to change that.
 *
 * The address is shown next to the name because it is the thing that does not change. An
 * Owner renaming an Office is entitled to wonder whether the link they sent everybody still
 * works, and the answer is on the same line as the rename.
 */
function OfficeRow({
  office,
  onRenamed,
  onDeleted,
  onError,
  onNotice,
}: {
  office: OfficeSummary
  onRenamed: (name: string) => void
  onDeleted: () => void
  onError: (message: string | null) => void
  onNotice: (message: string | null) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(office.name)
  const [busy, setBusy] = useState(false)

  const wanted = name.trim()

  const rename = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || !wanted) return
    if (wanted === office.name) return setRenaming(false)
    setBusy(true)
    onError(null)
    onNotice(null)
    try {
      const stored = await renameOffice(supabaseOfficeRows(supabase()), office.id, wanted)
      onRenamed(stored.name)
      setRenaming(false)
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not rename this office")
    } finally {
      setBusy(false)
    }
  }

  /**
   * Delete, having asked first — because an Office's address is spent for good and the
   * people inside are put out of it.
   *
   * Telling the server is the last step and the only one allowed to fail quietly: the
   * Office is gone the moment the row is marked, and what the announcement decides is
   * whether the people inside are told now or when their connection next tries to
   * re-establish (see `lib/publishing.ts`).
   */
  const remove = async () => {
    if (busy) return
    onError(null)
    onNotice(null)
    // Busy from before the question is asked, so a second click cannot open a second
    // confirm and delete the Office twice.
    setBusy(true)
    try {
      if (!window.confirm(await deleteQuestion(office))) return
      await deleteOffice(supabaseOfficeRows(supabase()), office.id)
      try {
        const turnedOut = await announceDeleted(office.slug)
        onNotice(
          turnedOut === 0
            ? `"${office.name}" is gone, and /${office.slug} leads nowhere now.`
            : `"${office.name}" is gone, and the ${people(turnedOut)} inside were told why.`,
        )
      } catch (err) {
        console.error(err)
        onNotice(
          `"${office.name}" is gone — but the office server could not be told, so anyone ` +
            "inside stays there until they next speak or their connection drops.",
        )
      }
      // Last, so a failed delete leaves the Office on screen where the Owner can try again.
      onDeleted()
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not delete this office")
    } finally {
      setBusy(false)
    }
  }

  if (renaming) {
    return (
      <form onSubmit={rename} className="flex items-center gap-2">
        <Input
          value={name}
          autoFocus
          aria-label={`Rename ${office.name}`}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        <Button type="submit" size="sm" disabled={busy || !wanted}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setName(office.name)
            setRenaming(false)
          }}
        >
          Cancel
        </Button>
      </form>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {/* The whole line is the way in, and the way in is the Office itself — the editor is
          offered inside it, to whoever turns out to own it, and not from a list. */}
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => navigate(officePath(office.slug))}
      >
        <span className="block truncate text-sm font-medium">{office.name}</span>
        <span className="text-muted-foreground block truncate text-xs">
          /{office.slug}
        </span>
      </button>
      <Button
        size="icon"
        variant="ghost"
        aria-label={`Rename ${office.name}`}
        disabled={busy}
        onClick={() => setRenaming(true)}
      >
        <Pencil />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label={`Delete ${office.name}`}
        disabled={busy}
        onClick={() => void remove()}
      >
        <Trash2 />
      </Button>
    </div>
  )
}

/**
 * What to ask before deleting an Office.
 *
 * Always asked, unlike the publish question: publishing onto an empty Floor disrupts
 * nobody, while deleting spends an address for good whether or not anyone is standing in
 * the Office at the time. The people inside are the part that is worth finding out, and
 * not being able to find out is worth saying rather than glossing over.
 */
async function deleteQuestion(office: OfficeSummary): Promise<string> {
  const permanence =
    `Delete "${office.name}"?\n\n` +
    `Its address /${office.slug} is spent for good — no office, yours or anyone else's, ` +
    "can be reached there again, so every link you have shared stops working."
  const inside = await visitorsInside(office.slug)
  if (inside === null) {
    return `${permanence}\n\nWe couldn't check whether anyone is in there right now.`
  }
  if (inside === 0) return permanence
  return `${permanence}\n\nThe ${people(inside)} in there now will be disconnected.`
}
