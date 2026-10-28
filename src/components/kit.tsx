/**
 * Usetally POS design kit: the small set of building blocks every rebuilt screen
 * uses, so spacing, radius and colour stay identical across the app.
 *
 *  - canvas grey page, white cards (rounded-xl) sitting on grey trays
 *  - one confident blue for the primary action, everything else quiet
 *  - Figtree, tabular numerals for money
 */
import type { ReactNode, HTMLAttributes } from 'react';
import { Link } from 'react-router-dom';

export const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/** Button look as a class string, for <button>, <Link> and <a> alike. */
export function btn(variant: 'primary' | 'outline' | 'ghost' | 'danger' | 'soft' = 'primary', size: 'sm' | 'md' | 'lg' = 'md') {
  return cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold no-underline transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50',
    size === 'sm' && 'h-8 px-3 text-[13px]',
    size === 'md' && 'h-10 px-4 text-sm',
    size === 'lg' && 'h-12 px-5 text-[15px]',
    variant === 'primary' && 'bg-brand text-white hover:bg-brand-hover',
    variant === 'outline' && 'border border-line-strong bg-surface text-ink hover:bg-hover',
    variant === 'ghost' && 'bg-transparent text-ink-2 hover:bg-hover hover:text-ink',
    variant === 'soft' && 'bg-brand-soft text-brand-ink hover:bg-brand-soft/70',
    variant === 'danger' && 'bg-danger-soft text-danger hover:bg-danger-soft/70',
  );
}

export const inputClass = 'block h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15';

export function Page({ children, width = 'page', className }: { children: ReactNode; width?: 'page' | 'wide' | 'form'; className?: string }) {
  return (
    <div className={cn('mx-auto w-full px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8',
      width === 'page' && 'max-w-[1120px]', width === 'wide' && 'max-w-[1440px]', width === 'form' && 'max-w-[760px]', className)}>
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, eyebrow, actions }: { title: ReactNode; subtitle?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between lg:mb-8">
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="mb-1 text-[13px] font-medium text-ink-3">{eyebrow}</p>}
        <h1 className="m-0 text-2xl font-semibold leading-8 tracking-tight text-ink lg:text-[28px] lg:leading-9">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className, padded = true, ...rest }: { children: ReactNode; className?: string; padded?: boolean } & HTMLAttributes<HTMLElement>) {
  return <section className={cn('min-w-0 rounded-xl border border-line bg-surface shadow-card', padded && 'p-5', className)} {...rest}>{children}</section>;
}

export function CardHead({ title, hint, action }: { title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="m-0 text-[15px] font-semibold leading-[22px] text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-[13px] text-ink-3">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'warn' | 'danger' | 'success' }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <p className="m-0 text-[13px] font-medium text-ink-2">{label}</p>
      <p className={cn('m-0 mt-2 truncate text-[22px] font-semibold tabular-nums leading-7 text-ink sm:text-2xl',
        tone === 'warn' && 'text-warn-ink', tone === 'danger' && 'text-danger', tone === 'success' && 'text-success-ink')}>{value}</p>
      {hint && <p className="m-0 mt-1 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'brand' | 'success' | 'warn' | 'danger' }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-medium',
      tone === 'neutral' && 'bg-tray text-ink-2', tone === 'brand' && 'bg-brand-soft text-brand-ink',
      tone === 'success' && 'bg-success-soft text-success-ink', tone === 'warn' && 'bg-warn-soft text-warn-ink',
      tone === 'danger' && 'bg-danger-soft text-danger')}>{children}</span>
  );
}

export function Empty({ title, body, action }: { title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
      <p className="m-0 text-[15px] font-semibold text-ink">{title}</p>
      {body && <p className="m-0 mt-1 max-w-sm text-sm text-ink-2">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  return <span aria-hidden="true" className={cn('inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-sm font-semibold text-brand-ink', className)}>{letters}</span>;
}

export function RowLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return <Link to={to} className={cn('flex items-center gap-3 px-4 py-3 text-inherit no-underline transition-colors hover:bg-subtle sm:px-5', className)}>{children}</Link>;
}
