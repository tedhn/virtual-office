import { Button } from "@/components/ui/button"
import { navigate } from "@/lib/useRoute"

/**
 * Nothing here.
 *
 * One screen for every way an address can lead nowhere: a slug nobody ever had, an Office
 * its Owner has not published, and an Office that has been deleted. Telling those apart
 * would say something about an Office to someone with no business knowing it exists.
 */
export function NotFound() {
  return (
    <div className="min-h-svh flex flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">No office here</h1>
        <p className="text-muted-foreground max-w-sm text-sm">
          This address doesn't lead to an office. It may never have, or the office that was
          here may be gone — either way, the link cannot be followed.
        </p>
      </div>
      <Button variant="secondary" onClick={() => navigate("/")}>
        Go to the start
      </Button>
    </div>
  )
}
