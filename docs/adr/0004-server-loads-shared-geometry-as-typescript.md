# The server loads the shared geometry module as TypeScript, stripped by Node at load

`server/relay.mjs` imports `src/office/layout.ts` directly, and `server/officeLayouts.mjs`
imports `src/office/layoutSchema.ts` the same way. Node strips the type annotations as it
loads them — no build step, no bundler, no transpiler dependency, and one implementation
of Room-context, and of what counts as a Layout, for client and server alike.

Two constraints come with it, and both are load-bearing:

- Every runtime import inside the shared module's graph carries an explicit `.ts`
  extension, because Node ESM does no extension resolution. `allowImportingTsExtensions`
  in `tsconfig.app.json` keeps the app build and Vite happy with the same specifiers.
- The shared graph stays erasable — no enums, namespaces or parameter properties — which
  `erasableSyntaxOnly` already enforces for the whole app. It must also stay free of DOM
  types and third-party imports, since nothing resolves them on the server side.

This is what makes ADR-0002 cheap to honour. The relay evaluates positions against the
Layout it fetched for that Office, using the same `roomContextAt` the browser uses to
decide what to show — so "who is inside which Room" has one answer and one implementation,
and the server's copy of it cannot drift from the client's.

## Considered options

Compiling the shared module to JavaScript with `tsc` and importing the output was the
conventional answer. It costs a build directory, a script that has to run before the
server starts in dev as well as prod, and a rebuild-on-change watcher — all so the server
can read three functions. `tsx` or `ts-node` as a runtime dependency buys the same result
for the price of a dependency in the server's boot path; Node now does the job itself.

Rewriting the geometry as plain `.mjs` with a hand-written `.d.mts` alongside was
considered and rejected: the client is the module's main consumer and would lose type
inference at its own call sites, and the declaration file becomes a second source of
truth to keep in step.

Keeping the server's own copy of the rectangles — the status quo when this was written —
was the option this ADR exists to kill. Two implementations of "who is inside which Room"
is exactly one more than privacy can afford, and the duplicate had already drifted a
comment reading "keep in sync if those change".

## Consequences

The server needs Node 22.18 or newer (type stripping unflagged); `package.json` records
that in `engines`. A deployment that pins an older Node fails at import, loudly, which is
the right failure — the alternative would be a silently stale copy of the floorplan.

The extension rule is easy to break by accident: adding a runtime `import` to
`layout.ts` or `layoutSchema.ts` written the way every other file in `src/` writes it will
start the app fine and break the server. Vitest resolves extensionless specifiers through
Vite, so the rest of the suite will not notice — importing the graph from a test proves
nothing. The guard that does work is the test in `server/relay.test.mjs` that spawns a
real `node` process and imports each server module through it. Keep it, and add a module
to its list whenever another one starts loading TypeScript from source: it is the only
thing between a missing extension and a boot failure in production.
