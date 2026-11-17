import {
  createRootRouteWithContext,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { Provider } from "jotai";
import { MotionConfig } from "motion/react";
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
  notFoundComponent: () => (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-16">
      <h1 className="text-3xl font-semibold">页面不存在</h1>
      <p className="mt-4 text-muted-foreground">请检查地址，或返回首页继续。</p>
      <Link to="/" className="mt-6 self-start underline underline-offset-4">
        返回首页
      </Link>
    </main>
  ),
  component: () => (
    <Provider>
      <MotionConfig reducedMotion="user">
        <NuqsAdapter>
          <Outlet />
        </NuqsAdapter>
      </MotionConfig>
    </Provider>
  ),
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
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
