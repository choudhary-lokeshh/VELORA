import type { ApiResult, DiscoveryCandidate } from '@velora/consumer-client';
import {
  availabilityView,
  failureMessage,
  isRetryable,
} from '@velora/consumer-client';
import {
  failureMessage as creatorFailureMessage,
  type PublicCreatorSummary,
} from '@velora/creator-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { useApi, useCreatorApi, useToast } from '../frame/providers';
import { Screen } from '../frame/shell';
import {
  Actions,
  Avatar,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorMessage,
  ErrorState,
  Inline,
  Notice,
  RowSkeleton,
  Segmented,
  Stack,
  Text,
} from '../design/primitives';
import { color, space } from '../design/tokens';
import { portraitReferences, useMediaAddresses } from './imagery';
import { languageNames, regionName } from './locale';
import { useResource, useSingleFlight } from './resource';
import { PersonSafetyMenu } from './safety-actions';

/**
 * Discovery, on a phone.
 *
 * Each person is a full-width card rather than a row, because a decision about
 * a person deserves a screenful and because both actions have to land under a
 * thumb. The list is virtualised and paged: a phone is the device most likely
 * to meet a long feed and least able to render one.
 *
 * Nothing about a candidate is invented. The card shows the name, the region,
 * the languages both people speak, and the bio — all of which the contract
 * publishes — and there is no photograph, because there is no route by which
 * one could be delivered.
 */

/** How many candidates one screenful tries to hold. */
const candidateTarget = 10;

/**
 * How many requests one fill may make.
 *
 * A short page carrying a cursor does not mean there is nothing left, so the
 * client keeps asking — but a bounded number of times, so one pull cannot walk
 * somebody's entire suppression history over a mobile connection.
 */
const maximumFillRequests = 4;

interface Feed {
  readonly candidates: readonly DiscoveryCandidate[];
  readonly cursor: string | undefined;
  readonly exhausted: boolean;
}

const emptyFeed: Feed = {
  candidates: [],
  cursor: undefined,
  exhausted: false,
};

/** Which half of Discover is being read. Kept in the address by the route. */
export type DiscoverSection = 'people' | 'creators';

export function DiscoverScreen({
  onOpenCreator,
  onOpenPerson,
  onOpenYou,
  onSection,
  section,
}: {
  /** Opening a creator's public page. The route owns the router. */
  readonly onOpenCreator: (handle: string) => void;
  /** Opening one person, at their own address. The route owns the router. */
  readonly onOpenPerson: (personId: string) => void;
  /** Where availability is set, for the notice that says nobody can see you. */
  readonly onOpenYou: () => void;
  /** Section changes go to the address, so Back and a relaunch keep it. */
  readonly onSection: (section: DiscoverSection) => void;
  readonly section: DiscoverSection;
}) {
  const api = useApi();
  const toast = useToast();
  const [feed, setFeed] = useState<Feed>(emptyFeed);
  const [loading, setLoading] = useState(true);
  const [answered, setAnswered] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [retryable, setRetryable] = useState(false);
  const decision = useSingleFlight();
  const inFlight = useRef<AbortController | undefined>(undefined);

  const fill = useCallback(
    async (from: Feed) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setLoading(true);
      setError(undefined);

      const collected = [...from.candidates];
      const seen = new Set(collected.map((candidate) => candidate.id));
      let next = from.cursor;
      let done = false;
      let failure: ApiResult<unknown> | undefined;

      for (
        let request = 0;
        request < maximumFillRequests && collected.length < candidateTarget;
        request += 1
      ) {
        const result = await api.candidates(
          { cursor: next, pageSize: candidateTarget },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (result.kind !== 'ok') {
          failure = result;
          break;
        }
        for (const candidate of result.value.candidates) {
          // Defensive: the server does not promise a candidate cannot appear on
          // two pages, and two cards for one person would invite two
          // conflicting decisions about them.
          if (seen.has(candidate.id)) continue;
          seen.add(candidate.id);
          collected.push(candidate);
        }
        next = result.value.nextCursor;
        if (next === undefined) {
          done = true;
          break;
        }
      }

      if (controller.signal.aborted) return;
      setLoading(false);
      setAnswered(true);
      setFeed({ candidates: collected, cursor: next, exhausted: done });
      if (failure !== undefined) {
        setError(failureMessage(failure));
        setRetryable(isRetryable(failure));
      }
    },
    // Depends on nothing that changes as the list grows: what is already held is
    // passed in, so a page arriving cannot restart the feed that fetched it.
    [api],
  );

  useEffect(() => {
    void fill(emptyFeed);
    return () => {
      inFlight.current?.abort();
    };
  }, [fill]);

  const drop = (candidateId: string) => {
    setFeed((current) => ({
      ...current,
      candidates: current.candidates.filter(
        (candidate) => candidate.id !== candidateId,
      ),
    }));
  };

  const decide = (
    candidateId: string,
    work: () => Promise<ApiResult<unknown>>,
    success: string,
  ) => {
    // A duplicate tap cannot produce a second request. The guard is a ref inside
    // `useSingleFlight`, not component state: three presses in one frame would
    // all read a state flag as it was before any of them committed.
    decision.run(async () => {
      const result = await work();
      const failure = failureMessage(result);
      if (failure === undefined) {
        toast.show(success, 'positive');
        drop(candidateId);
        return;
      }
      toast.show(failure, 'critical');
      await fill(emptyFeed);
    });
  };

  const showEmpty =
    answered && error === undefined && feed.candidates.length === 0;
  const portraits = useMediaAddresses(
    portraitReferences(feed.candidates),
    'display',
  );
  /*
   * Whether anybody can currently see this person, said where they are
   * looking at everybody else. Being available is what makes you visible,
   * and a feed browsed while invisible quietly answers nothing back — the
   * web surface says so, and a phone deserves the same sentence.
   */
  const loadAvailability = useCallback(
    async (signal: AbortSignal) => api.availability(signal),
    [api],
  );
  const availability = useResource(loadAvailability);
  const view = availabilityView(availability.value);

  return (
    <Screen
      onRefresh={() => {
        void fill(emptyFeed);
      }}
      refreshing={loading && feed.candidates.length > 0}
      scroll={false}
      subtitle="People who are available to you right now."
      testID="discover-screen"
      title="Discover"
    >
      <View style={styles.sections}>
        <Segmented
          onChange={onSection}
          options={[
            { label: 'People', value: 'people' },
            { label: 'Creators', value: 'creators' },
          ]}
          testID="discover-sections"
          value={section}
        />
      </View>

      {section === 'creators' || view === 'available' ? null : (
        <View style={styles.notice}>
          <Notice
            testID="discovery-availability"
            title={
              view === 'expired'
                ? 'Your availability window ended'
                : 'You are not visible right now'
            }
            tone="caution"
          >
            Other people only see you while you are available, and being
            available is also how you appear to them.
          </Notice>
          <Button
            onPress={onOpenYou}
            size="small"
            testID="discovery-availability-set"
            tone="ghost"
          >
            Set a window under You
          </Button>
        </View>
      )}

      {section === 'creators' ? (
        <CreatorsPane onOpenCreator={onOpenCreator} />
      ) : loading && !answered ? (
        <Card>
          <RowSkeleton rows={3} />
        </Card>
      ) : error !== undefined && feed.candidates.length === 0 ? (
        <ErrorState
          body={error}
          testID="discovery-failed"
          {...(retryable
            ? {
                onRetry: () => {
                  void fill(emptyFeed);
                },
              }
            : {})}
        />
      ) : showEmpty ? (
        <EmptyState
          action={
            <Button
              icon="refresh"
              onPress={() => {
                void fill(emptyFeed);
              }}
              testID="discovery-look-again"
            >
              Look again
            </Button>
          }
          body={
            feed.exhausted
              ? 'You have seen everybody available to you for now. People appear here when they make themselves available, so it is worth coming back.'
              : 'Nobody is available to you right now. Being available yourself is what makes you visible to other people too.'
          }
          icon="compass"
          testID="discovery-empty"
          title={
            feed.exhausted ? 'That is everybody for now' : 'Nobody right now'
          }
        />
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={[...feed.candidates]}
          keyExtractor={(candidate) => candidate.id}
          onEndReached={() => {
            if (feed.exhausted || feed.cursor === undefined || loading) return;
            void fill(feed);
          }}
          onEndReachedThreshold={0.6}
          renderItem={({ item }) => (
            <CandidateCard
              busy={decision.busy}
              candidate={item}
              portrait={portraits.get(item.media[0]?.id ?? '')}
              onBlocked={() => {
                drop(item.id);
              }}
              onOpen={() => {
                onOpenPerson(item.id);
              }}
              onPass={() => {
                decide(
                  item.id,
                  async () => api.pass(item.id),
                  'Passed. They are not told, and you will not see them for a while.',
                );
              }}
              onSignal={() => {
                decide(
                  item.id,
                  async () => api.signalIntroduction(item.id),
                  'Interest sent. They only hear about it if they say yes too.',
                );
              }}
            />
          )}
          showsVerticalScrollIndicator={false}
          testID="discovery-list"
        />
      )}
    </Screen>
  );
}

/**
 * The creator half of Discover.
 *
 * The same public directory Consumer Web renders in its Creators section, on
 * the same no-credential client: names, handles, and what each has written,
 * each row leading to the creator's own page. Before this existed the phone
 * had creator and club screens that nothing linked to — deep-link-only rooms
 * in a building with no corridor.
 */
function CreatorsPane({
  onOpenCreator,
}: {
  readonly onOpenCreator: (handle: string) => void;
}) {
  const creators = useCreatorApi();
  const pageSize = 20;
  const load = useCallback(
    async () => creators.publicCreatorDirectory({ pageSize }),
    [creators],
  );
  const first = useResource(load);
  const [extra, setExtra] = useState<readonly PublicCreatorSummary[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [pagingError, setPagingError] = useState<string | undefined>(undefined);
  const paging = useSingleFlight();

  useEffect(() => {
    setExtra([]);
    setPagingError(undefined);
    setCursor(first.value?.nextCursor);
  }, [first.value]);

  const rows = [...(first.value?.creators ?? []), ...extra];

  const more = () => {
    const from = cursor;
    if (from === undefined) return;
    paging.run(async () => {
      const result = await creators.publicCreatorDirectory({
        cursor: from,
        pageSize,
      });
      if (result.kind !== 'ok') {
        setPagingError(
          creatorFailureMessage(result) ?? 'More creators could not be loaded.',
        );
        return;
      }
      setPagingError(undefined);
      setExtra((held) => [...held, ...result.value.creators]);
      setCursor(result.value.nextCursor);
    });
  };

  if (first.loading && first.value === undefined) {
    return (
      <Card>
        <RowSkeleton rows={3} />
      </Card>
    );
  }
  if (first.error !== undefined && first.value === undefined) {
    return (
      <ErrorState
        body={first.error}
        testID="creator-directory-failed"
        {...(first.retryable ? { onRetry: first.reload } : {})}
      />
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        body="No creators have published a page yet. They appear here the moment one does."
        icon="sparkle"
        testID="creator-directory-empty"
        title="No creators yet"
      />
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={rows}
      keyExtractor={(row) => row.handle}
      ListFooterComponent={
        cursor === undefined ? null : (
          <Stack gap={2}>
            <Button
              busy={paging.busy}
              onPress={more}
              size="small"
              testID="creator-directory-more"
              tone="ghost"
            >
              Show more creators
            </Button>
            {pagingError === undefined ? null : (
              <ErrorMessage testID="creator-directory-more-failed">
                {pagingError}
              </ErrorMessage>
            )}
          </Stack>
        )
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            onOpenCreator(item.handle);
          }}
          testID={`creator-open-${item.handle}`}
        >
          <Card>
            <View style={styles.creatorRow}>
              <Avatar displayName={item.displayName} seed={item.handle} />
              <Stack gap={1} style={styles.creatorBody}>
                <Text variant="subheading" weight="semibold">
                  {item.displayName}
                </Text>
                <Text tone="tertiary" variant="caption">
                  {`@${item.handle}`}
                </Text>
                {item.bio === undefined ? null : (
                  <Text numberOfLines={2} tone="secondary" variant="small">
                    {item.bio}
                  </Text>
                )}
              </Stack>
            </View>
          </Card>
        </Pressable>
      )}
      showsVerticalScrollIndicator={false}
      testID="creator-directory"
    />
  );
}

function CandidateCard({
  busy,
  candidate,
  onBlocked,
  onOpen,
  onPass,
  onSignal,
  portrait,
}: {
  readonly busy: boolean;
  readonly candidate: DiscoveryCandidate;
  readonly onBlocked: () => void;
  /** Opening the person, to look properly before deciding. */
  readonly onOpen: () => void;
  readonly onPass: () => void;
  readonly onSignal: () => void;
  /** A short-lived address, or nothing to show. Never explained either way. */
  readonly portrait: string | undefined;
}) {
  const region = regionName(candidate.region);
  return (
    <Card testID={`candidate-${candidate.id}`}>
      <Stack gap={4}>
        <View style={styles.identity}>
          {/*
            The person, and the way into them. A card carries one photograph
            and the decision; somebody who wants to look properly before
            deciding opens the person, where the rest of what the projection
            already published is. The safety control stays outside this,
            because it acts on the person rather than opening them.
          */}
          <Pressable
            accessibilityLabel={`Open ${candidate.displayName}`}
            accessibilityRole="button"
            onPress={onOpen}
            style={({ pressed }) => [
              styles.open,
              pressed ? styles.openPressed : undefined,
            ]}
            testID={`candidate-open-${candidate.id}`}
          >
            <Avatar
              displayName={candidate.displayName}
              seed={candidate.id}
              size="large"
              source={portrait}
              testID={`candidate-portrait-${candidate.id}`}
            />
            <View style={styles.identityText}>
              <Text
                accessibilityRole="header"
                variant="heading"
                weight="semibold"
              >
                {candidate.displayName}
              </Text>
              <Inline gap={2} wrap>
                {region === undefined ? null : <Chip>{region}</Chip>}
                {candidate.sharedLanguages.length === 0 ? null : (
                  <Chip>
                    {`Both speak ${languageNames(candidate.sharedLanguages)}`}
                  </Chip>
                )}
              </Inline>
            </View>
          </Pressable>
          {/*
            Safety sits with the person rather than in the row of decisions.
            Beside Pass and Interested it competed for the same width and cost
            the primary action its own label; here it is where somebody looks
            when they are reacting to who this is rather than deciding about
            them.
          */}
          <PersonSafetyMenu
            onBlocked={onBlocked}
            person={{ displayName: candidate.displayName, id: candidate.id }}
          />
        </View>

        {candidate.bio === undefined ? (
          <Text tone="tertiary" variant="small">
            No bio yet.
          </Text>
        ) : (
          <Text tone="secondary" variant="small">
            {candidate.bio}
          </Text>
        )}

        <View style={styles.actions}>
          <Actions>
            <Button
              disabled={busy}
              onPress={onPass}
              testID={`discovery-pass-${candidate.id}`}
              tone="secondary"
              wide
            >
              Pass
            </Button>
            <Button
              disabled={busy}
              icon="heart"
              onPress={onSignal}
              testID={`discovery-signal-${candidate.id}`}
              tone="primary"
              wide
            >
              Interested
            </Button>
          </Actions>
        </View>
      </Stack>
    </Card>
  );
}

const styles = StyleSheet.create({
  creatorBody: {
    flex: 1,
    minWidth: 0,
  },
  creatorRow: {
    flexDirection: 'row',
    gap: space[3],
  },
  notice: {
    gap: space[2],
    marginBottom: space[3],
    paddingHorizontal: space[4],
  },
  sections: {
    marginBottom: space[3],
    paddingHorizontal: space[4],
  },
  actions: {
    borderTopColor: color.borderHairline,
    borderTopWidth: 1,
    paddingTop: space[4],
  },
  identity: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: space[4],
  },
  identityText: { flex: 1, gap: space[2] },
  list: { gap: space[4], paddingBottom: space[6] },
  open: {
    alignItems: 'flex-start',
    flex: 1,
    flexDirection: 'row',
    gap: space[4],
  },
  openPressed: { opacity: 0.6 },
});
