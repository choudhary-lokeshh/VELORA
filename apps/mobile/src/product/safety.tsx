import type { Appeal, SafetyStatement } from '@velora/consumer-client';
import { failureMessage } from '@velora/consumer-client';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApi, useToast } from '../frame/providers';
import { Screen } from '../frame/shell';
import {
  Badge,
  Button,
  Card,
  Divider,
  ErrorMessage,
  Field,
  RowSkeleton,
  Stack,
  Text,
  TextField,
  type Tone,
} from '../design/primitives';
import { Sheet } from '../design/sheet';
import { color, space } from '../design/tokens';
import { formatDate } from './locale';
import { useResource, useSingleFlight } from './resource';
import { PersonSafetyMenu } from './safety-actions';

/**
 * Everything VELORA is holding on somebody's behalf, and everything it has
 * decided about their account.
 *
 * Three things live here because they answer one question — "what is going on
 * with me" — and because none of them is a place anybody browses. There is no
 * field that takes a person: blocking and reporting happen beside the person
 * they are about, where the identifier is already known. A safety flow that
 * asks a frightened person to copy a UUID is a safety flow that does not get
 * used, and the wireframe this replaces had exactly that.
 */

const pageSize = 20;

/**
 * The coarse categories a subject may be told, in plain words.
 *
 * These are the only ones the server will ever send, and each is deliberately
 * about scope rather than about what a review concluded.
 */
const denialLabels: Readonly<Record<string, string>> = {
  account_restricted: 'Your account is restricted.',
  conversation_closed: 'A conversation was closed.',
  creator_capability_suspended: 'Your creator tools are suspended.',
  object_restricted: 'Something you published is not public.',
};

const scopeLabels: Readonly<Record<string, string>> = {
  account_restriction: 'It applies to your whole account.',
  club_membership_revocation: 'It applies to a club membership.',
  conversation_closure: 'It applies to one conversation.',
  creator_object_removal: 'It applies to something you published.',
  creator_suspension: 'It applies to your creator tools.',
};

const appealLabels: Readonly<
  Record<string, { readonly label: string; readonly tone: Tone }>
> = {
  received: { label: 'We have your request', tone: 'neutral' },
  refused: { label: 'The decision stands', tone: 'neutral' },
  under_review: { label: 'Somebody is looking at it', tone: 'caution' },
  upheld: { label: 'We changed the decision', tone: 'positive' },
  withdrawn: { label: 'You withdrew this', tone: 'neutral' },
};

const reportLabels: Readonly<
  Record<string, { readonly label: string; readonly tone: Tone }>
> = {
  actioned: { label: 'Closed', tone: 'neutral' },
  dismissed: { label: 'Closed', tone: 'neutral' },
  received: { label: 'Received', tone: 'neutral' },
  under_review: { label: 'Being looked at', tone: 'caution' },
};

/** The narrative bound the contract publishes for an appeal. */
const maximumAppealStatement = 2000;

export function SafetyScreen({ onBack }: { readonly onBack: () => void }) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();

  const loadStanding = useCallback(
    async (signal: AbortSignal) => api.standing(signal),
    [api],
  );
  const loadAppeals = useCallback(
    async (signal: AbortSignal) => api.appeals(signal),
    [api],
  );
  const loadBlocks = useCallback(
    async (signal: AbortSignal) => api.blocks({ pageSize }, signal),
    [api],
  );
  const loadRecentlyMet = useCallback(
    async (signal: AbortSignal) => api.recentLivePeople(signal),
    [api],
  );
  const loadReports = useCallback(
    async (signal: AbortSignal) => api.reports({ pageSize }, signal),
    [api],
  );

  const standing = useResource(loadStanding);
  const appeals = useResource(loadAppeals);
  const blocks = useResource(loadBlocks);
  const recentlyMet = useResource(loadRecentlyMet);
  const reports = useResource(loadReports);
  const [appealing, setAppealing] = useState<SafetyStatement | undefined>(
    undefined,
  );

  const statements = standing.value?.statements ?? [];
  const complaints = appeals.value?.appeals ?? [];
  const blocked = blocks.value?.blocks ?? [];
  const met = recentlyMet.value?.people ?? [];
  const metWindowHours = recentlyMet.value?.windowHours;
  const filed = reports.value?.reports ?? [];

  const reloadAll = () => {
    standing.reload();
    appeals.reload();
    blocks.reload();
    recentlyMet.reload();
    reports.reload();
  };

  return (
    <Screen
      onBack={onBack}
      onRefresh={reloadAll}
      subtitle="What VELORA has decided about your account, and what you have asked it to look at."
      testID="safety-screen"
      title="Safety"
    >
      <Stack gap={5}>
        {/* ------------------------------------------------- standing */}
        <Card testID="standing-card">
          <Stack gap={3}>
            <Text variant="subheading" weight="semibold">
              Your standing
            </Text>

            {standing.loading && standing.value === undefined ? (
              <RowSkeleton rows={1} />
            ) : standing.error !== undefined ? (
              <ErrorMessage testID="standing-failed">
                {standing.error}
              </ErrorMessage>
            ) : statements.length === 0 ? (
              <Text testID="standing-empty" tone="secondary" variant="small">
                Nothing is restricted on your account.
              </Text>
            ) : (
              <View testID="standing-list">
                {statements.map((statement, index) => (
                  <View key={statement.decisionId}>
                    {index === 0 ? null : <Divider />}
                    <Stack gap={2} style={styles.entry}>
                      <Text variant="small" weight="semibold">
                        {denialLabels[statement.reasonCode] ??
                          'A decision was made about your account.'}
                      </Text>
                      <Text tone="secondary" variant="caption">
                        {`${scopeLabels[statement.scope] ?? ''}${
                          statement.appealWindowClosesAt === undefined
                            ? ''
                            : ` You can ask us to look again until ${formatDate(statement.appealWindowClosesAt)}.`
                        }`}
                      </Text>
                      {statement.appealable ? (
                        <Button
                          disabled={busy}
                          onPress={() => {
                            setAppealing(statement);
                          }}
                          size="small"
                          testID={`appeal-${statement.decisionId}`}
                        >
                          Ask us to look again
                        </Button>
                      ) : null}
                    </Stack>
                  </View>
                ))}
              </View>
            )}

            {complaints.length === 0 ? null : (
              <View style={styles.appeals} testID="appeal-list">
                <Text tone="tertiary" variant="micro" weight="semibold">
                  YOUR REQUESTS
                </Text>
                {complaints.map((appeal: Appeal) => {
                  const shown = appealLabels[appeal.state] ?? {
                    label: 'Recorded',
                    tone: 'neutral' as Tone,
                  };
                  const live =
                    appeal.state === 'received' ||
                    appeal.state === 'under_review';
                  return (
                    <View key={appeal.id} style={styles.row}>
                      <View style={styles.rowBody}>
                        <Badge tone={shown.tone}>{shown.label}</Badge>
                        <Text tone="tertiary" variant="caption">
                          {`Sent ${formatDate(appeal.submittedAt)}`}
                        </Text>
                      </View>
                      {live ? (
                        <Button
                          disabled={busy}
                          onPress={() => {
                            run(async () => {
                              const failure = failureMessage(
                                await api.withdrawAppeal(appeal.id),
                              );
                              if (failure !== undefined) {
                                toast.show(failure, 'critical');
                              } else {
                                toast.show('Request withdrawn.', 'positive');
                              }
                              appeals.reload();
                            });
                          }}
                          size="small"
                          testID={`withdraw-${appeal.id}`}
                          tone="ghost"
                        >
                          Withdraw
                        </Button>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            )}
          </Stack>
        </Card>

        {/* --------------------------------------------- recently met */}
        {/*
          The people a random encounter has already ended with.

          This exists for one complaint and answers it exactly. Every other
          surface that shows somebody carries a safety action, but a random
          stranger is on no other surface: the moment the encounter is over they
          are nowhere, and the person who was just abused is left with a display
          name they did not write down.

          Absent entirely where live discovery is switched off — a card saying
          "nobody yet" would be a claim about a feature that is not running.
        */}
        {recentlyMet.error !== undefined && !recentlyMet.retryable ? null : (
          <Card testID="recently-met-card">
            <Stack gap={3}>
              <Text variant="subheading" weight="semibold">
                People you recently met on Live
              </Text>
              <Text tone="secondary" variant="small">
                {metWindowHours === undefined
                  ? 'They stay here for a short while after the conversation ends, so a conversation that went wrong can still be reported once it is over.'
                  : `They stay here for ${String(metWindowHours)} hours after the conversation ends, so a conversation that went wrong can still be reported once it is over.`}
              </Text>

              {recentlyMet.loading && recentlyMet.value === undefined ? (
                <RowSkeleton rows={1} />
              ) : recentlyMet.error !== undefined ? (
                <ErrorMessage testID="recently-met-failed">
                  {recentlyMet.error}
                </ErrorMessage>
              ) : met.length === 0 ? (
                <Text
                  testID="recently-met-empty"
                  tone="tertiary"
                  variant="small"
                >
                  Nobody yet.
                </Text>
              ) : (
                <View testID="recently-met-list">
                  {met.map((entry, index) => (
                    <View key={entry.encounterId}>
                      {index === 0 ? null : <Divider />}
                      <View style={styles.row}>
                        <View style={styles.rowBody}>
                          <Text variant="small" weight="medium">
                            {entry.person.displayName}
                          </Text>
                          <Text tone="tertiary" variant="caption">
                            {`Met ${formatDate(entry.endedAt)}`}
                          </Text>
                        </View>
                        <PersonSafetyMenu
                          onBlocked={recentlyMet.reload}
                          person={{
                            displayName: entry.person.displayName,
                            id: entry.person.id,
                          }}
                        />
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </Stack>
          </Card>
        )}

        {/* --------------------------------------------------- blocks */}
        <Card testID="blocked-card">
          <Stack gap={3}>
            <Text variant="subheading" weight="semibold">
              People you have blocked
            </Text>
            <Text tone="secondary" variant="small">
              They cannot reach you and you will not see them. They are not told
              either way.
            </Text>

            {blocks.loading && blocks.value === undefined ? (
              <RowSkeleton rows={1} />
            ) : blocks.error !== undefined ? (
              <ErrorMessage testID="blocks-failed">{blocks.error}</ErrorMessage>
            ) : blocked.length === 0 ? (
              <Text testID="blocks-empty" tone="tertiary" variant="small">
                You have not blocked anybody.
              </Text>
            ) : (
              <View testID="block-list">
                {blocked.map((block, index) => (
                  <View key={block.blockedId}>
                    {index === 0 ? null : <Divider />}
                    <View style={styles.row}>
                      <View style={styles.rowBody}>
                        {/*
                          The block list publishes an identifier and a date and
                          nothing else — no name, because VELORA does not keep
                          one against a block. Showing the raw identifier would
                          be showing an internal value in a product screen, so
                          the date is what identifies the entry.
                        */}
                        <Text variant="small" weight="medium">
                          {`Blocked ${formatDate(block.createdAt)}`}
                        </Text>
                        <Text tone="tertiary" variant="caption">
                          VELORA does not keep a name against a block.
                        </Text>
                      </View>
                      <Button
                        disabled={busy}
                        onPress={() => {
                          run(async () => {
                            const failure = failureMessage(
                              await api.unblock(block.blockedId),
                            );
                            if (failure !== undefined) {
                              toast.show(failure, 'critical');
                            } else {
                              toast.show(
                                'Block removed. They are not told either way.',
                                'positive',
                              );
                            }
                            blocks.reload();
                          });
                        }}
                        size="small"
                        testID={`unblock-${block.blockedId}`}
                      >
                        Unblock
                      </Button>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </Stack>
        </Card>

        {/* -------------------------------------------------- reports */}
        <Card testID="reports-card">
          <Stack gap={3}>
            <Text variant="subheading" weight="semibold">
              What you have reported
            </Text>
            {reports.loading && reports.value === undefined ? (
              <RowSkeleton rows={1} />
            ) : reports.error !== undefined ? (
              <ErrorMessage testID="reports-failed">
                {reports.error}
              </ErrorMessage>
            ) : filed.length === 0 ? (
              <Text testID="reports-empty" tone="tertiary" variant="small">
                You have not reported anybody.
              </Text>
            ) : (
              <View testID="report-list">
                {filed.map((report, index) => {
                  const shown = reportLabels[report.state] ?? {
                    label: 'Recorded',
                    tone: 'neutral' as Tone,
                  };
                  return (
                    <View key={report.id}>
                      {index === 0 ? null : <Divider />}
                      <View style={styles.row}>
                        <View style={styles.rowBody}>
                          <Badge tone={shown.tone}>{shown.label}</Badge>
                          <Text tone="tertiary" variant="caption">
                            {`Sent ${formatDate(report.createdAt)}`}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
            <Text tone="tertiary" variant="caption">
              You are told that a report was received and closed, and never what
              was decided about somebody else.
            </Text>
          </Stack>
        </Card>

        <Text tone="tertiary" variant="caption">
          To block or report somebody, use the control beside their name — in
          Discover, in Introductions, or at the top of your conversation with
          them.
        </Text>
      </Stack>

      {appealing === undefined ? null : (
        <AppealSheet
          busy={busy}
          onClose={() => {
            setAppealing(undefined);
          }}
          onSubmit={(statement) => {
            run(async () => {
              const result = await api.appeal({
                decisionId: appealing.decisionId,
                ...(statement.length === 0 ? {} : { statement }),
              });
              const failure = failureMessage(result);
              if (failure !== undefined) {
                toast.show(failure, 'critical');
                return;
              }
              toast.show(
                'We have your request. Somebody will look at it.',
                'positive',
              );
              setAppealing(undefined);
              appeals.reload();
              standing.reload();
            });
          }}
        />
      )}
    </Screen>
  );
}

function AppealSheet({
  busy,
  onClose,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (statement: string) => void;
}) {
  const [statement, setStatement] = useState('');
  const tooLong = statement.trim().length > maximumAppealStatement;

  return (
    <Sheet
      onClose={onClose}
      testID="appeal-dialog"
      title="Ask us to look again"
    >
      <Stack gap={4}>
        <Field
          count={{
            current: statement.trim().length,
            maximum: maximumAppealStatement,
          }}
          error={tooLong ? 'That is longer than we can accept.' : undefined}
          hint="Optional. A person reads this. You will be told the outcome, not the reasoning behind it."
          label="Anything you want us to know"
          testID="appeal-statement-field"
        >
          {(control) => (
            <TextField
              {...control}
              invalid={tooLong}
              multiline
              onChangeText={setStatement}
              testID="appeal-statement"
              value={statement}
            />
          )}
        </Field>
        <Button
          busy={busy}
          disabled={tooLong}
          icon="appeal"
          onPress={() => {
            onSubmit(statement.trim());
          }}
          testID="appeal-submit"
          tone="primary"
          wide
        >
          Send the request
        </Button>
      </Stack>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  entry: { paddingVertical: space[3] },
  row: {
    alignItems: 'center',
    borderColor: color.borderHairline,
    flexDirection: 'row',
    gap: space[3],
    paddingVertical: space[3],
  },
  appeals: { gap: space[2] },
  rowBody: { alignItems: 'flex-start', flex: 1, gap: space[1] },
});
