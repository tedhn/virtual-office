import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { isAnonymous, MIN_PASSWORD_LENGTH } from "./session"
import type { AuthGateway } from "./useAuthSession"

interface AccountSignInProps {
  auth: AuthGateway
}

/**
 * What the person is here to do with their account. Signing in is the default because it
 * is the thing done repeatedly: an account is made once and returned to for as long as
 * the Office exists.
 */
type Mode = "signIn" | "signUp" | "reset"

const HEADING: Record<Mode, string> = {
  signIn: "Sign in to your account",
  signUp: "Create an account",
  reset: "Choose a new password",
}

const SUBMIT: Record<Mode, string> = {
  signIn: "Sign in",
  signUp: "Create account",
  reset: "Email a reset link",
}

const BUSY: Record<Mode, string> = {
  signIn: "Signing in…",
  signUp: "Creating…",
  reset: "Sending…",
}

/**
 * The other door: owning an Office needs a real account, because an Office outlives the
 * browser storage an anonymous identity lives in (ADR-0003). Visiting needs nothing, so
 * this asks for an email only when someone wants to author something.
 *
 * A password is the way back in, and a magic link is the way in for someone who would
 * rather not keep one. Both reach the same account for the same address, so the choice
 * here is about this visit and not about the account.
 */
export function AccountSignIn({ auth }: AccountSignInProps) {
  const { session, recovering } = auth
  const [mode, setMode] = useState<Mode>("signIn")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** Runs one account action, and says why if it did not happen. */
  const attempt = async (action: () => Promise<string | null>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      setNotice(await action())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not do that")
    } finally {
      setBusy(false)
    }
  }

  // A person holding a recovery session is signed in but knows no password, so the only
  // thing worth showing them is a field to choose one.
  if (recovering) {
    return (
      <NewPasswordForm
        busy={busy}
        error={error}
        onSubmit={(next) =>
          attempt(async () => {
            await auth.replacePassword(next)
            return null
          })
        }
      />
    )
  }

  if (session && !isAnonymous(session)) {
    return (
      <p className="text-muted-foreground text-sm">
        Signed in — you can create an office.
      </p>
    )
  }

  if (notice) {
    return (
      <div className="grid gap-2 text-center">
        <p className="text-muted-foreground max-w-sm text-sm">{notice}</p>
        <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
          Back
        </Button>
      </div>
    )
  }

  const address = email.trim()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === "reset") {
      return attempt(async () => {
        await auth.requestPasswordReset(email)
        return `Check ${address} for a link to choose a new password.`
      })
    }
    if (mode === "signUp") {
      return attempt(async () => {
        const created = await auth.createAccount(email, password)
        // A project that confirms addresses signs nobody in yet, so there is something to
        // say; one that does not has already signed them in and the form goes away.
        return created ? null : `Check ${address} to confirm the address, then sign in.`
      })
    }
    return attempt(async () => {
      await auth.signIn(email, password)
      return null
    })
  }

  /** Switching what you are here to do should not carry an error about the last thing. */
  const switchTo = (next: Mode) => {
    setMode(next)
    setError(null)
  }

  const ready = mode === "reset" ? Boolean(address) : Boolean(address && password)

  return (
    <form onSubmit={submit} className="grid w-full max-w-sm gap-3">
      <Label htmlFor="email" className="text-muted-foreground text-xs">
        {HEADING[mode]} — an office needs one to belong to.
      </Label>

      <div className="grid gap-2">
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
        {mode !== "reset" && (
          <Input
            id="password"
            type="password"
            autoComplete={mode === "signUp" ? "new-password" : "current-password"}
            placeholder={
              mode === "signUp" ? `At least ${MIN_PASSWORD_LENGTH} characters` : "Password"
            }
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        )}
      </div>

      <Button type="submit" disabled={busy || !ready}>
        {busy ? BUSY[mode] : SUBMIT[mode]}
      </Button>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="text-muted-foreground flex flex-wrap justify-between gap-x-2 text-xs">
        {mode === "signIn" ? (
          <>
            <button type="button" className="underline" onClick={() => switchTo("signUp")}>
              Create an account
            </button>
            <button type="button" className="underline" onClick={() => switchTo("reset")}>
              Forgot your password?
            </button>
          </>
        ) : (
          <button type="button" className="underline" onClick={() => switchTo("signIn")}>
            Already have an account? Sign in
          </button>
        )}
      </div>

      {mode !== "reset" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || !address}
          onClick={() =>
            attempt(async () => {
              await auth.requestMagicLink(email)
              return `Check ${address} for a sign-in link. Opening it brings you back here, signed in to an account that can own an office.`
            })
          }
        >
          Email me a link instead
        </Button>
      )}
    </form>
  )
}

/** The end of a reset link: signed in already, and choosing the password from now on. */
function NewPasswordForm({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean
  error: string | null
  onSubmit: (password: string) => void
}) {
  const [password, setPassword] = useState("")

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(password)
      }}
      className="grid w-full max-w-sm gap-3"
    >
      <Label htmlFor="new-password" className="text-muted-foreground text-xs">
        Choose a new password for your account.
      </Label>
      <Input
        id="new-password"
        type="password"
        autoComplete="new-password"
        placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={busy}
      />
      <Button type="submit" disabled={busy || !password}>
        {busy ? "Saving…" : "Set password"}
      </Button>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </form>
  )
}
