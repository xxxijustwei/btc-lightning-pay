import { useRouter } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle } from "@btc-lightning-pay/ui/components/alert";
import { Button } from "@btc-lightning-pay/ui/components/button";

export function AuthError() {
  const router = useRouter();
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-5 px-6">
      <Alert variant="destructive">
        <AlertTitle>暂时无法读取登录状态</AlertTitle>
        <AlertDescription>登录服务暂时不可用，请稍后重试。</AlertDescription>
      </Alert>
      <Button onClick={() => void router.invalidate()}>重新尝试</Button>
    </main>
  );
}
