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
  const classes = ['badge', `badge-${tone}`, className].filter(Boolean).join(' ');
  return (
    <span className={classes}>
      {dot && <span className="badge-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
