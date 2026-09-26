import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  variant?: 'primary' | 'neutral' | 'outline' | 'ghost' | 'danger';
}

export function Button({ loading, variant = 'primary', children, disabled, className, ...props }: ButtonProps) {
  const classes = ['btn', `btn-${variant}`, className].filter(Boolean).join(' ');

  return (
    <button className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      <span className="btn-label">{children}</span>
      {loading && <span className="spinner btn-spinner" aria-hidden="true" />}
    </button>
  );
}
