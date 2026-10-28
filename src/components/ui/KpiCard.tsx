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
    'kpi-card flex min-w-0 flex-col rounded-xl border border-line bg-surface p-4 text-left shadow-card sm:p-5',
    onClick ? 'cursor-pointer transition-colors hover:border-line-strong' : '',
    tone === 'brand' ? 'is-brand' : '',
    tone === 'warning' ? 'is-warning' : '',
    tone === 'danger' ? 'is-danger' : '',
    tone === 'unavailable' ? 'is-unavailable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      <span className="kpi-head flex items-start justify-between gap-2">
        <span className="kpi-label text-[13px] font-medium text-ink-2">{label}</span>
        {icon && (
          <span className="kpi-icon text-ink-3" aria-hidden="true">
            {icon}
          </span>
        )}
      </span>
      <span className={`kpi-value mt-2 truncate text-[22px] font-semibold tabular-nums leading-7 sm:text-2xl ${tone === 'warning' ? 'text-warn-ink' : tone === 'danger' ? 'text-danger' : tone === 'unavailable' ? 'text-base text-ink-3' : tone === 'brand' ? 'text-brand-ink' : 'text-ink'}`}>{value}</span>
      <span className="kpi-foot mt-1 text-xs text-ink-3" aria-hidden={foot == null ? true : undefined}>{foot ?? '\u00a0'}</span>
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
  return <div className="kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">{children}</div>;
}
