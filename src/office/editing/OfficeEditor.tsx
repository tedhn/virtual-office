import { useCallback, useEffect, useState } from "react"
import { Trash2 } from "lucide-react"
import { NotFound } from "@/NotFound"
import type { AuthGateway } from "@/auth/useAuthSession"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { saveDraft, type Office } from "@/lib/offices"
import { supabaseOfficeRows } from "@/lib/officeRows"
import { officePath } from "@/lib/routes"
import { supabase } from "@/lib/supabase"
import { navigate } from "@/lib/useRoute"
import { DEFAULT_SEATS, type Layout, type Zone, type ZoneKind } from "../layout"
import { validatePublishableLayout } from "../layoutSchema"
import { EditorFloor } from "./EditorFloor"
import { addZone, newZoneId, removeZone, updateZone, type ZonePatch } from "./layoutEdits"
import { useDraftOffice } from "./useDraftOffice"

interface OfficeEditorProps {
  slug: string
  auth: AuthGateway
}

/** The palette, in the order an Owner tends to reach for them. */
const PALETTE: { kind: ZoneKind; label: string; hint: string }[] = [
  { kind: "room", label: "Room", hint: "Enclosed. Make it private to seal its audio, video and chat." },
  { kind: "table", label: "Table", hint: "Solid furniture, with chairs around it." },
  { kind: "wall", label: "Wall", hint: "A solid bar. Divides space, carries no privacy." },
  { kind: "spawn", label: "Spawn", hint: "Where arrivals appear. An Office needs exactly one." },
  { kind: "exterior", label: "Exterior", hint: "Outside the footprint. Visual only." },
]

/**
 * Authoring an Office's draft Layout.
 *
 * Its own address (`/<slug>/edit`) rather than a mode inside the Office, because it is its
 * own place: an Owner here is not present in their Office, has no avatar and no call, and
 * nothing they do is visible to anyone standing in it. Publishing — the moment a draft
 * becomes what Visitors walk into — is not here either; this screen only ever writes the
 * draft column.
 */
export function OfficeEditor({ slug, auth }: OfficeEditorProps) {
  const lookup = useDraftOffice(slug, auth.session?.user.id ?? null)

  if (lookup.status === "loading") {
    return (
      <div className="min-h-svh flex items-center justify-center p-6">
        <p className="text-muted-foreground text-sm">Opening the editor…</p>
      </div>
    )
  }

  // Somebody else's Office and no Office at all are the same answer, and are told apart by
  // nobody. See `useDraftOffice`.
  if (lookup.status === "missing") return <NotFound />

  if (lookup.status === "error") {
    return (
      <div className="min-h-svh flex flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight">This editor would not open</h1>
        <p className="text-destructive max-w-sm text-sm">{lookup.message}</p>
      </div>
    )
  }

  return (
    <DraftEditor
      key={lookup.value.office.id}
      office={lookup.value.office}
      draft={lookup.value.draft}
    />
  )
}

/**
 * The editor proper, once there is a draft to edit.
 *
 * Its own component so the draft can seed React state directly, rather than an effect
 * copying a loaded value into state and having to say what happens if it loads twice.
 */
function DraftEditor({ office, draft }: { office: Office; draft: Layout }) {
  const [layout, setLayout] = useState<Layout>(draft)
  // What is actually stored. Comparing against it is how "unsaved" is known, and it is a
  // reference comparison because every edit returns a new Layout.
  const [saved, setSaved] = useState<Layout>(draft)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const unsaved = layout !== saved
  const selected = layout.zones.find((z) => z.id === selectedId) ?? null
  // A draft is allowed to be an Office nobody could use, so this is said rather than
  // enforced: what publishing would refuse today, with the save button working regardless.
  const publishable = validatePublishableLayout(layout)

  const drop = (kind: ZoneKind) => {
    const id = newZoneId(layout, kind)
    setLayout(addZone(layout, kind, id))
    setSelectedId(id)
  }

  const removeSelected = useCallback(() => {
    if (!selectedId) return
    setLayout((current) => removeZone(current, selectedId))
    setSelectedId(null)
  }, [selectedId])

  // Delete removes the selected Zone; Escape deselects. Not Backspace, deliberately: it is
  // the key people hit expecting to go back, and there is no undo to take it back with.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing =
        !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
      if (typing) return
      if (e.key === "Delete") {
        e.preventDefault()
        removeSelected()
      }
      if (e.key === "Escape") setSelectedId(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [removeSelected])

  // Unsaved work has two ways out of this screen and both are guarded: closing the tab,
  // which the browser asks about, and walking back into the Office, which it does not.
  useEffect(() => {
    if (!unsaved) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [unsaved])

  const leave = () => {
    if (unsaved && !window.confirm("Leave the editor? Changes you haven't saved will be lost.")) {
      return
    }
    navigate(officePath(office.slug))
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    const attempt = layout
    try {
      await saveDraft(supabaseOfficeRows(supabase()), office.id, attempt)
      setSaved(attempt)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the draft")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-svh flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">{office.name}</h1>
          <p className="text-muted-foreground text-xs">
            Editing the draft — nobody else sees this until you publish.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {unsaved ? "Unsaved changes" : "Saved"}
          </span>
          <Button variant="secondary" onClick={leave}>
            Back to the office
          </Button>
          <Button onClick={() => void save()} disabled={saving || !unsaved}>
            {saving ? "Saving…" : "Save draft"}
          </Button>
        </div>
      </header>

      {error && (
        <p className="text-destructive border-b px-4 py-2 text-sm">{error}</p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 md:grid-cols-[13rem_1fr_15rem]">
        <section className="flex flex-col gap-2 overflow-auto">
          <h2 className="text-sm font-medium">Add a zone</h2>
          {PALETTE.map(({ kind, label, hint }) => (
            <button
              key={kind}
              onClick={() => drop(kind)}
              className="hover:bg-accent rounded-md border px-3 py-2 text-left"
            >
              <span className="text-sm font-medium">{label}</span>
              <span className="text-muted-foreground block text-xs">{hint}</span>
            </button>
          ))}
          {!publishable.ok && (
            <p className="text-muted-foreground mt-2 text-xs">
              Not ready to publish yet: {publishable.errors.join("; ")}. A draft is allowed to
              be, and this still saves.
            </p>
          )}
        </section>

        <section className="min-h-0">
          <EditorFloor
            layout={layout}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={setLayout}
          />
        </section>

        <section className="overflow-auto">
          {selected ? (
            <ZoneInspector
              zone={selected}
              onChange={(patch) => setLayout(updateZone(layout, selected.id, patch))}
              onRemove={removeSelected}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              Pick a zone on the floor to name it, change what it does, or delete it.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

/**
 * What the selected Zone is, beyond where it sits: its name, and the flags its kind
 * allows. Only the fields that belong to this kind are offered — a private Wall or a
 * six-seat Room is a Layout that has misunderstood the domain, so it is not something the
 * editor lets an Owner build.
 */
function ZoneInspector({
  zone,
  onChange,
  onRemove,
}: {
  zone: Zone
  onChange: (patch: ZonePatch) => void
  onRemove: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-medium capitalize">{zone.kind}</h2>
        <p className="text-muted-foreground text-xs">{zone.id}</p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="zone-label">Label</Label>
        <Input
          id="zone-label"
          value={zone.label ?? ""}
          placeholder="Unnamed"
          onChange={(e) => onChange({ label: e.target.value })}
        />
      </div>

      {zone.kind === "room" && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={zone.private === true}
            onChange={(e) => onChange({ private: e.target.checked })}
          />
          <span>
            Private
            <span className="text-muted-foreground block text-xs">
              Seals the audio, video and chat of everyone inside from the rest of the floor.
            </span>
          </span>
        </label>
      )}

      {zone.kind === "table" && (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="zone-seats">Seats</Label>
            <Input
              id="zone-seats"
              type="number"
              min={1}
              value={zone.seats ?? DEFAULT_SEATS}
              onChange={(e) => {
                const seats = Number(e.target.value)
                // A fraction of a chair, or none, is not a Layout — leave the value alone
                // until it is a number of seats again.
                if (Number.isInteger(seats) && seats > 0) onChange({ seats })
              }}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={zone.style === "dining"}
              onChange={(e) => onChange({ style: e.target.checked ? "dining" : "plain" })}
            />
            Dining table
            <span className="text-muted-foreground text-xs">(looks different, behaves the same)</span>
          </label>
        </>
      )}

      <Button variant="destructive" onClick={onRemove}>
        <Trash2 className="size-4" />
        Delete zone
      </Button>
    </div>
  )
}
