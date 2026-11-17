# Testing and validation

Choose checks for the changed behavior. Run affected tests while iterating and
broaden to consumers when a shared interface changes. Repeat passing checks only
when new changes, failures, or unresolved concerns justify it.

## Validation matrix

Commands below run from the repository root through `rtk proxy`. Root scripts own
required generation. Verify scripts against the manifests before using them.

| Change                                 | Checks                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent docs or Markdown                 | Check changed-file formatting, local links, and command references; use `git diff --check` when in a Git checkout. Application tests only if executable behavior changes. |
| Frontend behavior                      | `pnpm test --project frontend`; add `pnpm typecheck` for types/routes/imports, and browser inspection for visible or interaction changes.                                 |
| Backend behavior                       | `pnpm test --project backend`; add `pnpm typecheck` for types/contracts/bindings. Test handler composition when wiring changes.                                           |
| Shared API                             | `pnpm typecheck` and affected backend/frontend tests; exercise changed public contracts through their consumers.                                                          |
| Shared UI or theme                     | `pnpm typecheck`, consuming frontend tests, `pnpm build`, and browser inspection of affected states/styles.                                                               |
| Runtime bindings                       | `pnpm typecheck` generates bindings before type checks; validate affected app behavior.                                                                                   |
| Formatting or lint                     | `pnpm check`; limit fixes to the task's files.                                                                                                                            |
| Cross-package integration or readiness | `pnpm ready` includes generation, types, checks, tests, and builds; do not rerun its constituent checks without a reason.                                                 |

Tests currently run from the root Vite+ configuration: backend uses Node and
frontend uses happy-dom, with Node environment overrides for its server-boundary tests. There are no package-level test scripts. New test locations
must be included in that configuration; a test file outside its globs is not tested.
The backend build is a deployment dry-run, not a remote deployment.

## Test design

- Protect behavior through the interface callers use. For regressions, reproduce
  the failure before accepting the fix; assert outcomes, not private implementation.
- Use React Testing Library roles and accessible names, `userEvent.setup()`, and
  `findBy*` or RTL `waitFor` for async outcomes. Loading states must prevent duplicate
  actions where required and errors must leave a usable retry path.
- Create QueryClient/store instances per test. Clean up mounts, caches, mocks,
  subscriptions, and clocks; shared setup owns RTL cleanup, not shared app state.
- Mock I/O and other external boundaries. Composition tests should exercise real
  handler wiring so mocked internals cannot hide broken Layer assembly.
- When using fake timers, advance React updates within `act`, configure user-event
  timer advancement, and restore timers. Keep expected console errors local and
  leave unexpected warnings visible.
- DOM tests do not prove layout, CSS generation, or SSR hydration. Use browser and
  build checks when those behaviors change. Trivial documentation edits need none.

Database/auth integration tests run in the backend project with isolated PGlite,
applying `packages/db/drizzle` migrations and the supplied provisioning SQL.
Mock only connection creation and mail delivery; keep the actual ORM and auth
library in the flow. Test public-table access as a non-owner, non-BYPASSRLS role.
Real Supabase, Resend delivery, and deployed Workers require separate integration
checks after credentials are configured.
