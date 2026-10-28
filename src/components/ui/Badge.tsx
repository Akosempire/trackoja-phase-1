import type { ReactNode } from 'react';

export type BadgeTone =
  | 'neutral'
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'workspace'
  | 'outline';

interface BadgeProps {
  tone?: BadgeTone;
  /** Adds a filled dot, for statuses where colour alone should not carry meaning. */
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = 'neutral', dot, children, className }: BadgeProps) {
  const look: Record<BadgeTone, string> = {
    neutral: 'bg-tray text-ink-2', brand: 'bg-brand-soft text-brand-ink', success: 'bg-success-soft text-success-ink',
    warning: 'bg-warn-soft text-warn-ink', danger: 'bg-danger-soft text-danger', info: 'bg-brand-soft text-brand-ink',
    workspace: 'bg-tray text-ink', outline: 'border border-line-strong text-ink-2',
  };
  const classes = ['badge', `badge-${tone}`, 'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium', look[tone], className].filter(Boolean).join(' ');
  return (
    <span className={classes}>
      {dot && <span className="badge-dot size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}
