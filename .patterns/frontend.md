# Frontend

Applies to `apps/frontend`, `apps/pay` and `packages/ui`.

## Ownership

- App routes, pages, API integration, and business state belong in the frontend.
  Reusable UI source, theme tokens, and styling utilities belong in `packages/ui`.
  Shared UI must not import an app's router, state store, or business API.
- Use shared [API contracts](api-contract.md) at backend boundaries. Keep server-only
  bindings and secrets out of browser modules. Preserve route generation and splitting.
- TanStack Query owns server data/cache, Jotai owns shared client state, and nuqs owns
  URL state. Keep local interaction state local; avoid storing the same source of truth
  in multiple systems.
- Create QueryClient instances per router and keep Jotai state within the app Provider
  for SSR isolation. Preserve the Query SSR integration and nuqs adapter in place.

## Admin lists and forms

- Lists use TanStack Table through `components/data-table`: `table-hook.ts` registers
  the features and typed column/table meta once; pages build columns with
  `createAppColumnHelper` and render `<DataTable />` and `<DataTablePagination />`
  inside `<table.AppTable>`. Define columns at module scope (or memoize them when they
  close over props).
- Filters and pagination live in the URL. Declare parsers in `lib/list-search.ts` and
  register `searchSchema(parsers)` as the route's `validateSearch`. Server-paginated
  lists call `useServerList` (`modules/admin/server-list.ts`) with the parsers, a
  `fetchPage`, and `count: "total"` or, when the API returns a bare array,
  `count: "probe"`; change filters through its `setFilter`, which returns to the first
  page. Single-choice filters use `FilterToggle`; day ranges reach the API through
  `beijingRange`.
- Admin writes go through `useWriteDialog` (`modules/admin/write-dialog.tsx`) and
  render as `<FormDialog {...dialogProps}>`; a confirmation is a `FormDialog` without
  fields. The hook refreshes `["admin"]` data, reports success through the shadcn
  toast (`<Toaster />` is mounted once in the admin shell), and closes; failures stay
  in the dialog. Map server codes that describe one field with `fieldConflicts`.
- Fields render through `form.AppField` with the bound `TextField`, `TextareaField`,
  or `CheckboxField`, which own labels, errors, and server conflicts. Field rules
  come from the shared contract schemas in `lib/validation.ts`.
- Admin times display in Beijing time through `lib/format.ts` (`@date-fns/tz`);
  date-range filters store calendar days in the URL and send UTC instants to the API.

## Shared UI

- Use the existing shadcn/ui source with preset `bIkeymG`, Base UI primitives,
  `base-vega` style, neutral tokens, Lucide icons, and Inter font. The two
  `components.json` files and shared stylesheet own the configuration.
- Add components through the shadcn CLI using the existing workspace aliases;
  see [README](../README.md#前端基础依赖) for the command. Review generated source
  and dependencies, then put new dependency versions in the workspace catalog.
- Import components through `@btc-lightning-pay/ui/components/*`. Use semantic
  theme tokens and preserve Tailwind scanning for both app and shared UI sources.
- A future frontend consumes the same UI package and theme, while owning its own
  providers, routing, and application state. Extract shared behavior only when needed.
- Preserve keyboard access, accessible names, focus behavior, and loading/error
  feedback. Motion follows the existing reduced-motion configuration; CSS animation
  must also respect the user's reduced-motion preference.

For atom changes, use the installed [Jotai skill](../.agents/skills/jotai/SKILL.md)
with the installed package version. Generic React skills apply where compatible
with TanStack Start; Next.js-specific APIs and RSC assumptions do not apply here.
There is currently no Paraglide setup or dedicated preview system. See
[testing](testing.md) for interaction and visual validation.

## Authentication

`modules/auth` owns sign-in and account UI; `lib/auth` owns the client, session
query, and server function. The authenticated layout guards protected routes;
shared UI remains independent of this flow. Read [auth setup](../docs/auth-setup.md)
when changing routes, cookies, origins, or sign-in behavior.

Validate sessions at the backend, append every refreshed Set-Cookie, and keep
identity-dependent responses private/no-store. Treat 401 as anonymous and propagate
service failures. Use fresh session queries in guards and clear user data and
route caches after successful identity changes.
