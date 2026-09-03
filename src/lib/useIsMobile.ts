import { useEffect, useState } from "react"

const MOBILE_QUERY = "(max-width: 768px)"

/**
 * True while the viewport is phone-sized. Drives the stacked mobile layout in InsideOffice;
 * the desktop path is untouched when this is false. Updates live on resize/rotate.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setIsMobile(mql.matches)
    onChange()
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
