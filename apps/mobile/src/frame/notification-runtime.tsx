import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';

import { ensureNotificationChannels } from '../push/channels';

/**
 * The two things Android needs decided before a notification can exist, both
 * of which are properties of the build rather than of any screen.
 *
 * **Channels.** From Android 8 a notification with no channel is dropped, and
 * every property of a channel is frozen the moment it is first created. They
 * are declared at launch, before anything has ever been delivered, so that
 * enabling a provider later is a configuration change rather than a migration
 * that would silently discard everybody's own notification settings.
 *
 * **What a notification does while somebody is already looking at the app.**
 * The platform default is to show nothing, which is wrong here: this
 * application does not poll, so a message arriving while the conversation list
 * is open is a fact the surface has no other way to learn. Showing the banner
 * is also the honest option — it is what the person granted the permission
 * for. What is deliberately *not* done is reaching into the payload to update
 * state: the payload carries a routing identifier and nothing worth rendering,
 * and everything is re-read from the API on the next foreground anyway.
 *
 * None of this claims delivery. No provider is approved for VELORA, so in
 * every build today these channels exist and nothing is ever put through them.
 * That costs a few milliseconds at launch and buys a correct configuration on
 * the day one is.
 */

Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
});

export function NotificationRuntime() {
  useEffect(() => {
    // Failure is not reported to the person. A device that refuses to create a
    // channel is a device that will not show a notification, which is already
    // the state of every build, and there is nothing here for anybody to do
    // about it.
    void ensureNotificationChannels().catch(() => undefined);
  }, []);

  return null;
}
