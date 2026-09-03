import { useState } from "react"
import { Pencil } from "lucide-react"
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
import type { AuthGateway } from "@/auth/useAuthSession"
import { FloorPreview } from "@/office/FloorPreview"
import type { Layout } from "@/office/layout"

interface JoinScreenProps {
  /** What this Office is called. A Visitor arrived by its link, so say where they are. */
  officeName: string
  /** The Floor they are about to walk onto, drawn whole and with nobody on it. */
  layout: Layout
  onJoin: (name: string) => void
  connecting: boolean
  error?: string | null
  auth: AuthGateway
  /** Open this Office's editor. Given only when the person looking owns the Office. */
  onEdit?: () => void
}

/**
 * The door of one Office: see the Floor, pick a display name, and walk in.
 *
 * A name is all that is asked for, because the identity behind it is already settled — a
 * Visitor was signed in anonymously as the page loaded (ADR-0003). The name is what
 * everyone else sees above the avatar, and nothing else hangs off it.
 */
export function JoinScreen({
  officeName,
  layout,
  onJoin,
  connecting,
  error,
  auth,
  onEdit,
}: JoinScreenProps) {
  const [name, setName] = useState("")

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed && !connecting) onJoin(trimmed)
  }

  return (
    <div className="min-h-svh flex flex-col items-center justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="max-w-md truncate text-3xl font-semibold tracking-tight">{officeName}</h1>
        <p className="text-muted-foreground text-sm">
          Walk around. Voices fade in when you get close.
        </p>
      </div>

      {/* The Office itself, empty. Bounded rather than filling the page: this is a look at
          where you are going, not the thing you have come to do. */}
      <div className="h-48 w-full max-w-sm sm:h-56">
        <FloorPreview layout={layout} />
      </div>

      <Card className="w-full max-w-sm">
        <form onSubmit={submit}>
          <CardHeader>
            <CardTitle>Enter the office</CardTitle>
            <CardDescription>Pick a display name to join the floor.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="py-4 grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="J"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                disabled={connecting}
              />
              {error && <p className="text-destructive text-sm">{error}</p>}
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={connecting || !name.trim()}>
              {connecting ? "Connecting…" : "Join"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <AccountSignIn session={auth.session} onRequestLink={auth.requestMagicLink} />

      {/* The Owner's door, alongside the sign-in state rather than instead of it.
          Authoring is somewhere else entirely — not a mode you switch on while standing in
          the Office — so it is a way out of this screen, not a control on it. */}
      {onEdit && (
        <Button variant="ghost" onClick={onEdit}>
          <Pencil className="size-4" />
          Edit this office's layout
        </Button>
      )}
    </div>
  )
}
