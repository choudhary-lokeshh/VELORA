import type { ApiResult, DiscoveryCandidate } from '@velora/consumer-client';
import { failureMessage, isRetryable } from '@velora/consumer-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { useApi, useToast } from '../frame/providers';
import { Screen } from '../frame/shell';
import {
  Avatar,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Inline,
  RowSkeleton,
  Stack,
  Text,
} from '../design/primitives';
import { color, space } from '../design/tokens';
import { languageNames, regionName } from './locale';
import { useSingleFlight } from './resource';
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

export function DiscoverScreen() {
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
      {loading && !answered ? (
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
              onBlocked={() => {
                drop(item.id);
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

function CandidateCard({
  busy,
  candidate,
  onBlocked,
  onPass,
  onSignal,
}: {
  readonly busy: boolean;
  readonly candidate: DiscoveryCandidate;
  readonly onBlocked: () => void;
  readonly onPass: () => void;
  readonly onSignal: () => void;
}) {
  const region = regionName(candidate.region);
  return (
    <Card testID={`candidate-${candidate.id}`}>
      <Stack gap={4}>
        <View style={styles.identity}>
          <Avatar
            displayName={candidate.displayName}
            seed={candidate.id}
            size="large"
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
          <View style={styles.action}>
            <Button
              disabled={busy}
              onPress={onPass}
              testID={`discovery-pass-${candidate.id}`}
              tone="secondary"
              wide
            >
              Pass
            </Button>
          </View>
          <View style={styles.action}>
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
          </View>
        </View>
      </Stack>
    </Card>
  );
}

const styles = StyleSheet.create({
  action: { flex: 1 },
  actions: {
    alignItems: 'center',
    borderTopColor: color.borderHairline,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: space[2],
    paddingTop: space[4],
  },
  identity: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: space[4],
  },
  identityText: { flex: 1, gap: space[2] },
  list: { gap: space[4], paddingBottom: space[6] },
});
