'use client';

import { useState } from 'react';

import type {
  ApiResult,
  ConsumerApi,
  JourneyStage,
} from '@velora/consumer-client';
import { failureMessage } from '@velora/consumer-client';
import type { AccountState } from './account';
import { ProfilePhoto } from './media';
import { useSingleFlight } from './resource';
import { ErrorMessage, Section, StatusMessage } from './ui';

/**
 * Adult assurance, policy acknowledgement, and the minimum profile.
 *
 * The order is the server's. `docs/flows/onboarding.md` fixes the ladder and
 * the API derives the current step from stored evidence, so this surface asks
 * for whatever the server says is outstanding and never decides that somebody
 * has finished.
 *
 * The declaration collects a region and a yes. It does not collect a date of
 * birth: the minimum age per country is unresolved
 * (`docs/compliance/02-adult-age-verification.md`), and asking for a birth date
 * would gather sensitive data for a rule that does not exist yet. Nothing on
 * this screen calls a declaration a verified check, because it is not one.
 */
export function OnboardingPanel({
  account,
  api,
  stage,
}: {
  readonly account: AccountState;
  readonly api: ConsumerApi;
  readonly stage: JourneyStage;
}) {
  const [region, setRegion] = useState('ES');
  const [displayName, setDisplayName] = useState('');
  const [languages, setLanguages] = useState('es');
  const [message, setMessage] = useState<string | undefined>(undefined);
  const { busy, run } = useSingleFlight();
  const onboarding = account.onboarding.value;

  const submit = (work: () => Promise<ApiResult<unknown>>) => {
    run(async () => {
      setMessage(undefined);
      setMessage(failureMessage(await work()));
      account.reloadAll();
    });
  };

  return (
    <Section headingId="onboarding-heading" title="Getting started">
      {account.onboarding.loading && onboarding === undefined ? (
        <StatusMessage testId="onboarding-loading">
          Loading your next step…
        </StatusMessage>
      ) : null}
      {message === undefined ? null : (
        <ErrorMessage testId="onboarding-error">{message}</ErrorMessage>
      )}

      {stage === 'adult_declaration' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(async () => api.declareAdult(region));
          }}
        >
          <h3>Adult declaration</h3>
          {onboarding?.adultAssuranceRefused === true ? (
            <ErrorMessage testId="adult-refused">
              This account is not eligible to continue.
            </ErrorMessage>
          ) : null}
          <label htmlFor="onboarding-region">
            Country or region (two letters)
          </label>
          <input
            aria-describedby="onboarding-region-help"
            autoComplete="country"
            id="onboarding-region"
            maxLength={2}
            name="region"
            onChange={(event) => {
              setRegion(event.target.value.toUpperCase());
            }}
            pattern="[A-Za-z]{2}"
            required
            value={region}
          />
          <p className="hint" id="onboarding-region-help">
            VELORA is adults only. Confirming here is a declaration, not a
            verified age check.
          </p>
          <button data-testid="declare-adult" disabled={busy} type="submit">
            I am an adult
          </button>
        </form>
      ) : null}

      {stage === 'policy_acknowledgement' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(async () =>
              api.acknowledgePolicies(onboarding?.outstandingPolicies ?? []),
            );
          }}
        >
          <h3>Policies</h3>
          <ul data-testid="outstanding-policies">
            {(onboarding?.outstandingPolicies ?? []).map((document) => (
              <li key={`${document.key}:${document.version}`}>
                {document.key} (version {document.version})
              </li>
            ))}
          </ul>
          <button
            data-testid="acknowledge-policies"
            disabled={busy}
            type="submit"
          >
            Accept these policies
          </button>
        </form>
      ) : null}

      {stage === 'profile' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(async () =>
              api.saveProfile({
                displayName,
                languages: languages
                  .split(',')
                  .map((value) => value.trim().toLowerCase())
                  .filter((value) => value.length > 0),
              }),
            );
          }}
        >
          <h3>Profile</h3>
          <ul data-testid="outstanding-profile">
            {(onboarding?.outstandingProfile ?? []).map((requirement) => (
              <li key={requirement}>{requirement.replaceAll('_', ' ')}</li>
            ))}
          </ul>
          <label htmlFor="onboarding-display-name">Display name</label>
          <input
            id="onboarding-display-name"
            maxLength={32}
            minLength={2}
            name="displayName"
            onChange={(event) => {
              setDisplayName(event.target.value);
            }}
            required
            value={displayName}
          />
          <label htmlFor="onboarding-languages">
            Languages you speak, comma separated
          </label>
          <input
            id="onboarding-languages"
            name="languages"
            onChange={(event) => {
              setLanguages(event.target.value);
            }}
            required
            value={languages}
          />
          <button data-testid="save-profile" disabled={busy} type="submit">
            Save profile
          </button>
        </form>
      ) : null}

      {/*
        The photo lives on this step too, not only on the profile screen. An
        image is one of the requirements this step lists, and somebody told they
        are missing one has to be able to supply it where they are told.
      */}
      {stage === 'profile' ? (
        <ProfilePhoto
          api={api}
          busy={busy}
          onFinished={account.reloadAll}
          profile={account.profile.value}
        />
      ) : null}
    </Section>
  );
}
