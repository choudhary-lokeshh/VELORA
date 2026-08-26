'use client';

import Link from 'next/link';
import { useCallback, type ReactNode } from 'react';

import type {
  CreatorClubList,
  CreatorContentList,
  CreatorEarnings,
  CreatorReceivedGiftList,
} from '@velora/creator-client';
import { formatAmount, formatMoney } from '@velora/creator-client';

import { Icon } from '../design/icons';
import {
  Badge,
  ButtonLink,
  Card,
  CardHead,
  CardSkeleton,
  EmptyState,
  ErrorState,
  ListRow,
  Metric,
  Notice,
  PageHeader,
  RowSkeleton,
} from '../design/primitives';
import { useApi, useCreator } from '../app/providers';
import {
  creatorStandingLook,
  formatDateTime,
  plural,
  standingReasonLabels,
} from './format';
import { useResource } from './resource';

/**
 * What the creator currently has, counted from what the server actually holds.
 *
 * Every figure on this screen is derived from a list the server returned in the
 * same read. There is no earnings number, no growth line, no conversion rate,
 * no view count, no follower count, and no trend — none of those exist as
 * platform truth, and a number with nothing behind it is worse than an empty
 * screen because somebody will act on it.
 *
 * The counts are honest about their own bound as well: they describe the pages
 * the server returned rather than claiming to have counted everything, so a
 * creator with more than a page of items is told so instead of being shown a
 * total nobody computed.
 *
 * The one thing this screen is opinionated about is the next step. It is
 * derived from real state — no page, an unpublished page, a draft waiting — and
 * exactly one is offered, because a home screen with five equally weighted
 * calls to action is a home screen that has decided nothing.
 */

/** How much of each list one read brings back. The contract's maximum. */
const overviewPageSize = 50;

export function Home() {
  const api = useApi();
  const creator = useCreator();

  const loadContent = useCallback(
    async () => api.content({ pageSize: overviewPageSize }),
    [api],
  );
  const loadClubs = useCallback(
    async () => api.clubs({ pageSize: overviewPageSize }),
    [api],
  );
  const loadEarnings = useCallback(async () => api.earnings(), [api]);
  const loadGifts = useCallback(async () => api.receivedGifts(), [api]);
  const content = useResource<CreatorContentList>(loadContent);
  const clubs = useResource<CreatorClubList>(loadClubs);
  const earnings = useResource<CreatorEarnings>(loadEarnings);
  const gifts = useResource<CreatorReceivedGiftList>(loadGifts);

  const profile = creator.profile.value;
  const items = content.value?.content ?? [];
  const rooms = clubs.value?.clubs ?? [];
  const drafts = items.filter((item) => item.lifecycle === 'draft').length;
  const published = items.filter(
    (item) => item.lifecycle === 'published',
  ).length;
  const publishedClubs = rooms.filter(
    (club) => club.lifecycle === 'published',
  ).length;
  // A real count of people who currently hold access, summed from live
  // entitlements the server counted per club.
  const members = rooms.reduce((total, club) => total + club.memberCount, 0);
  const partial =
    content.value?.nextCursor !== undefined ||
    clubs.value?.nextCursor !== undefined;
  const standing = creator.onboarding.value?.account.status ?? 'active';
  const standingReason = creator.onboarding.value?.account.statusReason;
  // Both reads, or neither. A grid that filled in one list at a time would put
  // a wrong number on the screen for as long as the slower read took, and a
  // creator reading "0 clubs" while their clubs were still arriving would have
  // been told something untrue.
  const loadingCounts =
    (content.value === undefined && content.error === undefined) ||
    (clubs.value === undefined && clubs.error === undefined);
  const recent = [
    ...items.map((item) => ({
      at: item.updatedAt,
      href: `/catalog/${item.id}`,
      id: `content-${item.id}`,
      label: item.title,
      meta:
        item.lifecycle === 'published'
          ? 'Published catalog item'
          : item.lifecycle === 'archived'
            ? 'Archived catalog item'
            : 'Draft catalog item',
    })),
    ...rooms.map((club) => ({
      at: club.updatedAt,
      href: `/clubs/${club.id}`,
      id: `club-${club.id}`,
      label: club.name,
      meta:
        club.lifecycle === 'published'
          ? 'Published private club'
          : club.lifecycle === 'closed'
            ? 'Closed private club'
            : 'Draft private club',
    })),
    ...(gifts.value?.gifts ?? []).map((gift) => ({
      at: gift.sentAt ?? gift.createdAt,
      href: '/money/gifts',
      id: `gift-${gift.id}`,
      label: `Received ${gift.gift.name}`,
      meta: `Your ledger share ${formatMoney(gift.earning)} · sender identity withheld`,
    })),
  ]
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, 5);
  const loadingRecent =
    loadingCounts || (gifts.value === undefined && gifts.error === undefined);

  return (
    <>
      <PageHeader
        eyebrow="Creator Studio"
        lede={
          profile === undefined
            ? 'Your public page does not exist yet. Nothing you make here is visible to anybody until you create it and publish it.'
            : profile.publication === 'published'
              ? 'Your page is live. Everything below is what people can and cannot currently see.'
              : 'Your page is a draft. Everything below is yours alone until you publish it.'
        }
        title={profile?.displayName ?? 'Home'}
      />

      {standing === 'active' ? null : (
        <Notice
          testId="home-standing"
          title={`Creator access: ${creatorStandingLook(standing).label.toLowerCase()}`}
          tone={
            standing === 'suspended' || standing === 'closed'
              ? 'critical'
              : 'caution'
          }
        >
          <p>
            {standingReason === undefined
              ? 'Some of what you can normally do here is unavailable at the moment.'
              : (standingReasonLabels[standingReason] ??
                'Some of what you can normally do here is unavailable at the moment.')}
          </p>
          <p>
            Everything you have made is still yours and still listed. Controls
            that would be refused are not offered.
          </p>
        </Notice>
      )}

      <NextStep
        drafts={drafts}
        hasClubs={rooms.length > 0}
        hasContent={items.length > 0}
        published={profile?.publication === 'published'}
        ready={content.value !== undefined && creator.settled}
        started={profile !== undefined}
      />

      <div className="s-split">
        <Card testId="home-counts">
          <CardHead
            actions={
              <ButtonLink href="/catalog" size="sm">
                Open catalog
              </ButtonLink>
            }
            lede={
              partial
                ? 'These counts describe what has been loaded so far, not a total. Nothing on VELORA counts your whole catalog for you.'
                : 'Counted from what the server holds right now.'
            }
            title="What you have"
          />
          {content.error !== undefined || clubs.error !== undefined ? (
            <ErrorState
              body={content.error ?? clubs.error ?? ''}
              onRetry={
                content.retryable || clubs.retryable
                  ? () => {
                      content.reload();
                      clubs.reload();
                    }
                  : undefined
              }
              testId="home-counts-failed"
            />
          ) : loadingCounts ? (
            <CardSkeleton rows={2} />
          ) : (
            <div className="s-grid">
              <Metric
                caption="drafts only you can see"
                testId="home-drafts"
                value={drafts}
              />
              <Metric
                caption="items on your public page"
                testId="home-published"
                value={published}
              />
              <Metric
                caption="clubs listed on your page"
                testId="home-clubs"
                value={publishedClubs}
              />
              <Metric
                caption="people who hold club access now"
                testId="home-members"
                value={members}
              />
            </div>
          )}
        </Card>

        <Card testId="home-page">
          <CardHead title="Your public page" />
          {profile === undefined ? (
            <div className="s-stack s-stack--4">
              <p className="s-small s-muted">
                You have not claimed a handle yet. Your handle becomes your
                public address, and it cannot be changed afterwards.
              </p>
              <ButtonLink href="/profile" icon="plus" tone="primary">
                Create your page
              </ButtonLink>
            </div>
          ) : (
            <div className="s-stack s-stack--4">
              <div className="s-inline s-inline--tight">
                {profile.publication === 'published' ? (
                  <Badge icon="globe" testId="home-publication" tone="positive">
                    Published
                  </Badge>
                ) : (
                  <Badge icon="draft" testId="home-publication" tone="caution">
                    Draft
                  </Badge>
                )}
                <span
                  className="s-chip s-truncate"
                  data-testid="home-public-path"
                >
                  {profile.publicPath}
                </span>
              </div>
              <p className="s-small s-muted">
                {profile.publication === 'published'
                  ? 'Anyone who opens that address sees your published items and your published clubs.'
                  : 'Nobody can open that address yet. Publishing is a separate decision from saving.'}
              </p>
              <div className="s-inline s-inline--tight">
                <ButtonLink href="/profile">Edit your page</ButtonLink>
                <ButtonLink href="/profile/preview" icon="eye">
                  See what visitors see
                </ButtonLink>
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="s-split">
        <Card testId="home-money">
          <CardHead
            actions={
              <ButtonLink href="/money" size="sm">
                Open money
              </ButtonLink>
            }
            lede="Ledger balances only. Each currency stays separate, and none is a payout promise."
            title="Money at a glance"
          />
          {earnings.error !== undefined ? (
            <ErrorState
              body={earnings.error}
              onRetry={earnings.retryable ? earnings.reload : undefined}
              testId="home-money-failed"
            />
          ) : earnings.loading && earnings.value === undefined ? (
            <CardSkeleton rows={2} />
          ) : (earnings.value?.currencies.length ?? 0) === 0 ? (
            <EmptyState
              body="A currency appears here only after its ledger has something to report."
              icon="ledger"
              testId="home-money-empty"
              title="No balance yet"
            />
          ) : (
            <div className="s-grid" data-testid="home-money-currencies">
              {earnings.value?.currencies.map((currency) => (
                <Metric
                  caption={`${currency.currency} VELORA currently owes you`}
                  key={currency.currency}
                  testId={`home-money-${currency.currency}-payable`}
                  value={formatAmount(currency.payable, currency.currency)}
                />
              ))}
            </div>
          )}
        </Card>

        <Card flush testId="home-recent">
          <CardHead
            actions={
              <ButtonLink href="/money/gifts" size="sm">
                See gifts
              </ButtonLink>
            }
            lede="The latest real changes from your catalog, clubs, and received gifts."
            title="Recent activity"
          />
          {content.error !== undefined ||
          clubs.error !== undefined ||
          gifts.error !== undefined ? (
            <ErrorState
              body={content.error ?? clubs.error ?? gifts.error ?? ''}
              onRetry={
                content.retryable || clubs.retryable || gifts.retryable
                  ? () => {
                      content.reload();
                      clubs.reload();
                      gifts.reload();
                    }
                  : undefined
              }
              testId="home-recent-failed"
            />
          ) : loadingRecent ? (
            <RowSkeleton rows={3} />
          ) : recent.length === 0 ? (
            <EmptyState
              body="Saved catalog work, club changes, and received gifts appear here."
              icon="sparkle"
              testId="home-recent-empty"
              title="Nothing has happened yet"
            />
          ) : (
            <ul className="s-list" data-testid="home-recent-list">
              {recent.map((activity) => (
                <li key={activity.id}>
                  <ListRow
                    aside={
                      <time
                        className="s-caption s-quiet"
                        dateTime={activity.at}
                      >
                        {formatDateTime(activity.at)}
                      </time>
                    }
                    href={activity.href}
                  >
                    <span className="s-subheading s-wrap">
                      {activity.label}
                    </span>
                    <span className="s-caption s-quiet s-wrap">
                      {activity.meta}
                    </span>
                  </ListRow>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card testId="home-shortcuts" flush>
        <CardHead title="Go to" />
        <div className="s-shortcuts">
          <Shortcut
            body={
              items.length === 0
                ? 'Nothing here yet'
                : plural(items.length, 'item loaded', 'items loaded')
            }
            href="/catalog"
            icon="draft"
            title="Catalog"
          />
          <Shortcut
            body={
              rooms.length === 0
                ? 'No clubs yet'
                : plural(rooms.length, 'club loaded', 'clubs loaded')
            }
            href="/clubs"
            icon="users"
            title="Private clubs"
          />
          <Shortcut
            body="What VELORA holds for you"
            href="/money"
            icon="wallet"
            title="Money"
          />
        </div>
      </Card>
    </>
  );
}

/**
 * The one next step, chosen from server state.
 *
 * Nothing is offered while the reads are still in flight, because a suggestion
 * derived from an empty list is a suggestion to do something the creator may
 * have already done.
 */
function NextStep({
  drafts,
  hasClubs,
  hasContent,
  published,
  ready,
  started,
}: {
  readonly drafts: number;
  readonly hasClubs: boolean;
  readonly hasContent: boolean;
  readonly published: boolean;
  readonly ready: boolean;
  readonly started: boolean;
}) {
  if (!ready) return null;

  if (!started) {
    return (
      <NextStepCard
        action={
          <ButtonLink href="/profile" icon="plus" tone="primary">
            Claim your handle
          </ButtonLink>
        }
        body="Your handle is your public address and cannot be changed later, so it is worth a moment's thought."
        title="Start with your public page"
      />
    );
  }
  if (!hasContent) {
    return (
      <NextStepCard
        action={
          <ButtonLink href="/catalog/new" icon="plus" tone="primary">
            Write a draft
          </ButtonLink>
        }
        body="Everything starts as a draft that only you can see. Publishing is a separate decision you make afterwards."
        title="Add something to your catalog"
      />
    );
  }
  if (!published) {
    return (
      <NextStepCard
        action={
          <ButtonLink href="/profile" icon="globe" tone="primary">
            Review and publish
          </ButtonLink>
        }
        body="Your page is a draft, so nobody can open it — including anybody you send the address to."
        title="Your page is not visible yet"
      />
    );
  }
  if (drafts > 0) {
    return (
      <NextStepCard
        action={
          <ButtonLink href="/catalog" tone="primary">
            Open catalog
          </ButtonLink>
        }
        body={`${plural(drafts, 'draft is', 'drafts are')} finished enough to sit in your catalog and not visible to anybody.`}
        title="You have work nobody can see"
      />
    );
  }
  if (!hasClubs) {
    return (
      <NextStepCard
        action={
          <ButtonLink href="/clubs" icon="plus" tone="primary">
            Create a club
          </ButtonLink>
        }
        body="A club is a private space you admit people to by invitation. It starts with nobody in it."
        title="Everything you have is public"
      />
    );
  }
  return null;
}

function NextStepCard({
  action,
  body,
  title,
}: {
  readonly action: ReactNode;
  readonly body: string;
  readonly title: string;
}) {
  return (
    <Card testId="home-next-step" tone="accent">
      <div className="s-next-step">
        <div className="s-stack s-stack--2">
          <p className="s-subheading">{title}</p>
          <p className="s-small s-muted s-measure">{body}</p>
        </div>
        <div className="s-next-step__action">{action}</div>
      </div>
    </Card>
  );
}

function Shortcut({
  body,
  href,
  icon,
  title,
}: {
  readonly body: string;
  readonly href: string;
  readonly icon: 'draft' | 'users' | 'wallet';
  readonly title: string;
}) {
  return (
    <Link className="s-shortcut" href={href}>
      <span className="s-shortcut__mark">
        <Icon name={icon} size="md" />
      </span>
      <span className="s-shortcut__text">
        <span className="s-subheading">{title}</span>
        <span className="s-caption s-quiet">{body}</span>
      </span>
      <Icon name="chevronRight" size="sm" />
    </Link>
  );
}
