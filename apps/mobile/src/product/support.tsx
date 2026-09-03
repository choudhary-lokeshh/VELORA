import type { SupportCategory, SupportTicket } from '@velora/consumer-client';
import { failureMessage, isOk } from '@velora/consumer-client';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  Choice,
  Divider,
  EmptyState,
  ErrorMessage,
  Field,
  Notice,
  RowSkeleton,
  Stack,
  Text,
  TextField,
  type Tone,
} from '../design/primitives';
import { space } from '../design/tokens';
import { useApi, useToast } from '../frame/providers';
import { Screen } from '../frame/shell';
import { formatDate } from './locale';
import { useResource, useSingleFlight } from './resource';

/**
 * Getting help from a person, on a phone.
 *
 * The same surface Consumer Web carries and for the same complaint: there is no
 * way to reach anybody. Everything here is built around one property — after
 * submitting, a person holds a reference they can read back and a status that
 * came from the server rather than from this screen.
 *
 * It is deliberately not the safety surface. Somebody being harassed is pointed
 * at reporting them, which reaches moderation, carries evidence, and can block
 * the person in the same act.
 *
 * Nothing here promises a response time, because VELORA has nobody on a rota.
 */

const categories: readonly {
  readonly hint: string;
  readonly label: string;
  readonly value: SupportCategory;
}[] = [
  {
    hint: 'Signing in, signing up, or getting back into your account',
    label: 'Account and signing in',
    value: 'account_access',
  },
  {
    hint: 'Matching, calls, audio, video, or reconnecting',
    label: 'Live conversations',
    value: 'live',
  },
  {
    hint: 'Somebody’s behaviour, a block, or a decision about your account',
    label: 'Safety',
    value: 'safety',
  },
  {
    hint: 'Coins, a purchase, or anything that moved money',
    label: 'Coins and payments',
    value: 'wallet',
  },
  {
    hint: 'Messages that did not send, arrive, or stay',
    label: 'Messages',
    value: 'messaging',
  },
  {
    hint: 'Your profile, photographs, languages, or preferences',
    label: 'Profile',
    value: 'profile',
  },
  { hint: 'Anything else', label: 'Something else', value: 'other' },
];

const statusCopy: Readonly<
  Record<string, { readonly label: string; readonly tone: Tone }>
> = {
  closed: { label: 'Closed', tone: 'neutral' },
  in_review: { label: 'Being looked at', tone: 'accent' },
  received: { label: 'Received', tone: 'neutral' },
  resolved: { label: 'Answered', tone: 'positive' },
};

const maximumSubject = 120;
const maximumDescription = 4000;

/**
 * A per-ticket identifier that makes a retry safe.
 *
 * The Expo runtime provides `crypto.randomUUID`, and the fallback exists for
 * the one case where it does not: a ticket that could not be sent because an
 * identifier could not be made would be the worst possible failure on the one
 * screen somebody reaches when everything else has already failed them.
 */
function clientTicketId(): string {
  const source = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof source?.randomUUID === 'function') return source.randomUUID();
  return `ticket-${String(Date.now())}-${Math.random().toString(36).slice(2, 12)}`;
}

export function SupportScreen({ onBack }: { readonly onBack: () => void }) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();

  const load = useCallback(
    async (signal: AbortSignal) => api.supportTickets({}, signal),
    [api],
  );
  const tickets = useResource(load);
  const rows = tickets.value?.tickets ?? [];

  const [category, setCategory] = useState<SupportCategory>('account_access');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [opened, setOpened] = useState<SupportTicket | undefined>(undefined);

  const subjectTooLong = subject.trim().length > maximumSubject;
  const descriptionTooLong = description.trim().length > maximumDescription;
  const ready =
    subject.trim().length >= 3 &&
    description.trim().length >= 10 &&
    !subjectTooLong &&
    !descriptionTooLong;

  const send = () => {
    run(async () => {
      setError(undefined);
      const result = await api.createSupportTicket({
        category,
        clientTicketId: clientTicketId(),
        description: description.trim(),
        subject: subject.trim(),
      });
      const failure = failureMessage(result);
      if (failure !== undefined) {
        setError(failure);
        return;
      }
      if (isOk(result)) {
        setOpened(result.value);
        setSubject('');
        setDescription('');
        toast.show('We have your message.', 'positive');
        tickets.reload();
      }
    });
  };

  return (
    <Screen
      onBack={onBack}
      onRefresh={tickets.reload}
      subtitle="Tell VELORA what is wrong and get a reference you can quote."
      testID="support-screen"
      title="Help"
    >
      <Stack gap={5}>
        {/*
          The one thing this screen is not for. Somebody who has just been
          harassed should be reporting the person, which reaches moderation and
          can block them at the same time.
        */}
        <Notice
          testID="support-safety-hint"
          title="Being harassed? Report them instead"
        >
          <Text tone="secondary" variant="small">
            Reporting somebody from their profile or from your Live conversation
            reaches the safety team directly, and can block them at the same
            time. Everything else belongs here.
          </Text>
        </Notice>

        {opened === undefined ? null : (
          <Card testID="support-submitted">
            <Stack gap={2}>
              <Text variant="subheading" weight="semibold">
                We have it
              </Text>
              <Text testID="support-reference" variant="small">
                {`Your reference is ${opened.reference}.`}
              </Text>
              <Text tone="tertiary" variant="caption">
                A person reads every one of these. We are not going to give you
                a response time we cannot keep, so this screen will say what is
                actually happening to it.
              </Text>
            </Stack>
          </Card>
        )}

        <Card testID="support-form-card">
          <Stack gap={4}>
            <Text variant="subheading" weight="semibold">
              Tell us what is wrong
            </Text>

            <View accessibilityRole="radiogroup" style={styles.choices}>
              <Text tone="secondary" variant="small" weight="medium">
                What is it about?
              </Text>
              {categories.map((option) => (
                <Choice
                  key={option.value}
                  onPress={() => {
                    setCategory(option.value);
                  }}
                  selected={category === option.value}
                  testID={`support-category-${option.value}`}
                >
                  <Stack gap={1}>
                    <Text variant="small" weight="medium">
                      {option.label}
                    </Text>
                    <Text tone="tertiary" variant="caption">
                      {option.hint}
                    </Text>
                  </Stack>
                </Choice>
              ))}
            </View>

            <Field
              count={{
                current: subject.trim().length,
                maximum: maximumSubject,
              }}
              hint="A few words, so somebody can see at a glance what this is."
              label="Summary"
              testID="support-subject-field"
              {...(subjectTooLong
                ? { error: 'That is longer than a summary can be.' }
                : {})}
            >
              {(control) => (
                <TextField
                  {...control}
                  onChangeText={setSubject}
                  testID="support-subject"
                  value={subject}
                />
              )}
            </Field>

            <Field
              count={{
                current: description.trim().length,
                maximum: maximumDescription,
              }}
              hint="What happened, what you expected, and anything you tried."
              label="What happened"
              testID="support-description-field"
              {...(descriptionTooLong
                ? { error: 'That is longer than a message can be.' }
                : {})}
            >
              {(control) => (
                <TextField
                  {...control}
                  multiline
                  onChangeText={setDescription}
                  testID="support-description"
                  value={description}
                />
              )}
            </Field>

            {error === undefined ? null : (
              <ErrorMessage testID="support-error">{error}</ErrorMessage>
            )}

            <Button
              busy={busy}
              disabled={!ready}
              icon="send"
              onPress={send}
              testID="support-submit"
              tone="primary"
              wide
            >
              Send it
            </Button>
          </Stack>
        </Card>

        <Card testID="support-tickets-card">
          <Stack gap={3}>
            <Text variant="subheading" weight="semibold">
              What you have asked
            </Text>

            {tickets.loading && tickets.value === undefined ? (
              <RowSkeleton rows={1} />
            ) : tickets.error !== undefined && rows.length === 0 ? (
              <ErrorMessage
                testID="support-tickets-failed"
                {...(tickets.retryable ? { onRetry: tickets.reload } : {})}
              >
                {tickets.error}
              </ErrorMessage>
            ) : rows.length === 0 ? (
              <EmptyState
                body="Anything you send appears here with its reference and whatever VELORA has done about it."
                icon="help"
                testID="support-tickets-empty"
                title="Nothing yet"
              />
            ) : (
              <View testID="support-ticket-list">
                {rows.map((ticket, index) => {
                  const shown = statusCopy[ticket.status] ?? {
                    label: ticket.status,
                    tone: 'neutral' as Tone,
                  };
                  return (
                    <View
                      key={ticket.id}
                      testID={`support-ticket-${ticket.reference}`}
                    >
                      {index === 0 ? null : <Divider />}
                      <View style={styles.row}>
                        <Stack gap={1} style={styles.rowBody}>
                          <Text variant="small" weight="medium">
                            {ticket.subject}
                          </Text>
                          <Text tone="tertiary" variant="caption">
                            {`${ticket.reference} · sent ${formatDate(ticket.createdAt)}`}
                          </Text>
                        </Stack>
                        <Badge tone={shown.tone}>{shown.label}</Badge>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </Stack>
        </Card>
      </Stack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  choices: { gap: space[2] },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[3],
    paddingVertical: space[3],
  },
  rowBody: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
});
