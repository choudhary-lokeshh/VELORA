'use client';

import Link from 'next/link';
import { useCallback } from 'react';

import type { ConsumerGiftList } from '@velora/consumer-client';

import { useApi } from '../app/providers';
import { nestedHref } from '../app/navigation';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  PageHeader,
  RowSkeleton,
  type Tone,
} from '../design/primitives';
import { formatPrice } from './commerce';
import { GiftArt } from './gift-art';
import { formatDay } from './locale';
import { useResource } from './resource';

/**
 * Gifts this person has sent.
 *
 * A record of what BILLING settled, rendered in the product's own terms rather
 * than in the wire's. Each of those was a separate small dishonesty before: the
 * amount was assembled here instead of through the one formatter every other
 * price on this surface goes through, the date came out as a raw locale string
 * beside relative days everywhere else, the gift somebody chose by its
 * silhouette came back as the first letter of its name, and a gift that failed
 * wore the same quiet badge as one that was returned.
 *
 * Nothing is counted or celebrated. There is no total sent, no streak, and no
 * rank: a gift is a gesture somebody made and the platform's job is to say
 * accurately what happened to it, not to score it.
 */

interface StateLook {
  readonly label: string;
  readonly meaning: string;
  readonly tone: Tone;
}

/**
 * What each state is, and what it means for the person who sent it.
 *
 * The consequence is said rather than implied. Somebody whose gift was returned
 * needs to know the creator did not receive it, and somebody whose payment
 * failed needs to know nothing was charged — neither is guessable from a word
 * in a pill.
 */
const stateLooks: Readonly<Record<string, StateLook>> = {
  failed: {
    label: 'Did not go through',
    meaning:
      'The payment was refused. Nothing was charged and nothing was sent.',
    tone: 'critical',
  },
  partially_reversed: {
    label: 'Partly returned',
    meaning: 'Part of this was returned. The creator keeps the rest.',
    tone: 'caution',
  },
  pending: {
    label: 'Sending',
    meaning:
      'The payment has not settled yet. It is not with the creator until it does.',
    tone: 'caution',
  },
  reversed: {
    label: 'Returned',
    meaning: 'This was returned in full, so the creator did not receive it.',
    tone: 'neutral',
  },
  sent: {
    label: 'Sent',
    meaning: '',
    tone: 'positive',
  },
};

const unknownState: StateLook = {
  label: 'Unknown',
  meaning: '',
  tone: 'neutral',
};

export function SentGifts() {
  const api = useApi();
  const load = useCallback(async () => api.sentGifts(), [api]);
  const history = useResource<ConsumerGiftList>(load);
  const rows = history.value?.gifts ?? [];

  return (
    <>
      <PageHeader
        lede="Gifts you have sent to creators, and what happened to each one."
        title="Sent gifts"
      />
      {history.error !== undefined ? (
        <Card>
          <div className="v-stack v-stack--3">
            <ErrorMessage testId="sent-gifts-error">
              {history.error}
            </ErrorMessage>
            {history.retryable ? (
              <div>
                <Button onClick={history.reload}>Try again</Button>
              </div>
            ) : null}
          </div>
        </Card>
      ) : history.loading && history.value === undefined ? (
        <Card>
          <RowSkeleton rows={3} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            body="A creator's page is where you choose one. A gift is support and nothing else — it unlocks no content and gives no access."
            icon="sparkle"
            testId="sent-gifts-empty"
            title="No gifts sent"
          />
        </Card>
      ) : (
        <Card flush>
          <ul className="v-list v-list--divided" data-testid="sent-gifts-list">
            {rows.map((row) => {
              const look = stateLooks[row.state] ?? unknownState;
              return (
                <li data-testid={`sent-gift-${row.id}`} key={row.id}>
                  <div className="v-row">
                    <span className="v-gift-history-mark">
                      {/* The gift somebody actually chose, at the size of a
                          row. The name is beside it, so the mark is silent. */}
                      <GiftArt
                        className="v-gift-history-art"
                        visual={row.gift.visual}
                      />
                    </span>
                    <span className="v-row__body">
                      <span className="v-subheading v-wrap">
                        {row.gift.name}
                      </span>
                      <span className="v-caption v-quiet">
                        {/* The creator's own page, which is where this was
                            sent from and the only address this row knows. */}
                        <Link href={nestedHref(`/c/${row.creator.handle}`, '/you/gifts')}>
                          {row.creator.displayName}
                        </Link>
                        {' · '}
                        <span className="v-numeric">
                          {formatPrice(row.price)}
                        </span>
                        {' · '}
                        <time dateTime={row.sentAt ?? row.createdAt}>
                          {formatDay(row.sentAt ?? row.createdAt)}
                        </time>
                      </span>
                      {look.meaning === '' ? null : (
                        <span
                          className="v-caption v-quiet"
                          data-testid={`sent-gift-meaning-${row.id}`}
                        >
                          {look.meaning}
                        </span>
                      )}
                    </span>
                    <Badge tone={look.tone}>{look.label}</Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
