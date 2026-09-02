import type { ConsumerGiftList } from '@velora/consumer-client';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useApi } from '../frame/providers';
import { Screen } from '../frame/shell';
import {
  Button,
  Badge,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  Notice,
  RowSkeleton,
  Stack,
  Text,
  type Tone,
} from '../design/primitives';
import { color, radius, space } from '../design/tokens';
import { formatPrice } from './commerce';
import { GiftArt } from './gift-art';
import { formatDate } from './locale';
import { useResource } from './resource';

/**
 * Gifts this person has sent, on a phone.
 *
 * Consumer Mobile had no gifting surface at all, which meant somebody who sent
 * a gift on the web had no record of it on the device they carry — the money
 * left their account and the product on their phone had never heard of it.
 * This is that record, and it is a record only.
 *
 * **There is no send.** The API refuses `POST /v1/billing/gifts` for any
 * audience but `consumer_web`, so a send control here would produce a 403 and
 * nothing else. That refusal is not a gap to route around: whether an
 * application may take a payment for a digital gift, or point somebody
 * somewhere that does, is unresolved Google Play policy, and an application
 * that guessed is an application that gets pulled. So this screen says plainly
 * where sending happens and offers neither a control nor a link — the same
 * boundary a club that is for sale already draws on the creator's page.
 *
 * Nothing is counted or celebrated. There is no total sent, no streak, and no
 * rank: a gift is a gesture somebody made, and the platform's job is to say
 * accurately what happened to it rather than to score it.
 */

interface StateLook {
  readonly label: string;
  /** What it means for the person who sent it. Empty when the label says it. */
  readonly meaning: string;
  readonly tone: Tone;
}

/**
 * What each state is, and what it means for the person who sent it.
 *
 * Word for word what Consumer Web says, because a gift that failed cannot read
 * one way on a laptop and another on a phone. The consequence is spelled out
 * rather than implied: somebody whose gift was returned needs to know the
 * creator did not receive it, and somebody whose payment failed needs to know
 * nothing was charged — neither is guessable from a word in a pill.
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
  sent: { label: 'Sent', meaning: '', tone: 'positive' },
};

const unknownState: StateLook = {
  label: 'Unknown',
  meaning: 'VELORA cannot say where this one stands.',
  tone: 'neutral',
};

export function SentGiftsScreen({
  onBack,
  onOpenCreator,
  onOpenCreators,
}: {
  readonly onBack: () => void;
  /** The creator a gift went to, at their own page. The route owns the router. */
  readonly onOpenCreator: (handle: string) => void;
  /** Where creators are found, for the list that has nobody in it yet. */
  readonly onOpenCreators: () => void;
}) {
  const api = useApi();
  const load = useCallback(async () => api.sentGifts(), [api]);
  const history = useResource<ConsumerGiftList>(load);
  const rows = history.value?.gifts ?? [];

  return (
    <Screen
      onBack={onBack}
      onRefresh={history.reload}
      refreshing={history.loading && history.value !== undefined}
      subtitle="Gifts you have sent to creators, and what happened to each one."
      testID="sent-gifts"
      title="Gifts"
    >
      <Stack gap={5}>
        {history.error !== undefined ? (
          <ErrorState
            body={history.error}
            testID="sent-gifts-error"
            title="This could not be loaded"
            {...(history.retryable ? { onRetry: history.reload } : {})}
          />
        ) : history.loading && history.value === undefined ? (
          <Card>
            <RowSkeleton rows={3} />
          </Card>
        ) : rows.length === 0 ? (
          <EmptyState
            action={
              <Button
                onPress={onOpenCreators}
                testID="sent-gifts-browse"
                tone="secondary"
              >
                Browse creators
              </Button>
            }
            body="A gift is support and nothing else — it unlocks no content and gives no access. A creator's page is where you choose one."
            icon="sparkle"
            testID="sent-gifts-empty"
            title="No gifts sent"
          />
        ) : (
          <Card padded={false} testID="sent-gifts-list">
            <View style={styles.rows}>
              {rows.map((row, index) => {
                const look = stateLooks[row.state] ?? unknownState;
                return (
                  <View key={row.id} testID={`sent-gift-${row.id}`}>
                    {index === 0 ? null : <Divider />}
                    <View style={styles.row}>
                      <View style={styles.mark}>
                        <GiftArt
                          color={color.ember}
                          size={22}
                          visual={row.gift.visual}
                        />
                      </View>
                      <View style={styles.body}>
                        <Text weight="medium">{row.gift.name}</Text>
                        <Pressable
                          accessibilityRole="link"
                          onPress={() => {
                            onOpenCreator(row.creator.handle);
                          }}
                          testID={`sent-gift-creator-${row.id}`}
                        >
                          <Text tone="tertiary" variant="caption">
                            {`${row.creator.displayName} · ${formatPrice(row.price)} · ${formatDate(row.sentAt ?? row.createdAt)}`}
                          </Text>
                        </Pressable>
                        {look.meaning === '' ? null : (
                          <Text
                            testID={`sent-gift-meaning-${row.id}`}
                            tone="tertiary"
                            variant="caption"
                          >
                            {look.meaning}
                          </Text>
                        )}
                      </View>
                      <Badge
                        testID={`sent-gift-state-${row.id}`}
                        tone={look.tone}
                      >
                        {look.label}
                      </Badge>
                    </View>
                  </View>
                );
              })}
            </View>
          </Card>
        )}

        {/*
          Said once, whether or not anything has been sent, because somebody
          looking for the control is exactly the person who needs the answer.
          A statement rather than a link: pointing a mobile application at an
          outside payment page is the unresolved question, and this screen does
          not answer it by acting.
        */}
        <Notice testID="gift-send-elsewhere" title="Gifts are sent on the web">
          Sending is not available in this application. A creator's page in a
          browser is where a gift is chosen and paid for; this screen shows what
          has already been sent.
        </Notice>
      </Stack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: space[1] },
  mark: {
    alignItems: 'center',
    backgroundColor: color.emberWash,
    borderRadius: radius.pill,
    height: space[10],
    justifyContent: 'center',
    width: space[10],
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[4],
  },
  rows: { paddingVertical: space[1] },
});
