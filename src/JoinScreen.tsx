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
import type { AuthSession } from "@/auth/session"

interface JoinScreenProps {
  onJoin: (name: string) => void
  connecting: boolean
  error?: string | null
  /** The identity walking in — anonymous for a Visitor, an account for a creator. */
  session: AuthSession | null
  onRequestLink: (email: string) => Promise<void>
}

export function JoinScreen({ onJoin, connecting, error, session, onRequestLink }: JoinScreenProps) {
  const [name, setName] = useState("")

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed && !connecting) onJoin(trimmed)
  }

  return (
    <div className="min-h-svh flex flex-col items-center justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Virtual Office</h1>
        <p className="text-muted-foreground text-sm">
          Walk around. Voices fade in when you get close.
        </p>
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

      <AccountSignIn session={session} onRequestLink={onRequestLink} />
    </div>
  )
}
