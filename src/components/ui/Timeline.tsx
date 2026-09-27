import type { ReactNode } from 'react';

export interface TimelineEntry {
  id: string;
  title: ReactNode;
  meta?: ReactNode;
  text?: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'danger';
}

/** Activity trail for tickets, audit events and incident history. */
export function Timeline({ items }: { items: TimelineEntry[] }) {
  if (items.length === 0) {
    return <p className="data-table-secondary">No activity recorded.</p>;
  }

  return (
    <ol className="timeline">
      {items.map((item) => (
        <li className="timeline-item" key={item.id}>
          <span
            className={`timeline-dot${item.tone && item.tone !== 'neutral' ? ` is-${item.tone}` : ''}`}
            aria-hidden="true"
          />
          <div className="timeline-body">
            <p className="timeline-title">{item.title}</p>
            {item.meta && <p className="timeline-meta">{item.meta}</p>}
            {item.text && <p className="timeline-text">{item.text}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
