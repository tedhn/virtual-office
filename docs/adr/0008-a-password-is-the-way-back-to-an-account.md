# A password is the way back to an Owner's account, with the magic link kept alongside

An Owner reaches their account with an email and a password. The magic link stays as a
second way in, offered on the same form.

## Considered options

The magic link alone was what shipped first, and it is genuinely both doors: Supabase's
`/otp` endpoint creates an account for an address it has not seen and signs in the account
it has, so the one field already worked for returning Owners. It was rejected as the only
way in for two reasons, both about the return visit rather than the first one. It reads as
signing up — the form asked "want your own office?", and the first email Supabase sends a
new address is subject-lined as a signup confirmation, so an Owner coming back for the
tenth time is addressed as a newcomer every time. And it puts an email round trip in front
of every visit, on a mailer that is rate-limited to a couple of messages an hour on a
hosted project's built-in SMTP — so an Owner who signs in twice in an hour is refused by
the second attempt, with nothing wrong with their account.

Rewording the copy would fix the reading and not the round trip. An OAuth provider would
fix both, and was left for later: it moves the account into a third party's hands and
needs credentials configured per deployment, which is a larger decision than giving the
account a password.

## Consequences

An address now has two credentials that reach one account, and the account is whichever
one the address already has — someone who signed up by link can set a password through the
reset flow, and someone who signed up with a password can still ask for a link. Neither
credential is the account's identity; the address is.

A password login needs the paths a password implies: a reset link, and a screen for the
session that link produces, which is signed in but holds no password anyone knows.
Supabase reports that session as its own `PASSWORD_RECOVERY` event, and that event is the
only thing distinguishing it from an ordinary sign-in.

Whether creating an account also signs the person in is now a visible fork, decided by
`enable_confirmations` in `supabase/config.toml`: off, and the account is usable
immediately; on, and there is a confirmation email to wait for. Both answers are handled,
because that setting is a deployment's to make.
