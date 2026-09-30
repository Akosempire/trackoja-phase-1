import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  variant?: 'primary' | 'neutral' | 'outline' | 'ghost' | 'danger';
}

export function Button({ loading, variant = 'primary', children, disabled, className, onClick, ...props }: ButtonProps) {
  const classes = ['btn', `btn-${variant}`, className].filter(Boolean).join(' ');

  return (
    <button
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
      onClick={(event) => {
        // WebKit does not focus pointer-activated buttons. Focus before an action
        // opens a modal so native dialog.close() can restore its actual trigger.
        event.currentTarget.focus({ preventScroll: true });
        onClick?.(event);
      }}
    >
      <span className="btn-label">{children}</span>
      {loading && <span className="spinner btn-spinner" aria-hidden="true" />}
    </button>
  );
}
