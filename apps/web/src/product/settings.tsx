'use client';

import { useCallback, useState } from 'react';

import type { NotificationPreference } from '@velora/consumer-client';
import { failureMessage } from '@velora/consumer-client';

import { useAccount, useApi, useSession, useToast } from '../app/providers';
import { ConfirmDialog } from '../design/dialog';
import {
  Button,
  ErrorMessage,
  Notice,
  PageHeader,
  Section,
  Skeleton,
  Switch,
} from '../design/primitives';
import { formatFullDay, regionName } from './locale';
import { useResource, useSingleFlight } from './resource';

/**
 * Settings: the decisions a person can actually make about their account.
 *
 * Nothing here is invented. The notification switches are the exact category and
 * channel pairs the server says are settable — mandatory classes such as account
 * security and safety notices never appear, because they are not offers — and if
 * the server returns none, none are shown rather than a page of controls that do
 * nothing.
 *
 * What the switches do *not* claim is that anything will arrive. No email or
 * push provider is approved, and Consumer Web is not a push destination in any
 * case, so the choices are recorded against the day one exists and the screen
 * says exactly that.
 */

const categoryLabels: Readonly<Record<string, string>> = {
  account_security: 'Account security',
  call: 'Calls',
  direct_message: 'New messages',
  introduction: 'Introductions',
  marketing: 'News from VELORA',
  safety_legal: 'Safety and legal notices',
};

const channelLabels: Readonly<Record<string, string>> = {
  email: 'by email',
  push: 'on your phone',
  sms: 'by text message',
};

function preferenceKey(preference: NotificationPreference): string {
  return `${preference.category}:${preference.channel}`;
}

export function Settings() {
  return (
    <>
      <PageHeader
        lede="What VELORA sends you, and how you leave this device."
        title="Settings"
      />
      <div className="v-stack v-stack--6">
        <NotificationPreferences />
        <AccountCard />
        <SessionCard />
      </div>
    </>
  );
}

function NotificationPreferences() {
  const api = useApi();
  const toast = useToast();
  const load = useCallback(
    async (signal: AbortSignal) => api.notificationPreferences(signal),
    [api],
  );
  const preferences = useResource(load);
  const [saving, setSaving] = useState<string | undefined>(undefined);
  const rows = preferences.value?.preferences ?? [];

  const set = (preference: NotificationPreference, enabled: boolean) => {
    const key = preferenceKey(preference);
    setSaving(key);
    void api
      .saveNotificationPreference({
        category: preference.category,
        channel: preference.channel,
        enabled,
      })
      .then((result) => {
        const failure = failureMessage(result);
        if (failure !== undefined) toast.show(failure, 'critical');
        preferences.reload();
      })
      .finally(() => {
        setSaving(undefined);
      });
  };

  return (
    <Section raised testId="notice-preferences" title="Notices">
      <Notice
        icon="lock"
        testId="notice-delivery-blocked"
        title="Nothing is sent outside VELORA yet"
        tone="quiet"
      >
        No email or push provider is approved, and a website cannot be a push
        destination in any case. These choices are stored and will apply the day
        a channel exists; until then every notice waits for you on the Notices
        page.
      </Notice>

      {preferences.loading && preferences.value === undefined ? (
        <div className="v-stack v-stack--3">
          <Skeleton height={20} />
          <Skeleton height={20} />
        </div>
      ) : null}

      {preferences.error === undefined ? null : (
        <div className="v-stack v-stack--3">
          <ErrorMessage testId="notice-preferences-failed">
            {preferences.error}
          </ErrorMessage>
          {preferences.retryable ? (
            <div>
              <Button onClick={preferences.reload}>Try again</Button>
            </div>
          ) : null}
        </div>
      )}

      {!preferences.loading &&
      preferences.error === undefined &&
      rows.length === 0 ? (
        <p className="v-small v-quiet" data-testid="notice-preferences-empty">
          There is nothing to decide yet. Notices you cannot switch off —
          account security, safety, and legal — are never offered as a choice.
        </p>
      ) : null}

      <div className="v-stack v-stack--2">
        {rows.map((preference) => {
          const key = preferenceKey(preference);
          return (
            <Switch
              checked={preference.enabled}
              description={`Reach me ${channelLabels[preference.channel] ?? preference.channel}.`}
              disabled={saving !== undefined}
              key={key}
              label={categoryLabels[preference.category] ?? preference.category}
              onChange={(next) => {
                set(preference, next);
              }}
              testId={`notice-${key}`}
            />
          );
        })}
      </div>
    </Section>
  );
}

function AccountCard() {
  const account = useAccount();
  const current = account.account.value;
  const region = regionName(current?.region);

  return (
    <Section gap={4} raised testId="account-card" title="Account">
      <dl className="v-stack v-stack--3">
        <div className="v-inline v-inline--between">
          <dt className="v-small v-muted">Member since</dt>
          <dd className="v-small">
            {current === undefined ? (
              <Skeleton height={14} width={90} />
            ) : (
              <time dateTime={current.createdAt}>
                {formatFullDay(current.createdAt)}
              </time>
            )}
          </dd>
        </div>
        {region === undefined ? null : (
          <div className="v-inline v-inline--between">
            <dt className="v-small v-muted">Country</dt>
            <dd className="v-small">{region}</dd>
          </div>
        )}
      </dl>
      <p className="v-caption v-quiet">
        Closing your account is not something this page can do yet. Deletion
        reaches every domain that holds anything about you, and that path is not
        finished.
      </p>
    </Section>
  );
}

function SessionCard() {
  const session = useSession();
  const [confirming, setConfirming] = useState(false);
  const { busy, run } = useSingleFlight();

  return (
    <Section gap={4} raised testId="session-card" title="This device">
      <p className="v-small v-muted">
        Signing out here ends this browser&apos;s session. Signing out
        everywhere ends every session on every device you are signed in on.
      </p>
      <div className="v-inline">
        <Button
          busy={session.busy}
          data-testid="auth-sign-out"
          icon="logOut"
          onClick={session.signOut}
        >
          Sign out
        </Button>
        <Button
          data-testid="auth-sign-out-everywhere"
          disabled={session.busy || busy}
          onClick={() => {
            setConfirming(true);
          }}
          tone="ghost"
        >
          Sign out everywhere
        </Button>
      </div>

      {confirming ? (
        <ConfirmDialog
          busy={busy}
          confirmLabel="Sign out everywhere"
          onCancel={() => {
            setConfirming(false);
          }}
          onConfirm={() => {
            run(async () => {
              session.signOutEverywhere();
              setConfirming(false);
              return Promise.resolve();
            });
          }}
          testId="sign-out-everywhere"
          title="Sign out on every device?"
        >
          <p>
            Every session you have anywhere ends immediately, including this
            one. You will need to sign in again on each device.
          </p>
        </ConfirmDialog>
      ) : null}
    </Section>
  );
}
