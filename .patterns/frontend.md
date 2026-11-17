# Frontend

Applies to `apps/frontend` and `packages/ui`.

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
