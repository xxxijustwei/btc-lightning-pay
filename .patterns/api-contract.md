# API contracts

Applies to `packages/api`, backend HTTP handlers, and frontend API consumers/adapters.

- `packages/api` owns Effect Schema DTOs, inferred types, and Effect HttpApi endpoint
  definitions. Keep public success/error shapes and endpoint definitions here as
  operations are added. The current package does not need schema/http/core subpackages.
- Contracts remain independent of database access, environment configuration,
  authentication lookup, localized messages, and business implementation.
- Consumers use public package exports. Validate untrusted inputs and responses at
  their boundaries; TypeScript types alone do not validate network data.
- Apps implement handlers and map failures into intentional HTTP responses. Avoid
  leaking internal exception details or treating failed requests as successful data.

Browser apps call `PaymentsApi` through their own `contract-client.ts`, which takes
paths, input encoding, and response decoding from the contract
([ADR-0001](../docs/adr/0001-browser-adapters-derive-from-contract.md)). Pages branch
on an error's `code`, `retryable`, and `outcomeUnknown`, never on HTTP status.

Amounts stay integers in their smallest unit. `Sats` and `Millisats` are branded, so one
cannot stand in for the other; convert only through `satsToMsat`, `msatToSats`,
`bigintSatsToMsat`, and `excessMsat`, and type database amount columns with them.

When adding or changing an operation, update the shared contract, backend handler,
frontend adapter/consumer, and affected tests together. Check all callers before
changing a public shape or path. The existing health flow is the smallest example,
not evidence that payment services are ready. See [testing](testing.md).

Better Auth's `/api/auth/*` protocol is delegated to the installed library and its
client SDK. The backend allowlist limits exposed capabilities. Custom endpoints
such as `/api/me` still declare contracts here and validate library output before
returning it. Frontend auth uses the official client and same-origin service-binding proxy; see
[auth setup](../docs/auth-setup.md).
