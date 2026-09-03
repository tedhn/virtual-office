import { Toaster } from "sonner"
import { useAuthSession } from "./auth/useAuthSession"
import { HomeScreen } from "./HomeScreen"
import { NotFound } from "./NotFound"
import { useRoute } from "./lib/useRoute"
import { OfficeEditor } from "./office/editing/OfficeEditor"
import { OfficeView } from "./office/OfficeView"

/**
 * The whole route table: the root is where an Office is made, a slug is an Office, and
 * anything else is nowhere (see `lib/routes.ts`).
 *
 * An identity is arranged here rather than per screen, because every screen wants the
 * same one: a Visitor is signed in anonymously as the page loads, and an Owner signs in
 * on top of that with a magic link (ADR-0003). It is also the identity a Visitor walks
 * into an Office as, so there is exactly one person behind the avatar and the account.
 *
 * Note what the editor route does *not* do: check that the person opening it owns the
 * Office. Nothing here could enforce that anyway — the check lives in the database, where
 * a stranger's query for somebody else's Office simply returns nothing (ADR-0005).
 */
function App() {
  const route = useRoute()
  const auth = useAuthSession()

  return (
    <>
      <Toaster />
      {route.kind === "home" && <HomeScreen auth={auth} />}
      {route.kind === "office" && <OfficeView slug={route.slug} auth={auth} />}
      {route.kind === "edit" && <OfficeEditor slug={route.slug} auth={auth} />}
      {route.kind === "notFound" && <NotFound />}
    </>
  )
}

export default App
