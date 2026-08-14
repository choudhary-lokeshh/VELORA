'use client';

import { useCallback, useState } from 'react';

import type { ConsumerApi } from '@velora/consumer-client';
import {
  availabilityLabels,
  availabilityView,
  failureMessage,
} from '@velora/consumer-client';
import { useResource, useRevalidateOnFocus, useSingleFlight } from './resource';
import { ErrorMessage, Section, StatusMessage } from './ui';

/** Windows somebody can choose, in hours. Bounded by the contract's maximum. */
const windowChoices = [1, 4, 12, 24] as const;

/**
 * Availability, as a bounded choice rather than presence.
 *
 * `docs/flows/consumer-account-profile.md` is explicit that this is not online
 * presence, not consent to be contacted, and never an override of a block. So
 * this screen never says "online", never shows anybody else's availability, and
 * always makes the end of the window visible: an availability without an end
 * would be a claim about where somebody is right now, made by a browser that
 * has no idea.
 *
 * The window is revalidated whenever the tab comes back into view. A tab left
 * open overnight would otherwise still be showing "available" long after the
 * server stopped acting on it, which is the one thing a presence-shaped control
 * must never do.
 */
export function AvailabilityPanel({ api }: { readonly api: ConsumerApi }) {
  const load = useCallback(
    async (signal: AbortSignal) => api.availability(signal),
    [api],
  );
  const availability = useResource(load);
  const [hours, setHours] = useState<number>(4);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const { busy, run } = useSingleFlight();

  useRevalidateOnFocus(availability.reload);

  const view = availabilityView(availability.value);

  const save = (state: 'available' | 'unavailable') => {
    setMessage(undefined);
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
      setMessage(failureMessage(await api.saveAvailability(body)));
      availability.reload();
    });
  };

  return (
    <Section headingId="availability-heading" title="Availability">
      {availability.loading && availability.value === undefined ? (
        <StatusMessage testId="availability-loading">Loading…</StatusMessage>
      ) : null}
      {availability.error === undefined ? null : (
        <ErrorMessage testId="availability-failed">
          {availability.error}
        </ErrorMessage>
      )}
      <StatusMessage testId="availability-state">
        {availabilityLabels[view]}
      </StatusMessage>
      {view === 'available' &&
      availability.value?.availableUntil !== undefined ? (
        <p data-testid="availability-until">
          Until {new Date(availability.value.availableUntil).toLocaleString()}
        </p>
      ) : null}
      {view === 'expired' ? (
        <p data-testid="availability-expired">
          Your window ended, so you are not being shown in discovery. Choose a
          new one to be available again.
        </p>
      ) : null}
      {message === undefined ? null : (
        <ErrorMessage testId="availability-error">{message}</ErrorMessage>
      )}

      <label htmlFor="availability-hours">Be available for</label>
      <select
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
      </select>

      <div className="row">
        <button
          data-testid="availability-start"
          disabled={busy}
          onClick={() => {
            save('available');
          }}
          type="button"
        >
          {view === 'available' ? 'Extend availability' : 'Become available'}
        </button>
        <button
          data-testid="availability-stop"
          disabled={busy || view === 'unavailable'}
          onClick={() => {
            save('unavailable');
          }}
          type="button"
        >
          Stop being available
        </button>
      </div>
    </Section>
  );
}
