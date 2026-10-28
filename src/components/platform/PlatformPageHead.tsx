import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { PlatformArea } from '../../config/platformAreas';
import { Button } from '../ui/Button';
import { Disclosure } from '../ui/Disclosure';
import { LockIcon } from '../icons';
import { btn } from '../kit';
import { BulletList, monoClass } from './ui';

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
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      <div className="min-w-0 flex-1">
        {parent && (
          <nav className="mb-1.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] text-ink-3" aria-label="Breadcrumb">
            <Link className="text-ink-2 no-underline hover:text-ink hover:underline" to="/platform">Platform</Link>
            <span aria-hidden="true">/</span>
            <Link className="text-ink-2 no-underline hover:text-ink hover:underline" to={parent.to}>{parent.label}</Link>
            <span aria-hidden="true">/</span>
            <span className="min-w-0 truncate">{current ?? area.label}</span>
          </nav>
        )}
        <h1 className="m-0 break-words text-2xl font-semibold leading-8 tracking-tight text-ink lg:text-[28px] lg:leading-9">{current ?? area.label}</h1>
        {description && <p className="m-0 mt-1 text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
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
      <BulletList items={gaps} />
    </Disclosure>
  );
}

/** Shown when an operator reaches a screen their permissions do not cover. */
export function PermissionDenied({ what, permission }: { what: string; permission: string }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      <span className="mb-3 inline-flex size-10 items-center justify-center rounded-full bg-tray text-ink-2" aria-hidden="true">
        <LockIcon width={18} height={18} />
      </span>
      <p className="m-0 text-[15px] font-semibold text-ink">You do not have access to {what}</p>
      <p className="m-0 mt-1 max-w-sm text-sm text-ink-2">
        Ask a platform owner for the <span className={monoClass}>{permission}</span> permission.
      </p>
      <div className="mt-4">
        <Link className={btn('outline', 'sm')} to="/platform">Back to overview</Link>
      </div>
    </div>
  );
}

/** Standard refresh control, used by most read-only panels. */
export function RefreshButton({ onClick, loading }: { onClick: () => void; loading?: boolean }) {
  return (
    <Button variant="outline" className="btn-sm" onClick={onClick} loading={loading}>
      Refresh
    </Button>
  );
}
