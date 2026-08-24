import * as Notifications from 'expo-notifications';
import {
  AndroidImportance,
  AndroidNotificationVisibility,
} from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * The notification channels this application declares to Android.
 *
 * A channel is not a detail. From Android 8 onwards a notification with no
 * channel is dropped, and every property below — importance, whether it makes
 * a sound, whether it vibrates, what a locked screen shows — is **immutable
 * after the channel is first created**. The only way to change one is to
 * publish a new channel under a new identifier, at which point everyone who
 * had adjusted the old one silently loses their adjustment. So these are
 * created correctly now, before a single notification has ever been delivered,
 * rather than being left until a provider is approved and then migrated.
 *
 * There are exactly three, and they mirror the approved template catalogue in
 * `apps/api/src/notifications/policy.ts` rather than the full category
 * vocabulary. A channel appears in Android's own settings screen whether or
 * not anything is ever sent through it, so a channel for a category with no
 * approved template would be a switch in the operating system for a
 * notification that does not exist.
 *
 * Every one of them is `PRIVATE` on the lock screen. `docs/flows/notification-delivery.md`
 * requires lock-screen copy to minimize message text and identity; `PRIVATE`
 * is Android's own mechanism for exactly that, and it means a secure lock
 * screen shows that VELORA has something to say without saying it. The server
 * additionally sends no body, no name, and no preview, so the two controls are
 * independent rather than one relying on the other.
 */

export type NotificationCategory = 'call' | 'direct_message' | 'introduction';

export interface NotificationChannelDefinition {
  readonly category: NotificationCategory;
  readonly description: string;
  readonly id: string;
  readonly importance: AndroidImportance;
  readonly name: string;
  readonly vibrationPattern: readonly number[];
}

/**
 * Versioned identifiers. If one of the immutable properties above ever has to
 * change, the identifier changes with it and the old channel is deleted, which
 * is the only honest migration Android offers.
 */
export const notificationChannels: readonly NotificationChannelDefinition[] = [
  {
    category: 'call',
    description: 'Somebody is calling you, or a call went unanswered.',
    id: 'velora.call.v1',
    // The only thing in the product worth interrupting for: a call is
    // happening now and stops mattering in seconds.
    importance: AndroidImportance.HIGH,
    name: 'Calls',
    vibrationPattern: [0, 400, 200, 400],
  },
  {
    category: 'direct_message',
    description: 'Somebody you are introduced to has written to you.',
    id: 'velora.message.v1',
    importance: AndroidImportance.HIGH,
    name: 'Messages',
    vibrationPattern: [0, 250],
  },
  {
    category: 'introduction',
    description: 'Somebody you signalled interest in has signalled back.',
    id: 'velora.introduction.v1',
    // Worth telling somebody about, not worth taking over the screen for.
    importance: AndroidImportance.DEFAULT,
    name: 'Introductions',
    vibrationPattern: [0, 250],
  },
];

const channelByCategory = new Map(
  notificationChannels.map((channel) => [channel.category, channel]),
);

export function channelIdFor(
  category: NotificationCategory,
): string | undefined {
  return channelByCategory.get(category)?.id;
}

/**
 * Declares every channel, idempotently.
 *
 * Android treats a repeat creation of an existing channel as a no-op for the
 * immutable properties, so this is safe to run on every launch and is the only
 * way to be sure a channel exists after a person has deleted one. It is a
 * no-op off Android because no other platform has the concept.
 */
export async function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  for (const channel of notificationChannels) {
    await Notifications.setNotificationChannelAsync(channel.id, {
      description: channel.description,
      enableVibrate: true,
      importance: channel.importance,
      lockscreenVisibility: AndroidNotificationVisibility.PRIVATE,
      name: channel.name,
      showBadge: true,
      vibrationPattern: [...channel.vibrationPattern],
    });
  }
}
