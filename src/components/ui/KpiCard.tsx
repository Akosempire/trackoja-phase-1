import type { ReactNode } from 'react';

interface KpiCardProps {
  label: string;
  /** Already formatted. Pass a string like "Not configured" when there is no value. */
  value: ReactNode;
  foot?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'brand' | 'warning' | 'danger' | 'unavailable';
  /**
   * Makes the card a control that opens the filtered view it summarises.
   * A metric that leads nowhere is decoration.
   */
  onClick?: () => void;
  ariaLabel?: string;
}

export function KpiCard({
  label,
  value,
  foot,
  icon,
  tone = 'default',
  onClick,
  ariaLabel,
}: KpiCardProps) {
  const classes = [
    'kpi-card',
    tone === 'brand' ? 'is-brand' : '',
    tone === 'warning' ? 'is-warning' : '',
    tone === 'danger' ? 'is-danger' : '',
    tone === 'unavailable' ? 'is-unavailable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      <span className="kpi-head">
        <span className="kpi-label">{label}</span>
        {icon && (
          <span className="kpi-icon" aria-hidden="true">
            {icon}
          </span>
        )}
      </span>
      <span className="kpi-value">{value}</span>
      <span className="kpi-foot" aria-hidden={foot == null ? true : undefined}>{foot ?? '\u00a0'}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={classes}
        onClick={onClick}
        aria-label={ariaLabel ?? label}
      >
        {content}
      </button>
    );
  }

  return <div className={classes}>{content}</div>;
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="kpi-grid">{children}</div>;
}
