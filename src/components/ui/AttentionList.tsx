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

const DOT: Record<AttentionTone, string> = {
  danger: 'bg-danger', warning: 'bg-warn', info: 'bg-brand', ok: 'bg-success', muted: 'bg-ink-3',
};

/**
 * A queue of things that need a decision.
 *
 * Each row carries its own action, so the screen answers "what do I do about
 * this" in the same place it says "this is wrong". Deliberately dense: a queue
 * of six should be readable without scrolling.
 */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  return (
    <ul className="m-0 list-none divide-y divide-line p-0">
      {items.map((item) => (
        <li className={`flex items-start gap-3 py-3 first:pt-0 last:pb-0`} key={item.id}>
          <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[item.tone]}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-medium text-ink">{item.title}</p>
            {item.meta && <p className="m-0 mt-0.5 text-[13px] text-ink-3">{item.meta}</p>}
          </div>
          {item.action && <div className="shrink-0">{item.action}</div>}
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
    <div className="flex items-start gap-3 rounded-lg bg-success-soft px-4 py-3 text-[13px] text-success-ink" role="status">
      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}
