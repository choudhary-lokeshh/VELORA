'use client';

import { useCallback, useState } from 'react';

import type { ApiResult, SafetyStatement } from '@velora/consumer-client';
import { failureMessage, isOk } from '@velora/consumer-client';

import { useApi, useToast } from '../app/providers';
import { ConfirmDialog, Dialog } from '../design/dialog';
import { Icon } from '../design/icons';
import {
  Badge,
  Button,
  ErrorMessage,
  Field,
  Notice,
  PageHeader,
  RowSkeleton,
  Section,
  TextArea,
  type Tone,
  toneOf,
} from '../design/primitives';
import { formatFullDay, formatRelative } from './locale';
import { useResource, useSingleFlight } from './resource';
import { PersonSafetyMenu } from './safety-actions';

/**
 * Blocks, reports, and what the platform has decided about this account.
 *
 * A block is a safety action, not a display filter. The server stops the pair
 * from reaching each other everywhere — discovery, introductions, messages,
 * calls, and queued notices — and this screen only asks for it. It never claims
 * the other person was told, because they are not, and it never shows who has
 * blocked the person using it, because that is somebody else's decision.
 *
 * A report is evidence. The reporter learns that their report exists and what
 * state it is in, and nothing more: there is no moderator, no rationale, no
 * enforcement outcome, and no copy of the narrative they wrote. The narrative is
 * sent once and never echoed back, so it cannot be read out of this surface.
 *
 * Reporting and blocking start from a person rather than from here. Every screen
 * that shows somebody carries both actions, so nobody has to find this page and
 * paste an identifier into it to get away from someone.
 */

const reportReasonLabels: Readonly<Record<string, string>> = {
  harassment: 'Harassment or bullying',
  hate_or_abuse: 'Hate or abuse',
  impersonation: 'Impersonation or a fake profile',
  other: 'Something else',
  sexual_content_violation: 'Sexual content violation',
  spam_or_scam: 'Spam or a scam',
  threats_or_violence: 'Threats or violence',
  underage_concern: 'They may be under 18',
};

const reportStateLabels: Readonly<
  Record<string, { readonly label: string; readonly tone: Tone }>
> = {
  actioned: { label: 'Closed', tone: 'neutral' },
  dismissed: { label: 'Closed', tone: 'neutral' },
  received: { label: 'Received', tone: 'info' },
  under_review: { label: 'Being looked at', tone: 'info' },
};

/**
 * The coarse categories a subject may be told, in plain words.
 *
 * These are the only four the server will ever send, and each is deliberately
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
  received: { label: 'We have your request', tone: 'info' },
  refused: { label: 'The decision stands', tone: 'neutral' },
  under_review: { label: 'Somebody is looking at it', tone: 'info' },
  upheld: { label: 'We changed the decision', tone: 'positive' },
  withdrawn: { label: 'You withdrew this', tone: 'neutral' },
};

export function Safety() {
  return (
    <>
      <PageHeader
        lede="Everything VELORA is holding on your behalf, and everything it has decided about your account."
        title="Safety"
      />
      <div className="v-stack v-stack--6">
        <StandingCard />
        <RecentlyMetCard />
        <BlockedCard />
        <ReportsCard />
      </div>
    </>
  );
}

/* --------------------------------------------------------------- standing */

function StandingCard() {
  const api = useApi();
  const toast = useToast();
  const loadStanding = useCallback(
    async (signal: AbortSignal) => api.standing(signal),
    [api],
  );
  const loadAppeals = useCallback(
    async (signal: AbortSignal) => api.appeals(signal),
    [api],
  );
  const standing = useResource(loadStanding);
  const appeals = useResource(loadAppeals);
  const [appealing, setAppealing] = useState<SafetyStatement | undefined>(
    undefined,
  );
  const [withdrawing, setWithdrawing] = useState<string | undefined>(undefined);
  const { busy, run } = useSingleFlight();

  const statements = standing.value?.statements ?? [];
  const complaints = appeals.value?.appeals ?? [];

  const act = (work: () => Promise<ApiResult<unknown>>, success: string) => {
    run(async () => {
      const result = await work();
      toast.show(
        isOk(result)
          ? success
          : (failureMessage(result) ?? 'That did not work.'),
        isOk(result) ? 'positive' : 'critical',
      );
      standing.reload();
      appeals.reload();
    });
  };

  return (
    <Section raised testId="standing-card" title="Decisions about your account">
      {standing.loading && standing.value === undefined ? (
        <RowSkeleton rows={1} />
      ) : null}
      {standing.error === undefined ? null : (
        <div className="v-stack v-stack--3">
          <ErrorMessage testId="standing-failed">{standing.error}</ErrorMessage>
          {standing.retryable ? (
            <div>
              <Button onClick={standing.reload} size="sm">
                Try again
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {!standing.loading &&
      standing.error === undefined &&
      statements.length === 0 ? (
        <p className="v-small v-muted" data-testid="standing-empty">
          Nothing is restricted on your account.
        </p>
      ) : null}

      {statements.length === 0 ? null : (
        <ul className="v-list v-list--divided" data-testid="standing-list">
          {statements.map((statement) => (
            <li key={statement.decisionId}>
              <div className="v-row" style={{ alignItems: 'flex-start' }}>
                <span className="v-notification__mark">
                  <Icon name="alert" size="md" />
                </span>
                <span className="v-row__body">
                  <span className="v-subheading">
                    {denialLabels[statement.reasonCode] ??
                      'A decision was made about your account.'}
                  </span>
                  <span className="v-caption v-quiet">
                    {scopeLabels[statement.scope] ?? ''}{' '}
                    {statement.appealWindowClosesAt === undefined
                      ? ''
                      : `You can ask us to look again until ${formatFullDay(
                          statement.appealWindowClosesAt,
                        )}.`}
                  </span>
                  {statement.appealable ? (
                    <span style={{ marginTop: 'var(--space-2)' }}>
                      <Button
                        data-testid={`appeal-${statement.decisionId}`}
                        disabled={busy}
                        onClick={() => {
                          setAppealing(statement);
                        }}
                        size="sm"
                      >
                        Ask us to look again
                      </Button>
                    </span>
                  ) : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {complaints.length === 0 ? null : (
        <>
          <h3 className="v-label v-quiet">Your requests</h3>
          <ul className="v-list v-list--divided" data-testid="appeal-list">
            {complaints.map((appeal) => {
              const shown = appealLabels[appeal.state] ?? {
                label: 'Recorded',
                tone: 'neutral' as Tone,
              };
              return (
                <li key={appeal.id}>
                  <div className="v-row">
                    <span className="v-row__body">
                      <Badge tone={shown.tone}>{shown.label}</Badge>
                      <span className="v-caption v-quiet">
                        Sent {formatRelative(appeal.submittedAt)}
                      </span>
                    </span>
                    {appeal.state === 'received' ||
                    appeal.state === 'under_review' ? (
                      <Button
                        data-testid={`withdraw-${appeal.id}`}
                        disabled={busy}
                        onClick={() => {
                          setWithdrawing(appeal.id);
                        }}
                        size="sm"
                        tone="ghost"
                      >
                        Withdraw
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {appealing === undefined ? null : (
        <AppealDialog
          busy={busy}
          onClose={() => {
            setAppealing(undefined);
          }}
          onSubmit={(statement) => {
            act(
              async () =>
                api.appeal({
                  decisionId: appealing.decisionId,
                  ...(statement.length === 0 ? {} : { statement }),
                }),
              'We have your request. A person will look at it.',
            );
            setAppealing(undefined);
          }}
        />
      )}

      {withdrawing === undefined ? null : (
        <ConfirmDialog
          busy={busy}
          confirmLabel="Withdraw"
          confirmTone="secondary"
          onCancel={() => {
            setWithdrawing(undefined);
          }}
          onConfirm={() => {
            act(
              async () => api.withdrawAppeal(withdrawing),
              'Withdrawn. You can ask again if you change your mind.',
            );
            setWithdrawing(undefined);
          }}
          testId="withdraw-appeal"
          title="Withdraw this request?"
        >
          <p>
            Nobody will look at it further. You can ask again while the window
            is still open.
          </p>
        </ConfirmDialog>
      )}
    </Section>
  );
}

function AppealDialog({
  busy,
  onClose,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (statement: string) => void;
}) {
  const [statement, setStatement] = useState('');
  return (
    <Dialog
      onClose={onClose}
      testId="appeal-dialog"
      title="Ask us to look again"
    >
      <form
        className="v-stack v-stack--5"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(statement.trim());
        }}
      >
        <Field
          count={{ length: statement.length, maximum: 2000 }}
          hint="A person reads this. You will be told the outcome, not the reasoning behind it."
          label="Anything you want us to know"
          optional
        >
          {(control) => (
            <TextArea
              {...control}
              data-testid="appeal-statement"
              maxLength={2000}
              name="statement"
              onChange={(event) => {
                setStatement(event.target.value);
              }}
              rows={5}
              value={statement}
            />
          )}
        </Field>
        <div className="v-dialog__actions">
          <Button disabled={busy} onClick={onClose} tone="ghost">
            Cancel
          </Button>
          <Button
            busy={busy}
            data-testid="appeal-submit"
            tone="primary"
            type="submit"
          >
            Send request
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- blocked */

/* ------------------------------------------------------------ recently met */

/**
 * The people a random encounter has already ended with.
 *
 * This exists for one complaint and answers it exactly. Every other surface
 * that shows somebody carries a safety action, but a random stranger is on no
 * other surface: the moment the encounter is over they are nowhere, and the
 * person who was just abused is left with a display name they did not write
 * down. So the platform keeps a short-lived way back to them, here, where
 * somebody would look for it.
 *
 * It is not a history. Nothing here says what was said, how long it lasted, or
 * why it ended, and the server bounds it in both count and age — a permanent
 * list of every stranger somebody has been shown would be a directory this
 * product has spent its whole design refusing to build.
 */
function RecentlyMetCard() {
  const api = useApi();
  const load = useCallback(
    async (signal: AbortSignal) => api.recentLivePeople(signal),
    [api],
  );
  const met = useResource(load);
  const people = met.value?.people ?? [];
  const windowHours = met.value?.windowHours;

  // Live discovery is switched off in this environment, so there is nobody to
  // have met and nothing honest to render. A card saying "none" would be a
  // claim about a feature that is not running.
  if (met.error !== undefined && !met.retryable) return null;

  return (
    <Section
      raised
      testId="recently-met-card"
      title="People you recently met on Live"
    >
      {met.loading && met.value === undefined ? <RowSkeleton rows={2} /> : null}

      {met.error === undefined ? null : (
        <div className="v-stack v-stack--3">
          <ErrorMessage testId="recently-met-failed">{met.error}</ErrorMessage>
          {met.retryable ? (
            <div>
              <Button onClick={met.reload} size="sm">
                Try again
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {!met.loading && met.error === undefined && people.length === 0 ? (
        <p className="v-small v-muted" data-testid="recently-met-empty">
          Nobody yet. After a Live conversation ends, the person you met stays
          here for a while so you can still report or block them.
        </p>
      ) : null}

      {people.length === 0 ? null : (
        <>
          <Notice tone="quiet">
            {windowHours === undefined
              ? 'They stay here for a short while after the conversation ends, so a conversation that went wrong can still be reported once it is over.'
              : `They stay here for ${String(windowHours)} hours after the conversation ends, so a conversation that went wrong can still be reported once it is over.`}
          </Notice>
          <ul
            className="v-list v-list--divided"
            data-testid="recently-met-list"
          >
            {people.map((entry) => (
              <li key={entry.encounterId}>
                <div className="v-row">
                  <span
                    aria-hidden="true"
                    className={`v-avatar v-avatar--sm v-avatar--tone-${String(
                      toneOf(entry.person.id),
                    )}`}
                  >
                    {entry.person.displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="v-row__body">
                    <p className="v-strong">{entry.person.displayName}</p>
                    <p className="v-caption v-quiet">
                      Met {formatRelative(entry.endedAt)}
                    </p>
                  </div>
                  <PersonSafetyMenu
                    onBlocked={met.reload}
                    person={{
                      displayName: entry.person.displayName,
                      id: entry.person.id,
                    }}
                    size="sm"
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

function BlockedCard() {
  const api = useApi();
  const toast = useToast();
  const load = useCallback(
    async (signal: AbortSignal) => api.blocks({}, signal),
    [api],
  );
  const blocks = useResource(load);
  const [unblocking, setUnblocking] = useState<string | undefined>(undefined);
  const { busy, run } = useSingleFlight();
  const blocked = blocks.value?.blocks ?? [];

  return (
    <Section raised testId="blocked-card" title="People you have blocked">
      {blocks.loading && blocks.value === undefined ? (
        <RowSkeleton rows={2} />
      ) : null}
      {blocks.error === undefined ? null : (
        <div className="v-stack v-stack--3">
          <ErrorMessage testId="blocks-failed">{blocks.error}</ErrorMessage>
          {blocks.retryable ? (
            <div>
              <Button onClick={blocks.reload} size="sm">
                Try again
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {!blocks.loading && blocks.error === undefined && blocked.length === 0 ? (
        <p className="v-small v-muted" data-testid="blocks-empty">
          You have not blocked anybody. You can block or report somebody from
          anywhere they appear.
        </p>
      ) : null}

      {blocked.length === 0 ? null : (
        <>
          <Notice tone="quiet">
            VELORA does not keep a name against a block, so this list shows when
            you blocked somebody rather than who. Unblocking lets them see you
            in discovery again; neither blocking nor unblocking tells them
            anything.
          </Notice>
          <ul className="v-list v-list--divided" data-testid="block-list">
            {blocked.map((block) => (
              <li key={block.blockedId}>
                <div className="v-row">
                  <span
                    aria-hidden="true"
                    className={`v-avatar v-avatar--sm v-avatar--tone-${String(
                      toneOf(block.blockedId),
                    )}`}
                  >
                    <Icon name="ban" size="sm" />
                  </span>
                  <span className="v-row__body">
                    <span>Blocked person</span>
                    <span className="v-caption v-quiet">
                      Blocked {formatRelative(block.createdAt)}
                    </span>
                  </span>
                  <Button
                    data-testid={`unblock-${block.blockedId}`}
                    disabled={busy}
                    onClick={() => {
                      setUnblocking(block.blockedId);
                    }}
                    size="sm"
                  >
                    Unblock
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {unblocking === undefined ? null : (
        <ConfirmDialog
          busy={busy}
          confirmLabel="Unblock"
          confirmTone="secondary"
          onCancel={() => {
            setUnblocking(undefined);
          }}
          onConfirm={() => {
            run(async () => {
              const result = await api.unblock(unblocking);
              toast.show(
                isOk(result)
                  ? 'Block removed. They are not told either way.'
                  : (failureMessage(result) ?? 'That did not work.'),
                isOk(result) ? 'positive' : 'critical',
              );
              blocks.reload();
              setUnblocking(undefined);
            });
          }}
          testId="unblock-person"
          title="Unblock this person?"
        >
          <p>
            You will be able to see each other in discovery again, and either of
            you can say you are interested. They are not told this happened.
          </p>
        </ConfirmDialog>
      )}
    </Section>
  );
}

/* ---------------------------------------------------------------- reports */

function ReportsCard() {
  const api = useApi();
  const load = useCallback(
    async (signal: AbortSignal) => api.reports({}, signal),
    [api],
  );
  const reports = useResource(load);
  const rows = reports.value?.reports ?? [];

  return (
    <Section raised testId="reports-card" title="Reports you have made">
      {reports.loading && reports.value === undefined ? (
        <RowSkeleton rows={2} />
      ) : null}
      {reports.error === undefined ? null : (
        <div className="v-stack v-stack--3">
          <ErrorMessage testId="reports-failed">{reports.error}</ErrorMessage>
          {reports.retryable ? (
            <div>
              <Button onClick={reports.reload} size="sm">
                Try again
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {/*
          A sentence rather than a full empty state: this is one section among
          three on a page, and three centred illustrations stacked down it would
          make an ordinary, unremarkable account look like a series of failures.
        */}
      {!reports.loading && reports.error === undefined && rows.length === 0 ? (
        <p className="v-small v-muted" data-testid="reports-empty">
          You have not reported anybody. You can report somebody from anywhere
          they appear, and they are never told who reported them.
        </p>
      ) : null}

      {rows.length === 0 ? null : (
        <>
          <ul className="v-list v-list--divided" data-testid="report-list">
            {rows.map((report) => {
              const state = reportStateLabels[report.state] ?? {
                label: 'Recorded',
                tone: 'neutral' as Tone,
              };
              return (
                <li key={report.id}>
                  <div className="v-row">
                    <span className="v-row__body">
                      <span>
                        {reportReasonLabels[report.reasonCode] ??
                          report.reasonCode.replaceAll('_', ' ')}
                      </span>
                      <span className="v-caption v-quiet">
                        Sent {formatRelative(report.createdAt)}
                      </span>
                    </span>
                    <Badge tone={state.tone}>{state.label}</Badge>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="v-caption v-quiet">
            You are not told what happened after a report. An outcome told to a
            reporter is an outcome the reported person can work out.
          </p>
        </>
      )}
    </Section>
  );
}
