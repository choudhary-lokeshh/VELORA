'use client';

import Link from 'next/link';
import { useState } from 'react';

import { consumerAuthCauseMessages } from '../auth/state';
import { Icon } from '../design/icons';
import {
  Button,
  ErrorMessage,
  Field,
  Notice,
  TextInput,
} from '../design/primitives';
import { useSession } from '../app/providers';

/**
 * Signing in.
 *
 * What this screen offers is exactly what the platform has. No identity
 * provider is approved — `docs/decisions/DECISIONS_REQUIRED.md` records why, and
 * `packages/config` refuses to start staging or production while that is true —
 * so the only thing behind this form is the local development adapter. It is
 * named as such rather than dressed up as a password field, because a password
 * box that accepts anything is a lie told to the person using it and to whoever
 * reviews the screenshot later.
 *
 * The form waits for the session answer before it appears. The page is
 * delivered before anybody knows whose it is, and a form that is pressable in
 * that window swallows the press silently.
 */
export function SignIn() {
  const session = useSession();
  const [subject, setSubject] = useState('');
  const [touched, setTouched] = useState(false);

  const empty = subject.trim().length === 0;

  return (
    <div className="v-focus-page">
      <main className="v-focus-page__panel" id="main">
        <div className="v-stack v-stack--4">
          <Link className="v-wordmark" href="/">
            <Icon name="sparkle" size="md" />
            VELORA
          </Link>
          <h1 className="v-title">Sign in</h1>
          {session.auth.status === 'unauthenticated' &&
          session.auth.cause !== 'initial' ? (
            <p className="v-small v-muted" data-testid="auth-cause">
              {consumerAuthCauseMessages[session.auth.cause]}
            </p>
          ) : null}
        </div>

        <Notice
          testId="sign-in-development"
          title="Development sign-in"
          tone="quiet"
        >
          VELORA has no live sign-in provider yet, so this environment admits a
          development identity instead. Choose any address you like; it is not
          checked, and it grants nothing outside this environment.
        </Notice>

        <form
          className="v-stack v-stack--5"
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (empty) return;
            session.signIn(subject.trim());
          }}
        >
          <Field
            error={
              touched && empty ? 'Enter an address to continue.' : undefined
            }
            hint="Anything you will remember. The same address signs you back into the same account."
            label="Development identity"
          >
            {(control) => (
              <TextInput
                {...control}
                autoComplete="username"
                data-testid="sign-in-subject"
                inputMode="email"
                name="subject"
                onChange={(event) => {
                  setSubject(event.target.value);
                }}
                placeholder="you@example.com"
                value={subject}
              />
            )}
          </Field>

          <Button
            block
            busy={session.busy}
            data-testid="auth-sign-in"
            size="lg"
            tone="primary"
            type="submit"
          >
            Continue
          </Button>

          {session.auth.status === 'rejected' ? (
            <ErrorMessage testId="auth-rejected">
              That sign-in was refused. Wait a moment and try again.
            </ErrorMessage>
          ) : null}
          {session.auth.status === 'unavailable' ? (
            <ErrorMessage testId="auth-unavailable">
              VELORA could not be reached. Check your connection and try again.
            </ErrorMessage>
          ) : null}
        </form>

        <p className="v-caption v-quiet">
          VELORA is for adults. Continuing does not confirm your age — you will
          be asked to declare it, and a declaration is not a verified check.
        </p>
      </main>
    </div>
  );
}
