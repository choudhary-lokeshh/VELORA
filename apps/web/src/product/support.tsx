'use client';

import { useCallback, useState } from 'react';

import type {
  SupportCategory,
  SupportTicket,
  SupportTicketList,
} from '@velora/consumer-client';
import { failureMessage, isOk } from '@velora/consumer-client';

import { useApi, useToast } from '../app/providers';
import { Icon } from '../design/icons';
import {
  Badge,
  Button,
  Choice,
  ErrorMessage,
  Field,
  Notice,
  PageHeader,
  RowSkeleton,
  Section,
  TextArea,
  TextInput,
  type Tone,
} from '../design/primitives';
import { formatRelative } from './locale';
import { useResource, useSingleFlight, type Resource } from './resource';

/**
 * Getting help from a person.
 *
 * The complaint this exists for is the flattest one in the whole category:
 * there is no way to reach anybody. An address in a policy document is not a
 * support path, because somebody using it can never tell whether anything
 * happened — so this screen is built around one thing, which is that after
 * submitting, a person holds a reference they can read back and a status that
 * came from the server.
 *
 * It is deliberately not the safety surface. Somebody being harassed is pointed
 * at reporting them, which has different rules and tells the reporter nothing;
 * this is for "I cannot sign in" and "my coins did not arrive". The two are
 * kept apart because folding either into the other would break one of them.
 *
 * Nothing here promises a response time, because VELORA has nobody on a rota.
 * The screen says what is true — that a ticket has been received and that
 * somebody will read it — and no more than that.
 */

const categories: readonly {
  readonly hint: string;
  readonly label: string;
  readonly value: SupportCategory;
}[] = [
  {
    hint: 'Signing in, signing up, or getting back into your account',
    label: 'Account and signing in',
    value: 'account_access',
  },
  {
    hint: 'Matching, calls, audio, video, or reconnecting',
    label: 'Live conversations',
    value: 'live',
  },
  {
    hint: 'Somebody’s behaviour, a block, or a decision about your account',
    label: 'Safety',
    value: 'safety',
  },
  {
    hint: 'Coins, a purchase, or anything that moved money',
    label: 'Coins and payments',
    value: 'wallet',
  },
  {
    hint: 'Messages that did not send, arrive, or stay',
    label: 'Messages',
    value: 'messaging',
  },
  {
    hint: 'Your profile, photographs, languages, or preferences',
    label: 'Profile',
    value: 'profile',
  },
  { hint: 'Anything else', label: 'Something else', value: 'other' },
];

/**
 * What each status means, in words that are true.
 *
 * `received` says plainly that nobody has looked yet. Saying anything warmer
 * while nobody is looking is the lie that makes a person stop believing every
 * later status too.
 */
const statusCopy: Readonly<
  Record<string, { readonly label: string; readonly tone: Tone }>
> = {
  closed: { label: 'Closed', tone: 'neutral' },
  in_review: { label: 'Somebody is looking at it', tone: 'info' },
  received: { label: 'Received', tone: 'info' },
  resolved: { label: 'Answered', tone: 'positive' },
};

const maximumSubject = 120;
const maximumDescription = 4000;

export function Support() {
  const api = useApi();
  const load = useCallback(
    async (signal: AbortSignal) => api.supportTickets({}, signal),
    [api],
  );
  // One resource, owned here, so submitting refreshes the list underneath it.
  // Held separately it was possible to send something and watch it not appear,
  // which on this screen of all screens reads as the message going nowhere.
  const tickets = useResource(load);

  return (
    <>
      <PageHeader
        lede="Tell VELORA what is wrong and get a reference you can quote. A person reads every one of these."
        title="Help"
      />
      <div className="v-stack v-stack--6">
        <SafetyRedirect />
        <NewTicketCard onOpened={tickets.reload} />
        <TicketsCard tickets={tickets} />
      </div>
    </>
  );
}

/**
 * The one thing this screen is not for.
 *
 * Somebody who has just been harassed should be reporting the person, not
 * writing a ticket about them: reporting reaches moderation, carries evidence,
 * and can be paired with a block in one act. Saying so here costs a line and
 * saves somebody the slowest possible route to safety.
 */
function SafetyRedirect() {
  return (
    <Notice icon="shield" testId="support-safety-hint" tone="quiet">
      <p>
        If somebody is harassing you or behaving badly, report them from their
        profile or from your Live conversation instead — that reaches the safety
        team directly and can block them at the same time. Everything else
        belongs here.
      </p>
    </Notice>
  );
}

function NewTicketCard({ onOpened }: { readonly onOpened: () => void }) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [category, setCategory] = useState<SupportCategory>('account_access');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [opened, setOpened] = useState<SupportTicket | undefined>(undefined);

  const ready =
    subject.trim().length >= 3 && description.trim().length >= 10 && !busy;

  if (opened !== undefined) {
    return (
      <Section raised testId="support-submitted" title="We have it">
        <Notice icon="check" title="Your reference">
          <p>
            Quote{' '}
            <strong data-testid="support-reference">{opened.reference}</strong>{' '}
            if you need to follow this up. It is also on the list below, with
            whatever VELORA has done about it.
          </p>
        </Notice>
        <p className="v-small v-quiet">
          A person reads every one of these. We are not going to give you a
          response time we cannot keep, so this screen will simply say what is
          actually happening to it.
        </p>
        <div>
          <Button
            data-testid="support-write-another"
            onClick={() => {
              setOpened(undefined);
              setSubject('');
              setDescription('');
            }}
            size="sm"
            tone="ghost"
          >
            Ask about something else
          </Button>
        </div>
      </Section>
    );
  }

  return (
    <Section raised testId="support-form-card" title="Tell us what is wrong">
      <form
        className="v-stack v-stack--5"
        onSubmit={(event) => {
          event.preventDefault();
          run(async () => {
            setError(undefined);
            const result = await api.createSupportTicket({
              category,
              // Generated once per submission. The server scopes it to the
              // sender, so a retry after a lost response is one ticket rather
              // than two — which matters most on exactly the bad connection
              // that produced the ticket.
              clientTicketId: crypto.randomUUID(),
              description: description.trim(),
              subject: subject.trim(),
            });
            const failure = failureMessage(result);
            if (failure !== undefined) {
              setError(failure);
              return;
            }
            if (isOk(result)) {
              setOpened(result.value);
              toast.show('We have your message.', 'positive');
              onOpened();
            }
          });
        }}
      >
        <fieldset className="v-fieldset">
          <legend>What is it about?</legend>
          {categories.map((option) => (
            <Choice
              checked={category === option.value}
              key={option.value}
              label={
                <>
                  <span>{option.label}</span>
                  <span className="v-caption v-quiet"> — {option.hint}</span>
                </>
              }
              name="category"
              onSelect={() => {
                setCategory(option.value);
              }}
              value={option.value}
            />
          ))}
        </fieldset>

        <Field
          count={{ length: subject.length, maximum: maximumSubject }}
          hint="A few words, so somebody can see at a glance what this is."
          label="Summary"
        >
          {(control) => (
            <TextInput
              {...control}
              data-testid="support-subject"
              maxLength={maximumSubject}
              name="subject"
              onChange={(event) => {
                setSubject(event.target.value);
              }}
              value={subject}
            />
          )}
        </Field>

        <Field
          count={{ length: description.length, maximum: maximumDescription }}
          hint="What happened, what you expected, and anything you already tried."
          label="What happened"
        >
          {(control) => (
            <TextArea
              {...control}
              data-testid="support-description"
              maxLength={maximumDescription}
              name="description"
              onChange={(event) => {
                setDescription(event.target.value);
              }}
              rows={6}
              value={description}
            />
          )}
        </Field>

        {error === undefined ? null : (
          <ErrorMessage testId="support-error">{error}</ErrorMessage>
        )}

        <div>
          <Button
            busy={busy}
            data-testid="support-submit"
            disabled={!ready}
            tone="primary"
            type="submit"
          >
            Send it
          </Button>
        </div>
      </form>
    </Section>
  );
}

function TicketsCard({
  tickets,
}: {
  readonly tickets: Resource<SupportTicketList>;
}) {
  const rows = tickets.value?.tickets ?? [];

  return (
    <Section raised testId="support-tickets-card" title="What you have asked">
      {tickets.loading && tickets.value === undefined ? (
        <RowSkeleton rows={2} />
      ) : null}

      {tickets.error === undefined ? null : (
        <div className="v-stack v-stack--3">
          <ErrorMessage testId="support-tickets-failed">
            {tickets.error}
          </ErrorMessage>
          {tickets.retryable ? (
            <div>
              <Button onClick={tickets.reload} size="sm">
                Try again
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {!tickets.loading && tickets.error === undefined && rows.length === 0 ? (
        <p className="v-small v-muted" data-testid="support-tickets-empty">
          Nothing yet. Anything you send appears here with its reference and
          whatever VELORA has done about it.
        </p>
      ) : null}

      {rows.length === 0 ? null : (
        <ul
          className="v-list v-list--divided"
          data-testid="support-ticket-list"
        >
          {rows.map((ticket) => {
            const shown = statusCopy[ticket.status] ?? {
              label: ticket.status,
              tone: 'neutral' as Tone,
            };
            return (
              <li
                data-testid={`support-ticket-${ticket.reference}`}
                key={ticket.id}
              >
                <div className="v-row" style={{ alignItems: 'flex-start' }}>
                  <span className="v-notification__mark">
                    <Icon name="message" size="md" />
                  </span>
                  <span className="v-row__body">
                    <span className="v-subheading">{ticket.subject}</span>
                    <span className="v-caption v-quiet">
                      {ticket.reference} · sent{' '}
                      {formatRelative(ticket.createdAt)}
                    </span>
                    <span className="v-wrap v-small">{ticket.description}</span>
                  </span>
                  <Badge tone={shown.tone}>{shown.label}</Badge>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
