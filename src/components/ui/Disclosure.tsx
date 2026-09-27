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
    <details className="disclosure">
      <summary>{summary}</summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}
