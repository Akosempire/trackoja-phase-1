import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { PlatformArea } from '../../config/platformAreas';
import { Button } from '../ui/Button';
import { Disclosure } from '../ui/Disclosure';

interface PlatformPageHeadProps {
  area: PlatformArea;
  /** Overrides the area description with something screen-specific. */
  description?: ReactNode;
  /** An extra breadcrumb segment, e.g. a business name. */
  parent?: { label: string; to: string };
  current?: string;
  actions?: ReactNode;
}

/**
 * One header shape for every platform screen: where you are, what the screen is
 * for, and the actions that apply to the whole area.
 *
 * The breadcrumb only appears for a detail view. On a top-level area it would
 * read "Platform / Platform settings" above a heading that already says
 * "Platform settings", which is text spent saying nothing.
 */
export function PlatformPageHead({ area, description, parent, current, actions }: PlatformPageHeadProps) {
  return (
    <div className="plat-page-head">
      <div className="plat-page-head-text">
        {parent && (
          <nav className="plat-breadcrumb" aria-label="Breadcrumb">
            <Link to="/platform">Platform</Link>
            <span aria-hidden="true">/</span>
            <Link to={parent.to}>{parent.label}</Link>
            <span aria-hidden="true">/</span>
            <span>{current ?? area.label}</span>
          </nav>
        )}
        <h1 className="plat-page-title">{current ?? area.label}</h1>
        {description && <p className="plat-page-desc">{description}</p>}
      </div>
      {actions && <div className="plat-page-actions">{actions}</div>}
    </div>
  );
}

/**
 * States plainly which parts of an area the backend cannot serve yet.
 *
 * Collapsed by default. The fact that something is missing stays visible in the
 * summary, and the detail is one click away — a warning box listing every gap
 * competed with the data it sat above, and the areas that lack a capability
 * already say `Not configured` where the capability would have been.
 */
export function AreaCoverage({ gaps, title = 'Not built here' }: { gaps?: string[]; title?: string }) {
  if (!gaps || gaps.length === 0) return null;
  return (
    <Disclosure summary={`${title} (${gaps.length})`}>
      <ul className="plat-coverage-list">
        {gaps.map((gap) => (
          <li key={gap}>{gap}</li>
        ))}
      </ul>
    </Disclosure>
  );
}

/** Shown when an operator reaches a screen their permissions do not cover. */
export function PermissionDenied({ what, permission }: { what: string; permission: string }) {
  return (
    <div className="state-block state-denied">
      <span className="state-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <rect x="4" y="10" width="16" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      </span>
      <p className="state-title">You do not have access to {what}</p>
      <p className="state-body">
        This needs the <span className="mono">{permission}</span> permission. A platform owner can grant it from
        Users &amp; roles. The server refuses this data regardless of what the interface shows, so nothing is
        exposed by reaching this page.
      </p>
      <div className="state-actions">
        <Link className="btn btn-outline btn-sm" to="/platform">
          <span className="btn-label">Back to overview</span>
        </Link>
      </div>
    </div>
  );
}

/** Standard refresh control, used by most read-only panels. */
export function RefreshButton({ onClick, loading }: { onClick: () => void; loading?: boolean }) {
  return (
    <Button variant="ghost" className="btn-sm" onClick={onClick} loading={loading}>
      Refresh
    </Button>
  );
}
