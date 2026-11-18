import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@btc-lightning-pay/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { shortId } from "../../lib/format";
import { allMerchantsQuery } from "./queries";

const ALL = "all";

/** Merchant filter shown as "名称 · /slug"; `null` means all merchants. */
export function MerchantSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (merchantId: string | null) => void;
}) {
  const merchants = useQuery(allMerchantsQuery());
  const items = [
    { value: ALL, label: "全部商户" },
    ...(merchants.data ?? []).map((merchant) => ({
      value: merchant.id,
      label: `${merchant.name} · /${merchant.slug}`,
    })),
  ];
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next) => onChange(!next || next === ALL ? null : String(next))}
      items={items}
    >
      <SelectTrigger size="sm" className="min-w-44" aria-label="商户">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Map of merchant id → merchant, for screens that only carry the UUID. */
export function useMerchantNames() {
  const merchants = useQuery(allMerchantsQuery());
  return new Map((merchants.data ?? []).map((merchant) => [merchant.id, merchant]));
}

/** Table cell that shows a merchant's name for its UUID, linking to the merchant. */
export function MerchantCell({ merchantId }: { merchantId: string }) {
  const merchant = useMerchantNames().get(merchantId);
  return merchant ? (
    <Link
      to="/merchants/$merchantId"
      params={{ merchantId }}
      className="underline-offset-4 hover:underline"
    >
      {merchant.name}
    </Link>
  ) : (
    <span className="font-mono text-muted-foreground">{shortId(merchantId)}</span>
  );
}
