import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';

import { resolvePushDestination } from '../push/routing';
import { resolveDeepLink } from './deep-links';
import { useToast } from './providers';

/**
 * The two ways somebody arrives somewhere without touching the application.
 *
 * They are handled here, together, because they have the same three hazards —
 * a cold launch, a duplicate, and a destination that no longer exists — and
 * solving them twice would mean solving them differently.
 *
 * **Links.** Expo Router already resolves a `velora://` URL against the real
 * routes, and a path that matches nothing lands on the not-found page. So this
 * does not re-route a link that works; re-routing one would mean two
 * navigations for one tap and a race between them. What it adds is the case
 * the router has no opinion about: a link that is *refused* — a malformed
 * identifier, a path this application does not publish, a scheme that is not
 * VELORA's — is taken to Notices with a sentence saying so, rather than to a
 * dead end.
 *
 * **Notification taps.** Nothing else routes these, so all of it is here. The
 * payload carries a template key and one identifier and nothing else, so
 * arriving fetches everything from the API, re-authorized at that moment.
 *
 * Three behaviours are load-bearing and each is a test:
 *
 * - **A cold launch is not a warm one.** An application started *by* a
 *   notification never receives the listener event for it, so the last
 *   response has to be asked for once at mount. Handling only the listener
 *   loses every tap that started the application, which is most of them.
 * - **A tap is handled once.** The cold-start read and the listener can both
 *   see the same response during the first moments of a launch, and Android
 *   re-delivers a response to a resumed activity. Responses are remembered by
 *   the platform's own notification identifier, so the second sighting
 *   navigates nowhere.
 * - **`replace`, not `push`, on a cold launch.** Otherwise the back gesture
 *   from a notification destination leaves a screen behind that nobody
 *   navigated from, and on Android that is the gesture people use most.
 *
 * Nothing here decides whether somebody may see the destination. It produces
 * an address; the gate above decides whether the routes are mounted at all,
 * and the server re-authorizes every request behind them. A notification
 * tapped while signed out lands on the welcome screen and, once the session is
 * real, on the route it was always for.
 */
export function LinkRouter() {
  const router = useRouter();
  const toast = useToast();
  const handled = useRef(new Set<string>());
  const navigate = useRef<(path: string, replace: boolean) => void>(
    () => undefined,
  );
  /*
   * The toast API is reached through a ref rather than through the effect's
   * dependency list, and that is load-bearing rather than tidiness. `useToast`
   * returns a new object whenever the set of visible toasts changes, so an
   * effect depending on it re-runs every time it raises one — and this effect
   * raises one. On a device that closed into an infinite loop: the initial URL
   * answered, the link was refused, a toast was shown, the dependency changed,
   * the effect ran again. It remounted the application about thirty-six times
   * a second and the launch never finished. Nothing in a browser-rendered walk
   * could have found it, because `getInitialURL` never answers there.
   */
  const announce = useRef(toast.show);
  announce.current = toast.show;

  navigate.current = (path, replace) => {
    if (replace) router.replace(path);
    else router.navigate(path);
  };

  /* ------------------------------------------------------------- links */
  useEffect(() => {
    let live = true;

    const refuse = (url: string) => {
      const resolved = resolveDeepLink(url);
      // A link the router can serve is left to the router; acting on it here
      // as well would navigate twice for one tap. An address belonging to
      // something else on this scheme — the development client's, on every
      // development launch — is not the product's to answer for either.
      if (resolved.kind !== 'refused') return;
      if (!live) return;
      announce.current(resolved.reason, 'neutral');
      navigate.current(resolved.path, true);
    };

    void Linking.getInitialURL().then((url) => {
      if (url !== null) refuse(url);
    });
    const subscription = Linking.addEventListener('url', (event) => {
      refuse(event.url);
    });
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);

  /* ----------------------------------------------------- notifications */
  useEffect(() => {
    let live = true;
    const seen = handled.current;

    const act = (
      response: Notifications.NotificationResponse | null,
      coldStart: boolean,
    ) => {
      if (!live || response === null) return;
      const id = response.notification.request.identifier;
      if (seen.has(id)) return;
      seen.add(id);
      const destination = resolvePushDestination(
        response.notification.request.content.data,
      );
      navigate.current(destination.path, coldStart);
    };

    // Read synchronously. An application started *by* a notification never
    // receives the listener event for it, so without this every tap that
    // launched the application — which is most of them — would land nowhere.
    try {
      act(Notifications.getLastNotificationResponse(), true);
    } catch {
      // A build where the module cannot answer routes nothing, which is the
      // same outcome as no notification having been tapped.
    }

    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        act(response, false);
      },
    );
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);

  return null;
}
