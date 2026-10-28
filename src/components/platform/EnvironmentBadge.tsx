import type { EnvironmentInfo } from '../../config/environment';
import { cn } from '../kit';

// Production is the one environment where a mistake reaches customers, so it
// carries the loudest tone; the others are quieter but never invisible.
const TONE: Record<EnvironmentInfo['name'], string> = {
  production: 'bg-danger-soft text-danger',
  staging: 'bg-warn-soft text-warn-ink',
  development: 'bg-brand-soft text-brand-ink',
  unknown: 'bg-tray text-ink-2',
};

/** Compact marker for headers and sidebars. */
export function EnvironmentBadge({ environment }: { environment: EnvironmentInfo }) {
  return (
    <span
      className={cn('inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold', TONE[environment.name])}
      data-environment={environment.name}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {environment.label}
    </span>
  );
}

/**
 * The full marker: what environment this is, where that was determined from, and
 * what it means for the work being done. Deliberately not dismissible — an
 * operator should never be unsure which environment they are acting on.
 *
 * When the deployment and the database disagree about the environment, that is
 * reported here rather than resolved silently: a development build wired to the
 * production database is the case most worth shouting about.
 */
export function EnvironmentMarker({ environment }: { environment: EnvironmentInfo }) {
  const sourceNote =
    environment.source === 'setting'
      ? 'Declared by the platform setting.'
      : environment.source === 'build'
        ? 'Declared by this build.'
        : '';

  return (
    <div
      className={cn('rounded-lg border p-3', environment.mismatch ? 'border-danger/40 bg-danger-soft/50' : 'border-line bg-subtle')}
      role="status"
      data-environment={environment.name}
    >
      <EnvironmentBadge environment={environment} />
      <p className="m-0 mt-2 text-xs leading-[18px] text-ink-3">
        {environment.detail}
        {sourceNote ? ` ${sourceNote}` : ''}
      </p>
      {environment.mismatch && (
        <p className="m-0 mt-1.5 text-xs font-medium leading-[18px] text-danger" data-environment-mismatch="true">
          {environment.mismatch.note}
        </p>
      )}
    </div>
  );
}
