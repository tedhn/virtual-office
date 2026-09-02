import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { isAnonymous, type AuthSession } from "./session"

interface AccountSignInProps {
  session: AuthSession | null
  onRequestLink: (email: string) => Promise<void>
}

/**
 * The other door: owning an Office needs a real account, because an Office outlives the
 * browser storage an anonymous identity lives in (ADR-0003). Visiting needs nothing, so
 * this asks for an email only when someone wants to author something.
 */
export function AccountSignIn({ session, onRequestLink }: AccountSignInProps) {
  const [email, setEmail] = useState("")
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (session && !isAnonymous(session)) {
    return (
      <p className="text-muted-foreground text-sm">
        Signed in — you can create an office.
      </p>
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (sending) return
    setSending(true)
    setError(null)
    try {
      await onRequestLink(email)
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the link")
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <p className="text-muted-foreground text-sm text-center max-w-sm">
        Check <span className="text-foreground">{email.trim()}</span> for a sign-in link. Opening it
        brings you back here, signed in to an account that can own an office.
      </p>
    )
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm grid gap-2">
      <Label htmlFor="email" className="text-muted-foreground text-xs">
        Want your own office? Sign in with an email link.
      </Label>
      <div className="flex gap-2">
        <Input
          id="email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={sending}
        />
        <Button type="submit" variant="secondary" disabled={sending || !email.trim()}>
          {sending ? "Sending…" : "Send link"}
        </Button>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </form>
  )
}
