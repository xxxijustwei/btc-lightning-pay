import { Button } from "@btc-lightning-pay/ui/components/button";
import { Calendar } from "@btc-lightning-pay/ui/components/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@btc-lightning-pay/ui/components/popover";
import { format, parse } from "date-fns";
import { zhCN } from "date-fns/locale";
import { CalendarIcon, X } from "lucide-react";

const DAY = "yyyy-MM-dd";
const toDate = (day: string | null) => (day ? parse(day, DAY, new Date()) : undefined);

/**
 * Picks an inclusive range of calendar days (`yyyy-MM-dd`). Callers convert the days
 * to Beijing-time instants; the picker itself never deals with time zones.
 */
export function DateRangePicker({
  from,
  to,
  onChange,
  label = "日期范围",
  showLabel = false,
}: {
  from: string | null;
  to: string | null;
  onChange: (range: { from: string | null; to: string | null }) => void;
  label?: string;
  /** Show the label inside the trigger, e.g. 「生成时间：全部」. */
  showLabel?: boolean;
}) {
  const range = from ? (to && to !== from ? `${from} – ${to}` : from) : null;
  const text = showLabel ? `${label}：${range ?? "全部"}` : (range ?? "全部日期");
  return (
    <div className="flex items-center">
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              aria-label={showLabel ? text : `${label}：${text}`}
              className="font-normal"
            />
          }
        >
          <CalendarIcon
            data-icon="inline-start"
            aria-hidden="true"
            className="text-muted-foreground"
          />
          {text}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            locale={zhCN}
            numberOfMonths={2}
            defaultMonth={toDate(from)}
            selected={{ from: toDate(from), to: toDate(to) }}
            onSelect={(range) =>
              onChange({
                from: range?.from ? format(range.from, DAY) : null,
                to: range?.to
                  ? format(range.to, DAY)
                  : range?.from
                    ? format(range.from, DAY)
                    : null,
              })
            }
          />
        </PopoverContent>
      </Popover>
      {from ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="清除日期"
          onClick={() => onChange({ from: null, to: null })}
        >
          <X aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
