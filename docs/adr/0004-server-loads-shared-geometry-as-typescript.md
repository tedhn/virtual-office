# The server loads the shared geometry module as TypeScript, stripped by Node at load

`server/relay.mjs` imports `src/office/layout.ts` and `src/office/defaultLayout.ts`
directly. Node strips the type annotations as it loads them — no build step, no bundler,
no transpiler dependency, and one implementation of Room-context for client and server
alike.

Two constraints come with it, and both are load-bearing:

- Every runtime import inside the shared module's graph carries an explicit `.ts`
  extension, because Node ESM does no extension resolution. `allowImportingTsExtensions`
  in `tsconfig.app.json` keeps the app build and Vite happy with the same specifiers.
- The shared graph stays erasable — no enums, namespaces or parameter properties — which
  `erasableSyntaxOnly` already enforces for the whole app. It must also stay free of DOM
  types and third-party imports, since nothing resolves them on the server side.

This narrows ADR-0002 rather than contradicting it. That ADR has the server evaluating
positions against the published Layout it fetches from the database per Office; no
database exists yet, so the relay evaluates them against the shipped `DEFAULT_LAYOUT`
instead. What ADR-0002 actually forbids — trusting a client's own account of which Room
it is in — is untouched, and the isolation code already takes the Layout as an argument,
so the database fetch drops in without rewriting the privacy check.

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

Keeping the server's own copy of the rectangles — the status quo — was the option this
ADR exists to kill. Two implementations of "who is inside which Room" is exactly one more
than privacy can afford, and the duplicate had already drifted a comment reading "keep in
sync if those change".

## Consequences

The server needs Node 22.18 or newer (type stripping unflagged); `package.json` records
that in `engines`. A deployment that pins an older Node fails at import, loudly, which is
the right failure — the alternative would be a silently stale copy of the floorplan.

The extension rule is easy to break by accident: adding a runtime `import` to
`layout.ts` written the way every other file in `src/` writes it will start the app fine
and break the server. Vitest resolves extensionless specifiers through Vite, so the rest
of the suite will not notice — importing the graph from a test proves nothing. The guard
that does work is one test in `server/relay.test.mjs` that spawns a real `node` process
and imports `relay.mjs` through it. Keep it: it is the only thing between a missing
extension and a boot failure in production.
