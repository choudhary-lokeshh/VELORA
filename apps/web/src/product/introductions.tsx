'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import type { ApiResult, Introduction } from '@velora/consumer-client';
import { failureMessage, isOk } from '@velora/consumer-client';

import { useApi, useFeeds, useToast } from '../app/providers';
import {
  Avatar,
  Button,
  Chip,
  EmptyState,
  ErrorMessage,
  PageHeader,
  RowSkeleton,
  Segmented,
} from '../design/primitives';
import { CallControls } from './calls';
import { languageNames, regionName } from './locale';
import { PersonSafetyMenu } from './safety-actions';
import { useResource, useRevalidateOnFocus, useSingleFlight } from './resource';

/**
 * Pending signals and mutual introductions.
 *
 * A pending signal is an offer with an end. Its validity is bounded by the
 * availability that produced it or by a day, whichever comes first, and the
 * server closes it where it finds it expired rather than sweeping it on a timer.
 * This surface therefore does not compute or count down an expiry it would only
 * get wrong — and it deliberately does not dress the deadline up as pressure.
 * `docs/design/01-design-principles.md` rules out artificial urgency, and a
 * ticking clock over somebody's face is exactly that.
 *
 * Nothing here tells anybody who declined them, who withdrew, or who let a
 * signal lapse. A closed introduction stops being listed, which is the same
 * thing somebody sees when the other person was never there.
 */

type Group = 'waiting-on-you' | 'you-reached-out' | 'mutual';

export function Introductions() {
  const api = useApi();
  const feeds = useFeeds();
  const router = useRouter();
  const toast = useToast();
  const load = useCallback(
    async (signal: AbortSignal) => api.introductions({}, signal),
    [api],
  );
  const introductions = useResource(load);
  const [group, setGroup] = useState<Group>('waiting-on-you');
  const [pending, setPending] = useState<string | undefined>(undefined);
  const action = useSingleFlight();

  useRevalidateOnFocus(introductions.reload);

  const rows = introductions.value?.introductions ?? [];
  const incoming = rows.filter(
    (row) => row.state === 'pending' && row.role === 'recipient',
  );
  const outgoing = rows.filter(
    (row) => row.state === 'pending' && row.role === 'initiator',
  );
  const mutual = rows.filter((row) => row.state === 'mutual');

  const act = (
    id: string,
    work: () => Promise<ApiResult<unknown>>,
    success: string,
  ) => {
    action.run(async () => {
      setPending(id);
      try {
        const result = await work();
        toast.show(
          isOk(result)
            ? success
            : (failureMessage(result) ?? 'That did not work.'),
          isOk(result) ? 'positive' : 'critical',
        );
        // Re-read either way. The server decides what state the pair is in, and
        // an accepted action can still have been overtaken by the other side.
        introductions.reload();
      } finally {
        setPending(undefined);
      }
    });
  };

  const openConversation = (introduction: Introduction) => {
    action.run(async () => {
      setPending(introduction.id);
      try {
        const result = await api.openConversation(introduction.id);
        if (isOk(result)) {
          // The list the messages screen reads was fetched before this
          // conversation existed. Asking for it again before navigating is what
          // stops the thread rendering "not available" for the moment between.
          feeds.conversations.reload();
          router.push(`/messages/${result.value.id}`);
          return;
        }
        toast.show(
          failureMessage(result) ?? 'That conversation could not be opened.',
          'critical',
        );
        introductions.reload();
      } finally {
        setPending(undefined);
      }
    });
  };

  const shown =
    group === 'mutual'
      ? mutual
      : group === 'you-reached-out'
        ? outgoing
        : incoming;
  const busy = action.busy || pending !== undefined;

  return (
    <>
      <PageHeader
        lede="An introduction happens when two people both say yes. Until then nobody is told anything."
        title="Introductions"
      />

      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Segmented
          label="Which introductions"
          onChange={setGroup}
          options={[
            {
              count: incoming.length,
              label: 'Waiting on you',
              value: 'waiting-on-you',
            },
            {
              count: outgoing.length,
              label: 'You reached out',
              value: 'you-reached-out',
            },
            { count: mutual.length, label: 'Mutual', value: 'mutual' },
          ]}
          value={group}
        />
      </div>

      {introductions.loading && introductions.value === undefined ? (
        <RowSkeleton rows={3} />
      ) : null}

      {introductions.error === undefined ? null : (
        <div className="v-stack v-stack--3">
          <ErrorMessage testId="introductions-failed">
            {introductions.error}
          </ErrorMessage>
          {introductions.retryable ? (
            <div>
              <Button onClick={introductions.reload}>Try again</Button>
            </div>
          ) : null}
        </div>
      )}

      {!introductions.loading &&
      introductions.error === undefined &&
      shown.length === 0 ? (
        <EmptyState
          icon={group === 'mutual' ? 'link' : 'heart'}
          testId={`introductions-empty-${group}`}
          {...emptyCopy[group]}
        />
      ) : null}

      {shown.length === 0 ? null : (
        <ul className="v-intro-grid" data-testid={`introductions-${group}`}>
          {shown.map((row) => (
            <li key={row.id}>
              <IntroductionCard
                busy={busy}
                introduction={row}
                onAccept={() => {
                  act(
                    row.id,
                    async () => api.signalIntroduction(row.counterpart.id),
                    'You are introduced. Say hello whenever you like.',
                  );
                }}
                onChanged={introductions.reload}
                onDecline={() => {
                  act(
                    row.id,
                    async () => api.declineIntroduction(row.id),
                    'Declined. They are not told.',
                  );
                }}
                onOpen={() => {
                  openConversation(row);
                }}
                onWithdraw={() => {
                  act(
                    row.id,
                    async () => api.withdrawIntroduction(row.id),
                    'Withdrawn. They never heard about it.',
                  );
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const emptyCopy: Readonly<
  Record<Group, { readonly body: string; readonly title: string }>
> = {
  mutual: {
    body: 'When you and somebody else both say yes, you appear here and a conversation opens.',
    title: 'No mutual introductions yet',
  },
  'waiting-on-you': {
    body: 'When somebody says they are interested in you, they wait here for your answer.',
    title: 'Nobody is waiting on you',
  },
  'you-reached-out': {
    body: 'People you have said you are interested in wait here. They are not told unless they say yes too.',
    title: 'You have not reached out to anybody',
  },
};

function IntroductionCard({
  busy,
  introduction,
  onAccept,
  onChanged,
  onDecline,
  onOpen,
  onWithdraw,
}: {
  readonly busy: boolean;
  readonly introduction: Introduction;
  readonly onAccept: () => void;
  readonly onChanged: () => void;
  readonly onDecline: () => void;
  readonly onOpen: () => void;
  readonly onWithdraw: () => void;
}) {
  const { counterpart } = introduction;
  const region = regionName(counterpart.region);
  const mutual = introduction.state === 'mutual';

  return (
    <article
      className="v-intro"
      data-testid={`introduction-${introduction.id}`}
    >
      <header className="v-intro__head">
        <Avatar
          displayName={counterpart.displayName}
          seed={counterpart.id}
          size="md"
        />
        <div className="v-row__body">
          <h2 className="v-subheading v-wrap">{counterpart.displayName}</h2>
          <p className="v-caption v-quiet">
            {mutual
              ? 'You both said yes.'
              : introduction.role === 'initiator'
                ? 'Waiting for them. They only hear about it if they are interested too.'
                : 'They are interested in meeting you.'}
          </p>
        </div>
        <PersonSafetyMenu
          onBlocked={onChanged}
          person={{
            displayName: counterpart.displayName,
            id: counterpart.id,
          }}
          size="sm"
        />
      </header>

      {counterpart.bio === undefined ? null : (
        <p className="v-small v-muted v-wrap v-clamp-3">{counterpart.bio}</p>
      )}

      <div className="v-inline v-inline--tight">
        {region === undefined ? null : <Chip>{region}</Chip>}
        {counterpart.sharedLanguages.length === 0 ? null : (
          <Chip>Both speak {languageNames(counterpart.sharedLanguages)}</Chip>
        )}
      </div>

      <div className="v-intro__actions">
        {mutual ? (
          <>
            <Button
              data-testid={`introduction-open-${introduction.id}`}
              disabled={busy}
              icon="message"
              onClick={onOpen}
              tone="primary"
            >
              Message
            </Button>
            <CallControls
              counterpart={{
                displayName: counterpart.displayName,
                id: counterpart.id,
              }}
              disabled={busy}
              introductionId={introduction.id}
            />
          </>
        ) : introduction.role === 'initiator' ? (
          <Button
            data-testid={`introduction-withdraw-${introduction.id}`}
            disabled={busy}
            onClick={onWithdraw}
          >
            Withdraw
          </Button>
        ) : (
          <>
            <Button
              data-testid={`introduction-accept-${introduction.id}`}
              disabled={busy}
              icon="heart"
              onClick={onAccept}
              tone="primary"
            >
              Interested too
            </Button>
            <Button
              data-testid={`introduction-decline-${introduction.id}`}
              disabled={busy}
              onClick={onDecline}
            >
              Decline
            </Button>
          </>
        )}
      </div>
    </article>
  );
}
