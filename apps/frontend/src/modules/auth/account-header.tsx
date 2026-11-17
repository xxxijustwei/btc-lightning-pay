import type { AuthUser } from "@btc-lightning-pay/api";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { Alert, AlertDescription } from "@btc-lightning-pay/ui/components/alert";
import { Button } from "@btc-lightning-pay/ui/components/button";
import { Spinner } from "@btc-lightning-pay/ui/components/spinner";
import { authClient } from "../../lib/auth/client";

export function AccountHeader({ user }: { user: typeof AuthUser.Type }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function signOut() {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError(false);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setError(true);
        return;
      }
      await queryClient.cancelQueries();
      queryClient.clear();
      router.clearCache();
      await router.navigate({ to: "/sign-in", replace: true });
    } catch {
      setError(true);
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <header className="border-b">
      <div className="mx-auto flex min-h-20 max-w-2xl items-center justify-between gap-4 px-6 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground" title={user.email}>
            {user.email}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={pending}
          aria-busy={pending}
          onClick={() => void signOut()}
        >
          {pending ? (
            <Spinner aria-hidden="true" className="motion-reduce:animate-none" />
          ) : (
            <LogOut aria-hidden="true" />
          )}
          {pending ? "正在退出…" : "退出登录"}
        </Button>
      </div>
      {error && (
        <Alert variant="destructive" className="mx-auto mb-3 max-w-sm">
          <AlertDescription>退出失败，请稍后重试。</AlertDescription>
        </Alert>
      )}
    </header>
  );
}
