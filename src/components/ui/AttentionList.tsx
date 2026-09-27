import type { ReactNode } from 'react';

export type AttentionTone = 'danger' | 'warning' | 'info' | 'ok' | 'muted';

export interface AttentionItem {
  id: string;
  tone: AttentionTone;
  /** What is wrong, in a few words. */
  title: ReactNode;
  /** The context needed to judge it: counts, time range, names. */
  meta?: ReactNode;
  /** What the operator can do about it. */
  action?: ReactNode;
}

/**
 * A queue of things that need a decision.
 *
 * Each row carries its own action, so the screen answers "what do I do about
 * this" in the same place it says "this is wrong". Deliberately dense: a queue
 * of six should be readable without scrolling.
 */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  return (
    <ul className="attention-list">
      {items.map((item) => (
        <li className={`attention-item is-${item.tone}`} key={item.id}>
          <span className="attention-dot" aria-hidden="true" />
          <div className="attention-body">
            <p className="attention-title">{item.title}</p>
            {item.meta && <p className="attention-meta">{item.meta}</p>}
          </div>
          {item.action && <div className="attention-action">{item.action}</div>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Shown in place of the queue when nothing needs attention.
 *
 * One line rather than a large empty panel: an oversized empty state reads as
 * missing information, and this one is genuinely good news.
 */
export function HealthyStrip({ children }: { children: ReactNode }) {
  return (
    <div className="healthy-strip" role="status">
      <span className="attention-dot" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
