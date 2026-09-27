import type { ReactNode } from 'react';
import { AlertIcon } from '../icons';

export type StateVariant = 'empty' | 'error' | 'denied' | 'unavailable';

interface StateBlockProps {
  variant?: StateVariant;
  title: string;
  body?: ReactNode;
  actions?: ReactNode;
  centred?: boolean;
}

/**
 * One component for the four ways a panel can legitimately have nothing to show.
 *
 * `unavailable` is deliberate: when a capability is not configured or not
 * instrumented, the honest answer is "Not configured", not a zero that looks like
 * a healthy measurement.
 */
export function StateBlock({ variant = 'empty', title, body, actions, centred }: StateBlockProps) {
  const classes = ['state-block', `state-${variant}`, centred ? 'is-centred' : ''].filter(Boolean).join(' ');
  return (
    <div className={classes}>
      {(variant === 'error' || variant === 'denied' || variant === 'unavailable') && (
        <span className="state-icon" aria-hidden="true">
          <AlertIcon width={18} height={18} />
        </span>
      )}
      <p className="state-title">{title}</p>
      {body && <p className="state-body">{body}</p>}
      {actions && <div className="state-actions">{actions}</div>}
    </div>
  );
}

interface SectionStateProps {
  loading?: boolean;
  error?: string | null;
  /** Rendered instead of `children` when the data source is absent. */
  unavailable?: string | null;
  empty?: boolean;
  emptyTitle?: string;
  emptyBody?: ReactNode;
  onRetry?: () => void;
  children: ReactNode;
}

/**
 * The loading / error / unavailable / empty ladder, wrapped so a section cannot
 * accidentally skip a state. Loading uses geometry-preserving skeletons.
 */
export function SectionState({
  loading,
  error,
  unavailable,
  empty,
  emptyTitle = 'Nothing here yet',
  emptyBody,
  onRetry,
  children,
}: SectionStateProps) {
  if (loading) {
    return (
      <div className="skeleton-inline" role="status" aria-label="Loading">
        <span className="skeleton skeleton-text" />
        <span className="skeleton skeleton-text" />
        <span className="skeleton skeleton-text is-short" />
      </div>
    );
  }

  if (error) {
    return (
      <StateBlock
        variant="error"
        title="Could not load this"
        body={error}
        actions={
          onRetry && (
            <button type="button" className="btn btn-outline btn-sm" onClick={onRetry}>
              <span className="btn-label">Try again</span>
            </button>
          )
        }
      />
    );
  }

  if (unavailable) {
    return <StateBlock variant="unavailable" title="Not configured" body={unavailable} />;
  }

  if (empty) {
    return <StateBlock variant="empty" title={emptyTitle} body={emptyBody} />;
  }

  return <>{children}</>;
}
