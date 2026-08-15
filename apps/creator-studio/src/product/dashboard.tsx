'use client';

import { useCallback } from 'react';

import type {
  CreatorApi,
  CreatorClubList,
  CreatorContentList,
  CreatorProfile,
} from '@velora/creator-client';
import { publicationLabels, publicationView } from '@velora/creator-client';

import { useResource } from './resource';
import { ResourceState, Section, StatusMessage } from './ui';

/**
 * What the creator currently has, counted from what the server actually holds.
 *
 * Every figure on this screen is derived from a list the server returned in the
 * same read. There is no earnings number, no growth line, no conversion rate,
 * no view count, no follower count, and no trend — none of those exist as
 * platform truth, and a number with nothing behind it is worse than an empty
 * screen because somebody will act on it.
 *
 * The counts are honest about their own bound as well: they describe the first
 * page the server returned rather than claiming to have counted everything, so
 * a creator with more than a page of items is told so instead of being shown a
 * total nobody computed.
 */
export function Dashboard({
  api,
  onSessionEnded,
  profile,
}: {
  readonly api: CreatorApi;
  readonly onSessionEnded: () => void;
  readonly profile: CreatorProfile | undefined;
}) {
  const loadContent = useCallback(async () => api.content(), [api]);
  const loadClubs = useCallback(async () => api.clubs(), [api]);
  const content = useResource<CreatorContentList>(loadContent, {
    onUnauthenticated: onSessionEnded,
  });
  const clubs = useResource<CreatorClubList>(loadClubs, {
    onUnauthenticated: onSessionEnded,
  });

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

  return (
    <Section headingId="home-heading" title="Home">
      <ResourceState resource={content} testId="dashboard-content" />
      <ResourceState resource={clubs} testId="dashboard-clubs" />

      <StatusMessage testId="dashboard-publication">
        {publicationLabels[publicationView(profile)]}
      </StatusMessage>
      {profile === undefined ? null : (
        <p data-testid="dashboard-public-path">
          Your public address is {profile.publicPath}
        </p>
      )}

      <dl>
        <div>
          <dt>Drafts</dt>
          <dd data-testid="dashboard-drafts">{drafts}</dd>
        </div>
        <div>
          <dt>Published items</dt>
          <dd data-testid="dashboard-published">{published}</dd>
        </div>
        <div>
          <dt>Published clubs</dt>
          <dd data-testid="dashboard-clubs-count">{publishedClubs}</dd>
        </div>
        <div>
          <dt>People with club access</dt>
          <dd data-testid="dashboard-members">{members}</dd>
        </div>
      </dl>

      {partial ? (
        <p className="hint" data-testid="dashboard-partial">
          These counts describe the first page the server returned, not a total.
        </p>
      ) : null}
    </Section>
  );
}
