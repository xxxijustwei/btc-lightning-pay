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

When adding or changing an operation, update the shared contract, backend handler,
frontend adapter/consumer, and affected tests together. Check all callers before
changing a public shape or path. The existing health flow is the smallest example,
not evidence that payment services are ready. See [testing](testing.md).
