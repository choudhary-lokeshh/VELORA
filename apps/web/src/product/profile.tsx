'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import {
  maximumBioLength,
  maximumDisplayNameLength,
  minimumDisplayNameLength,
} from '@velora/validation';
import type { ApiResult } from '@velora/consumer-client';
import { accountStanding, failureMessage } from '@velora/consumer-client';

import { useAccount, useApi, useToast } from '../app/providers';
import { Icon } from '../design/icons';
import {
  Avatar,
  Button,
  Card,
  Chip,
  ErrorMessage,
  Field,
  ListRow,
  Notice,
  PageHeader,
  Skeleton,
  Switch,
  TextArea,
  TextInput,
} from '../design/primitives';
import { AvailabilityCard } from './availability';
import { LanguagePicker } from './language-picker';
import { languageName, regionName } from './locale';
import { ProfilePhotos } from './media';
import { useSingleFlight } from './resource';

/**
 * Your profile, and the controls that decide who sees it.
 *
 * Two rules shape this screen. Edits carry the version the client last read, so
 * a change made in another tab loses the race explicitly rather than silently
 * overwriting; a conflict is reported and the surface re-reads. And nothing here
 * decides discoverability — the server refuses to make an incomplete profile
 * discoverable, and this screen shows the requirements it publishes rather than
 * re-deriving them.
 *
 * Reading a profile and editing one deliberately do not look the same. A screen
 * that is permanently a form makes somebody feel like a record rather than a
 * person, and it hides which of the values on it are actually saved.
 */

/** Requirements the server publishes, in words rather than in field names. */
const requirementLabels: Readonly<Record<string, string>> = {
  bio: 'a short bio',
  display_name: 'a display name',
  languages: 'at least one language',
  ready_media: 'one photo that has been checked',
  region: 'the country you are in',
};

export function You() {
  const account = useAccount();
  const profile = account.profile.value;
  const current = account.account.value;
  const [editing, setEditing] = useState(false);

  const standing = current === undefined ? undefined : accountStanding(current);
  const outstanding = profile?.outstandingRequirements ?? [];

  return (
    <>
      <PageHeader title="You" />

      {standing === 'restricted' ? (
        <div className="v-lede-gap">
          {/*
            Said once, to the account it describes, in the coarse terms the
            server publishes. No enforcement detail and no appeal invented here.
          */}
          <Notice
            testId="account-restricted"
            title="Some things are unavailable right now"
            tone="caution"
          >
            This account is restricted. What that covers, and whether you can
            ask us to look again, is on your{' '}
            <Link href="/you/safety">safety page</Link>.
          </Notice>
        </div>
      ) : null}

      <div className="v-stack v-stack--6">
        {account.profile.loading && profile === undefined ? (
          <Card>
            <div className="v-profile-hero">
              <Skeleton circle height={88} width={88} />
              <div className="v-profile-hero__body" style={{ flex: 1 }}>
                <Skeleton height={20} width="40%" />
                <Skeleton height={12} width="70%" />
              </div>
            </div>
          </Card>
        ) : editing ? (
          <ProfileForm
            onDone={() => {
              setEditing(false);
            }}
          />
        ) : (
          <Card testId="profile-view">
            <div className="v-profile-hero">
              <Avatar
                displayName={profile?.displayName ?? 'You'}
                seed={current?.id ?? profile?.displayName ?? 'you'}
                size="lg"
              />
              <div className="v-profile-hero__body">
                <h2 className="v-title v-wrap" data-testid="profile-name">
                  {profile?.displayName ?? 'Your profile'}
                </h2>
                <div className="v-inline v-inline--tight">
                  {regionName(profile?.region) === undefined ? null : (
                    <Chip>
                      <Icon name="globe" size="sm" />
                      {regionName(profile?.region)}
                    </Chip>
                  )}
                  {(profile?.languages ?? []).map((code) => (
                    <Chip key={code}>{languageName(code)}</Chip>
                  ))}
                </div>
                {profile?.bio === undefined || profile.bio.length === 0 ? (
                  <p className="v-small v-quiet">
                    No bio yet. A couple of sentences goes a long way.
                  </p>
                ) : (
                  <p
                    className="v-small v-muted v-wrap"
                    data-testid="profile-bio"
                  >
                    {profile.bio}
                  </p>
                )}
                <div>
                  <Button
                    data-testid="profile-edit"
                    icon="settings"
                    onClick={() => {
                      setEditing(true);
                    }}
                  >
                    Edit profile
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}

        {outstanding.length === 0 ? null : (
          <Notice
            testId="profile-requirements"
            title="Your profile is not complete"
            tone="caution"
          >
            Before you can be shown to anybody, VELORA needs{' '}
            {listOf(outstanding.map((item) => requirementLabels[item] ?? item))}
            .
          </Notice>
        )}

        <DiscoverySwitch />

        <AvailabilityCard />

        <section
          aria-labelledby="photos-heading"
          className="v-card"
          data-testid="photos-card"
        >
          <div className="v-stack v-stack--5">
            <h2 className="v-subheading" id="photos-heading">
              Photos
            </h2>
            <ProfilePhotos />
          </div>
        </section>

        <Card flush>
          <ul className="v-list v-list--divided">
            <li>
              <ListRow
                aside={<Icon name="chevronRight" size="sm" />}
                href="/you/settings"
                testId="link-settings"
              >
                <span className="v-notification__mark">
                  <Icon name="settings" size="md" />
                </span>
                <span className="v-row__body">
                  <span className="v-subheading">Settings</span>
                  <span className="v-caption v-quiet">
                    Notices, sessions, and signing out
                  </span>
                </span>
              </ListRow>
            </li>
            <li>
              <ListRow
                aside={<Icon name="chevronRight" size="sm" />}
                href="/you/safety"
                testId="link-safety"
              >
                <span className="v-notification__mark">
                  <Icon name="shield" size="md" />
                </span>
                <span className="v-row__body">
                  <span className="v-subheading">Safety</span>
                  <span className="v-caption v-quiet">
                    People you have blocked, reports you have made, decisions
                    about your account
                  </span>
                </span>
              </ListRow>
            </li>
            <li>
              <ListRow
                aside={<Icon name="chevronRight" size="sm" />}
                href="/you/memberships"
                testId="link-memberships"
              >
                <span className="v-notification__mark">
                  <Icon name="membership" size="md" />
                </span>
                <span className="v-row__body">
                  <span className="v-subheading">Memberships</span>
                  <span className="v-caption v-quiet">
                    What you are paying for
                  </span>
                </span>
              </ListRow>
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}

function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

function DiscoverySwitch() {
  const api = useApi();
  const account = useAccount();
  const toast = useToast();
  const profile = account.profile.value;
  const { busy, run } = useSingleFlight();
  const complete = (profile?.outstandingRequirements ?? []).length === 0;

  return (
    <section className="v-card" data-testid="discoverable-card">
      <Switch
        checked={profile?.discoverable ?? false}
        description={
          complete
            ? 'When this is on and you are available, other people can find you.'
            : 'Finish your profile first — VELORA will not show an incomplete one.'
        }
        disabled={busy || profile === undefined || !complete}
        label="Appear in discovery"
        onChange={(next) => {
          run(async () => {
            const result = await api.savePreferences({
              discoverable: next,
              ...(profile?.preferencesVersion === undefined
                ? {}
                : { expectedVersion: profile.preferencesVersion }),
            });
            const failure = failureMessage(result);
            toast.show(
              failure ??
                (next
                  ? 'You can be found in discovery.'
                  : 'You are hidden from discovery.'),
              failure === undefined ? 'positive' : 'critical',
            );
            account.reloadAll();
          });
        }}
        testId="profile-discoverable"
      />
    </section>
  );
}

function ProfileForm({ onDone }: { readonly onDone: () => void }) {
  const api = useApi();
  const account = useAccount();
  const toast = useToast();
  const profile = account.profile.value;
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [languages, setLanguages] = useState<readonly string[]>([]);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [touched, setTouched] = useState(false);
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
    setLanguages(profile.languages);
  }, [profile]);

  const nameValid =
    displayName.trim().length >= minimumDisplayNameLength &&
    displayName.trim().length <= maximumDisplayNameLength;
  const languagesValid = languages.length > 0;

  const submit = (work: () => Promise<ApiResult<unknown>>) => {
    run(async () => {
      setMessage(undefined);
      const result = await work();
      const failure = failureMessage(result);
      if (failure !== undefined) {
        setMessage(failure);
        account.reloadAll();
        return;
      }
      toast.show('Profile saved.', 'positive');
      account.reloadAll();
      onDone();
    });
  };

  return (
    <Card testId="profile-form">
      <form
        className="v-stack v-stack--5"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (!nameValid || !languagesValid) return;
          submit(async () =>
            api.saveProfile({
              ...(bio.trim().length === 0 ? {} : { bio: bio.trim() }),
              displayName: displayName.trim(),
              ...(profile?.version === undefined
                ? {}
                : { expectedVersion: profile.version }),
              languages: [...languages],
            }),
          );
        }}
      >
        <h2 className="v-subheading">Edit profile</h2>

        <Field
          count={{
            length: displayName.length,
            maximum: maximumDisplayNameLength,
          }}
          error={
            touched && !nameValid
              ? `Between ${String(minimumDisplayNameLength)} and ${String(
                  maximumDisplayNameLength,
                )} characters.`
              : undefined
          }
          label="Display name"
        >
          {(control) => (
            <TextInput
              {...control}
              autoComplete="nickname"
              data-testid="profile-display-name"
              maxLength={maximumDisplayNameLength}
              name="displayName"
              onChange={(event) => {
                setDisplayName(event.target.value);
              }}
              value={displayName}
            />
          )}
        </Field>

        <LanguagePicker
          error={
            touched && !languagesValid
              ? 'Add at least one language.'
              : undefined
          }
          onChange={setLanguages}
          value={languages}
        />

        <Field
          count={{ length: bio.length, maximum: maximumBioLength }}
          hint="Other people read this before deciding whether to say yes."
          label="About you"
          optional
        >
          {(control) => (
            <TextArea
              {...control}
              data-testid="profile-bio-input"
              maxLength={maximumBioLength}
              name="bio"
              onChange={(event) => {
                setBio(event.target.value);
              }}
              rows={4}
              value={bio}
            />
          )}
        </Field>

        {message === undefined ? null : (
          <ErrorMessage testId="profile-error">{message}</ErrorMessage>
        )}

        <div className="v-inline">
          <Button
            busy={busy}
            data-testid="profile-save"
            tone="primary"
            type="submit"
          >
            Save changes
          </Button>
          <Button
            data-testid="profile-cancel"
            disabled={busy}
            onClick={onDone}
            tone="ghost"
          >
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
