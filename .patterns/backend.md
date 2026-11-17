# Backend

Applies to `apps/backend` and the frontend's server-side API adapters.

- `apps/backend` owns HTTP handlers, business implementation, and runtime Layer
  composition. Keep handlers focused on translating requests and results; extract
  business workflows when actual behavior needs them, without creating empty layers.
- Business workflows receive identity and inputs explicitly. Keep request objects,
  environment reads, and vendor clients at runtime boundaries. Introduce Effect
  services for actual dependencies; see [Effect](effect.md).
- `packages/api` owns shared HTTP contracts, not business implementation. There is
  currently no separate core or database package; extract one when concrete reuse
  or ownership requires it, not to mirror sirens.
- The frontend forwards same-origin API requests through the `BACKEND` service
  binding. Preserve failure handling and intentional response headers; keep backend
  business rules out of this adapter.
- Scope request identity and mutable request data to the request. Keep failures
  explicit and release acquired resources through their owning runtime scope.
- Runtime binding changes require type generation. Keep secrets in ignored local
  environment files or platform bindings, outside browser code and logs.

For endpoint changes, follow [API contracts](api-contract.md); select checks from
[testing](testing.md). Local service binding setup is documented in [README](../README.md).
