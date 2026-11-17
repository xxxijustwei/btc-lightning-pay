# Effect

For Effect implementation or API questions, read the changed workspace's installed
`node_modules/effect/AGENTS.md`, then follow its relevant sections and source links.
With pnpm, resolve this from the consuming package, such as
`apps/backend/node_modules/effect/AGENTS.md`, rather than assuming a root dependency.

Use Context7 as required by [AGENTS.md](../AGENTS.md), matching the installed major
version. Resolve differences against installed exports, types, and source. The
current code uses `effect/http` and `effect/http-api`; older examples with separate
platform packages are not an instruction to change dependencies.

Keep execution and concrete Layer composition at app/runtime boundaries. Preserve
typed errors and scoped resource cleanup when moving code; expose failures through
the owning [API contract](api-contract.md) rather than silently recovering to success.
