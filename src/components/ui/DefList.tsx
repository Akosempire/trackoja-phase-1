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
    <dl className={['def-list', className].filter(Boolean).join(' ')}>
      {rows.map((row) => (
        <div className="def-row" key={row.term}>
          <dt className="def-term">{row.term}</dt>
          <dd className={row.muted ? 'def-value is-muted' : 'def-value'}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
