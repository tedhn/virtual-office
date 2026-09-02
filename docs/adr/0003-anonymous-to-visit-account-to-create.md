# Anonymous sign-in to visit an Office, a real account to create one

Visitors enter an Office with an anonymous identity created silently on first load, so
joining stays a single field and one click. Creating an Office requires signing in with
a real, recoverable account.

## Considered options

Letting anonymous users create Offices too would be more consistent, and was rejected
because an anonymous identity lives in browser storage: clear it, switch browser, or use
a private window and the Office is orphaned — unreachable by its Owner, undeletable, and
unsupportable, with no proof of ownership to appeal to. Requiring accounts for visitors
as well would fix that symmetrically, but charges a signup at exactly the moment where
friction costs the most: someone who was handed a link and wants to walk in.

The asymmetry follows the durability of what is being produced. Visiting is transient
and leaves nothing behind. An Office is durable, bookmarked by other people, and needs
an Owner who can still prove they are the Owner in six months.

## Consequences

Two sign-in paths exist in the product at once, and the transition between them — an
anonymous Visitor deciding to create their own Office — has to be handled deliberately
rather than falling out of the design.
