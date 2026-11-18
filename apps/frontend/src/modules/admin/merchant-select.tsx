import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@btc-lightning-pay/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { allMerchantsQuery } from "./queries";

const ALL = "all";

/** Merchant filter shown as "名称 · /slug"; `undefined` means all merchants. */
export function MerchantSelect({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (merchantId: string | undefined) => void;
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
      onValueChange={(next) => onChange(!next || next === ALL ? undefined : String(next))}
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

/** Map of merchant id → display name, for tables that only carry the UUID. */
export function useMerchantNames() {
  const merchants = useQuery(allMerchantsQuery());
  return new Map((merchants.data ?? []).map((merchant) => [merchant.id, merchant]));
}
