import type { ButtonHTMLAttributes } from 'react';
import { btn } from '../kit';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  variant?: 'primary' | 'neutral' | 'outline' | 'ghost' | 'danger' | 'soft';
}

export function Button({ loading, variant = 'primary', children, disabled, className, onClick, ...props }: ButtonProps) {
  const size = className?.split(/\s+/).includes('btn-sm') ? 'sm' : className?.split(/\s+/).includes('btn-lg') ? 'lg' : 'md';
  const look = btn(variant === 'neutral' ? 'primary' : variant, size);
  const classes = ['btn', `btn-${variant}`, 'relative', look, className].filter(Boolean).join(' ');

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
