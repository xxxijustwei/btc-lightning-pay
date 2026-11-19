import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { UnavailableScreen } from "../modules/payment/unavailable-screen";
import stylesheet from "../styles.css?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  headers: () => ({ "cache-control": "no-store", "referrer-policy": "no-referrer" }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "robots", content: "noindex" },
      { title: "Lightning Payment" },
    ],
    links: [
      { rel: "stylesheet", href: stylesheet },
      { rel: "icon", type: "image/png", href: "/payment-logo.png" },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: () => <UnavailableScreen variant="notfound" />,
  component: Outlet,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-white text-pay-ink antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
