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

/**
 * Categorical comparison, and usage against a limit. Reads faster than a pie and
 * needs no legend, and unlike the ad-hoc bars it replaced it is entirely
 * token-driven.
 */
export function MeterList({ items, max }: { items: MeterItem[]; max?: number }) {
  const peak = max ?? Math.max(1, ...items.map((item) => item.max ?? item.value));

  return (
    <div className="meter-list">
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
          <div className="meter-row" key={item.id ?? item.label}>
            <span className="meter-label">{item.label}</span>
            <span className="meter-value">{item.display ?? item.value.toLocaleString()}</span>
            <span className="meter-track">
              <span
                className={`meter-fill${tone !== 'accent' ? ` meter-tone-${tone}` : ''}`}
                style={{ width: `${Math.round(share * 100)}%` }}
              />
            </span>
            {item.detail && <span className="meter-value">{item.detail}</span>}
          </div>
        );
      })}
    </div>
  );
}
