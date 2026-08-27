import type {
  ClubDetail,
  MembershipOffer,
  PublicClub,
} from '@velora/consumer-client';
import { useCallback, useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { useApi } from '../frame/providers';
import { Screen } from '../frame/shell';
import { clubPath } from '../frame/links';
import {
  Badge,
  Button,
  Card,
  Chip,
  Divider,
  EmptyState,
  ErrorState,
  Notice,
  RowSkeleton,
  Stack,
  Text,
} from '../design/primitives';
import { radius, space } from '../design/tokens';
import { cadenceLabels, formatPrice, membershipSourceLabels } from './commerce';
import { useMediaAddresses } from './imagery';
import { formatDate } from './locale';
import { useResource } from './resource';

/**
 * A creator's public page, on a phone.
 *
 * Parity in what somebody can *see*, and a deliberate boundary in what they can
 * *do*. A membership that is for sale shows its price, its cadence, and what it
 * admits somebody to — and then says where it can be bought, because starting a
 * purchase from a mobile application is a different commercial arrangement with
 * different obligations and the API refuses it for this audience. The refusal
 * is at the server; this screen simply never offers a control that would meet
 * one.
 *
 * There is no external purchase link either. Whether an application may point
 * somebody at a payment page outside it is a store-policy question nobody has
 * answered, and a link added on the assumption that it is fine is exactly the
 * kind of thing that gets an application removed.
 */

export function CreatorScreen({
  handle,
  onBack,
  onOpenClub,
}: {
  readonly handle: string;
  readonly onBack: () => void;
  readonly onOpenClub: (path: string) => void;
}) {
  const api = useApi();
  const loadClubs = useCallback(
    async (signal: AbortSignal) => api.publicClubs(handle, signal),
    [api, handle],
  );
  const clubs = useResource(loadClubs);
  const loadOffers = useCallback(
    async (signal: AbortSignal) => api.membershipOffers(handle, signal),
    [api, handle],
  );
  const offers = useResource(loadOffers);

  const offerByResource = useMemo(() => {
    const found = new Map<string, MembershipOffer>();
    for (const offer of offers.value?.offers ?? []) {
      found.set(offer.resource.id, offer);
    }
    return found;
  }, [offers.value]);

  const rows = clubs.value?.clubs ?? [];

  return (
    <Screen
      onBack={onBack}
      onRefresh={() => {
        clubs.reload();
        offers.reload();
      }}
      refreshing={clubs.loading}
      subtitle={`@${handle}`}
      testID="creator-page"
      title="Creator"
    >
      <Stack gap={5}>
        {clubs.loading && clubs.value === undefined ? (
          <RowSkeleton rows={3} />
        ) : null}

        {clubs.error === undefined ? null : (
          <ErrorState
            body={clubs.error}
            onRetry={clubs.retryable ? clubs.reload : undefined}
            testID="creator-page-failed"
            title="This page could not be loaded"
          />
        )}

        {clubs.value !== undefined && rows.length === 0 ? (
          <EmptyState
            body="This creator has no private clubs open right now."
            icon="lock"
            testID="creator-clubs-empty"
            title="Nothing to join"
          />
        ) : null}

        {rows.map((club) => (
          <MembershipCard
            club={club}
            key={club.slug}
            offer={offerByResource.get(club.id)}
            onOpen={() => {
              onOpenClub(clubPath(handle, club.slug));
            }}
          />
        ))}
      </Stack>
    </Screen>
  );
}

function MembershipCard({
  club,
  offer,
  onOpen,
}: {
  readonly club: PublicClub;
  readonly offer: MembershipOffer | undefined;
  readonly onOpen: () => void;
}) {
  const prices = offer?.prices ?? [];
  const member = club.membership !== undefined;

  return (
    <Card testID={`club-card-${club.slug}`}>
      <Stack gap={3}>
        <View style={styles.row}>
          <Text variant="subheading">{club.name}</Text>
          {member ? (
            <Badge tone="positive">You are in</Badge>
          ) : prices.length === 0 ? (
            <Badge tone="neutral">By invitation</Badge>
          ) : null}
        </View>

        {club.description === undefined ? null : (
          <Text tone="secondary" variant="small">
            {club.description}
          </Text>
        )}

        {club.benefits.map((line) => (
          <Text key={line} tone="secondary" variant="small">
            • {line}
          </Text>
        ))}

        {prices.length === 0 ? null : (
          <View style={styles.prices}>
            {prices.map((price) => (
              <Chip key={price.id}>
                {`${formatPrice(price.amount)}${
                  price.interval === undefined
                    ? ''
                    : ` ${cadenceLabels[price.interval] ?? ''}`
                }`}
              </Chip>
            ))}
          </View>
        )}

        {member ? (
          <>
            <Text tone="tertiary" variant="caption">
              {membershipSourceLabels[club.membership?.source ?? ''] ??
                'Access granted'}
            </Text>
            <Button
              onPress={onOpen}
              testID={`club-open-${club.slug}`}
              tone="primary"
            >
              Open the club
            </Button>
          </>
        ) : prices.length === 0 ? (
          <Text tone="tertiary" variant="caption">
            Membership is by invitation from this creator. There is nothing to
            buy here.
          </Text>
        ) : (
          <>
            <Button onPress={onOpen} testID={`club-look-${club.slug}`}>
              Look inside
            </Button>
            <Notice
              testID={`club-buy-elsewhere-${club.slug}`}
              title="Joining happens on the web"
            >
              Memberships are not sold in this application. Open VELORA in a
              browser to join.
            </Notice>
          </>
        )}
      </Stack>
    </Card>
  );
}

/**
 * One club as its own destination.
 *
 * The same screen Consumer Web has, and safe in the same way: whether the feed
 * is readable is decided by the server on this request, so a locked club has no
 * body, summary, or image reference in its answer to hide.
 */
export function ClubScreen({
  handle,
  onBack,
  slug,
}: {
  readonly handle: string;
  readonly onBack: () => void;
  readonly slug: string;
}) {
  const api = useApi();
  const load = useCallback(
    async (signal: AbortSignal) => api.club({ handle, slug }, signal),
    [api, handle, slug],
  );
  const detail = useResource<ClubDetail>(load);
  const covers = (detail.value?.content ?? []).flatMap((item) => {
    const first = item.media[0]?.id;
    return first === undefined ? [] : [first];
  });
  const addresses = useMediaAddresses(covers, 'card');

  const club = detail.value?.club;
  const member = club?.membership !== undefined;

  return (
    <Screen
      onBack={onBack}
      onRefresh={detail.reload}
      refreshing={detail.loading}
      subtitle={`@${handle}`}
      testID="club-page"
      title={club?.name ?? 'Club'}
    >
      <Stack gap={5}>
        {detail.loading && detail.value === undefined ? (
          <RowSkeleton rows={3} />
        ) : null}

        {detail.value === undefined && !detail.loading ? (
          <ErrorState
            body="There is nothing to show at this address."
            onRetry={detail.retryable ? detail.reload : undefined}
            testID="club-page-missing"
            title="This club is not available"
          />
        ) : null}

        {club === undefined ? null : (
          <Card>
            <Stack gap={3}>
              {club.description === undefined ? null : (
                <Text tone="secondary" variant="small">
                  {club.description}
                </Text>
              )}
              {club.benefits.map((line) => (
                <Text key={line} tone="secondary" variant="small">
                  • {line}
                </Text>
              ))}
              {member ? (
                <Text
                  testID="club-membership"
                  tone="tertiary"
                  variant="caption"
                >
                  {membershipSourceLabels[club.membership?.source ?? ''] ??
                    'Access granted'}
                  {club.membership === undefined
                    ? ''
                    : ` · joined ${formatDate(club.membership.grantedAt)}`}
                </Text>
              ) : (
                <Notice testID="club-locked" title="You are not in this club">
                  What its members read is not published here. Membership comes
                  from the creator, or from joining on the web.
                </Notice>
              )}
            </Stack>
          </Card>
        )}

        {!member || detail.value === undefined ? null : detail.value.content
            .length === 0 ? (
          <EmptyState
            body="What appears here is written by the creator, for its members."
            icon="lock"
            testID="club-feed-empty"
            title="Nothing published yet"
          />
        ) : (
          <Card testID="club-feed">
            <Stack gap={4}>
              {detail.value.content.map((item, index) => {
                const cover = addresses.get(item.media[0]?.id ?? '');
                return (
                  <View key={item.id} testID={`club-item-${item.id}`}>
                    {index === 0 ? null : <Divider />}
                    <Stack gap={2}>
                      {cover === undefined ? null : (
                        <Image
                          accessibilityIgnoresInvertColors
                          source={{ uri: cover }}
                          style={styles.cover}
                        />
                      )}
                      <Text variant="subheading">{item.title}</Text>
                      {item.summary === undefined ? null : (
                        <Text tone="secondary" variant="small">
                          {item.summary}
                        </Text>
                      )}
                      {item.body === undefined ? null : (
                        <Text variant="body">{item.body}</Text>
                      )}
                      <Text tone="tertiary" variant="caption">
                        {formatDate(item.publishedAt)}
                      </Text>
                    </Stack>
                  </View>
                );
              })}
            </Stack>
          </Card>
        )}
      </Stack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cover: {
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    width: '100%',
  },
  prices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space[3],
    justifyContent: 'space-between',
  },
});
