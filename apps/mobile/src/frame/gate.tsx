import { journeyStage } from '@velora/consumer-client';
import type { ReactNode } from 'react';

import {
  LaunchScreen,
  UnavailableScreen,
  WelcomeScreen,
} from '../product/welcome';
import { OnboardingScreen } from '../product/onboarding';
import { useSession } from './providers';

/**
 * Who sees what, decided from server answers only.
 *
 * It wraps the routes rather than redirecting between them, which is what makes
 * a deep link safe: a notification tapped while signed out lands on the welcome
 * screen and, once the session is real, renders the route it was always for.
 * There is no window in which a privileged route is mounted and then navigated
 * away from, because it is never mounted.
 *
 * A gate is not a security boundary and is not treated as one. Every request
 * behind it is authorized again by the server, and a refusal is rendered as a
 * refusal. What it decides is what is worth rendering.
 *
 * The three states before the product are all real and all distinct. A cold
 * launch reads the platform keystore before it can ask the server anything —
 * that is `loading`, and it has a duration a person can see. A build with no
 * usable endpoint is `unavailable` and no amount of waiting fixes it. And being
 * signed in is not the same as being able to use VELORA: the server's own
 * onboarding ladder decides that, so somebody halfway through it gets the
 * ladder rather than an empty feed.
 */
export function ConsumerGate({ children }: { readonly children: ReactNode }) {
  const session = useSession();

  if (session.state.status === 'loading') return <LaunchScreen />;
  if (!session.signedIn) return <WelcomeScreen />;

  const { account, onboarding } = session.account;

  // The account read has not answered yet. Rendering the ladder here would
  // flash "create your account" at somebody who has one.
  if (account.loading && account.value === undefined) return <LaunchScreen />;
  if (onboarding.loading && onboarding.value === undefined) {
    return <LaunchScreen />;
  }

  if (account.value === undefined) return <OnboardingScreen />;
  if (journeyStage(onboarding.value) !== 'ready') return <OnboardingScreen />;

  return <>{children}</>;
}

export { UnavailableScreen };
