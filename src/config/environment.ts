export type PlatformEnvironmentName = 'production' | 'staging' | 'development' | 'unknown';

/** Platform setting that carries the environment the database declares. */
export const ENVIRONMENT_SETTING_KEY = 'environment.name';

export interface EnvironmentMismatch {
  databaseName: PlatformEnvironmentName;
  note: string;
}

export interface EnvironmentInfo {
  name: PlatformEnvironmentName;
  label: string;
  /** Where the answer came from, so the UI can be honest about its confidence. */
  source: 'build' | 'setting' | 'unknown';
  detail: string;
  /**
   * Set when the deployment and the database disagree. A development build
   * pointed at the production database is exactly the situation an operator most
   * needs warning about, and silently preferring one source would hide it.
   */
  mismatch?: EnvironmentMismatch;
}

const LABELS: Record<PlatformEnvironmentName, string> = {
  production: 'Production',
  staging: 'Staging',
  development: 'Development',
  unknown: 'Environment unknown',
};

const DETAILS: Record<PlatformEnvironmentName, string> = {
  production: 'Live customer data. Changes here affect real businesses immediately.',
  staging: 'A rehearsal environment. Customer data must not be created here.',
  development: 'A development environment. Nothing here is a customer record.',
  unknown: 'This deployment has not declared which environment it is.',
};

function normalise(value: unknown): PlatformEnvironmentName {
  if (typeof value !== 'string') return 'unknown';
  const cleaned = value.trim().toLowerCase();
  if (cleaned === 'production' || cleaned === 'prod' || cleaned === 'live') return 'production';
  if (cleaned === 'staging' || cleaned === 'stage' || cleaned === 'preview') return 'staging';
  if (cleaned === 'development' || cleaned === 'dev' || cleaned === 'local') return 'development';
  return 'unknown';
}

function databaseDeclaration(settingValue: unknown): PlatformEnvironmentName {
  if (settingValue === undefined || settingValue === null) return 'unknown';
  return normalise(
    typeof settingValue === 'object' && settingValue !== null && 'name' in settingValue
      ? (settingValue as { name?: unknown }).name
      : settingValue,
  );
}

/**
 * Resolves the environment the operator is working in.
 *
 * Environment is a property of the *deployment*, not of the database, and the
 * same database here is used by the live site and by local development. So the
 * deployment's own declaration is the primary source, and the database's
 * `environment.name` setting is both a fallback and a cross-check: when the two
 * disagree, that disagreement is reported rather than resolved silently.
 */
export function resolveEnvironment(settingValue?: unknown): EnvironmentInfo {
  const buildName = normalise(import.meta.env.VITE_ENVIRONMENT);
  const databaseName = databaseDeclaration(settingValue);

  const mismatch: EnvironmentMismatch | undefined =
    buildName !== 'unknown' && databaseName !== 'unknown' && buildName !== databaseName
      ? {
          databaseName,
          note: `This build targets ${LABELS[buildName].toLowerCase()}, but the database declares ${LABELS[
            databaseName
          ].toLowerCase()}. Check which database you are actually connected to before making changes.`,
        }
      : undefined;

  if (buildName !== 'unknown') {
    return {
      name: buildName,
      label: LABELS[buildName],
      source: 'build',
      detail: DETAILS[buildName],
      mismatch,
    };
  }

  if (databaseName !== 'unknown') {
    return {
      name: databaseName,
      label: LABELS[databaseName],
      source: 'setting',
      detail: DETAILS[databaseName],
    };
  }

  // A development or test build is self-evidently not production, so the Vite
  // mode is trustworthy in that direction only.
  const mode = normalise(import.meta.env.MODE);
  if (mode === 'development' || mode === 'staging') {
    return { name: mode, label: LABELS[mode], source: 'build', detail: DETAILS[mode] };
  }

  return {
    name: 'unknown',
    label: LABELS.unknown,
    source: 'unknown',
    detail: `${DETAILS.unknown} Declare it with the VITE_ENVIRONMENT build variable or the "${ENVIRONMENT_SETTING_KEY}" platform setting.`,
  };
}
