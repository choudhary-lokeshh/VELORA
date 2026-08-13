import type {
  AuthAssurance,
  AuthAudience,
  BrowserAuthAudience,
} from '@velora/validation';

/**
 * The code-side projection of the session, recovery, and privileged-access
 * values locked by ADR-0017. This is the only module in the API that may state
 * one of those values; `pnpm auth:policy` fails when a value here disagrees with
 * the ADR, and when any other API source file restates one.
 *
 * Break-glass values are absent on purpose. ADR-0017 documents break-glass
 * semantics and explicitly does not implement them, so putting its constants in
 * runtime code would create a control that looks real and is not.
 */

const millisecondsPerUnit = {
  d: 86_400_000,
  h: 3_600_000,
  m: 60_000,
} as const;

type DurationUnit = keyof typeof millisecondsPerUnit;
export type LockedDuration = `${number}${DurationUnit}`;

function isDurationUnit(value: string): value is DurationUnit {
  return Object.hasOwn(millisecondsPerUnit, value);
}

export function durationMilliseconds(value: LockedDuration): number {
  const unit = value.slice(-1);
  const amount = Number(value.slice(0, -1));
  if (!isDurationUnit(unit) || !Number.isInteger(amount) || amount <= 0) {
    throw new Error('Locked duration is malformed');
  }
  return amount * millisecondsPerUnit[unit];
}

/** Verbatim ADR-0017 values. Changing one requires amending the ADR. */
export const lockedAuthDurations = {
  consumerMobileAccessToken: '10m',
  consumerMobileRefreshAbsolute: '90d',
  consumerMobileRefreshIdle: '30d',
  consumerWebAbsolute: '30d',
  consumerWebIdle: '14d',
  creatorStudioAbsolute: '7d',
  creatorStudioIdle: '8h',
  platformAdminAbsolute: '8h',
  platformAdminIdle: '15m',
  recoveryHighImpactCooldown: '24h',
  recoveryTokenExpiry: '15m',
  stepUpAssuranceAge: '5m',
} as const satisfies Record<string, LockedDuration>;

export const lockedAuthLimits = {
  recoveryPerAccountPerDay: 5,
  recoveryPerAccountPerHour: 3,
  recoveryPerRequesterPerHour: 10,
} as const;

export interface SessionLifetimePolicy {
  readonly absoluteMilliseconds: number;
  readonly idleMilliseconds: number;
}

function lifetime(
  idle: LockedDuration,
  absolute: LockedDuration,
): SessionLifetimePolicy {
  return {
    absoluteMilliseconds: durationMilliseconds(absolute),
    idleMilliseconds: durationMilliseconds(idle),
  };
}

export const browserSessionPolicy: Readonly<
  Record<BrowserAuthAudience, SessionLifetimePolicy>
> = {
  consumer_web: lifetime(
    lockedAuthDurations.consumerWebIdle,
    lockedAuthDurations.consumerWebAbsolute,
  ),
  creator_studio: lifetime(
    lockedAuthDurations.creatorStudioIdle,
    lockedAuthDurations.creatorStudioAbsolute,
  ),
  platform_admin: lifetime(
    lockedAuthDurations.platformAdminIdle,
    lockedAuthDurations.platformAdminAbsolute,
  ),
};

export const refreshFamilyPolicy: SessionLifetimePolicy = lifetime(
  lockedAuthDurations.consumerMobileRefreshIdle,
  lockedAuthDurations.consumerMobileRefreshAbsolute,
);

export const accessTokenLifetimeMilliseconds = durationMilliseconds(
  lockedAuthDurations.consumerMobileAccessToken,
);

export const recoveryTokenLifetimeMilliseconds = durationMilliseconds(
  lockedAuthDurations.recoveryTokenExpiry,
);

export const highImpactCooldownMilliseconds = durationMilliseconds(
  lockedAuthDurations.recoveryHighImpactCooldown,
);

export const stepUpAssuranceMaximumAgeMilliseconds = durationMilliseconds(
  lockedAuthDurations.stepUpAssuranceAge,
);

export const recoveryRateLimits = {
  perAccountPerDay: lockedAuthLimits.recoveryPerAccountPerDay,
  perAccountPerHour: lockedAuthLimits.recoveryPerAccountPerHour,
  perRequesterPerHour: lockedAuthLimits.recoveryPerRequesterPerHour,
} as const;

/**
 * Implementation constants. None of these is policy: they bound how the
 * mechanism behaves, not how long authority lasts or how often a user may try.
 */
export const authMechanismConstants = {
  /**
   * Idle expiry slides on use. Writing that on every request would make each
   * read a write, so activity is persisted at most this often. It shortens no
   * lifetime: expiry is still computed from the stored value.
   */
  sessionActivityWriteIntervalMilliseconds: 60_000,
  /** Tolerated clock difference when validating a signed access token. */
  signedTokenClockSkewMilliseconds: 5_000,
} as const;

/** Ordered weakest to strongest. */
const assuranceOrder: readonly AuthAssurance[] = [
  'single_factor',
  'multi_factor',
  'phishing_resistant',
];

export function assuranceAtLeast(
  actual: AuthAssurance,
  required: AuthAssurance,
): boolean {
  return assuranceOrder.indexOf(actual) >= assuranceOrder.indexOf(required);
}

/**
 * ADR-0017 requires phishing-resistant authenticators for privileged access, so
 * the Platform Admin audience has a minimum assurance that no other audience
 * has. A consumer or creator session can never satisfy it.
 */
export const minimumAssuranceByAudience: Readonly<
  Record<AuthAudience, AuthAssurance>
> = {
  consumer_mobile: 'single_factor',
  consumer_web: 'single_factor',
  creator_studio: 'single_factor',
  platform_admin: 'phishing_resistant',
};
