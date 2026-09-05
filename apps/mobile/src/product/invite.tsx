import { useCallback, useState } from 'react';
import { Share } from 'react-native';

import type { InviteLinkAnswer } from '@velora/consumer-client';

import { resolvePublicWebOrigin } from '../api';
import { useApi } from '../frame/providers';
import { Button, Card, ErrorMessage, Stack, Text } from '../design/primitives';
import { useResource, useSingleFlight } from './resource';

/**
 * Inviting somebody, from the screen that belongs to the person doing it.
 *
 * Deliberately here and not after a conversation, after a match, or in a sheet
 * over Live. A growth prompt interrupting a live conversation is the single
 * most complained-about behaviour in this category of product, and somebody who
 * wants to bring a friend will look for this where their own things are.
 *
 * The link is a web address rather than a `velora://` one, because the person
 * being invited does not have the application — which is the entire reason they
 * are being invited. A build with no declared web origin therefore offers no
 * control at all rather than handing somebody an address that opens nothing.
 *
 * There is no count of who joined, no list of who was invited, and no reward.
 * The first two would hand somebody a small social graph they were never given,
 * and the third is a decision nobody has made.
 */
export function InviteCard() {
  const api = useApi();
  const origin = resolvePublicWebOrigin();
  const load = useCallback(
    async (signal: AbortSignal) => api.inviteLink(signal),
    [api],
  );
  const invite = useResource<InviteLinkAnswer>(load, {
    enabled: origin !== undefined,
  });
  const { busy, run } = useSingleFlight();
  const [minted, setMinted] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  const code = minted ?? invite.value?.invite?.code;
  const address =
    origin === undefined || code === undefined
      ? undefined
      : `${origin}/invite/${code}`;

  const share = useCallback(() => {
    if (address === undefined) return;
    // The platform's own sheet, which reaches every application on the phone
    // and is the one somebody already knows how to use. A cancelled share is
    // not a failure and is not reported as one.
    void Share.share({
      message: `Come and meet people on VELORA. ${address}`,
    }).catch(() => undefined);
  }, [address]);

  if (origin === undefined) return null;

  return (
    <Card testID="invite-card">
      <Stack gap={3}>
        <Text variant="subheading" weight="semibold">
          Invite someone
        </Text>
        <Text tone="secondary" variant="small">
          One link, yours, and it does not change. Anybody who opens it sees
          what VELORA is before they decide — and nobody who opens it learns
          anything about you.
        </Text>

        {failed ? (
          <ErrorMessage testID="invite-card-failed">
            Your link could not be prepared. Trying again is worth a go.
          </ErrorMessage>
        ) : null}

        {address === undefined ? (
          <Button
            busy={busy}
            icon="link"
            onPress={() => {
              setFailed(false);
              run(async () => {
                const result = await api.createInviteLink();
                if (result.kind === 'ok') {
                  setMinted(result.value.invite?.code);
                  return;
                }
                setFailed(true);
              });
            }}
            testID="invite-card-create"
            tone="primary"
            wide
          >
            Get my link
          </Button>
        ) : (
          <Stack gap={3}>
            <Text
              testID="invite-card-address"
              tone="tertiary"
              variant="caption"
            >
              {address}
            </Text>
            <Button
              icon="link"
              onPress={share}
              testID="invite-card-share"
              tone="secondary"
              wide
            >
              Share my link
            </Button>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
