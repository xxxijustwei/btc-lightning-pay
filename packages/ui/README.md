# Shared UI

`@btc-lightning-pay/ui` is the shared Lobe UI entry for the current frontend and future frontend apps. It owns the Lobe dependency versions, exported components, CSS and `UIProvider`. Routing, Query caches and Jotai stores belong to each app.

## Use in another frontend

1. Add `"@btc-lightning-pay/ui": "workspace:*"` to the app's dependencies. The app supplies React 19 and React DOM 19 using the workspace catalog.
2. Import the shared stylesheet **before Tailwind**, so the declared cascade order keeps Tailwind's reset below Lobe component styles:

   ```css
   @import "@btc-lightning-pay/ui/styles.css";
   @import "tailwindcss";
   ```

3. Apply the shared theme attributes on the server-rendered document and wrap the application content:

   ```tsx
   import { Button, UIProvider, uiThemeAttributes } from "@btc-lightning-pay/ui";

   <html lang="zh-CN" {...uiThemeAttributes}>
     <head>{/* Framework head and stylesheet links */}</head>
     <body>
       <UIProvider>
         <Button type="primary">继续</Button>
       </UIProvider>
       {/* Framework scripts */}
     </body>
   </html>;
   ```

The default is a light theme with the library's default primary color and slate neutral colors. Static HTML attributes keep SSR and hydration consistent without a theme script. `UIProvider` supplies Lobe's motion runtime, respects reduced-motion preferences and disables automatic remote font loading. It does not share application state between apps.

The package exports TypeScript source; consuming apps bundle it. CSS is marked as a side effect. Add named component exports here as they are needed, keeping the upstream component API rather than wrapping every component. Full Lobe styles are currently included so exported components share a consistent style entry.

## Adding components

Follow the official [Lobe UI skill](https://ui.lobehub.com/skills.md): read the linked component reference before adding imports or props. If a reference is unavailable, consult the matching source documentation in the [official repository](https://github.com/lobehub/lobe-ui). The current integration uses the [v6 setup](https://github.com/lobehub/lobe-ui/blob/master/docs/migration-v6.mdx), [Button](https://github.com/lobehub/lobe-ui/blob/master/src/Button/index.mdx), [Block](https://github.com/lobehub/lobe-ui/blob/master/src/Block/index.mdx) and [ConfigProvider](https://github.com/lobehub/lobe-ui/blob/master/src/ConfigProvider/index.mdx) references.

Use Lobe's documented CSS variables, classes and slots for styling. Do not target generated StyleX class names or add Ant Design providers.

## Known upstream peer warning

Lobe UI 6.16.1 requires React 19 but includes `@emoji-mart/react@1.1.1`, whose React peer range only declares React 16–18. This warning remains visible; the workspace does not override it. The shared package does not expose an emoji picker. Verify that feature separately before adding it, or update when upstream resolves the peer declaration.
