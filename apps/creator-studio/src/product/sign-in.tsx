'use client';

import { useState } from 'react';

import { creatorAuthCauseMessages } from '../auth/state';
import {
  Button,
  Card,
  ErrorMessage,
  Field,
  Notice,
  TextInput,
} from '../design/primitives';
import { useSession } from '../app/providers';
import { EntryLayout } from '../app/shell';

/**
 * Signing in to Creator Studio.
 *
 * A different door from the consumer one, on purpose. The session this issues
 * is scoped to the `creator_studio` audience and lives in its own `__Host-`
 * cookie, so a consumer session cannot become a creator session by opening this
 * address, and this one cannot reach a consumer route. That separation is
 * `AGENTS.md`'s and the server enforces it; this screen only says so.
 *
 * What the form offers is exactly what the platform has. No identity provider
 * is approved — `docs/decisions/DECISIONS_REQUIRED.md` records why, and
 * `packages/config` refuses to start staging or production while that is true —
 * so the only thing behind it is the local development adapter. It is named as
 * such rather than dressed up as a password field, because a password box that
 * accepts anything is a lie told to the person using it and to whoever reviews
 * the screenshot later.
 */
export function SignIn() {
  const session = useSession();
  const [subject, setSubject] = useState('');
  const [touched, setTouched] = useState(false);

  const empty = subject.trim().length === 0;

  return (
    <EntryLayout>
      <Card>
        <div className="s-stack s-stack--2">
          <h1 className="s-title">Creator Studio</h1>
          <p className="s-small s-muted">
            Where you run your public page, your catalog, and your private
            clubs.
          </p>
          {session.auth.status === 'unauthenticated' &&
          session.auth.cause !== 'initial' ? (
            <p className="s-small s-muted" data-testid="auth-cause">
              {creatorAuthCauseMessages[session.auth.cause]}
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
          className="s-stack s-stack--5"
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
            hint="The same address you use on VELORA. Creator access sits on that account rather than beside it."
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
      </Card>

      <p className="s-caption s-quiet">
        Creator Studio sessions are shorter than the ones on VELORA itself, so
        you will be asked to sign in again more often here.
      </p>
    </EntryLayout>
  );
}
