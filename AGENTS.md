# AGENTS.md

BTC Lightning Pay contains two frontends (`apps/frontend` platform admin, `apps/pay`
payer pages), a Worker backend, a wallet service, shared API contracts, shared UI
source, and a database package. The admin frontend requires an admin session; the
payer app needs no login and may only reach `/api/public/*`.

## Task routing

Read the guidance matching the behavior being changed. Documentation-only work
needs the affected documents and their references, not application setup.

| Task                                                     | Guidance                                               |
| -------------------------------------------------------- | ------------------------------------------------------ |
| Backend handlers, business logic, or runtime composition | [.patterns/backend.md](.patterns/backend.md)           |
| DTOs, HTTP contracts, route adapters, or public errors   | [.patterns/api-contract.md](.patterns/api-contract.md) |
| Frontend, shared components, styling, or client state    | [.patterns/frontend.md](.patterns/frontend.md)         |
| Effect implementation or API usage                       | [.patterns/effect.md](.patterns/effect.md)             |
| Tests or validation selection                            | [.patterns/testing.md](.patterns/testing.md)           |
| Database, migrations, provisioning, or auth setup        | [docs/auth-setup.md](docs/auth-setup.md)               |
| Local setup, scripts, or current project boundaries      | [README.md](README.md)                                 |

## Repository constraints

- Dependencies flow from apps into shared packages. Keep shared UI independent of
  app routes and business state, and shared API contracts independent of runtime I/O.
- Generate route trees and Worker binding types through their owning tools;
  generated outputs are not hand-edited.
- Keep dependency versions in the workspace catalog and update the lockfile with
  dependency changes. Check compatibility before upgrading; retain supply-chain checks.
- Update affected documentation with behavior changes. Complete relevant checks
  and report any skipped checks or blockers.
- Local edits and affected checks can proceed within the request. Remote writes,
  deployment, and transactions require authorization covering that operation;
  an explicit request already provides it.

## Documentation and skills

For library, framework, SDK, API, CLI, or cloud-service usage, use Context7:
resolve the library ID first (unless supplied), then query documentation for the
actual question. Prefer version-matched documentation and installed types/source;
if Context7 is unavailable or incomplete, use official sources and state the gap.
General refactoring and business logic do not require library documentation lookup.

Use installed skills for their relevant tasks. Project conventions and the actual
stack govern how generic advice applies. For agent-document edits, read
[writing-for-agents](.agents/skills/writing-for-agents/SKILL.md).
Before using a skill that publishes specs or tickets, establish this project's
tracker; no tracker or business decision is inherited from sirens.

## Workspace tooling

Run shell commands through `rtk`; use `rtk proxy <command>` for unfiltered output.
Use the root `pnpm` scripts and `pnpm --filter <package> <script>` for package
scripts, checking the owning manifest first. Vite+ owns root checks and tests;
the frontend uses its own Vite. Setup and the pnpm version-switch fallback are in
[README.md](README.md#快速开始); validation scope is in [testing](.patterns/testing.md).
