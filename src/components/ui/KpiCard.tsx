import type { ReactNode } from 'react';

interface KpiCardProps {
  label: string;
  /** Already formatted. Pass a string like "Not configured" when there is no value. */
  value: ReactNode;
  foot?: ReactNode;
  tone?: 'default' | 'brand' | 'warning' | 'danger' | 'unavailable';
  /**
   * Makes the card a control that opens the filtered view it summarises.
   * A metric that leads nowhere is decoration.
   */
  onClick?: () => void;
  ariaLabel?: string;
}

export function KpiCard({ label, value, foot, tone = 'default', onClick, ariaLabel }: KpiCardProps) {
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
      <p className="kpi-label">{label}</p>
      <p className="kpi-value">{value}</p>
      {foot && <p className="kpi-foot">{foot}</p>}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick} aria-label={ariaLabel ?? label}>
        {content}
      </button>
    );
  }

  return <div className={classes}>{content}</div>;
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="kpi-grid">{children}</div>;
}
