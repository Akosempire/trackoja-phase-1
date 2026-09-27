export interface MeterItem {
  label: string;
  value: number;
  /** Formatted value shown on the right. */
  display?: string;
  detail?: string;
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'muted';
}

/**
 * Categorical comparison. Reads faster than a pie and needs no legend, and
 * unlike the ad-hoc bars it replaced it is entirely token-driven.
 */
export function MeterList({ items, max }: { items: MeterItem[]; max?: number }) {
  const peak = max ?? Math.max(1, ...items.map((item) => item.value));

  return (
    <div className="meter-list">
      {items.map((item) => {
        const share = Math.max(0, Math.min(1, item.value / peak));
        return (
          <div className="meter-row" key={item.label}>
            <span className="meter-label">{item.label}</span>
            <span className="meter-value">{item.display ?? item.value.toLocaleString()}</span>
            <span className="meter-track">
              <span
                className={`meter-fill${item.tone && item.tone !== 'accent' ? ` meter-tone-${item.tone}` : ''}`}
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
