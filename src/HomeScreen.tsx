import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AccountSignIn } from "@/auth/AccountSignIn"
import { isAnonymous } from "@/auth/session"
import type { AuthGateway } from "@/auth/useAuthSession"
import { createOfficeFromName } from "@/lib/offices"
import { supabaseOfficeRows } from "@/lib/officeRows"
import { officePath } from "@/lib/routes"
import { isSlug, slugFrom } from "@/lib/slug"
import { supabase } from "@/lib/supabase"
import { navigate } from "@/lib/useRoute"
import { OwnOffices } from "@/OwnOffices"

interface HomeScreenProps {
  auth: AuthGateway
}

/**
 * The front door, and what it offers depends on who is standing at it.
 *
 * An Office is reached at its own URL, so a Visitor who arrived with a link never comes
 * here and there is nothing to show them. This screen is for the other case: making an
 * Office of your own, which takes a real account (ADR-0003) — and then, once you have one,
 * keeping track of the ones you have made.
 */
export function HomeScreen({ auth }: HomeScreenProps) {
  const { session, error } = auth
  const owner = session && !isAnonymous(session) ? session.user.id : null

  return (
    <div className="min-h-svh flex flex-col items-center justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Virtual Office</h1>
        <p className="text-muted-foreground text-sm">
          A floor to walk around on together. Voices fade in when you get close.
        </p>
      </div>

      {owner && <OwnOffices ownerId={owner} />}

      {owner && <CreateOfficeForm ownerId={owner} />}

      <AccountSignIn session={session} onRequestLink={auth.requestMagicLink} />

      {error && <p className="text-destructive max-w-sm text-center text-sm">{error}</p>}
    </div>
  )
}

/**
 * What to say the Office's link will be, before there is one.
 *
 * Only promises the bare address when that address is one an Office may have: a name too
 * short to be a slug, or one that collides with a path the server owns, always ends up
 * with a random tail, and saying otherwise would be a promise about a permanent address
 * that we then break.
 */
function addressFor(name: string): string {
  if (!name) return "Its link comes from the name, and never changes afterwards."
  const wanted = slugFrom(name)
  return isSlug(wanted)
    ? `Its link will be /${wanted}, or close to it if that one is taken.`
    : `Its link will be /${wanted} followed by a few random characters.`
}

/**
 * Name an Office, get an Office. The name is the only thing asked for: the address comes
 * from it, and the Floor it starts with is empty but for the Spawn Zone people arrive in.
 */
function CreateOfficeForm({ ownerId }: { ownerId: string }) {
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const wanted = name.trim()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!wanted || creating) return
    setCreating(true)
    setError(null)
    try {
      const office = await createOfficeFromName(supabaseOfficeRows(supabase()), {
        ownerId,
        name: wanted,
      })
      navigate(officePath(office.slug))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the office")
    } finally {
      setCreating(false)
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <form onSubmit={submit}>
        <CardHeader>
          <CardTitle>Create an office</CardTitle>
          <CardDescription>
            It starts empty, with one spot for people to arrive in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="py-4 grid gap-2">
            <Label htmlFor="office-name">Name</Label>
            <Input
              id="office-name"
              placeholder="Acme HQ"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              disabled={creating}
            />
            {/* The address is permanent, so it is worth seeing before pressing the button. */}
            <p className="text-muted-foreground text-xs">{addressFor(wanted)}</p>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={creating || !wanted}>
            {creating ? "Creating…" : "Create office"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
