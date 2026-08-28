'use client';

import Link from 'next/link';
import { useState } from 'react';

import {
  maximumBioLength,
  maximumDisplayNameLength,
  maximumProfileLanguages,
  minimumDisplayNameLength,
} from '@velora/validation';
import type {
  ApiResult,
  ConsumerProfile,
  JourneyStage,
} from '@velora/consumer-client';
import { failureMessage, journeyStage } from '@velora/consumer-client';

import { useAccount, useApi, useSession } from '../app/providers';
import { Icon } from '../design/icons';
import {
  Button,
  ErrorMessage,
  Field,
  Notice,
  TextArea,
  TextInput,
} from '../design/primitives';
import { LanguagePicker } from './language-picker';
import { ProfilePhotos } from './media';
import { regionName } from './locale';
import { useSeededField, useSingleFlight } from './resource';

/**
 * Admission, one step at a time.
 *
 * The order is the server's. `docs/flows/onboarding.md` fixes the ladder and the
 * API derives the current step from stored evidence, so this screen asks for
 * whatever the server says is outstanding and never decides that somebody has
 * finished. The progress indicator counts the server's steps rather than a
 * client-side wizard position, which is why it stays correct when somebody
 * completes a step on another device.
 *
 * The declaration collects a region and a yes. It does not collect a date of
 * birth: the minimum age per country is unresolved
 * (`docs/compliance/02-adult-age-verification.md`), and asking for a birth date
 * would gather sensitive data for a rule that does not exist yet. Nothing here
 * calls a declaration a verified check, because it is not one.
 */

const ladder: readonly JourneyStage[] = [
  'account_required',
  'adult_declaration',
  'policy_acknowledgement',
  'profile',
];

/** What each policy key is, in words. Anything unlisted is shown as sent. */
const policyTitles: Readonly<Record<string, string>> = {
  community_guidelines: 'Community guidelines',
  privacy_notice: 'Privacy notice',
  terms_of_service: 'Terms of service',
};

function policyTitle(key: string): string {
  return policyTitles[key] ?? key.replaceAll('_', ' ');
}

export function Welcome() {
  const api = useApi();
  const account = useAccount();
  const session = useSession();
  const stage = journeyStage(account.onboarding.value);
  const position = ladder.indexOf(stage);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const { busy, run } = useSingleFlight();

  const submit = (work: () => Promise<ApiResult<unknown>>) => {
    run(async () => {
      setMessage(undefined);
      setMessage(failureMessage(await work()));
      account.reloadAll();
    });
  };

  return (
    <div className="v-onboarding">
      <header className="v-stack v-stack--5">
        <Link className="v-wordmark" href="/welcome">
          <Icon name="sparkle" size="md" />
          VELORA
        </Link>
        <ol className="v-steps" data-testid="welcome-progress">
          {ladder.map((step, index) => (
            <li
              className={`v-steps__step${
                index < position
                  ? ' v-steps__step--done'
                  : index === position
                    ? ' v-steps__step--current'
                    : ''
              }`}
              key={step}
            >
              <span className="v-visually-hidden">
                Step {index + 1} of {ladder.length}
              </span>
            </li>
          ))}
        </ol>
      </header>

      <main className="v-stack v-stack--6" id="main">
        {account.onboarding.loading &&
        account.onboarding.value === undefined ? (
          <p className="v-muted" data-testid="welcome-loading" role="status">
            Loading your next step…
          </p>
        ) : null}
        {message === undefined ? null : (
          <ErrorMessage testId="welcome-error">{message}</ErrorMessage>
        )}

        {stage === 'account_required' ? (
          <CreateAccountStep
            busy={busy}
            onCreate={() => {
              submit(async () => api.createAccount());
            }}
          />
        ) : null}

        {stage === 'adult_declaration' ? (
          <AdultStep
            busy={busy}
            onDeclare={(region) => {
              submit(async () => api.declareAdult(region));
            }}
            refused={account.onboarding.value?.adultAssuranceRefused === true}
          />
        ) : null}

        {stage === 'policy_acknowledgement' ? (
          <PoliciesStep
            busy={busy}
            documents={account.onboarding.value?.outstandingPolicies ?? []}
            onAccept={() => {
              submit(async () =>
                api.acknowledgePolicies(
                  account.onboarding.value?.outstandingPolicies ?? [],
                ),
              );
            }}
          />
        ) : null}

        {stage === 'profile' ? (
          <ProfileStep
            busy={busy}
            onSave={(input) => {
              submit(async () => api.saveProfile(input));
            }}
            outstanding={account.onboarding.value?.outstandingProfile ?? []}
            profile={account.profile.value}
          />
        ) : null}
      </main>

      {/*
        A way out, before there is a product to leave.
        Everything else that ends a session lives behind the admission this
        screen is asking somebody to complete, so without this a person who
        signed in as the wrong identity — or on somebody else's machine — would
        have no control at all.
      */}
      <footer className="v-stack v-stack--3">
        <p className="v-caption v-quiet">Not you, or not now?</p>
        <div className="v-inline">
          <Button
            busy={session.busy}
            data-testid="auth-sign-out"
            icon="logOut"
            onClick={session.signOut}
            size="sm"
            tone="ghost"
          >
            Sign out
          </Button>
          <Button
            data-testid="auth-sign-out-everywhere"
            disabled={session.busy}
            onClick={session.signOutEverywhere}
            size="sm"
            tone="ghost"
          >
            Sign out everywhere
          </Button>
        </div>
      </footer>
    </div>
  );
}

function StepFrame({
  children,
  lede,
  title,
}: {
  readonly children: React.ReactNode;
  readonly lede: string;
  readonly title: string;
}) {
  return (
    <section className="v-stack v-stack--6">
      <div className="v-stack v-stack--3">
        <h1 className="v-title">{title}</h1>
        <p className="v-muted">{lede}</p>
      </div>
      {children}
    </section>
  );
}

function CreateAccountStep({
  busy,
  onCreate,
}: {
  readonly busy: boolean;
  readonly onCreate: () => void;
}) {
  return (
    <StepFrame
      lede="You are signed in, but there is no VELORA account behind it yet. Creating one takes a moment and nothing is shown to anybody until you finish."
      title="Welcome to VELORA"
    >
      <Button
        block
        busy={busy}
        data-testid="create-account"
        onClick={onCreate}
        size="lg"
        tone="primary"
      >
        Create my account
      </Button>
    </StepFrame>
  );
}

function AdultStep({
  busy,
  onDeclare,
  refused,
}: {
  readonly busy: boolean;
  readonly onDeclare: (region: string) => void;
  readonly refused: boolean;
}) {
  const [region, setRegion] = useState('');
  const [touched, setTouched] = useState(false);
  const normalized = region.trim().toUpperCase();
  const valid = /^[A-Z]{2}$/u.test(normalized);
  const resolved = regionName(normalized);

  return (
    <StepFrame
      lede="VELORA is for adults. Confirming here is a declaration you are making, not an identity or age check we have run."
      title="Confirm you are an adult"
    >
      {refused ? (
        <ErrorMessage testId="adult-refused">
          This account is not eligible to continue.
        </ErrorMessage>
      ) : null}

      <form
        className="v-stack v-stack--5"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (!valid) return;
          onDeclare(normalized);
        }}
      >
        <Field
          error={
            touched && !valid
              ? 'Enter a two-letter country code, such as ES.'
              : undefined
          }
          hint={
            resolved === undefined
              ? 'Two letters, such as ES for Spain or JP for Japan. It decides which rules apply to your account.'
              : `That is ${resolved}.`
          }
          label="Where you are"
        >
          {(control) => (
            <TextInput
              {...control}
              autoCapitalize="characters"
              autoComplete="country"
              data-testid="onboarding-region"
              maxLength={2}
              name="region"
              onChange={(event) => {
                setRegion(event.target.value.toUpperCase());
              }}
              placeholder="ES"
              value={region}
            />
          )}
        </Field>

        <Button
          block
          busy={busy}
          data-testid="declare-adult"
          size="lg"
          tone="primary"
          type="submit"
        >
          I am an adult
        </Button>
      </form>
    </StepFrame>
  );
}

function PoliciesStep({
  busy,
  documents,
  onAccept,
}: {
  readonly busy: boolean;
  readonly documents: readonly {
    readonly key: string;
    readonly version: string;
  }[];
  readonly onAccept: () => void;
}) {
  return (
    <StepFrame
      lede="These are the terms your account is held to. Accepting records which version you saw, so a later change is a new decision rather than a silent one."
      title="Accept the policies"
    >
      <ul className="v-list v-list--divided" data-testid="outstanding-policies">
        {documents.map((document) => (
          <li key={`${document.key}:${document.version}`}>
            <div className="v-row">
              <span className="v-row__body">
                <span className="v-subheading">
                  {policyTitle(document.key)}
                </span>
                <span className="v-caption v-quiet">
                  Version {document.version}
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>

      <Notice tone="quiet">
        The full text of these documents is not published yet. What is recorded
        is which version you accepted, so nothing is applied to your account
        retroactively.
      </Notice>

      <Button
        block
        busy={busy}
        data-testid="acknowledge-policies"
        onClick={onAccept}
        size="lg"
        tone="primary"
      >
        Accept and continue
      </Button>
    </StepFrame>
  );
}

function ProfileStep({
  busy,
  onSave,
  outstanding,
  profile,
}: {
  readonly busy: boolean;
  readonly onSave: (input: {
    readonly bio?: string;
    readonly displayName: string;
    readonly expectedVersion?: number;
    readonly languages: string[];
  }) => void;
  readonly outstanding: readonly string[];
  readonly profile?: ConsumerProfile | undefined;
}) {
  const [touched, setTouched] = useState(false);
  // This step renders as soon as the server says admission is at the profile,
  // which can be before the profile itself has been read. Each field therefore
  // follows the server only until somebody types in it: a late answer fills in
  // what is untouched and leaves the rest alone.
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
  const needsPhoto = outstanding.includes('ready_media');

  return (
    <StepFrame
      lede="This is what other people see. You can change any of it later, and you are not shown to anybody until you choose to be."
      title="Set up your profile"
    >
      <form
        className="v-stack v-stack--5"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (!nameValid || !languagesValid) return;
          onSave({
            ...(bio.value.trim().length === 0 ? {} : { bio: bio.value.trim() }),
            displayName: enteredName,
            ...(version === undefined ? {} : { expectedVersion: version }),
            languages: [...languages.value],
          });
        }}
      >
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
              data-testid="onboarding-display-name"
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
          hint="A couple of sentences is plenty. What you are into, what you are looking for."
          label="About you"
          optional
        >
          {(control) => (
            <TextArea
              {...control}
              data-testid="onboarding-bio"
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

        <Button
          block
          busy={busy}
          data-testid="save-profile"
          size="lg"
          tone="primary"
          type="submit"
        >
          Save and continue
        </Button>
      </form>

      {/*
        The photo lives on this step too, not only on the profile screen. It is
        one of the requirements this step lists, and somebody told they are
        missing one has to be able to supply it where they are told.
      */}
      {needsPhoto ? (
        <section className="v-stack v-stack--4">
          <h2 className="v-subheading">Add a photo</h2>
          <p className="v-small v-muted">
            One photo is part of the minimum, so other people are meeting a
            person rather than a blank card.
          </p>
          <ProfilePhotos />
        </section>
      ) : null}
    </StepFrame>
  );
}

export { policyTitle, ladder as onboardingLadder, maximumProfileLanguages };
