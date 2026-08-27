'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  CommercialOffer,
  CommercialPrice,
  CreatorClub,
  CreatorClubList,
  MonetisationReadiness,
} from '@velora/creator-client';
import { failureMessage, formatMoney } from '@velora/creator-client';

import { ConfirmDialog } from '../design/dialog';
import {
  Badge,
  BlockedState,
  Button,
  Card,
  CardHead,
  Chip,
  EmptyState,
  ErrorMessage,
  ErrorState,
  Field,
  ListRow,
  Notice,
  PageHeader,
  RowSkeleton,
  Select,
  TextInput,
} from '../design/primitives';
import { useApi, useCreator, useToast } from '../app/providers';
import {
  formatDate,
  offerModeLabels,
  offerStateLook,
  priceIntervalLabels,
} from './format';
import { MoneyNav } from './money-nav';
import { useCollection, useResource, useSingleFlight } from './resource';

/**
 * What a creator sells, and the controls for actually selling it.
 *
 * The screen is built around what the architecture supports rather than around
 * what a membership product usually looks like. VELORA sells **access to one
 * club**: one commercial offer per club, carrying one live price per currency.
 * There is deliberately no Bronze/Silver/Gold here, because there is no tier in
 * the domain — a hierarchy invented on this screen would be three names over
 * one entitlement, and the first person to ask what the difference was would be
 * told something untrue. A creator who wants two levels makes two clubs, which
 * is a real distinction the access rules already enforce.
 *
 * Pricing is immutable by construction. A price row is frozen when written, so
 * changing what something costs retires the old row and publishes a new one;
 * everybody already paying keeps exactly the terms they agreed to. That is why
 * the control below says "Publish a new price" rather than "Edit price", and
 * why nothing on this screen can rewrite a figure somebody was charged.
 *
 * Every control here disappears when the platform has approved no commercial
 * terms, and it disappears because the server said `enabled: false` rather than
 * because a build flag did. A form that always refuses is worse than an
 * explanation of why there is none.
 */

const offersPageSize = 25;

/** Minor units a creator types, before the contract sees them. */
const amountPattern = /^[0-9]+(?:\.[0-9]{0,3})?$/u;

/**
 * A typed decimal amount as the integer count of minor units the contract
 * requires.
 *
 * Digit manipulation rather than multiplication, for the reason the contract
 * gives for doing the reverse the same way: `19.99 * 100` is `1998.9999...` in
 * binary floating point, and a price is not a thing to be nearly right about.
 * Anything malformed returns nothing rather than a best guess.
 */
export function minorUnitsOf(
  typed: string,
  exponent: number,
): string | undefined {
  const trimmed = typed.trim();
  if (!amountPattern.test(trimmed)) return undefined;
  const [whole = '0', fraction = ''] = trimmed.split('.');
  if (fraction.length > exponent) return undefined;
  const digits = `${whole}${fraction.padEnd(exponent, '0')}`.replace(
    /^0+(?=\d)/u,
    '',
  );
  return digits === '0' ? undefined : digits;
}

/** How many decimal places one unit of a currency divides into. */
const minorUnitExponents: Readonly<Record<string, number>> = {
  BHD: 3,
  CLP: 0,
  ISK: 0,
  JOD: 3,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  OMR: 3,
  TND: 3,
  VND: 0,
};

export function exponentFor(currency: string): number {
  return minorUnitExponents[currency] ?? 2;
}

export function Selling() {
  const api = useApi();

  const load = useCallback(
    async (cursor: string | undefined) => {
      const result = await api.offers({ cursor, pageSize: offersPageSize });
      return result.kind === 'ok'
        ? {
            kind: 'ok' as const,
            value: {
              items: result.value.offers,
              meta: result.value.readiness,
              nextCursor: result.value.nextCursor,
            },
          }
        : result;
    },
    [api],
  );
  const offers = useCollection<CommercialOffer, MonetisationReadiness>(load);

  const loadClubs = useCallback(async () => api.clubs({ pageSize: 50 }), [api]);
  const clubs = useResource<CreatorClubList>(loadClubs);
  const clubsById = useMemo(() => {
    const found = new Map<string, CreatorClub>();
    for (const club of clubs.value?.clubs ?? []) found.set(club.id, club);
    return found;
  }, [clubs.value]);

  const readiness = offers.meta;
  const enabled = readiness?.enabled ?? false;
  const reload = () => {
    offers.reload();
    clubs.reload();
  };

  return (
    <>
      <PageHeader
        lede="What somebody can buy from you, and on what terms."
        title="Money"
      />
      <MoneyNav />

      {readiness === undefined || enabled ? null : (
        <BlockedState
          label="Not available yet"
          testId="offers-readiness"
          title="Nothing on VELORA can be sold yet"
        >
          <p>
            No payment provider is approved for VELORA and no pricing terms are
            published — no platform share, no currencies, no price limits, no
            billing cadence — so nothing you have can be made purchasable.
          </p>
          <p>
            There is no form here for a reason. A price field that always
            refuses is worse than an explanation, and this is not something you
            can complete from your side.
          </p>
        </BlockedState>
      )}

      {readiness !== undefined && enabled ? (
        <NewOffer
          clubs={clubs.value?.clubs ?? []}
          offers={offers.items}
          onCreated={reload}
          readiness={readiness}
        />
      ) : null}

      <Card flush testId="offers-list">
        <CardHead
          lede="A price here is the exact figure a purchase would use, never a suggestion."
          title="Your memberships"
        />
        {offers.error !== undefined && offers.items.length === 0 ? (
          <ErrorState
            body={offers.error}
            onRetry={offers.retryable ? offers.reload : undefined}
            testId="offers-failed"
          />
        ) : offers.loading && offers.items.length === 0 ? (
          <RowSkeleton rows={2} />
        ) : offers.items.length === 0 ? (
          <EmptyState
            body={
              enabled
                ? 'Pick one of your published clubs above and set what joining it costs.'
                : 'Nothing of yours has a commercial offer against it, and nothing can have one until VELORA can sell.'
            }
            icon="ledger"
            testId="offers-empty"
            title="You are not selling anything yet"
          />
        ) : (
          <ul className="s-list">
            {offers.items.map((offer) => (
              <li key={offer.id}>
                <OfferRow
                  club={clubsById.get(offer.resourceId)}
                  offer={offer}
                  onChanged={reload}
                  readiness={readiness}
                />
              </li>
            ))}
          </ul>
        )}
        {offers.hasMore ? (
          <div className="s-card__pad s-card__pad--block">
            <Button
              block
              busy={offers.loadingMore}
              data-testid="offers-more"
              onClick={offers.loadMore}
            >
              Load more
            </Button>
          </div>
        ) : null}
      </Card>
    </>
  );
}

/* ============================== Creating ============================= */

/**
 * Opening commercial terms against a club.
 *
 * Only a published club appears, because only a published club may be
 * activated for sale, and only one that has no live offer, because the domain
 * allows exactly one per club and mode. Offering a creator a choice that would
 * be refused is a form that fails on submit for a reason the screen already
 * knew.
 */
function NewOffer({
  clubs,
  offers,
  onCreated,
  readiness,
}: {
  readonly clubs: readonly CreatorClub[];
  readonly offers: readonly CommercialOffer[];
  readonly onCreated: () => void;
  readonly readiness: MonetisationReadiness;
}) {
  const api = useApi();
  const creator = useCreator();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [clubId, setClubId] = useState('');
  const [message, setMessage] = useState<string | undefined>(undefined);

  const taken = new Set(
    offers
      .filter((offer) => offer.state !== 'retired')
      .map((offer) => offer.resourceId),
  );
  const eligible = clubs.filter(
    (club) => club.lifecycle === 'published' && !taken.has(club.id),
  );

  useEffect(() => {
    if (clubId !== '' && !eligible.some((club) => club.id === clubId)) {
      setClubId('');
    }
  }, [clubId, eligible]);

  if (!creator.canWrite) return null;
  if (!readiness.modes.includes('subscription')) return null;

  return (
    <Card testId="offer-create">
      <CardHead
        lede="One membership per club. Somebody who joins gets everything in that club and nothing outside it."
        title="Sell access to a club"
      />
      {message === undefined ? null : (
        <ErrorMessage testId="offer-create-error">{message}</ErrorMessage>
      )}
      {clubs.length === 0 ? (
        <Notice icon="info" testId="offer-create-no-clubs" tone="quiet">
          You have no clubs yet. A membership is access to one, so make the club
          first and price it afterwards.
        </Notice>
      ) : eligible.length === 0 ? (
        <Notice icon="info" testId="offer-create-none-eligible" tone="quiet">
          Every published club of yours already has a membership. Publish
          another club to sell another one.
        </Notice>
      ) : (
        <form
          className="s-stack s-stack--5"
          onSubmit={(event) => {
            event.preventDefault();
            if (clubId === '') return;
            run(async () => {
              const result = await api.createOffer({
                // Access to a club recurs; that is what a membership is. A
                // one-off purchase of club access would be a different product
                // with a different access rule and nobody has decided one.
                mode: 'subscription',
                resourceId: clubId,
                resourceType: 'club',
              });
              const failure = failureMessage(result, {
                conflict:
                  'That club already has a membership, or it is no longer published.',
              });
              setMessage(failure);
              if (failure === undefined) {
                setClubId('');
                toast.show(
                  'Membership drafted. Publish a price to put it on sale.',
                  'positive',
                );
                onCreated();
              }
            });
          }}
        >
          <Field
            hint="Only published clubs can be sold. A draft has nobody to admit."
            label="Which club"
          >
            {(control) => (
              <Select
                {...control}
                data-testid="offer-create-club"
                name="clubId"
                onChange={(event) => {
                  setClubId(event.target.value);
                }}
                value={clubId}
              >
                <option value="">Choose a club</option>
                {eligible.map((club) => (
                  <option key={club.id} value={club.id}>
                    {club.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="s-form-actions">
            <Button
              busy={busy}
              data-testid="offer-create-submit"
              disabled={clubId === ''}
              tone="primary"
              type="submit"
            >
              Draft a membership
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

/* =============================== One offer =========================== */

function OfferRow({
  club,
  offer,
  onChanged,
  readiness,
}: {
  readonly club: CreatorClub | undefined;
  readonly offer: CommercialOffer;
  readonly onChanged: () => void;
  readonly readiness: MonetisationReadiness | undefined;
}) {
  const creator = useCreator();
  const state = offerStateLook(offer.state);
  const live = offer.prices.filter((price) => price.state === 'active');
  const [open, setOpen] = useState(false);
  const manageable =
    creator.canWrite &&
    readiness?.enabled === true &&
    offer.state !== 'retired';

  return (
    <>
      <ListRow testId={`offer-${offer.id}`}>
        <span className="s-subheading">
          {club?.name ?? offerModeLabels[offer.mode] ?? 'Membership'}
          {club === undefined
            ? null
            : ` · ${offerModeLabels[offer.mode] ?? 'Membership'}`}
        </span>
        <span className="s-inline s-inline--tight">
          <Badge icon={state.icon} tone={state.tone}>
            {state.label}
          </Badge>
          {live.length === 0 ? (
            <Chip>No price published</Chip>
          ) : (
            live.map((price) => (
              <Chip key={price.id}>
                <span className="s-numeric">{formatMoney(price.amount)}</span>
                {price.interval === undefined
                  ? null
                  : ` ${priceIntervalLabels[price.interval] ?? ''}`}
              </Chip>
            ))
          )}
          <span className="s-caption s-quiet">
            Created {formatDate(offer.createdAt)}
          </span>
          {manageable ? (
            <Button
              data-testid={`offer-manage-${offer.id}`}
              onClick={() => {
                setOpen((current) => !current);
              }}
            >
              {open ? 'Done' : 'Manage'}
            </Button>
          ) : null}
        </span>
      </ListRow>
      {open && manageable ? (
        <div
          className="s-card__pad s-stack s-stack--5"
          data-testid={`offer-panel-${offer.id}`}
        >
          <ConsumerPreview club={club} offer={offer} />
          <PriceControls
            offer={offer}
            onChanged={onChanged}
            readiness={readiness}
          />
          <OfferLifecycle
            live={live.length > 0}
            offer={offer}
            onChanged={onChanged}
          />
        </div>
      ) : null}
    </>
  );
}

/**
 * What a visitor to the creator's page will actually read.
 *
 * Assembled from the same two answers the public page assembles it from — the
 * club's own presentation and this offer's live prices — so a creator is
 * previewing the product rather than a mock-up of it. Nothing here is invented:
 * a club with no benefit lines previews with none.
 */
function ConsumerPreview({
  club,
  offer,
}: {
  readonly club: CreatorClub | undefined;
  readonly offer: CommercialOffer;
}) {
  const live = offer.prices.filter((price) => price.state === 'active');
  return (
    <Card testId={`offer-preview-${offer.id}`}>
      <CardHead
        lede="Exactly what somebody standing on your page sees, from the same answers they get."
        title="How this reads"
      />
      <div className="s-stack s-stack--3">
        <span className="s-subheading">{club?.name ?? 'Membership'}</span>
        {club?.description === undefined ? null : (
          <p className="s-body">{club.description}</p>
        )}
        {club === undefined || club.benefits.length === 0 ? (
          <p
            className="s-caption s-quiet"
            data-testid={`offer-preview-no-benefits-${offer.id}`}
          >
            This club lists nothing a member gets. Somebody deciding whether to
            join has only the description to go on.
          </p>
        ) : (
          <ul className="s-list s-list--bullets">
            {club.benefits.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {live.length === 0 ? (
          <p className="s-caption s-quiet">
            No price is published, so no join control appears on your page.
          </p>
        ) : (
          <div className="s-inline s-inline--tight">
            {live.map((price) => (
              <Chip key={price.id}>
                <span className="s-numeric">{formatMoney(price.amount)}</span>
                {price.interval === undefined
                  ? null
                  : ` ${priceIntervalLabels[price.interval] ?? ''}`}
              </Chip>
            ))}
          </div>
        )}
        {offer.state === 'active' ? null : (
          <p className="s-caption s-quiet">
            This membership is a draft, so none of it appears on your page yet.
          </p>
        )}
      </div>
    </Card>
  );
}

/* ================================ Prices ============================= */

function PriceControls({
  offer,
  onChanged,
  readiness,
}: {
  readonly offer: CommercialOffer;
  readonly onChanged: () => void;
  readonly readiness: MonetisationReadiness;
}) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [currency, setCurrency] = useState<
    MonetisationReadiness['currencies'][number] | ''
  >(readiness.currencies[0] ?? '');
  const [interval, setInterval] = useState(readiness.intervals[0] ?? 'month');
  const [amount, setAmount] = useState('');
  const [touched, setTouched] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);

  const exponent = exponentFor(currency);
  const minorUnits =
    amount.trim() === '' ? undefined : minorUnitsOf(amount, exponent);
  const amountError =
    !touched || amount.trim() === '' || minorUnits !== undefined
      ? undefined
      : exponent === 0
        ? 'This currency has no decimal places. Enter a whole number.'
        : `Enter an amount above zero, with at most ${String(exponent)} decimal places.`;

  const live = offer.prices.filter((price) => price.state === 'active');
  const replacing = live.find(
    (price) =>
      price.amount.currency === currency && price.interval === interval,
  );

  return (
    <Card testId={`offer-prices-${offer.id}`}>
      <CardHead
        lede="A published price is frozen. Changing what this costs withdraws the old figure and publishes a new one; anybody already paying keeps what they agreed to."
        title="Price"
      />
      {message === undefined ? null : (
        <ErrorMessage testId={`offer-price-error-${offer.id}`}>
          {message}
        </ErrorMessage>
      )}

      {live.length === 0 ? null : (
        <ul className="s-list">
          {live.map((price) => (
            <li key={price.id}>
              <LivePrice offer={offer} onChanged={onChanged} price={price} />
            </li>
          ))}
        </ul>
      )}

      <form
        className="s-stack s-stack--5"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (minorUnits === undefined || currency === '') return;
          run(async () => {
            const result = await api.publishPrice({
              amountMinor: minorUnits,
              currency,
              interval,
              offerId: offer.id,
            });
            const failure = failureMessage(result, {
              conflict:
                'That price is outside what VELORA has approved, or this membership changed since the page loaded.',
            });
            setMessage(failure);
            if (failure === undefined) {
              setAmount('');
              setTouched(false);
              toast.show('Price published.', 'positive');
              onChanged();
            }
          });
        }}
      >
        <div className="s-inline s-inline--tight">
          <Field error={amountError} label="Amount">
            {(control) => (
              <TextInput
                {...control}
                data-testid={`offer-price-amount-${offer.id}`}
                inputMode="decimal"
                name="amount"
                onChange={(event) => {
                  setAmount(event.target.value);
                }}
                placeholder={exponent === 0 ? '1000' : '9.99'}
                value={amount}
              />
            )}
          </Field>
          <Field label="Currency">
            {(control) => (
              <Select
                {...control}
                data-testid={`offer-price-currency-${offer.id}`}
                name="currency"
                onChange={(event) => {
                  setCurrency(
                    event.target
                      .value as MonetisationReadiness['currencies'][number],
                  );
                }}
                value={currency}
              >
                {readiness.currencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Billed">
            {(control) => (
              <Select
                {...control}
                data-testid={`offer-price-interval-${offer.id}`}
                name="interval"
                onChange={(event) => {
                  setInterval(event.target.value as 'month' | 'year');
                }}
                value={interval}
              >
                {readiness.intervals.map((value) => (
                  <option key={value} value={value}>
                    {value === 'month' ? 'Every month' : 'Every year'}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {replacing === undefined ? null : (
          <p
            className="s-field__hint"
            data-testid={`offer-price-replaces-${offer.id}`}
          >
            Publishing this withdraws {formatMoney(replacing.amount)}{' '}
            {priceIntervalLabels[interval] ?? ''}. Nobody already paying that is
            charged the new figure.
          </p>
        )}
        <div className="s-form-actions">
          <Button
            busy={busy}
            data-testid={`offer-price-publish-${offer.id}`}
            disabled={minorUnits === undefined || currency === ''}
            tone="primary"
            type="submit"
          >
            Publish this price
          </Button>
        </div>
      </form>
    </Card>
  );
}

function LivePrice({
  offer,
  onChanged,
  price,
}: {
  readonly offer: CommercialOffer;
  readonly onChanged: () => void;
  readonly price: CommercialPrice;
}) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);

  return (
    <>
      <ListRow testId={`offer-live-price-${price.id}`}>
        <span className="s-subheading s-numeric">
          {formatMoney(price.amount)}
          {price.interval === undefined
            ? null
            : ` ${priceIntervalLabels[price.interval] ?? ''}`}
        </span>
        <span className="s-inline s-inline--tight">
          <span className="s-caption s-quiet">
            Live since {formatDate(price.effectiveFrom)}
          </span>
          <Button
            data-testid={`offer-price-retire-${price.id}`}
            disabled={busy}
            onClick={() => {
              setConfirming(true);
            }}
            tone="ghost"
          >
            Withdraw
          </Button>
        </span>
      </ListRow>
      {message === undefined ? null : (
        <ErrorMessage testId={`offer-price-retire-error-${price.id}`}>
          {message}
        </ErrorMessage>
      )}
      {confirming ? (
        <ConfirmDialog
          busy={busy}
          confirmLabel="Withdraw it"
          onCancel={() => {
            setConfirming(false);
          }}
          onConfirm={() => {
            setConfirming(false);
            run(async () => {
              const failure = failureMessage(
                await api.retirePrice({ offerId: offer.id, priceId: price.id }),
              );
              setMessage(failure);
              if (failure === undefined) {
                toast.show('Price withdrawn.', 'positive');
                onChanged();
              }
            });
          }}
          testId={`offer-price-retire-confirm-${price.id}`}
          title="Withdraw this price?"
        >
          <p>
            Nobody new can buy at this figure. Anybody already paying it keeps
            paying it, because a price they agreed to is not something a later
            decision may rewrite.
          </p>
          <p>
            With no live price this membership cannot be joined, even while it
            is on sale.
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

/* ============================== Lifecycle ============================ */

function OfferLifecycle({
  live,
  offer,
  onChanged,
}: {
  readonly live: boolean;
  readonly offer: CommercialOffer;
  readonly onChanged: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [confirmingRetire, setConfirmingRetire] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);

  const move = (state: 'active' | 'retired', confirmation: string) => {
    run(async () => {
      const failure = failureMessage(
        await api.setOfferLifecycle({
          offerId: offer.id,
          state,
          version: offer.version,
        }),
        {
          conflict:
            'This membership changed somewhere else since the page loaded. Reload and try again.',
        },
      );
      setMessage(failure);
      if (failure === undefined) {
        toast.show(confirmation, 'positive');
        onChanged();
      }
    });
  };

  return (
    <Card testId={`offer-lifecycle-${offer.id}`}>
      <CardHead
        lede={
          offer.state === 'active'
            ? 'On sale. Somebody on your page can join it.'
            : 'A draft. Nobody can see it and nobody can join it.'
        }
        title="On sale"
      />
      {message === undefined ? null : (
        <ErrorMessage testId={`offer-lifecycle-error-${offer.id}`}>
          {message}
        </ErrorMessage>
      )}
      {offer.state === 'draft' && !live ? (
        <Notice
          icon="info"
          testId={`offer-needs-price-${offer.id}`}
          tone="quiet"
        >
          Publish a price first. A membership on sale with no price is a join
          control that cannot succeed.
        </Notice>
      ) : null}
      <div className="s-inline s-inline--tight">
        {offer.state === 'draft' ? (
          <Button
            busy={busy}
            data-testid={`offer-activate-${offer.id}`}
            disabled={!live}
            onClick={() => {
              move('active', 'Membership is on sale.');
            }}
            tone="primary"
          >
            Put it on sale
          </Button>
        ) : (
          <Button
            data-testid={`offer-retire-${offer.id}`}
            disabled={busy}
            onClick={() => {
              setConfirmingRetire(true);
            }}
            tone="ghost"
          >
            Stop selling
          </Button>
        )}
      </div>

      {confirmingRetire ? (
        <ConfirmDialog
          busy={busy}
          confirmLabel="Stop selling it"
          onCancel={() => {
            setConfirmingRetire(false);
          }}
          onConfirm={() => {
            setConfirmingRetire(false);
            move('retired', 'Membership withdrawn from sale.');
          }}
          testId={`offer-retire-confirm-${offer.id}`}
          title="Stop selling this membership?"
        >
          <p>
            It disappears from your page and nobody new can join. Everybody who
            already has it keeps it, and keeps being charged for it, until they
            cancel — withdrawing a membership from sale is not the same as
            ending it.
          </p>
        </ConfirmDialog>
      ) : null}
    </Card>
  );
}
