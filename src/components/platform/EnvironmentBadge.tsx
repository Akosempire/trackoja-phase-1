import type { EnvironmentInfo } from '../../config/environment';

const TONE_CLASS: Record<EnvironmentInfo['name'], string> = {
  production: 'env-badge-production',
  staging: 'env-badge-staging',
  development: 'env-badge-development',
  unknown: 'env-badge-unknown',
};

/** Compact marker for headers and sidebars. */
export function EnvironmentBadge({ environment }: { environment: EnvironmentInfo }) {
  return (
    <span className={`env-badge ${TONE_CLASS[environment.name]}`} data-environment={environment.name}>
      <span className="badge-dot" aria-hidden="true" />
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
      className={`env-marker env-marker-${environment.name}`}
      role="status"
      data-environment={environment.name}
    >
      <EnvironmentBadge environment={environment} />
      <div className="env-marker-text">
        <p className="env-marker-detail">
          {environment.detail}
          {sourceNote ? ` ${sourceNote}` : ''}
        </p>
        {environment.mismatch && (
          <p className="env-marker-detail" data-environment-mismatch="true">
            {environment.mismatch.note}
          </p>
        )}
      </div>
    </div>
  );
}
