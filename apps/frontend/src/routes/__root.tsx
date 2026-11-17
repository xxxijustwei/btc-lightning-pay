import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { Provider } from "jotai";
import { UIProvider } from "../providers/ui";
import { NuqsAdapter } from "nuqs/adapters/tanstack-router";
import type { ReactNode } from "react";
import stylesheet from "../styles.css?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "BTC Lightning Pay" },
    ],
    links: [{ rel: "stylesheet", href: stylesheet }],
  }),
  shellComponent: RootDocument,
  component: () => (
    <Provider>
      <UIProvider>
        <NuqsAdapter>
          <Outlet />
        </NuqsAdapter>
      </UIProvider>
    </Provider>
  ),
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" data-theme="light" data-neutral-color="slate">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
