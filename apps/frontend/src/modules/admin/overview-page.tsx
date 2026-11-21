import { Button } from "@btc-lightning-pay/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@btc-lightning-pay/ui/components/card";
import { Skeleton } from "@btc-lightning-pay/ui/components/skeleton";
import { Spinner } from "@btc-lightning-pay/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { formatSats } from "../../lib/format";
import { ErrorState, UsdApprox } from "./common";
import { walletQuery } from "./queries";
import { AdminPage } from "./shell";

export function OverviewPage() {
  const wallet = useQuery(walletQuery());
  return (
    <AdminPage crumbs={[{ label: "概览" }]} title="概览">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">钱包余额</CardTitle>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="刷新余额"
              disabled={wallet.isFetching}
              onClick={() => void wallet.refetch()}
            >
              {wallet.isFetching ? <Spinner /> : <RefreshCw aria-hidden="true" />}
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {wallet.isPending ? (
              <Skeleton className="h-9 w-48" />
            ) : wallet.isError ? (
              <ErrorState error={wallet.error} onRetry={() => void wallet.refetch()} />
            ) : (
              <>
                <span className="flex items-baseline gap-1.5 font-mono tabular-nums">
                  <span className="text-3xl font-semibold tracking-tight">
                    {formatSats(wallet.data.balanceSat)}
                  </span>
                  <span className="text-muted-foreground">sats</span>
                </span>
                <UsdApprox
                  sats={wallet.data.balanceSat}
                  className="font-medium text-muted-foreground tabular-nums"
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminPage>
  );
}
