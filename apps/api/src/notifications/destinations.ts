import type { Executor } from '../database/executor.js';
import type { NotificationChannel, PushPlatform } from './policy.js';
import type { NotificationRepository } from './repository.js';

/**
 * Somewhere a notice can actually arrive.
 *
 * Carries a discriminant despite having one shape today. A push destination is
 * a device; an email destination will be an address, and the two share nothing
 * but the fact that a notice is aimed at them. When the second one exists this
 * becomes a union, and every reader that already switches on `kind` keeps
 * working — whereas one shape with optional fields would have valid
 * combinations no reader could enumerate.
 */
export interface DeliveryDestination {
  readonly deviceId: string;
  readonly kind: 'push_device';
  readonly platform: PushPlatform;
}

export interface DeliveryDestinationPort {
  resolve(input: {
    readonly channel: NotificationChannel;
    readonly executor: Executor;
    readonly recipientId: string;
  }): Promise<readonly DeliveryDestination[]>;
}

/**
 * Where a notice can be sent, read at the moment of sending.
 *
 * Resolved inside the claiming transaction rather than remembered from when
 * the notice was created, for the same reason the safety recheck is: a device
 * registered last week may have been retired since, and a notice aimed at a
 * retired registration is one nobody receives.
 *
 * Email and SMS resolve to nothing, and that is a statement about the platform
 * rather than about any recipient. No domain stores an email address —
 * `auth_identities` holds an opaque provider subject and AUTH's recovery port
 * takes a destination as a parameter without keeping one — so there is no
 * address to resolve for anybody. That gap blocks the email channel more
 * completely than the absence of an approved provider does, and it is recorded
 * in `docs/decisions/DECISIONS_REQUIRED.md`.
 */
export class RegisteredDeviceDestinations implements DeliveryDestinationPort {
  constructor(private readonly repository: NotificationRepository) {}

  async resolve(input: {
    readonly channel: NotificationChannel;
    readonly executor: Executor;
    readonly recipientId: string;
  }): Promise<readonly DeliveryDestination[]> {
    if (input.channel !== 'push') return [];
    const devices = await this.repository.listActivePushDevices(
      input.executor,
      input.recipientId,
    );
    return devices.map((device) => ({
      deviceId: device.id,
      kind: 'push_device' as const,
      platform: device.platform as PushPlatform,
    }));
  }
}
