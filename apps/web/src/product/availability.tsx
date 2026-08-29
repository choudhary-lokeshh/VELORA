'use client';

import { useCallback, useState } from 'react';

import type { AvailabilityView } from '@velora/consumer-client';
import { availabilityView, failureMessage } from '@velora/consumer-client';

import { useApi, useToast } from '../app/providers';
import { Icon } from '../design/icons';
import {
  Badge,
  Button,
  ErrorMessage,
  Section,
  Select,
  Skeleton,
  type Tone,
} from '../design/primitives';
import { formatDateTime } from './locale';
import { useResource, useRevalidateOnFocus, useSingleFlight } from './resource';

/**
 * Availability, as a bounded choice rather than presence.
 *
 * `docs/flows/consumer-account-profile.md` is explicit that this is not online
 * presence, not consent to be contacted, and never an override of a block. So
 * this card never says "online", never shows anybody else's availability, and
 * always makes the end of the window visible: an availability without an end
 * would be a claim about where somebody is right now, made by a browser that has
 * no idea.
 *
 * The window is revalidated whenever the tab comes back into view. A tab left
 * open overnight would otherwise still show "available" long after the server
 * stopped acting on it, which is the one thing a presence-shaped control must
 * never do.
 */

/** Windows somebody can choose, in hours. Bounded by the contract's maximum. */
const windowChoices = [1, 4, 12, 24] as const;

const viewTone: Readonly<Record<AvailabilityView, Tone>> = {
  available: 'positive',
  expired: 'caution',
  unavailable: 'neutral',
};

const viewLabel: Readonly<Record<AvailabilityView, string>> = {
  available: 'Available now',
  expired: 'Window ended',
  unavailable: 'Not available',
};

export function AvailabilityCard() {
  const api = useApi();
  const toast = useToast();
  const load = useCallback(
    async (signal: AbortSignal) => api.availability(signal),
    [api],
  );
  const availability = useResource(load);
  const [hours, setHours] = useState<number>(4);
  const [error, setError] = useState<string | undefined>(undefined);
  const { busy, run } = useSingleFlight();

  useRevalidateOnFocus(availability.reload);

  const view = availabilityView(availability.value);
  const until = availability.value?.availableUntil;

  const save = (state: 'available' | 'unavailable') => {
    setError(undefined);
    const body =
      state === 'available'
        ? {
            availableUntil: new Date(
              Date.now() + hours * 60 * 60 * 1000,
            ).toISOString(),
            state,
          }
        : { state };
    run(async () => {
      const failure = failureMessage(await api.saveAvailability(body));
      setError(failure);
      if (failure === undefined) {
        toast.show(
          state === 'available'
            ? 'You are visible in discovery until the window ends.'
            : 'You are no longer visible in discovery.',
          'positive',
        );
      }
      availability.reload();
    });
  };

  return (
    <Section
      actions={
        availability.loading && availability.value === undefined ? (
          <Skeleton height={22} width={110} />
        ) : (
          <Badge testId="availability-state" tone={viewTone[view]}>
            <Icon name="clock" size="sm" />
            {viewLabel[view]}
          </Badge>
        )
      }
      raised
      testId="availability-card"
      title="Availability"
    >
      <p className="v-small v-muted">
        {view === 'available' && until !== undefined ? (
          <>
            You are being shown to other people until{' '}
            <time dateTime={until} data-testid="availability-until">
              {formatDateTime(until)}
            </time>
            . It ends on its own — there is nothing to remember to switch off.
          </>
        ) : view === 'expired' ? (
          <span data-testid="availability-expired">
            Your window ended, so you are not being shown in discovery. Choose a
            new one to be available again.
          </span>
        ) : (
          'Nobody sees you in discovery while this is off, and you see nobody either. Availability is a window you choose, not a status anybody can watch.'
        )}
      </p>

      {availability.error === undefined ? null : (
        <ErrorMessage testId="availability-failed">
          {availability.error}
        </ErrorMessage>
      )}
      {error === undefined ? null : (
        <ErrorMessage testId="availability-error">{error}</ErrorMessage>
      )}

      <div className="v-inline">
        <label className="v-field__label" htmlFor="availability-hours">
          For
        </label>
        <div style={{ width: '140px' }}>
          <Select
            data-testid="availability-hours"
            id="availability-hours"
            name="hours"
            onChange={(event) => {
              setHours(Number(event.target.value));
            }}
            value={String(hours)}
          >
            {windowChoices.map((choice) => (
              <option key={choice} value={String(choice)}>
                {choice} hour{choice === 1 ? '' : 's'}
              </option>
            ))}
          </Select>
        </div>
        <Button
          busy={busy}
          data-testid="availability-start"
          onClick={() => {
            save('available');
          }}
          tone="primary"
        >
          {view === 'available' ? 'Extend' : 'Become available'}
        </Button>
        {view === 'available' ? (
          <Button
            data-testid="availability-stop"
            disabled={busy}
            onClick={() => {
              save('unavailable');
            }}
          >
            Stop
          </Button>
        ) : null}
      </div>
    </Section>
  );
}
