import type { ApiResult, JourneyStage } from '@velora/consumer-client';
import { failureMessage, journeyStage } from '@velora/consumer-client';
import {
  languagePattern,
  maximumBioLength,
  maximumDisplayNameLength,
  maximumProfileLanguages,
  minimumDisplayNameLength,
} from '@velora/validation/profile-bounds';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { useApi, useSession } from '../frame/providers';
import { PlainScreen, Wordmark } from '../frame/shell';
import {
  Badge,
  Button,
  Divider,
  ErrorMessage,
  Field,
  IconButton,
  Inline,
  Notice,
  Stack,
  Text,
  TextField,
} from '../design/primitives';
import { color, radius, space } from '../design/tokens';
import { languageName, regionName } from './locale';
import { useSingleFlight } from './resource';

/**
 * Everything between signing in and being able to use VELORA.
 *
 * The ladder is the server's, not this screen's: each step asks for whatever
 * the onboarding read says is outstanding, and the progress counts the server's
 * steps rather than a client-side wizard position — which is why it stays
 * correct when somebody completes a step on another device and comes back here.
 *
 * The declaration collects a region and a yes. It does not collect a date of
 * birth: the minimum age per country is unresolved
 * (`docs/compliance/02-adult-age-verification.md`), and asking for a birth date
 * would gather sensitive data for a rule that does not exist yet. Nothing here
 * calls a declaration a verified check, because it is not one.
 *
 * A photo cannot be supplied at any step. No storage provider is approved, so
 * there is no route by which an image could be uploaded or delivered, and the
 * screen says so rather than offering a camera control that could not work.
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

export function OnboardingScreen() {
  const api = useApi();
  const session = useSession();
  const { busy, run } = useSingleFlight();
  const [message, setMessage] = useState<string | undefined>(undefined);

  const onboarding = session.account.onboarding.value;
  /*
   * The account read is authoritative about the first rung. The two reads can
   * disagree — a 404 on one and a stale answer on the other — and a ladder that
   * trusted only the onboarding read would render a screen with no step on it
   * at all, which is the one outcome that is never correct here: the gate only
   * sends somebody to this screen because something is outstanding.
   */
  const stage: JourneyStage =
    session.account.account.value === undefined
      ? 'account_required'
      : journeyStage(onboarding);
  const position = ladder.indexOf(stage);

  const submit = (work: () => Promise<ApiResult<unknown>>) => {
    run(async () => {
      setMessage(undefined);
      const failure = failureMessage(await work());
      setMessage(failure);
      session.account.reloadAll();
    });
  };

  return (
    <PlainScreen testID="onboarding-screen">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.fill}
      >
        <Stack gap={5}>
          <Wordmark />
          {position < 0 ? null : (
            <View
              accessibilityLabel={`Step ${String(position + 1)} of ${String(ladder.length)}`}
              accessibilityRole="progressbar"
              style={styles.steps}
              testID="onboarding-progress"
            >
              {ladder.map((step, index) => (
                <View
                  key={step}
                  style={[
                    styles.step,
                    index <= position ? styles.stepDone : undefined,
                  ]}
                />
              ))}
            </View>
          )}
        </Stack>

        {message === undefined ? null : (
          <ErrorMessage testID="onboarding-error">{message}</ErrorMessage>
        )}

        {stage === 'account_required' ? (
          <StepFrame
            lede="VELORA needs an account before anything else can happen. Nothing is published and nobody can see you yet."
            title="Create your account"
          >
            <Button
              busy={busy}
              onPress={() => {
                submit(async () => api.createAccount());
              }}
              size="large"
              testID="create-account"
              tone="primary"
              wide
            >
              Create my account
            </Button>
          </StepFrame>
        ) : null}

        {stage === 'adult_declaration' ? (
          <AdultStep
            busy={busy}
            onDeclare={(region) => {
              submit(async () => api.declareAdult(region));
            }}
            refused={onboarding?.adultAssuranceRefused ?? false}
          />
        ) : null}

        {stage === 'policy_acknowledgement' ? (
          <PoliciesStep
            busy={busy}
            documents={onboarding?.outstandingPolicies ?? []}
            onAccept={() => {
              submit(async () =>
                api.acknowledgePolicies(onboarding?.outstandingPolicies ?? []),
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
            outstanding={onboarding?.outstandingProfile ?? []}
          />
        ) : null}
      </KeyboardAvoidingView>
    </PlainScreen>
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
    <Stack gap={6} style={styles.frame}>
      <Stack gap={3}>
        <Text accessibilityRole="header" variant="title" weight="semibold">
          {title}
        </Text>
        <Text tone="secondary" variant="small">
          {lede}
        </Text>
      </Stack>
      {children}
    </Stack>
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
        <ErrorMessage testID="adult-refused">
          This account is not eligible to continue.
        </ErrorMessage>
      ) : null}

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
        testID="onboarding-region-field"
      >
        {(control) => (
          <TextField
            {...control}
            autoCapitalize="characters"
            autoComplete="country"
            autoCorrect={false}
            invalid={touched && !valid}
            maxLength={2}
            onChangeText={(next) => {
              setRegion(next.toUpperCase());
            }}
            placeholder="ES"
            testID="onboarding-region"
            value={region}
          />
        )}
      </Field>

      <Button
        busy={busy}
        onPress={() => {
          setTouched(true);
          if (!valid) return;
          onDeclare(normalized);
        }}
        size="large"
        testID="declare-adult"
        tone="primary"
        wide
      >
        I am an adult
      </Button>
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
      <View style={styles.policies} testID="outstanding-policies">
        {documents.map((document, index) => (
          <View key={`${document.key}:${document.version}`}>
            {index === 0 ? null : <Divider />}
            <View style={styles.policy}>
              <Text variant="small" weight="medium">
                {policyTitle(document.key)}
              </Text>
              <Text tone="tertiary" variant="caption">
                {`Version ${document.version}`}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <Notice
        testID="policies-unpublished"
        title="The full text is not published yet"
      >
        What is recorded is which version you accepted, so nothing is applied to
        your account retroactively.
      </Notice>

      <Button
        busy={busy}
        onPress={onAccept}
        size="large"
        testID="acknowledge-policies"
        tone="primary"
        wide
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
}: {
  readonly busy: boolean;
  readonly onSave: (input: {
    readonly bio?: string;
    readonly displayName: string;
    readonly languages: string[];
  }) => void;
  readonly outstanding: readonly string[];
}) {
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [languages, setLanguages] = useState<readonly string[]>([]);
  const [touched, setTouched] = useState(false);

  const name = displayName.trim();
  const nameValid =
    name.length >= minimumDisplayNameLength &&
    name.length <= maximumDisplayNameLength;
  const languagesValid = languages.length > 0;
  const bioTooLong = bio.trim().length > maximumBioLength;
  const needsPhoto = outstanding.includes('ready_media');

  return (
    <StepFrame
      lede="This is what other people see. You can change any of it later, and you are not shown to anybody until you choose to be."
      title="Set up your profile"
    >
      <Field
        error={
          touched && !nameValid
            ? `Between ${String(minimumDisplayNameLength)} and ${String(maximumDisplayNameLength)} characters.`
            : undefined
        }
        hint="How you appear everywhere in VELORA."
        label="Display name"
        testID="onboarding-display-name-field"
      >
        {(control) => (
          <TextField
            {...control}
            invalid={touched && !nameValid}
            maxLength={maximumDisplayNameLength}
            onChangeText={setDisplayName}
            testID="onboarding-display-name"
            value={displayName}
          />
        )}
      </Field>

      <LanguagePicker
        error={
          touched && !languagesValid ? 'Add at least one language.' : undefined
        }
        onChange={setLanguages}
        value={languages}
      />

      <Field
        count={{ current: bio.trim().length, maximum: maximumBioLength }}
        error={bioTooLong ? 'That is longer than a bio can be.' : undefined}
        hint="Optional. A few lines about you."
        label="About you"
        testID="onboarding-bio-field"
      >
        {(control) => (
          <TextField
            {...control}
            invalid={bioTooLong}
            multiline
            onChangeText={setBio}
            testID="onboarding-bio"
            value={bio}
          />
        )}
      </Field>

      {needsPhoto ? (
        <Notice
          testID="onboarding-photo-note"
          title="A photo is still required, and cannot be added yet"
          tone="caution"
        >
          VELORA has no approved way to store or deliver an image, so there is
          nothing here to upload one with. Your profile is complete in every
          other way and this is not something you can fix.
        </Notice>
      ) : null}

      <Button
        busy={busy}
        onPress={() => {
          setTouched(true);
          if (!nameValid || !languagesValid || bioTooLong) return;
          onSave({
            ...(bio.trim().length === 0 ? {} : { bio: bio.trim() }),
            displayName: name,
            languages: [...languages],
          });
        }}
        size="large"
        testID="save-profile"
        tone="primary"
        wide
      >
        Save and continue
      </Button>
    </StepFrame>
  );
}

/**
 * The languages somebody speaks, as a set rather than as a comma-separated
 * string.
 *
 * The contract stores BCP 47 primary subtags, which is the right thing to store
 * and the wrong thing to ask for in a plain text box: a person who typed
 * "Spanish" would get a validation failure with no way to see what went wrong.
 * Here a code is echoed back as its language name the moment it is valid, so
 * the confirmation happens before the save rather than after it.
 *
 * There is no list to choose from. `Intl.DisplayNames` names a code without
 * anybody shipping a catalogue, and a curated list would quietly become a
 * statement about which languages VELORA supports.
 */
export function LanguagePicker({
  error,
  onChange,
  value,
}: {
  readonly error?: string | undefined;
  readonly onChange: (next: readonly string[]) => void;
  readonly value: readonly string[];
}) {
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<string | undefined>(undefined);

  const normalized = draft.trim().toLowerCase();
  const wellFormed = languagePattern.test(normalized);
  const full = value.length >= maximumProfileLanguages;
  const resolved = wellFormed ? languageName(normalized) : undefined;

  const add = () => {
    if (!wellFormed) {
      setMessage('Use a two or three letter code, such as es or fra.');
      return;
    }
    if (value.includes(normalized)) {
      setMessage('That one is already here.');
      return;
    }
    if (full) {
      setMessage(
        `You can list up to ${String(maximumProfileLanguages)} languages.`,
      );
      return;
    }
    setMessage(undefined);
    setDraft('');
    onChange([...value, normalized]);
  };

  return (
    <Stack gap={3}>
      <Field
        error={error ?? message}
        hint={
          resolved === undefined
            ? 'A code, such as es or ja. Discovery uses these to find people you can actually talk to.'
            : `That is ${resolved}.`
        }
        label="Languages you speak"
        testID="language-picker"
      >
        {(control) => (
          <View style={styles.languageRow}>
            <View style={styles.languageInput}>
              <TextField
                {...control}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!full}
                invalid={error !== undefined || message !== undefined}
                maxLength={3}
                onChangeText={(next) => {
                  setDraft(next.toLowerCase());
                  setMessage(undefined);
                }}
                onSubmitEditing={add}
                placeholder="es"
                testID="language-input"
                value={draft}
              />
            </View>
            <IconButton
              disabled={full || normalized.length === 0}
              label="Add this language"
              name="plus"
              onPress={add}
              testID="language-add"
              tone="accent"
            />
          </View>
        )}
      </Field>

      {value.length === 0 ? null : (
        <Inline gap={2} wrap>
          {value.map((code) => (
            <View key={code} style={styles.language}>
              <Badge testID={`language-${code}`}>{languageName(code)}</Badge>
              <IconButton
                label={`Remove ${languageName(code)}`}
                name="x"
                onPress={() => {
                  onChange(value.filter((held) => held !== code));
                }}
                testID={`language-remove-${code}`}
                tone="tertiary"
              />
            </View>
          ))}
        </Inline>
      )}
    </Stack>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, gap: space[8] },
  frame: { flex: 1 },
  language: { alignItems: 'center', flexDirection: 'row', gap: space[1] },
  languageInput: { flex: 1 },
  languageRow: { alignItems: 'center', flexDirection: 'row', gap: space[2] },
  policies: {
    backgroundColor: color.surface1,
    borderColor: color.borderHairline,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space[4],
  },
  policy: { gap: space[1], paddingVertical: space[3] },
  step: {
    backgroundColor: color.surface3,
    borderRadius: radius.pill,
    flex: 1,
    height: 4,
  },
  stepDone: { backgroundColor: color.ember },
  steps: { flexDirection: 'row', gap: space[2] },
});
