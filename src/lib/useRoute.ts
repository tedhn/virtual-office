import { useEffect, useMemo, useState } from "react"
import { routeOf, type Route } from "./routes"

/**
 * The page the browser's URL is asking for, kept current as the user moves around.
 *
 * Paired with `navigate` below: together they are the whole of this app's navigation.
 * The mapping itself lives in `routes.ts`, as a pure function — this is only the part
 * that has to touch the browser.
 */
export function useRoute(): Route {
  const [pathname, setPathname] = useState(() => window.location.pathname)

  useEffect(() => {
    const sync = () => setPathname(window.location.pathname)
    window.addEventListener("popstate", sync)
    return () => window.removeEventListener("popstate", sync)
  }, [])

  return useMemo(() => routeOf(pathname), [pathname])
}

/**
 * Go somewhere without reloading. The synthetic `popstate` is what tells `useRoute` the
 * URL moved: the browser fires that event for the back button but not for a pushState of
 * our own, so we say so ourselves rather than keeping a second copy of the current path.
 */
export function navigate(path: string): void {
  if (path === window.location.pathname) return
  window.history.pushState(null, "", path)
  window.dispatchEvent(new PopStateEvent("popstate"))
}
