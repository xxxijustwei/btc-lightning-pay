import type { AuthUser } from "@btc-lightning-pay/api";
import { Button } from "@btc-lightning-pay/ui/components/button";
import { Spinner } from "@btc-lightning-pay/ui/components/spinner";
import { LogOut } from "lucide-react";
import { useSignOut } from "../../lib/auth/use-sign-out";

/** Signed-in admin and the sign-out action, shown at the bottom of the sidebar. */
export function AccountMenu({ user }: { user: typeof AuthUser.Type }) {
  const { signOut, pending, error } = useSignOut();
  return (
    <>
      <div className="flex items-center gap-2 p-2">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-medium"
        >
          {user.name.slice(0, 1)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-sm font-medium">{user.name}</span>
          <span className="truncate text-xs text-muted-foreground" title={user.email}>
            {user.email}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="退出登录"
          title="退出登录"
          disabled={pending}
          aria-busy={pending}
          onClick={() => void signOut()}
        >
          {pending ? (
            <Spinner aria-hidden="true" className="motion-reduce:animate-none" />
          ) : (
            <LogOut aria-hidden="true" />
          )}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="px-2 pb-2 text-xs text-destructive">
          退出失败，请稍后重试。
        </p>
      ) : null}
    </>
  );
}
