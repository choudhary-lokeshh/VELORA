import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useSession } from '../frame/providers';
import { PlainScreen, Wordmark } from '../frame/shell';
import {
  Button,
  Field,
  Notice,
  Stack,
  Text,
  TextField,
} from '../design/primitives';
import { color, space } from '../design/tokens';

/**
 * The first screen, and signing in.
 *
 * What this offers is exactly what the platform has. No identity provider is
 * approved — `docs/decisions/DECISIONS_REQUIRED.md` records why, and
 * `packages/config` refuses to start staging or production while that is true —
 * so the only thing behind this form is the local development adapter. It is
 * named as such rather than dressed up as a password field, because a password
 * box that accepts anything is a lie told to the person using it and to whoever
 * reviews the screenshot later.
 *
 * There is no "sign up" and no "continue with" anything, because neither
 * exists. There is also nothing here that a person could tap and have fail.
 */

const causeMessages: Readonly<Record<string, string>> = {
  session_ended: 'Your session ended. Sign in again to carry on.',
  signed_out: 'You are signed out on this device.',
};

export function WelcomeScreen() {
  const session = useSession();
  const [subject, setSubject] = useState('');
  const [touched, setTouched] = useState(false);

  const empty = subject.trim().length === 0;
  const cause =
    session.state.status === 'unauthenticated' &&
    session.state.cause !== 'initial'
      ? causeMessages[session.state.cause]
      : undefined;
  const unreachable = session.state.status === 'unavailable';

  return (
    <PlainScreen testID="welcome-screen">
      <View style={styles.fill}>
        <View style={styles.top}>
          {/*
            One mark, not two. The wordmark already carries the sparkle, and a
            second brand tile under it spends the top third of a phone screen
            on a logo in a product about people.
          */}
          <Wordmark />
          <Stack gap={3}>
            <Text variant="display" weight="bold">
              Meet fewer people, properly.
            </Text>
            <Text tone="secondary">
              VELORA introduces two people only when both have said yes. Nothing
              is broadcast, nothing is ranked, and nobody is told you passed.
            </Text>
          </Stack>
        </View>

        <Stack gap={4} style={styles.form}>
          {cause === undefined ? null : (
            <Text testID="auth-cause" tone="secondary" variant="small">
              {cause}
            </Text>
          )}

          {unreachable ? (
            <Notice
              testID="auth-unavailable"
              title="VELORA could not be reached"
              tone="caution"
            >
              Your session is still on this device. Nothing was signed out — try
              again when you have a connection.
            </Notice>
          ) : null}

          <Notice testID="sign-in-development" title="Development sign-in">
            VELORA has no live sign-in provider yet, so this environment admits
            a development identity instead. Choose any address you like; it is
            not checked, and it grants nothing outside this environment.
          </Notice>

          <Field
            error={
              touched && empty ? 'Enter an identity to continue.' : undefined
            }
            hint="Any address. It is not checked and no message is sent to it."
            label="Development identity"
            testID="sign-in-field"
          >
            {(control) => (
              <TextField
                {...control}
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                inputMode="email"
                invalid={touched && empty}
                onChangeText={setSubject}
                placeholder="person@velora.test"
                testID="auth-subject"
                value={subject}
              />
            )}
          </Field>

          <Button
            busy={session.busy}
            onPress={() => {
              setTouched(true);
              if (empty) return;
              session.signIn(subject.trim());
            }}
            size="large"
            testID="auth-sign-in"
            tone="primary"
            wide
          >
            Continue
          </Button>

          <Text align="center" tone="tertiary" variant="caption">
            VELORA is for adults. You will be asked to confirm that before
            anybody can find you.
          </Text>
        </Stack>
      </View>
    </PlainScreen>
  );
}

/**
 * The moment before anybody knows whose device this is.
 *
 * A cold launch reads the keystore before it can ask the server anything, and
 * that read has a real duration. Rendering the product into it would put a
 * signed-in surface in front of somebody who is signed out; rendering the
 * welcome screen would flash a sign-in at somebody who is already signed in.
 */
export function LaunchScreen() {
  return (
    <View style={styles.launch} testID="launch">
      <Wordmark />
      <Text
        accessibilityLiveRegion="polite"
        style={styles.launchText}
        tone="tertiary"
        variant="caption"
      >
        Loading VELORA
      </Text>
    </View>
  );
}

/**
 * A build that cannot reach VELORA at all.
 *
 * Distinct from being offline: this is a build with no usable endpoint
 * compiled into it, which no amount of waiting or retrying fixes. Saying so is
 * better than rendering a product every control on which would fail.
 */
export function UnavailableScreen() {
  return (
    <View style={styles.launch} testID="endpoint-unavailable">
      <Wordmark />
      <Text align="center" tone="secondary" variant="small">
        This build has no usable VELORA endpoint, so nothing here can work.
      </Text>
    </View>
  );
}

/**
 * A session that is real, and an account nobody could read.
 *
 * The distinction this screen exists to keep is between *there is no account*
 * and *we could not ask*. They arrive here identically — a session, and no
 * account value — and rendering the onboarding ladder for both told somebody
 * who has been on VELORA for a year that there is no account behind their
 * sign-in, over a failed request, next to a button that would then try to
 * create the account they already have.
 *
 * A 404 is not this. The account reads map an absent account to a successful
 * empty answer precisely because the client is asking about itself and already
 * knows which it is, so the ladder still belongs to somebody who genuinely has
 * no account. This is only for a read that failed.
 *
 * Consumer Web says the same thing on the same condition, and offers the same
 * retry. The sentence is the server's own, not one invented here.
 */
export function AccountUnreadableScreen({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry?: (() => void) | undefined;
}) {
  return (
    <View style={styles.launch} testID="account-failed">
      <Wordmark />
      <Text align="center" variant="small">
        We could not load your account
      </Text>
      <Text align="center" tone="secondary" variant="small">
        {message}
      </Text>
      {onRetry === undefined ? null : (
        <Button onPress={onRetry} testID="account-failed-retry" tone="primary">
          Try again
        </Button>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, gap: space[8], justifyContent: 'space-between' },
  form: { paddingBottom: space[4] },
  launch: {
    alignItems: 'center',
    backgroundColor: color.canvas,
    flex: 1,
    gap: space[4],
    justifyContent: 'center',
    padding: space[6],
  },
  launchText: { opacity: 0.8 },
  top: { gap: space[6] },
});
