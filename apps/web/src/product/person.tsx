'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { ApiResult, DiscoveryPerson } from '@velora/consumer-client';
import { failureMessage } from '@velora/consumer-client';

import { usePageHeading } from '../app/page-heading';
import { useApi, useToast } from '../app/providers';
import {
  Button,
  Chip,
  EmptyState,
  ErrorMessage,
  Skeleton,
  initialsOf,
  toneOf,
} from '../design/primitives';
import { useMediaAddresses } from './imagery';
import { languageNames, regionName } from './locale';
import { PersonSafetyMenu } from './safety-actions';
import { useResource, useSingleFlight } from './resource';

/**
 * One person, as a page.
 *
 * A card shows one photograph and a clamped bio because a card is a decision
 * surface. This is where somebody goes to look properly, and the only thing it
 * adds is the rest of what the projection already carried: every ready image
 * instead of the first, and the bio unclamped.
 *
 * It adds nothing else, deliberately. A page about somebody else is not a
 * licence to publish more about them, so there is no last-seen, no view count,
 * no mutual-connection count, and no "online now" — the server publishes none of
 * them and this surface invents nothing.
 *
 * Nobody the caller may see and nobody who exists are the same answer here,
 * because they are the same answer from the server. The screen says there is
 * nothing to show rather than guessing which it was.
 */
export function PersonPage({ personId }: { readonly personId: string }) {
  const api = useApi();
  // This page's heading is a name laid over a photograph rather than a
  // `PageHeader`, so it offers itself to the shell directly. Without that the
  // bar would announce the page for the whole of it, over a hero already
  // carrying the same person's name in display type.
  const heading = usePageHeading();
  const toast = useToast();
  const router = useRouter();
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
        // Back to where they came from, because the decision is made and this
        // page is about somebody they have now decided about.
        router.replace('/discover');
        return;
      }
      toast.show(failureMessage(result) ?? 'That did not work.', 'critical');
      person.reload();
    });
  };

  if (person.loading && person.value === undefined) {
    return (
      <div className="v-stack v-stack--5" data-testid="person-loading">
        <p className="v-visually-hidden" role="status">
          Loading
        </p>
        <Skeleton height={360} width="100%" />
        <Skeleton height={20} width="40%" />
        <Skeleton height={14} width="80%" />
      </div>
    );
  }

  if (gone || person.value === undefined) {
    return (
      <EmptyState
        actions={
          <Button
            onClick={() => {
              router.replace('/discover');
            }}
            tone="secondary"
          >
            Back to Discover
          </Button>
        }
        body="There is nothing to show here. It may never have been anybody, or it may not be yours to see."
        icon="compass"
        testId="person-missing"
        title="Nothing to show"
      />
    );
  }

  const shown = person.value;
  const region = regionName(shown.region);
  const cover = addresses.get(images[0]?.id ?? '');

  return (
    <article className="v-stack v-stack--6" data-testid={`person-${shown.id}`}>
      {person.error === undefined ? null : (
        <ErrorMessage testId="person-failed">{person.error}</ErrorMessage>
      )}

      <div
        className={`v-person-hero v-avatar--tone-${String(toneOf(shown.id))}`}
      >
        {cover === undefined ? (
          <span aria-hidden="true" className="v-person__portrait-mark">
            {initialsOf(shown.displayName)}
          </span>
        ) : (
          /* A plain element rather than the framework's optimised one: the
             address is issued per request and viewer-scoped. */
          <img
            alt=""
            className="v-person__portrait-image"
            data-testid="person-portrait"
            src={cover}
          />
        )}
        <div className="v-person__identity">
          <h1 className="v-title v-wrap" ref={heading}>
            {shown.displayName}
          </h1>
          <div className="v-inline v-inline--tight">
            {region === undefined ? null : <Chip>{region}</Chip>}
            {shown.sharedLanguages.length === 0 ? null : (
              <Chip>Both speak {languageNames(shown.sharedLanguages)}</Chip>
            )}
          </div>
        </div>
      </div>

      {shown.bio === undefined ? (
        <p className="v-small v-quiet">No bio yet.</p>
      ) : (
        <p className="v-body v-measure v-wrap" data-testid="person-bio">
          {shown.bio}
        </p>
      )}

      {images.length < 2 ? null : (
        <ul className="v-person-gallery" data-testid="person-gallery">
          {images.slice(1).map((image) => {
            const address = addresses.get(image.id);
            return address === undefined ? null : (
              <li key={image.id}>
                {/* Same reasoning as the hero above. */}
                <img alt="" className="v-person-gallery__image" src={address} />
              </li>
            );
          })}
        </ul>
      )}

      <div className="v-person__actions">
        <Button
          data-testid="person-pass"
          disabled={decision.busy}
          onClick={() => {
            decide(
              async () => api.pass(shown.id),
              'Passed. They are not told, and you will not see them for a while.',
            );
          }}
          tone="secondary"
        >
          Pass
        </Button>
        <Button
          data-testid="person-signal"
          disabled={decision.busy}
          icon="heart"
          onClick={() => {
            decide(
              async () => api.signalIntroduction(shown.id),
              'Interest sent. They only hear about it if they say yes too.',
            );
          }}
          tone="primary"
        >
          Interested
        </Button>
        <PersonSafetyMenu
          onBlocked={() => {
            setGone(true);
          }}
          person={{ displayName: shown.displayName, id: shown.id }}
        />
      </div>
    </article>
  );
}
