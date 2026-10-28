import type { ReactNode } from 'react';

export interface DefRow {
  term: string;
  value: ReactNode;
  /** Renders in muted text: used for "Not configured" and other honest absences. */
  muted?: boolean;
}

/**
 * A label/value list for detail panels. Narrower reading width than a table and
 * it survives narrow screens without a horizontal scroll.
 */
export function DefList({ rows, className }: { rows: DefRow[]; className?: string }) {
  return (
    <dl className={['def-list m-0 divide-y divide-line', className].filter(Boolean).join(' ')}>
      {rows.map((row) => (
        <div className="def-row flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 first:pt-0 last:pb-0" key={row.term}>
          <dt className="def-term text-[13px] text-ink-2">{row.term}</dt>
          <dd className={row.muted ? 'def-value is-muted m-0 text-sm text-ink-3' : 'def-value m-0 min-w-0 text-right text-sm font-medium text-ink'}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
