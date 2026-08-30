import type { ApiResult, DiscoveryPerson } from '@velora/consumer-client';
import { failureMessage } from '@velora/consumer-client';
import { useCallback, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { useApi, useToast } from '../frame/providers';
import { Screen } from '../frame/shell';
import {
  Actions,
  Avatar,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorMessage,
  Inline,
  RowSkeleton,
  Stack,
  Text,
} from '../design/primitives';
import { radius, space } from '../design/tokens';
import { useMediaAddresses } from './imagery';
import { languageNames, regionName } from './locale';
import { useResource, useSingleFlight } from './resource';
import { PersonSafetyMenu } from './safety-actions';

/**
 * One person, at their own address.
 *
 * Discover is a decision surface: one photograph, both actions under a thumb,
 * and the next card behind it. This is where somebody goes to look properly
 * before deciding, and Consumer Mobile had nowhere to do that — the phone
 * showed the first of somebody's photographs and there was no way to reach the
 * rest, while the same person on the web had a page carrying all of them.
 *
 * An address rather than a sheet, for the reasons Consumer Web already gives:
 * the system Back leaves the person instead of doing nothing, a `velora://`
 * link somebody was sent works, and a notification about somebody lands
 * somewhere real.
 *
 * It adds nothing else, deliberately. A page about somebody else is not a
 * licence to publish more about them, so there is no last-seen, no view count,
 * no mutual-connection count, and no "online now" — the server publishes none
 * of them and this surface invents nothing. Nobody the caller may see and
 * nobody who exists are the same answer here, because they are the same answer
 * from the server; the screen says there is nothing to show rather than
 * guessing which it was.
 */
export function PersonScreen({
  onBack,
  onLeave,
  personId,
}: {
  readonly onBack: () => void;
  /** Where a decision lands, once this person is no longer somebody to decide about. */
  readonly onLeave: () => void;
  readonly personId: string;
}) {
  const api = useApi();
  const toast = useToast();
  const decision = useSingleFlight();
  const load = useCallback(
    async (signal: AbortSignal) => api.person(personId, signal),
    [api, personId],
  );
  const person = useResource<DiscoveryPerson>(load);
  const [gone, setGone] = useState(false);

  const images = person.value?.media ?? [];
  const addresses = useMediaAddresses(
    images.map((one) => one.id),
    'display',
  );

  const decide = (work: () => Promise<ApiResult<unknown>>, success: string) => {
    decision.run(async () => {
      const result = await work();
      if (result.kind === 'ok') {
        toast.show(success, 'positive');
        // The decision is made, and this screen is about somebody they have
        // now decided about.
        onLeave();
        return;
      }
      toast.show(failureMessage(result) ?? 'That did not work.', 'critical');
      person.reload();
    });
  };

  const shown = person.value;
  const region = regionName(shown?.region);
  const cover = addresses.get(images[0]?.id ?? '');
  const rest = images.slice(1).flatMap((image) => {
    const address = addresses.get(image.id);
    return address === undefined ? [] : [{ address, id: image.id }];
  });

  return (
    <Screen
      onBack={onBack}
      onRefresh={person.reload}
      refreshing={person.loading && shown !== undefined}
      testID="person-screen"
      title={shown?.displayName ?? 'Person'}
    >
      {person.loading && shown === undefined ? (
        <Card>
          <RowSkeleton rows={3} />
        </Card>
      ) : gone || shown === undefined ? (
        <EmptyState
          action={
            <Button onPress={onLeave} testID="person-missing-back">
              Back to Discover
            </Button>
          }
          body="There is nothing to show here. It may never have been anybody, or it may not be yours to see."
          icon="compass"
          testID="person-missing"
          title="Nothing to show"
        />
      ) : (
        <Stack gap={5}>
          {person.error === undefined ? null : (
            <ErrorMessage testID="person-failed">{person.error}</ErrorMessage>
          )}

          <View style={styles.identity}>
            <Avatar
              displayName={shown.displayName}
              seed={shown.id}
              size="large"
              source={cover}
              testID="person-portrait"
            />
            {/*
              No name here. A phone's header is persistent rather than
              scrolled away, so it already carries this person's name for the
              whole of the screen — printing it again a centimetre below is
              the same word twice on a small display, and two things a screen
              reader announces as the heading.
            */}
            <View style={styles.identityText}>
              <Inline gap={2} wrap>
                {region === undefined ? null : <Chip>{region}</Chip>}
                {shown.sharedLanguages.length === 0 ? null : (
                  <Chip>
                    {`Both speak ${languageNames(shown.sharedLanguages)}`}
                  </Chip>
                )}
              </Inline>
            </View>
            <PersonSafetyMenu
              onBlocked={() => {
                setGone(true);
              }}
              person={{ displayName: shown.displayName, id: shown.id }}
            />
          </View>

          {shown.bio === undefined ? (
            <Text tone="tertiary" variant="small">
              No bio yet.
            </Text>
          ) : (
            <Text testID="person-bio" tone="secondary" variant="body">
              {shown.bio}
            </Text>
          )}

          {/*
            Every other photograph this person has ready, which is the whole
            reason to open this screen rather than read the card. An address
            that was not issued renders nothing at all: whose image is withheld
            and why is never disclosed, so a gap is silent.
          */}
          {rest.length === 0 ? null : (
            <View style={styles.gallery} testID="person-gallery">
              {rest.map((image) => (
                <Image
                  accessibilityIgnoresInvertColors
                  key={image.id}
                  source={{ uri: image.address }}
                  style={styles.galleryImage}
                />
              ))}
            </View>
          )}

          <Actions>
            <Button
              disabled={decision.busy}
              onPress={() => {
                decide(
                  async () => api.pass(shown.id),
                  'Passed. They are not told, and you will not see them for a while.',
                );
              }}
              testID="person-pass"
              tone="secondary"
              wide
            >
              Pass
            </Button>
            <Button
              disabled={decision.busy}
              icon="heart"
              onPress={() => {
                decide(
                  async () => api.signalIntroduction(shown.id),
                  'Interest sent. They only hear about it if they say yes too.',
                );
              }}
              testID="person-signal"
              tone="primary"
              wide
            >
              Interested
            </Button>
          </Actions>
        </Stack>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gallery: { gap: space[3] },
  galleryImage: {
    aspectRatio: 3 / 4,
    borderRadius: radius.md,
    width: '100%',
  },
  identity: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: space[4],
  },
  identityText: { flex: 1, gap: space[2] },
});
