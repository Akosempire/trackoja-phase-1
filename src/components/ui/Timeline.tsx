import type { ReactNode } from 'react';

export interface TimelineEntry {
  id: string;
  title: ReactNode;
  meta?: ReactNode;
  text?: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'danger';
}

const DOT = { neutral: 'bg-ink-3', accent: 'bg-brand', success: 'bg-success', danger: 'bg-danger' } as const;

/** Activity trail for tickets, audit events and incident history. */
export function Timeline({ items }: { items: TimelineEntry[] }) {
  if (items.length === 0) {
    return <p className="m-0 text-[13px] text-ink-3">No activity recorded.</p>;
  }

  return (
    <ol className="m-0 list-none p-0">
      {items.map((item) => (
        <li className="relative flex gap-3 pb-4 last:pb-0 before:absolute before:bottom-0 before:left-[3.5px] before:top-4 before:w-px before:bg-line last:before:hidden" key={item.id}>
          <span
            className={`relative mt-1.5 size-2 shrink-0 rounded-full ring-4 ring-surface ${DOT[item.tone ?? 'neutral']}`}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="m-0 break-words text-sm font-medium text-ink">{item.title}</p>
            {item.meta && <p className="m-0 mt-0.5 break-words text-xs text-ink-3">{item.meta}</p>}
            {item.text && <p className="m-0 mt-1 break-words text-[13px] text-ink-2">{item.text}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
