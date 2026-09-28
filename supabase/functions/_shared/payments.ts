// Resolves how this deployment may take money, from Edge Function secrets only.
//
// WHY THIS FILE EXISTS. Until 095, `paystack-initialize` treated a missing
// `PAYSTACK_SECRET_KEY` as "run in mock mode": it created no gateway session,
// returned the callback URL as if it were a checkout URL, and activated a paid
// subscription immediately. A production deployment with no payment configuration
// therefore gave away paid access to anyone who pressed the button. A missing
// secret is a configuration error, and a configuration error must never be a free
// subscription.
//
// THE RULES, in order of how much they matter:
//
//   1. Configuration comes from secrets. Nothing here reads a request body, a
//      header, a query string, a database row or a platform setting, so no client
//      and no tenant can influence which mode is used. That is the requirement the
//      brief states most plainly, and this file is where it is kept.
//   2. Production uses the live key or nothing. A test key in production leaves
//      payments UNAVAILABLE rather than quietly taking test money for real access.
//   3. A key must look like the key it claims to be. `sk_test_` in the live slot is
//      a misconfiguration, and "some secret is set" must not read as "we are live".
//   4. Mock requires an explicit opt-in secret AND a non-production environment.
//      Both, every time, because a single flag is one typo away from giving away
//      subscriptions on the live site.
//   5. An environment that was never declared is treated as production. The
//      cautious reading of an unknown deployment is the one that refuses.

export type PaymentMode = 'live' | 'test' | 'mock';
export type PaymentEnvironment = 'production' | 'staging' | 'development';

export const PAYMENTS_UNAVAILABLE = 'PAYMENTS_UNAVAILABLE';

export interface PaymentConfigUnavailable {
  available: false;
  code: typeof PAYMENTS_UNAVAILABLE;
  /** What the operator should do about it. Shown to customers as a short state. */
  reason: string;
  /** How the deployment declared itself, or 'unknown' when it did not. */
  environment: PaymentEnvironment | 'unknown';
  notices: string[];
}

export interface PaymentConfigReady {
  available: true;
  mode: PaymentMode;
  environment: PaymentEnvironment;
  /**
   * The key to talk to the gateway with. `null` in mock mode, which never reaches
   * a gateway. Kept out of every response body, log line and error message: see
   * `redactSecrets` below.
   */
  secretKey: string | null;
  /** True for test and mock, so callers can label the money honestly. */
  testMode: boolean;
  notices: string[];
}

export type PaymentConfig = PaymentConfigUnavailable | PaymentConfigReady;

const LIVE_PREFIX = 'sk_live_';
const TEST_PREFIX = 'sk_test_';

function readEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (value && value.trim() !== '') return value.trim();
  }
  return undefined;
}

function declaredEnvironment(): { environment: PaymentEnvironment; declared: boolean } {
  const raw = (readEnv('PAYMENTS_ENVIRONMENT') ?? '').toLowerCase();
  if (raw === 'production' || raw === 'prod' || raw === 'live') {
    return { environment: 'production', declared: true };
  }
  if (raw === 'staging' || raw === 'stage' || raw === 'preview') {
    return { environment: 'staging', declared: true };
  }
  if (raw === 'development' || raw === 'dev' || raw === 'local') {
    return { environment: 'development', declared: true };
  }
  // Not declared. Assume the most dangerous reading, because the alternative is
  // granting a trial or a mock checkout on a live site that forgot to say so.
  return { environment: 'production', declared: false };
}

/**
 * Removes anything that looks like a Paystack secret from a string.
 *
 * Applied to every error message this module and its callers produce, because the
 * one place a key realistically escapes is a gateway error echoed back verbatim.
 * A key in a log line is a key that has to be rotated.
 */
export function redactSecrets(value: unknown): string {
  return String(value ?? '')
    .replace(/sk_(live|test)_[A-Za-z0-9]+/g, 'sk_$1_[redacted]')
    .replace(/pk_(live|test)_[A-Za-z0-9]+/g, 'pk_$1_[redacted]')
    .replace(/whsec_[A-Za-z0-9]+/g, 'whsec_[redacted]');
}

/**
 * Resolves the payment configuration for this deployment.
 *
 * Returns a discriminated union rather than throwing, because every caller has to
 * decide what to tell the user, and a thrown error makes it too easy to write a
 * catch block that activates anyway.
 */
export function resolvePaymentConfig(): PaymentConfig {
  const { environment, declared } = declaredEnvironment();
  const notices: string[] = [];

  const liveKey = readEnv('PAYSTACK_SECRET_KEY_LIVE');
  const testKey = readEnv('PAYSTACK_SECRET_KEY_TEST');
  const legacyKey = readEnv('PAYSTACK_SECRET_KEY');
  const mockEnabled = (readEnv('PAYMENTS_MOCK_ENABLED') ?? '').toLowerCase() === 'true';

  if (!declared) {
    notices.push(
      'PAYMENTS_ENVIRONMENT is not set, so this deployment is being treated as production. ' +
        'Set it to production, staging or development so the payment rules can be applied honestly.',
    );
  }

  if (legacyKey) {
    // Deliberately ignored. Accepting the bare name would reintroduce exactly the
    // assumption this module removes: that any secret at all means the system is
    // live. Reported by name so the operator knows why nothing is working.
    notices.push(
      'PAYSTACK_SECRET_KEY is set and is being IGNORED. Use PAYSTACK_SECRET_KEY_LIVE and ' +
        'PAYSTACK_SECRET_KEY_TEST so the mode is explicit, then remove the old variable.',
    );
  }

  if (liveKey && !liveKey.startsWith(LIVE_PREFIX)) {
    notices.push('PAYSTACK_SECRET_KEY_LIVE does not begin with sk_live_, so it is not a live key.');
  }
  if (testKey && !testKey.startsWith(TEST_PREFIX)) {
    notices.push('PAYSTACK_SECRET_KEY_TEST does not begin with sk_test_, so it is not a test key.');
  }

  const usableLive = liveKey && liveKey.startsWith(LIVE_PREFIX) ? liveKey : undefined;
  const usableTest = testKey && testKey.startsWith(TEST_PREFIX) ? testKey : undefined;

  // ----------------------------------------------------------
  // Production: the live key, or nothing at all.
  // ----------------------------------------------------------
  if (environment === 'production') {
    if (!usableLive) {
      return {
        available: false,
        code: PAYMENTS_UNAVAILABLE,
        reason: liveKey
          ? 'PAYSTACK_SECRET_KEY_LIVE is set but is not a live key (it must begin with sk_live_).'
          : 'PAYSTACK_SECRET_KEY_LIVE is not configured on this deployment.',
        environment,
        notices,
      };
    }

    return {
      available: true,
      mode: 'live',
      environment,
      secretKey: usableLive,
      testMode: false,
      notices,
    };
  }

  // ----------------------------------------------------------
  // Staging and development.
  // ----------------------------------------------------------
  if (mockEnabled) {
    return {
      available: true,
      mode: 'mock',
      environment,
      secretKey: null,
      testMode: true,
      notices: [
        ...notices,
        `PAYMENTS_MOCK_ENABLED is true, so checkouts settle without a gateway. Every payment and every entitlement ` +
          `this produces is marked as test data. Allowed only because this deployment declares itself ${environment}.`,
      ],
    };
  }

  if (usableTest) {
    return {
      available: true,
      mode: 'test',
      environment,
      secretKey: usableTest,
      testMode: true,
      notices,
    };
  }

  // A live key in a non-production environment is refused rather than used. Taking
  // real money from a rehearsal is worse than taking none, and the operator almost
  // certainly swapped two variables.
  return {
    available: false,
    code: PAYMENTS_UNAVAILABLE,
    reason: usableLive
      ? 'Only a live key is configured. A live key is refused in a non-production environment, because it would ' +
        'charge real cards from a rehearsal. Set PAYSTACK_SECRET_KEY_TEST.'
      : 'PAYSTACK_SECRET_KEY_TEST is not configured on this deployment.',
    environment,
    notices,
  };
}

/** The subset of the configuration that is safe to hand to a browser. */
export function publicPaymentConfig(config: PaymentConfig) {
  if (!config.available) {
    return {
      available: false as const,
      code: PAYMENTS_UNAVAILABLE,
      environment: config.environment,
      reason: config.reason,
    };
  }

  return {
    available: true as const,
    mode: config.mode,
    environment: config.environment,
    testMode: config.testMode,
    // The operator-facing notices are included so the console can show a
    // misconfiguration, and they are written to name variables only, never values.
    notices: config.notices,
  };
}

/**
 * The key that can look up a transaction recorded under a given mode.
 *
 * Used by the callback path, which has to ask the gateway about a specific
 * reference and must use the same key that created it. Returns null in mock mode,
 * where no gateway session was ever created, and null when the key for that mode
 * is not present on this deployment.
 */
export function secretKeyForMode(mode: PaymentMode): string | null {
  if (mode === 'mock') return null;
  const key = mode === 'live'
    ? readEnv('PAYSTACK_SECRET_KEY_LIVE')
    : readEnv('PAYSTACK_SECRET_KEY_TEST');
  const prefix = mode === 'live' ? LIVE_PREFIX : TEST_PREFIX;
  return key && key.startsWith(prefix) ? key : null;
}

/**
 * The key that signs a webhook payload for a given mode.
 *
 * Paystack signs with whichever key created the transaction, so a test-mode
 * webhook is signed with the test key and a live one with the live key. The
 * webhook tries both and treats which one verified as the independent evidence of
 * the mode - which is why the mode is not taken from the payload, where a forged
 * body could claim anything it liked.
 */
export function candidateKeys(config: PaymentConfig): { mode: PaymentMode; key: string }[] {
  if (!config.available) return [];

  if (config.mode === 'mock') return [];

  const candidates: { mode: PaymentMode; key: string }[] = [];
  const testKey = readEnv('PAYSTACK_SECRET_KEY_TEST');
  const liveKey = readEnv('PAYSTACK_SECRET_KEY_LIVE');

  // The configured mode first, then the other key if it is present and looks
  // right. A live deployment that also holds a test key can still verify a test
  // webhook, and the mode it settles under comes from which key matched.
  if (config.mode === 'live') {
    if (liveKey?.startsWith(LIVE_PREFIX)) candidates.push({ mode: 'live', key: liveKey });
    if (testKey?.startsWith(TEST_PREFIX)) candidates.push({ mode: 'test', key: testKey });
  } else {
    if (testKey?.startsWith(TEST_PREFIX)) candidates.push({ mode: 'test', key: testKey });
    if (liveKey?.startsWith(LIVE_PREFIX)) candidates.push({ mode: 'live', key: liveKey });
  }

  if (candidates.length === 0 && config.secretKey) {
    candidates.push({ mode: config.mode, key: config.secretKey });
  }

  return candidates;
}
