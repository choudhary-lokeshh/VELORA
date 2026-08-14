'use client';

import { useEffect, useRef, useState } from 'react';

import type { ApiResult, ConsumerApi } from '@velora/consumer-client';
import { failureMessage } from '@velora/consumer-client';
import type { AccountState } from './account';
import { ProfilePhoto } from './media';
import { useSingleFlight } from './resource';
import { ErrorMessage, Section, StatusMessage } from './ui';

/**
 * The profile, its images, and whether it may be seen.
 *
 * Two rules shape this screen. Edits carry the version the client last read, so
 * a change made in another tab loses the race explicitly rather than silently
 * overwriting; a conflict is reported and the surface re-reads. And nothing
 * here decides discoverability — the server refuses to make an incomplete
 * profile discoverable, and this screen shows the requirements it publishes
 * rather than re-deriving them.
 *
 * There is no claim about scanning or moderation. No media provider is approved
 * (`docs/decisions/DECISIONS_REQUIRED.md`), the configured adapter refuses to
 * store anything in every deployed environment, and this surface says exactly
 * that when it happens instead of leaving an upload looking like it worked.
 */
export function ProfilePanel({
  account,
  api,
}: {
  readonly account: AccountState;
  readonly api: ConsumerApi;
}) {
  const profile = account.profile.value;
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [languages, setLanguages] = useState('');
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const { busy, run } = useSingleFlight();
  // The form is seeded from the server once, and re-seeded whenever a newer
  // version arrives. Anything else would fight the person as they type.
  const seededVersion = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (profile === undefined) return;
    if (seededVersion.current === profile.version) return;
    seededVersion.current = profile.version;
    setDisplayName(profile.displayName ?? '');
    setBio(profile.bio ?? '');
    setLanguages(profile.languages.join(', '));
  }, [profile]);

  const submit = (work: () => Promise<ApiResult<unknown>>) => {
    run(async () => {
      setMessage(undefined);
      setNotice(undefined);
      const result = await work();
      setMessage(failureMessage(result));
      if (result.kind === 'ok') setNotice('Saved.');
      account.reloadAll();
    });
  };

  return (
    <Section headingId="profile-heading" title="Profile">
      {account.profile.loading && profile === undefined ? (
        <StatusMessage testId="profile-loading">
          Loading your profile…
        </StatusMessage>
      ) : null}
      {account.profile.error === undefined ? null : (
        <ErrorMessage testId="profile-load-failed">
          {account.profile.error}
        </ErrorMessage>
      )}
      {notice === undefined ? null : (
        <StatusMessage testId="profile-saved">{notice}</StatusMessage>
      )}
      {message === undefined ? null : (
        <ErrorMessage testId="profile-error">{message}</ErrorMessage>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(async () =>
            api.saveProfile({
              ...(bio.trim().length === 0 ? {} : { bio }),
              displayName,
              ...(profile?.version === undefined
                ? {}
                : { expectedVersion: profile.version }),
              languages: languages
                .split(',')
                .map((value) => value.trim().toLowerCase())
                .filter((value) => value.length > 0),
            }),
          );
        }}
      >
        <label htmlFor="profile-display-name">Display name</label>
        <input
          id="profile-display-name"
          maxLength={32}
          minLength={2}
          name="displayName"
          onChange={(event) => {
            setDisplayName(event.target.value);
          }}
          required
          value={displayName}
        />

        <label htmlFor="profile-bio">About you</label>
        <textarea
          id="profile-bio"
          maxLength={500}
          name="bio"
          onChange={(event) => {
            setBio(event.target.value);
          }}
          rows={3}
          value={bio}
        />

        <label htmlFor="profile-languages">
          Languages you speak, comma separated
        </label>
        <input
          id="profile-languages"
          name="languages"
          onChange={(event) => {
            setLanguages(event.target.value);
          }}
          required
          value={languages}
        />

        <button data-testid="profile-save" disabled={busy} type="submit">
          Save profile
        </button>
      </form>

      <h3>Photo</h3>
      <ProfilePhoto
        api={api}
        busy={busy}
        onFinished={account.reloadAll}
        profile={profile}
      />

      <h3>Who can see you</h3>
      <p data-testid="profile-requirements">
        {profile === undefined || profile.outstandingRequirements.length === 0
          ? 'Your profile meets the minimum to be seen.'
          : `Still needed: ${profile.outstandingRequirements
              .map((requirement) => requirement.replaceAll('_', ' '))
              .join(', ')}`}
      </p>
      <div className="row">
        <label htmlFor="profile-discoverable">Appear in discovery</label>
        <input
          checked={profile?.discoverable ?? false}
          disabled={busy || profile === undefined}
          id="profile-discoverable"
          name="discoverable"
          onChange={(event) => {
            const discoverable = event.target.checked;
            submit(async () =>
              api.savePreferences({
                discoverable,
                ...(profile?.preferencesVersion === undefined
                  ? {}
                  : { expectedVersion: profile.preferencesVersion }),
              }),
            );
          }}
          type="checkbox"
        />
      </div>
    </Section>
  );
}
