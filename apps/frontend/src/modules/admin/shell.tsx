import type { AuthUser } from "@btc-lightning-pay/api";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@btc-lightning-pay/ui/components/breadcrumb";
import { Separator } from "@btc-lightning-pay/ui/components/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@btc-lightning-pay/ui/components/sidebar";
import { Toaster } from "@btc-lightning-pay/ui/components/toast";
import { TooltipProvider } from "@btc-lightning-pay/ui/components/tooltip";
import { Link, useMatchRoute } from "@tanstack/react-router";
import { Receipt, Store, Users, Wallet, Zap } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { AccountMenu } from "../auth/account-menu";

const nav = [
  { to: "/merchants", label: "商户", icon: Store },
  { to: "/orders", label: "订单", icon: Receipt },
  { to: "/settlements", label: "结算单", icon: Wallet },
  { to: "/accounts", label: "账号", icon: Users },
] as const;

export function AdminShell({
  user,
  children,
}: {
  user: typeof AuthUser.Type;
  children: ReactNode;
}) {
  const matchRoute = useMatchRoute();
  return (
    <TooltipProvider>
      <SidebarProvider>
        <Sidebar collapsible="offcanvas">
          <SidebarHeader>
            <div className="flex items-center gap-2 p-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Zap aria-hidden="true" className="size-4" />
              </span>
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-semibold">Lightning Pay</span>
                <span className="text-xs text-muted-foreground">平台管理</span>
              </div>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>管理</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {nav.map((item) => (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        isActive={Boolean(matchRoute({ to: item.to, fuzzy: true }))}
                        render={<Link to={item.to} />}
                      >
                        <item.icon aria-hidden="true" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <AccountMenu user={user} />
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
      <Toaster />
    </TooltipProvider>
  );
}

export type Crumb = { label: string; to?: string; params?: Record<string, string> };

/** Standard admin page: top bar with breadcrumb, then a centered content column. */
export function AdminPage({
  crumbs,
  title,
  description,
  actions,
  children,
}: {
  crumbs: Crumb[];
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-1 h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            {crumbs.map((crumb, index) => (
              <Fragment key={crumb.label}>
                {index > 0 ? <BreadcrumbSeparator /> : null}
                <BreadcrumbItem>
                  {crumb.to && index < crumbs.length - 1 ? (
                    <BreadcrumbLink
                      render={<Link to={crumb.to as never} params={crumb.params as never} />}
                    >
                      {crumb.label}
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      </header>
      <main className="flex-1 p-4 md:p-6">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-6">
          {title ? (
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  {typeof title === "string" ? (
                    <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
                  ) : (
                    title
                  )}
                </div>
                {description ? (
                  <div className="text-sm text-muted-foreground">{description}</div>
                ) : null}
              </div>
              {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
            </div>
          ) : null}
          {children}
        </div>
      </main>
    </>
  );
}
