import { failureMessage } from '@velora/consumer-client';
import { useState } from 'react';
import { View } from 'react-native';

import { useApi, useToast } from '../frame/providers';
import {
  Button,
  Choice,
  ErrorMessage,
  Field,
  IconButton,
  Stack,
  Text,
  TextField,
} from '../design/primitives';
import { Sheet } from '../design/sheet';
import { useSingleFlight } from './resource';

/**
 * Blocking and reporting, from wherever somebody is standing.
 *
 * `docs/design/01-design-principles.md` asks for safety to stay reachable
 * without the product feeling hostile, so these live behind one unobtrusive
 * control on every surface that shows a person rather than on a separate screen
 * somebody has to find and then paste an identifier into. The identifier is
 * already known here, which is the point: a safety flow that asks a frightened
 * person to copy a UUID is a safety flow that does not get used.
 *
 * On a phone they open as sheets rather than as centred dialogs, so the
 * confirming control lands under the thumb of a hand that is already holding
 * the device.
 *
 * Neither action tells the other person anything, and both say so. A block is
 * enforced by the server everywhere at once — discovery, introductions,
 * messages, calls, and queued notices — and this surface only asks for it.
 */

export interface Person {
  readonly displayName: string;
  readonly id: string;
}

const reportReasons = [
  { label: 'They may be under 18', value: 'underage_concern' },
  { label: 'Harassment or bullying', value: 'harassment' },
  { label: 'Hate or abuse', value: 'hate_or_abuse' },
  { label: 'Threats or violence', value: 'threats_or_violence' },
  { label: 'Sexual content violation', value: 'sexual_content_violation' },
  { label: 'Impersonation or a fake profile', value: 'impersonation' },
  { label: 'Spam or a scam', value: 'spam_or_scam' },
  { label: 'Something else', value: 'other' },
] as const;

type ReasonCode = (typeof reportReasons)[number]['value'];

/** The narrative bound the contract publishes for a report. */
const maximumReportDetail = 2000;

/**
 * A per-report identifier that makes submission retry-safe.
 *
 * The Expo runtime provides `crypto.randomUUID`, and the fallback exists for
 * the one case where it does not: a report that could not be sent because an
 * identifier could not be made would be the worst possible failure on this
 * particular flow. The server scopes the value to the reporter, so it cannot
 * collide with anybody else's.
 */
function clientReportId(): string {
  const source = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof source?.randomUUID === 'function') return source.randomUUID();
  return `report-${String(Date.now())}-${Math.random().toString(36).slice(2, 12)}`;
}

type Mode = 'menu' | 'block' | 'report' | 'report-and-block';

/**
 * One unobtrusive control beside a person, and everything safety behind it.
 *
 * It is a mark rather than a labelled button on purpose: a product that puts
 * "Report" next to every face reads as a place where something is expected to
 * go wrong. It still carries a full accessible name, so nothing about it is
 * hidden from somebody who cannot see the mark.
 */
export function PersonSafetyMenu({
  onBlocked,
  person,
}: {
  readonly onBlocked?: () => void;
  readonly person: Person;
}) {
  const [mode, setMode] = useState<Mode | undefined>(undefined);

  return (
    <>
      <IconButton
        label={`Safety options for ${person.displayName}`}
        name="moreHorizontal"
        onPress={() => {
          setMode('menu');
        }}
        testID={`safety-menu-${person.id}`}
      />

      {mode === 'menu' ? (
        <Sheet
          onClose={() => {
            setMode(undefined);
          }}
          testID="safety-menu"
          title={person.displayName}
        >
          <Stack gap={3}>
            <Button
              icon="ban"
              onPress={() => {
                setMode('block');
              }}
              testID="safety-open-block"
              tone="secondary"
              wide
            >
              Block them
            </Button>
            <Button
              icon="flag"
              onPress={() => {
                setMode('report');
              }}
              testID="safety-open-report"
              tone="secondary"
              wide
            >
              Report them
            </Button>
            {/*
              The two together, because that is usually what somebody actually
              wants and doing it as two taps means two chances to stop halfway.
              The server applies the block first, so this cannot leave somebody
              believing they are separated when they are not.
            */}
            <Button
              icon="shield"
              onPress={() => {
                setMode('report-and-block');
              }}
              testID="safety-open-report-and-block"
              tone="secondary"
              wide
            >
              Report and block
            </Button>
            <Text tone="tertiary" variant="caption">
              None of them tells the other person anything. Blocking stops all
              contact both ways; reporting sends what happened to VELORA.
            </Text>
          </Stack>
        </Sheet>
      ) : null}

      {mode === 'block' ? (
        <BlockSheet
          onBlocked={onBlocked}
          onClose={() => {
            setMode(undefined);
          }}
          person={person}
        />
      ) : null}

      {mode === 'report' || mode === 'report-and-block' ? (
        <ReportSheet
          alsoBlock={mode === 'report-and-block'}
          {...(onBlocked === undefined ? {} : { onBlocked })}
          onClose={() => {
            setMode(undefined);
          }}
          person={person}
        />
      ) : null}
    </>
  );
}

export function BlockSheet({
  onBlocked,
  onClose,
  person,
}: {
  readonly onBlocked?: (() => void) | undefined;
  readonly onClose: () => void;
  readonly person: Person;
}) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <Sheet
      onClose={onClose}
      testID="block-person"
      title={`Block ${person.displayName}`}
    >
      <Stack gap={4}>
        <Text tone="secondary" variant="small">
          They will not be able to reach you and you will not see them. They are
          not told. You can undo this from Safety under You.
        </Text>
        {error === undefined ? null : (
          <ErrorMessage testID="block-error">{error}</ErrorMessage>
        )}
        <Button
          busy={busy}
          icon="ban"
          onPress={() => {
            run(async () => {
              setError(undefined);
              const result = await api.block(person.id);
              const failure = failureMessage(result);
              if (failure !== undefined) {
                setError(failure);
                return;
              }
              toast.show(
                `${person.displayName} is blocked. They are not told.`,
                'positive',
              );
              onBlocked?.();
              onClose();
            });
          }}
          testID="block-confirm"
          tone="danger"
          wide
        >
          Block them
        </Button>
      </Stack>
    </Sheet>
  );
}

/**
 * Reporting, optionally with the block that usually belongs with it.
 *
 * `alsoBlock` picks the endpoint rather than making a second request. The
 * server applies the block first and answers with it, so what this renders
 * afterwards is what actually happened: separated, and reported when a report
 * was taken. The reporting bound is real, and claiming a report was filed when
 * it was not would be worse than saying so.
 */
export function ReportSheet({
  alsoBlock = false,
  onBlocked,
  onClose,
  onSubmitted,
  person,
}: {
  readonly alsoBlock?: boolean;
  readonly onBlocked?: (() => void) | undefined;
  readonly onClose: () => void;
  readonly onSubmitted?: (() => void) | undefined;
  readonly person: Person;
}) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [reasonCode, setReasonCode] = useState<ReasonCode>('harassment');
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const tooLong = detail.trim().length > maximumReportDetail;

  return (
    <Sheet
      onClose={onClose}
      testID="report-person"
      title={
        alsoBlock
          ? `Report and block ${person.displayName}`
          : `Report ${person.displayName}`
      }
    >
      <Stack gap={4}>
        <Text tone="secondary" variant="small">
          {alsoBlock
            ? `VELORA reviews this, and sending it blocks ${person.displayName} straight away. They are told neither.`
            : 'VELORA reviews this. They are not told who reported them.'}
        </Text>

        <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
          <Text tone="secondary" variant="small" weight="medium">
            What is wrong?
          </Text>
          {reportReasons.map((reason) => (
            <Choice
              key={reason.value}
              onPress={() => {
                setReasonCode(reason.value);
              }}
              selected={reasonCode === reason.value}
              testID={`report-reason-${reason.value}`}
            >
              <Text variant="small" weight="medium">
                {reason.label}
              </Text>
            </Choice>
          ))}
        </View>

        <Field
          count={{
            current: detail.trim().length,
            maximum: maximumReportDetail,
          }}
          hint="Optional. Anything that helps somebody understand what happened."
          label="What happened"
          testID="report-detail-field"
          {...(tooLong
            ? { error: 'That is longer than a report can carry.' }
            : {})}
        >
          {(control) => (
            <TextField
              {...control}
              multiline
              onChangeText={setDetail}
              testID="report-detail"
              value={detail}
            />
          )}
        </Field>

        {error === undefined ? null : (
          <ErrorMessage testID="report-error">{error}</ErrorMessage>
        )}

        <Button
          busy={busy}
          disabled={tooLong}
          icon="flag"
          onPress={() => {
            run(async () => {
              setError(undefined);
              // Generated once per submission. The server scopes it to the
              // reporter, so a retry of the same submission is one report.
              const reportId = clientReportId();
              const detailFields =
                detail.trim().length === 0 ? {} : { detail: detail.trim() };
              if (alsoBlock) {
                const result = await api.reportWithBlock({
                  clientReportId: reportId,
                  ...detailFields,
                  reasonCode,
                  targetAccountId: person.id,
                });
                const failure = failureMessage(result);
                if (failure !== undefined) {
                  setError(failure);
                  return;
                }
                const reported =
                  'value' in result && result.value.report !== undefined;
                toast.show(
                  reported
                    ? `${person.displayName} is blocked and your report was received.`
                    : `${person.displayName} is blocked. We could not take another report right now, and the block still stands.`,
                  reported ? 'positive' : 'neutral',
                );
                onBlocked?.();
                onSubmitted?.();
                onClose();
                return;
              }
              const result = await api.report({
                clientReportId: reportId,
                ...detailFields,
                reasonCode,
                target: { accountId: person.id, type: 'consumer_account' },
              });
              const failure = failureMessage(result);
              if (failure !== undefined) {
                setError(failure);
                return;
              }
              toast.show(
                'Report received. They are not told who reported them.',
                'positive',
              );
              onSubmitted?.();
              onClose();
            });
          }}
          testID="report-submit"
          tone="primary"
          wide
        >
          {alsoBlock ? 'Report and block' : 'Send the report'}
        </Button>
      </Stack>
    </Sheet>
  );
}
