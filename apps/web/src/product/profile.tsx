'use client';

import Link from 'next/link';
import { useState } from 'react';

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
  Choice,
  ErrorMessage,
  Field,
  ListRow,
  Notice,
  PageHeader,
  Section,
  Skeleton,
  Switch,
  TextArea,
  TextInput,
} from '../design/primitives';
import { AvailabilityCard } from './availability';
import { ConsumerAiAssist } from './ai-assist';
import { LanguagePicker } from './language-picker';
import { languageName, regionName } from './locale';
import { ProfilePhotos } from './media';
import { useSeededField, useSingleFlight } from './resource';

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
  // Nothing to draw yet, rather than "there is nothing". The two look identical
  // in a value and are opposite things to show somebody.
  const waiting = profile === undefined && !account.profile.settled;

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
        {editing ? (
          /*
            Asked for before the placeholder, deliberately. This screen is
            pressable before the profile read has answered — it has to be, or
            somebody arriving with a cold session would be looking at a
            spinner — and swapping an open form for a skeleton the moment that
            read starts would take away whatever they had already typed. The
            form fills itself in as the answer lands instead.
          */
          <ProfileForm
            onDone={() => {
              setEditing(false);
            }}
          />
        ) : (
          /*
            One card, whether the answer has arrived or not.

            What is unknown is drawn as a placeholder and the control is not:
            editing is something somebody may start before the server has
            answered — that is the whole point of the seeded fields below — and a
            button that appears, disappears under a reaching hand while the read
            runs, and comes back is worse than either state on its own.
          */
          <Card testId="profile-view">
            <div className="v-profile-hero">
              {waiting ? (
                <Skeleton circle height={88} width={88} />
              ) : (
                <Avatar
                  displayName={profile?.displayName ?? 'You'}
                  seed={current?.id ?? profile?.displayName ?? 'you'}
                  size="lg"
                />
              )}
              <div className="v-profile-hero__body">
                {waiting ? (
                  <>
                    <p className="v-visually-hidden" role="status">
                      Loading your profile
                    </p>
                    <Skeleton height={20} width="40%" />
                    <Skeleton height={12} width="70%" />
                  </>
                ) : (
                  <>
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
                  </>
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

        <MatchingDeclarationCard />

        <AvailabilityCard />

        <Section raised testId="photos-card" title="Photos">
          <ProfilePhotos />
        </Section>

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
                href="/you/gifts"
                testId="link-gifts"
              >
                <span className="v-notification__mark">
                  <Icon name="sparkle" size="md" />
                </span>
                <span className="v-row__body">
                  <span className="v-subheading">Sent gifts</span>
                  <span className="v-caption v-quiet">
                    Support you have sent to creators
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

/**
 * The declarations somebody may make about themselves, in their own words
 * rather than in the server's.
 *
 * The order is deliberate and it is not alphabetical, not "most common first",
 * and not ranked by anything. Two named categories, a third that is equally a
 * category and not an afterthought, and then the option to decline — which is
 * last because it is the answer to a different question, not the least
 * important one.
 */
const matchingDeclarations = [
  { label: 'Woman', value: 'woman' },
  { label: 'Man', value: 'man' },
  { label: 'Non-binary', value: 'non_binary' },
  { label: 'Prefer not to say', value: 'undisclosed' },
] as const;

/**
 * What you say about yourself, and what it is used for.
 *
 * Four rules hold this control together, and each is a way products like this
 * usually get it wrong.
 *
 * **It is optional, and the screen says so where somebody can see it.** Nothing
 * on VELORA requires an answer: an account with no declaration is complete,
 * discoverable, and matched by Everyone exactly as it is today. The only thing
 * it changes is whether somebody else's paid, narrowed search can reach you.
 *
 * **It is never displayed to anybody else.** No card, no profile, no encounter,
 * and no live session carries it, and the server publishes it in exactly one
 * place: this person reading their own profile.
 *
 * **It is never inferred.** There is no path anywhere in this product that
 * derives it from a photograph, a name, a voice, or a country, and this control
 * is the only way a value is ever set.
 *
 * **Declining is a real answer.** "Prefer not to say" is stored as such and is
 * treated exactly like no answer for matching, so choosing it stops the
 * question being asked again without costing anything.
 */
function MatchingDeclarationCard() {
  const api = useApi();
  const account = useAccount();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const profile = account.profile.value;
  const declared = profile?.matchingGender;

  return (
    <Section
      raised
      testId="matching-declaration-card"
      title="How you are matched"
    >
      <p className="v-caption v-quiet v-measure">
        Some people pay to narrow who they meet on Live. This is what you tell
        VELORA about yourself so that search can include you. It is optional, it
        is never shown to anybody, and nothing about you is ever guessed.
      </p>
      <fieldset className="v-fieldset" disabled={busy}>
        <legend className="v-visually-hidden">
          How you would like to be matched
        </legend>
        {matchingDeclarations.map((option) => (
          <Choice
            checked={declared === option.value}
            key={option.value}
            label={option.label}
            name="matchingGender"
            onSelect={() => {
              run(async () => {
                const result = await api.saveMatchingGender({
                  matchingGender: option.value,
                });
                const failure = failureMessage(result);
                toast.show(
                  failure ?? 'Saved. It applies to the next person you meet.',
                  failure === undefined ? 'positive' : 'critical',
                );
                account.reloadAll();
              });
            }}
            value={option.value}
          />
        ))}
      </fieldset>
      {declared === undefined ? (
        <p
          className="v-caption v-quiet"
          data-testid="matching-declaration-unset"
        >
          You have not answered this. You do not have to.
        </p>
      ) : null}
    </Section>
  );
}

function ProfileForm({ onDone }: { readonly onDone: () => void }) {
  const api = useApi();
  const account = useAccount();
  const toast = useToast();
  const profile = account.profile.value;
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [touched, setTouched] = useState(false);
  const { busy, run } = useSingleFlight();
  // Every field follows the server until somebody types in it, and is theirs
  // after that. The form opens before the profile read has necessarily
  // answered — the screen offers it as soon as it can — so an answer arriving
  // afterwards must fill in what is still untouched without taking back what
  // is not.
  const version = profile?.version;
  const displayName = useSeededField(profile?.displayName ?? '', version);
  const bio = useSeededField(profile?.bio ?? '', version);
  const languages = useSeededField<readonly string[]>(
    profile?.languages ?? [],
    version,
  );
  const enteredName = displayName.value.trim();
  const nameValid =
    enteredName.length >= minimumDisplayNameLength &&
    enteredName.length <= maximumDisplayNameLength;
  const languagesValid = languages.value.length > 0;

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
              ...(bio.value.trim().length === 0
                ? {}
                : { bio: bio.value.trim() }),
              displayName: enteredName,
              ...(version === undefined ? {} : { expectedVersion: version }),
              languages: [...languages.value],
            }),
          );
        }}
      >
        <h2 className="v-subheading">Edit profile</h2>

        <Field
          count={{
            length: displayName.value.length,
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
                displayName.set(event.target.value);
              }}
              value={displayName.value}
            />
          )}
        </Field>

        <LanguagePicker
          error={
            touched && !languagesValid
              ? 'Add at least one language.'
              : undefined
          }
          onChange={languages.set}
          value={languages.value}
        />

        <Field
          count={{ length: bio.value.length, maximum: maximumBioLength }}
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
                bio.set(event.target.value);
              }}
              rows={4}
              value={bio.value}
            />
          )}
        </Field>

        <ConsumerAiAssist
          capability="consumer_profile_bio"
          draft={bio.value}
          onReplace={bio.set}
          testId="profile-ai"
        />

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
