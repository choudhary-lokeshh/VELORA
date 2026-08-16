'use client';

import { useCallback } from 'react';

import type {
  CreatorApi,
  CreatorClubList,
  CreatorContentList,
  CreatorMatureReadiness,
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

      <MatureReadiness api={api} onSessionEnded={onSessionEnded} />
    </Section>
  );
}

/**
 * Why mature content is unavailable.
 *
 * There is no upload control here and no toggle, because there is nothing a
 * creator could do that would work. What there is instead is the list of what
 * actually stands in the way, each owned by somebody who is not the creator, so
 * nobody is left assuming the remaining work is theirs.
 *
 * The two mobile surfaces are shown separately from the blockers. Both app
 * stores prohibit the content class outright with no published approval path,
 * so their ineligibility is a permanent fact about those surfaces rather than
 * something anybody is working through, and listing it as a blocker would imply
 * otherwise.
 */
function MatureReadiness({
  api,
  onSessionEnded,
}: {
  readonly api: CreatorApi;
  readonly onSessionEnded: () => void;
}) {
  const load = useCallback(async () => api.matureReadiness(), [api]);
  const readiness = useResource<CreatorMatureReadiness>(load, {
    onUnauthenticated: onSessionEnded,
  });
  const value = readiness.value;

  return (
    <>
      <ResourceState resource={readiness} testId="mature-readiness" />
      {value === undefined ? null : (
        <div data-testid="mature-readiness-detail">
          <StatusMessage testId="mature-readiness-state">
            Mature content is not available on Velora.
          </StatusMessage>
          <ul data-testid="mature-blockers">
            {value.blockers.map((blocker) => (
              <li key={blocker}>{blockerLabels[blocker] ?? blocker}</li>
            ))}
          </ul>
          <p className="hint" data-testid="mature-ineligible-surfaces">
            The iOS and Android apps could never carry it in any case: both
            stores prohibit it outright.
          </p>
        </div>
      )}
    </>
  );
}

/**
 * Each blocker in plain words, and each attributed to somebody other than the
 * creator reading it.
 */
const blockerLabels: Readonly<Record<string, string>> = {
  consent_wording_unpublished:
    'Nobody has approved the wording a depicted person would agree to.',
  content_taxonomy_undecided:
    'The content categories in use are provisional rather than approved.',
  depicted_person_verifier_unavailable:
    'No approved provider can verify a depicted adult.',
  mature_content_capability_disabled:
    'The capability itself is switched off and has no setting that turns it on.',
};
