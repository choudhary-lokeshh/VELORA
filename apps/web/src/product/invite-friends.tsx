'use client';

import { useCallback, useEffect, useState } from 'react';

import type { InviteLinkAnswer } from '@velora/consumer-client';

import { Button, Card, ErrorMessage } from '../design/primitives';
import { useApi } from '../app/providers';
import { useResource, useSingleFlight } from './resource';
import { ShareControl } from './share';

/**
 * Inviting somebody, from the one screen that belongs to the person doing it.
 *
 * It is here rather than after a conversation, after a match, or in a sheet
 * that appears over Live, and that placement is the design. A growth prompt
 * interrupting a conversation is the thing every review of every product like
 * this complains about, and a person who wants to bring a friend will look for
 * this where their own things are.
 *
 * There is no count of who joined, no list of who was invited, and no reward.
 * The first two would hand somebody a small social graph they were never given,
 * and the third is a decision nobody has made — when a reward exists it will
 * have a qualification rule attached, and inventing one here would be inventing
 * the rule too.
 *
 * The link is minted on the first press rather than for every account, so an
 * account that has never shared anything has no invitation row and nothing to
 * leak. It is then the same link forever: minting a second would silently break
 * every link the person had already sent.
 */
export function InviteFriends({
  origin,
}: {
  /**
   * The address the link is written against, as the server understands it.
   *
   * Empty where this environment has declared no public origin, which is a
   * developer's machine and a preview deployment. The browser's own origin then
   * fills in — read after mount rather than during render, because the server
   * and the browser would otherwise disagree about the page they just built.
   */
  readonly origin: string;
}) {
  const api = useApi();
  const [reachedAt, setReachedAt] = useState('');
  useEffect(() => {
    if (origin === '') setReachedAt(globalThis.location.origin);
  }, [origin]);
  const base = origin === '' ? reachedAt : origin;
  const load = useCallback(
    async (signal: AbortSignal) => api.inviteLink(signal),
    [api],
  );
  const invite = useResource<InviteLinkAnswer>(load);
  const { busy, run } = useSingleFlight();
  const [minted, setMinted] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  const code = minted ?? invite.value?.invite?.code;
  const address =
    code === undefined || base === '' ? undefined : `${base}/invite/${code}`;

  return (
    <Card testId="invite-friends">
      <div className="v-stack v-stack--4">
        <div className="v-stack v-stack--2">
          <h2 className="v-subheading">Invite someone</h2>
          <p className="v-small v-muted">
            One link, yours, and it does not change. Anybody who opens it sees
            what VELORA is before they decide — and nobody who opens it learns
            anything about you.
          </p>
        </div>

        {failed ? (
          <ErrorMessage testId="invite-friends-failed">
            Your link could not be prepared. Trying again is worth a go.
          </ErrorMessage>
        ) : null}

        {address === undefined ? (
          <div>
            <Button
              busy={busy}
              data-testid="invite-friends-create"
              icon="link"
              onClick={() => {
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
              tone="primary"
            >
              Get my link
            </Button>
          </div>
        ) : (
          <div className="v-stack v-stack--3">
            <p
              className="v-small v-share__address"
              data-testid="invite-friends-address"
            >
              {address}
            </p>
            <ShareControl
              label="Share my link"
              origin={base}
              path={`/invite/${code ?? ''}`}
              testId="invite-friends-share"
              text="Come and meet people on VELORA."
              title="VELORA"
            />
          </div>
        )}
      </div>
    </Card>
  );
}
