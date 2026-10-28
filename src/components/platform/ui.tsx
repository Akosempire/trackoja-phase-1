/**
 * Small building blocks shared by the platform console screens, on top of the
 * Usetally kit. They exist so twelve operator screens use one spacing, one
 * field shape and one notice shape instead of re-deriving them per area.
 */
import type { HTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn, inputClass } from '../kit';

export const selectClass = cn(inputClass, 'cursor-pointer pr-8');
export const textareaClass = 'block min-h-24 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15';
export const labelClass = 'text-[13px] font-medium text-ink-2';
export const hintClass = 'text-xs text-ink-3';
export const monoClass = 'font-mono text-[12px] tracking-tight';
/** A plain text link inside running copy or a table cell. */
export const linkClass = 'font-medium text-brand-ink no-underline hover:underline';
/** Secondary line under a table cell's primary value. */
export const subClass = 'block text-xs text-ink-3';

/** A label/control pair for selects, textareas and other non-FormField controls. */
export function Field({ label, htmlFor, hint, error, children, className }: {
  label: ReactNode; htmlFor?: string; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <div className={cn('mb-4 flex min-w-0 flex-col gap-1.5', className)}>
      <label className={labelClass} htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="text-xs text-danger" role="alert">{error}</span> : hint ? <span className={hintClass}>{hint}</span> : null}
    </div>
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(selectClass, className)} {...props} />;
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(textareaClass, className)} {...props} />;
}

type NoticeTone = 'info' | 'warn' | 'danger' | 'success' | 'neutral';
const NOTICE_TONE: Record<NoticeTone, string> = {
  info: 'border-brand-line bg-brand-soft/60 text-ink',
  warn: 'border-warn/30 bg-warn-soft text-ink',
  danger: 'border-danger/30 bg-danger-soft text-ink',
  success: 'border-success/30 bg-success-soft text-ink',
  neutral: 'border-line bg-subtle text-ink',
};
const NOTICE_DOT: Record<NoticeTone, string> = {
  info: 'bg-brand', warn: 'bg-warn', danger: 'bg-danger', success: 'bg-success', neutral: 'bg-ink-3',
};

/** An inline message: partial data, a warning before an action, a result. */
export function Notice({ tone = 'info', title, children, action, className, ...rest }: {
  tone?: NoticeTone; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, 'title'>) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-lg border px-4 py-3 text-[13px] leading-5 sm:flex-row sm:items-start', NOTICE_TONE[tone], className)} {...rest}>
      <span className={cn('mt-1.5 hidden size-2 shrink-0 rounded-full sm:block', NOTICE_DOT[tone])} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <p className="m-0 text-sm font-semibold text-ink">{title}</p>}
        {children && <div className={cn('text-ink-2 [&_p]:m-0', Boolean(title) && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
  );
}

/** Placeholder lines while a panel loads; geometry-preserving rather than a spinner. */
export function SkeletonLines({ count = 3, label = 'Loading' }: { count?: number; label?: string }) {
  return (
    <div className="space-y-2.5 py-1" role="status" aria-label={label}>
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={cn('block h-3.5 animate-pulse rounded bg-tray', index === count - 1 && count > 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

/** A grid of filter controls above a table; collapses to one column on phones. */
export function FilterGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-1 gap-x-3 sm:grid-cols-2 lg:grid-cols-4 [&>*]:mb-3', className)}>{children}</div>;
}

/** Vertical rhythm for a screen's sections. */
export function Stack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex min-w-0 flex-col gap-4 lg:gap-6', className)}>{children}</div>;
}

/** A bulleted list in body copy (gaps, rules, consequences). */
export function BulletList({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <ul className={cn('m-0 list-disc space-y-1 pl-5 text-[13px] text-ink-2 marker:text-ink-3', className)}>
      {items.map((item, index) => <li key={index}>{item}</li>)}
    </ul>
  );
}

/** White card surface, as a class for elements that are not a kit <Card>. */
export const cardClass = 'min-w-0 rounded-xl border border-line bg-surface p-5 shadow-card';

/**
 * `tableInset` normalises DataTable headers and its stacked phone layout;
 * `tableBleed` also handles a DataTable that sits inside a padded card: on wide screens the table
 * bleeds to the card edges with the first and last columns re-padded; below
 * 900px, where DataTable stacks rows into labelled cards, it keeps the padding.
 */
export const tableInset = `min-w-0 [&_th]:normal-case [&_th]:tracking-normal [&_th]:text-xs [&_th]:font-medium [&_th]:text-ink-2 max-[900px]:[&_td]:grid max-[900px]:[&_td]:grid-cols-[40%_minmax(0,1fr)] max-[900px]:[&_td]:gap-x-4 max-[900px]:[&_td]:gap-y-0.5 max-[900px]:[&_td]:text-right max-[900px]:[&_td>*]:col-start-2 max-[900px]:[&_td>*]:justify-self-end max-[900px]:[&_td[data-label='']]:block max-[900px]:[&_td[data-label='']]:text-left max-[900px]:[&_td[data-label='']>*]:justify-self-start max-[900px]:[&_td]:px-0 max-[900px]:[&_td]:py-1.5 max-[900px]:[&_td::before]:text-left max-[900px]:[&_td::before]:text-[13px] max-[900px]:[&_td::before]:font-normal max-[900px]:[&_td::before]:text-ink-3`;
export const tableBleed = `${tableInset} min-[901px]:-mx-5 min-[901px]:[&_td]:px-3 min-[901px]:[&_th]:px-3 min-[901px]:[&_td:first-child]:pl-5 min-[901px]:[&_th:first-child]:pl-5 min-[901px]:[&_td:last-child]:pr-5 min-[901px]:[&_th:last-child]:pr-5`;

/** A pill-shaped filter toggle; pressed state comes from aria-pressed. */
export const chipClass = 'inline-flex h-8 shrink-0 items-center rounded-full border border-line-strong bg-surface px-3.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-surface';

/** Monospace block for payloads and SQL-free diagnostics. */
export const codePanelClass = 'm-0 max-h-[360px] min-w-0 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-subtle p-3 font-mono text-xs leading-5 text-ink-2 [overflow-wrap:anywhere]';
