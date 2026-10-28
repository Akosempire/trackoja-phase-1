import type { ReactNode } from 'react';

/**
 * Detail that is genuinely useful and genuinely not needed by default.
 *
 * The alternative — putting backend contracts and edge-case rules inline — is
 * what made these screens read as documentation rather than a console. Native
 * `<details>`, so it is keyboard operable and costs no JavaScript.
 */
export function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group min-w-0 rounded-lg border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-3 text-[13px] font-semibold text-ink-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand [&::-webkit-details-marker]:hidden">
        <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          className="shrink-0 text-ink-3 transition-transform group-open:rotate-90"><path d="m6 4 4 4-4 4" /></svg>
        <span className="min-w-0">{summary}</span>
      </summary>
      <div className="min-w-0 border-t border-line px-4 py-3 text-[13px] text-ink-2 [&>*+*]:mt-3">{children}</div>
    </details>
  );
}
