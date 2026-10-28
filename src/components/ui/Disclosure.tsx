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
    <details className="disclosure group rounded-lg border border-line bg-surface">
      <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-semibold text-ink-2 hover:text-ink">{summary}</summary>
      <div className="disclosure-body border-t border-line px-4 py-3 text-[13px] text-ink-2">{children}</div>
    </details>
  );
}
