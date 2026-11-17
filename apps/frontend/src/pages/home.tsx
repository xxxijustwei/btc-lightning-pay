import { Health } from "@btc-lightning-pay/api";
import { Button } from "@btc-lightning-pay/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@btc-lightning-pay/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { Schema } from "effect";
import { RefreshCw } from "lucide-react";

export function Home() {
  const health = useQuery({
    queryKey: ["health"],
    enabled: false,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/health", {
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Schema.decodeUnknownSync(Health)(await response.json());
    },
  });
  let status = "尚未检查";
  if (health.isFetching) status = "正在连接后端…";
  else if (health.isError) status = "后端连接失败，请确认后端已启动后重试。";
  else if (health.isSuccess) status = "后端连接正常";

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-16">
      <p className="mb-3 text-sm font-medium text-primary">开发环境 · 工程骨架</p>
      <h1 className="text-4xl font-semibold tracking-tight">BTC Lightning Pay</h1>
      <p className="mt-5 leading-7 text-muted-foreground">
        前端与后端已独立组织。点击下方按钮检查服务连接。
      </p>
      <section aria-label="服务连接" className="mt-10">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>后端状态</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p role="status" className="mt-2 text-sm text-muted-foreground">
              {status}
            </p>
            <Button
              type="button"
              onClick={() => void health.refetch()}
              disabled={health.isFetching}
              aria-busy={health.isFetching}
              className="mt-5 self-start"
            >
              <RefreshCw
                aria-hidden="true"
                data-icon="inline-start"
                className={health.isFetching ? "motion-safe:animate-spin" : undefined}
              />
              {health.isFetching ? "检查中…" : "检查连接"}
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
