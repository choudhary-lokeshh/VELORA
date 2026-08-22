import { createHash } from 'node:crypto';

import { sql } from 'drizzle-orm';

import type { Executor, TransactionHandle } from '../database/executor.js';
import {
  maximumPushTokenLength,
  minimumPushTokenLength,
  type PushDeviceDisableReason,
  type PushPlatform,
} from './policy.js';
import type {
  NotificationPushDeviceRow,
  NotificationRepository,
} from './repository.js';

export type DeviceRegistrationOutcome =
  | { readonly deviceId: string; readonly kind: 'registered' }
  /** The token or the installation identifier is not a usable shape. */
  | { readonly kind: 'invalid' };

/**
 * Device registration, and the rule that a token is not an identity.
 *
 * A push token is a bearer credential for reaching a device. Whoever holds the
 * device receives what is sent to it, which makes every question here a
 * question about the device rather than about the person: who registered it
 * most recently, whether that registration is still live, and whether the
 * token has since moved somewhere else.
 *
 * The token is fingerprinted and discarded. Nothing stores it, because nothing
 * can use it — no push provider is approved and no native build pipeline
 * exists to issue one — and a stored bearer credential that no code path can
 * spend is risk without benefit.
 */
export class PushDeviceService {
  constructor(
    private readonly dependencies: {
      readonly now: () => Date;
      readonly repository: NotificationRepository;
    },
  ) {}

  /**
   * Registers a device, or refreshes what is already registered.
   *
   * Three things can be true at once when a token arrives: this installation
   * had a different token, this token was registered by somebody else, and
   * neither. All three are resolved in one transaction, because the window
   * between them is exactly where one person's notice reaches another
   * person's phone.
   */
  async register(input: {
    readonly installationId: string;
    readonly platform: PushPlatform;
    readonly recipientId: string;
    readonly token: string;
  }): Promise<DeviceRegistrationOutcome> {
    if (
      input.token.length < minimumPushTokenLength ||
      input.token.length > maximumPushTokenLength
    ) {
      return { kind: 'invalid' };
    }
    const tokenFingerprint = fingerprintOf(input.token);
    const now = this.dependencies.now();

    return this.dependencies.repository.transaction(async (transaction) => {
      // Before anything is read or written. Registration is three
      // check-then-act decisions in one — is this token somebody else's, does
      // this installation hold a different token, does a row already exist —
      // and each of them is about the *absence* of a row, which has nothing to
      // lock. Fifty concurrent registrations of one token proved it: without
      // this, some of them lose the insert race on the partial unique index
      // and fail rather than settling on the row that won.
      await lockRegistration(transaction, {
        installationId: input.installationId,
        recipientId: input.recipientId,
        tokenFingerprint,
      });
      // Somebody else holding this token loses it. The device is the thing
      // being addressed, and it can only be addressed for one account.
      await this.dependencies.repository.disableDevicesByFingerprint(
        transaction,
        {
          exceptRecipientId: input.recipientId,
          now,
          reason: 'claimed_by_another_principal',
          tokenFingerprint,
        },
      );
      // This installation's older token is retired rather than kept, so a
      // rotated token does not leave a second live row that would double
      // every notice.
      await this.dependencies.repository.disableDevicesByInstallation(
        transaction,
        {
          exceptTokenFingerprint: tokenFingerprint,
          installationId: input.installationId,
          now,
          reason: 'token_rotated',
          recipientId: input.recipientId,
        },
      );
      const device = await this.dependencies.repository.upsertPushDevice(
        transaction,
        {
          installationId: input.installationId,
          now,
          platform: input.platform,
          recipientId: input.recipientId,
          tokenFingerprint,
        },
      );
      return { deviceId: device.id, kind: 'registered' as const };
    });
  }

  /**
   * Retires this installation's registration.
   *
   * Scoped to the caller's own principal, so a revocation can only ever remove
   * a device the caller registered. Revoking something that is not registered
   * is silently successful: reporting otherwise would let anybody test whether
   * an installation identifier exists.
   */
  async revoke(input: {
    readonly installationId: string;
    readonly reason: PushDeviceDisableReason;
    readonly recipientId: string;
  }): Promise<void> {
    await this.dependencies.repository.disableDevicesByInstallation(
      this.dependencies.repository.transactionless,
      {
        installationId: input.installationId,
        now: this.dependencies.now(),
        reason: input.reason,
        recipientId: input.recipientId,
      },
    );
  }

  /** Every device this person can currently be reached on. */
  async active(
    executor: Executor,
    recipientId: string,
  ): Promise<readonly NotificationPushDeviceRow[]> {
    return this.dependencies.repository.listActivePushDevices(
      executor,
      recipientId,
    );
  }
}

/**
 * The stored identity of a token, and never the token.
 *
 * SHA-256 over the exact bytes the client sent. No normalization: a device
 * token is opaque, so trimming or lower-casing one would risk making two
 * different credentials look like the same registration.
 */
export function fingerprintOf(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Serializes concurrent registrations that could collide.
 *
 * Two locks rather than one, because two different uniqueness rules are being
 * protected: one live registration per token across the platform, and one live
 * registration per installation per person. A single key would leave the other
 * race open — two different tokens registering on one installation at once
 * would both pass and then violate the installation index.
 *
 * The keys are taken in sorted order for the same reason `lockPair` orders its
 * pair: two transactions that need both locks must ask for them in the same
 * sequence, or they can wait on each other. Unrelated registrations can hash to
 * one key and serialize briefly; that is a throughput detail, never a
 * correctness one.
 */
async function lockRegistration(
  executor: TransactionHandle,
  input: {
    readonly installationId: string;
    readonly recipientId: string;
    readonly tokenFingerprint: string;
  },
): Promise<void> {
  const keys = [
    `notifications:push-token:${input.tokenFingerprint}`,
    `notifications:push-installation:${input.recipientId.toLowerCase()}:${input.installationId}`,
  ].toSorted();
  for (const key of keys) {
    await executor.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
    );
  }
}
