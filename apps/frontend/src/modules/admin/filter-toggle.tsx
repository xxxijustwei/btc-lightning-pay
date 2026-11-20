import { ToggleGroup, ToggleGroupItem } from "@btc-lightning-pay/ui/components/toggle-group";

/**
 * Single-choice list filter with an "all" choice first. Choosing "all" reports `null`, which
 * removes the filter from the URL.
 */
export function FilterToggle<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  /** Accessible name of the group. */
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T | null) => void;
}) {
  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      spacing={0}
      aria-label={label}
      value={[value ?? "all"]}
      onValueChange={(values) => {
        const next = values[0] as T | "all" | undefined;
        // Pressing the active item again would clear the group; keep the current choice.
        if (next) onChange(next === "all" ? null : next);
      }}
    >
      <ToggleGroupItem value="all">全部</ToggleGroupItem>
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
