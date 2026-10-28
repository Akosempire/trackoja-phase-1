export interface MeterItem {
  id?: string;
  label: string;
  value: number;
  /** Formatted value shown on the right. */
  display?: string;
  detail?: string;
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'muted';
  /**
   * A ceiling for this item's own bar, for usage-against-a-limit rather than a
   * comparison between items. Without it the bar is relative to the largest
   * value in the list, which would misrepresent "3 of 5 users" beside
   * "1 of 1 store".
   */
  max?: number;
  /** Fraction filled at or above which the bar turns amber, then red. */
  warnAt?: number;
  dangerAt?: number;
}

const FILL: Record<NonNullable<MeterItem['tone']>, string> = {
  accent: 'bg-brand', success: 'bg-success', warning: 'bg-warn', danger: 'bg-danger', muted: 'bg-ink-3',
};

/**
 * Categorical comparison, and usage against a limit. Reads faster than a pie and
 * needs no legend, and it is entirely token-driven.
 */
export function MeterList({ items, max }: { items: MeterItem[]; max?: number }) {
  const peak = max ?? Math.max(1, ...items.map((item) => item.max ?? item.value));

  return (
    <div className="flex flex-col gap-3.5">
      {items.map((item) => {
        const ceiling = item.max ?? peak;
        const share = ceiling > 0 ? Math.max(0, Math.min(1, item.value / ceiling)) : 0;
        const ratio = ceiling > 0 ? item.value / ceiling : 0;

        const tone =
          item.tone ??
          (item.dangerAt !== undefined && ratio >= item.dangerAt
            ? 'danger'
            : item.warnAt !== undefined && ratio >= item.warnAt
              ? 'warning'
              : 'accent');

        return (
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5" key={item.id ?? item.label}>
            <span className="min-w-0 truncate text-[13px] text-ink-2">{item.label}</span>
            <span className="text-right text-[13px] font-semibold tabular-nums text-ink">{item.display ?? item.value.toLocaleString()}</span>
            <span className="col-span-2 block h-2 overflow-hidden rounded-full bg-tray">
              <span
                className={`block h-full rounded-full ${FILL[tone]}`}
                style={{ width: `${Math.round(share * 100)}%` }}
              />
            </span>
            {item.detail && <span className="col-span-2 text-xs text-ink-3">{item.detail}</span>}
          </div>
        );
      })}
    </div>
  );
}
