'use client';

import { useCallback, useState } from 'react';

import type {
  SupportTicket,
  SupportTicketDetail,
  SupportTicketList,
  SupportTicketStatus,
} from '../api/contract';
import { failureMessage } from '../api/messages';
import { useApi, useToast } from '../app/providers';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Panel,
  PanelBody,
  PanelHead,
  PageHeader,
  RowSkeleton,
  Scroller,
  Select,
  Table,
  TextArea,
} from '../design/primitives';
import { formatDateTime, humanState, shortId } from './format';
import { QueueNav } from './queues';
import { useResource, useSingleFlight } from './resource';

/**
 * The support queue.
 *
 * The smallest operator surface a consumer ticket needs to be answerable, and
 * deliberately no larger. An operator reads the queue, opens one ticket with
 * its history, moves its status, and optionally records why. There is no route
 * from this screen to an account status, an enforcement, a wallet balance, or a
 * block — a support console that grew a shortcut into one of those would be an
 * enforcement path with none of the audit the real one carries.
 *
 * It sits under Queues rather than in a destination of its own, because that is
 * what it is: work waiting for a person. It is not a moderation queue and the
 * two are not merged — a report is evidence about somebody else and its
 * reporter is told nothing, while a ticket is a person asking about their own
 * account and the whole point is that they are told what happened.
 *
 * The list is oldest first, which is the opposite of the order the person who
 * wrote it sees. That is deliberate: somebody wants their most recent question
 * and an operator wants the one that has been waiting longest.
 */

const supportPageSize = 50;

const statusLabels: Readonly<Record<string, string>> = {
  closed: 'Closed',
  in_review: 'In review',
  received: 'Received',
  resolved: 'Resolved',
};

const categoryLabels: Readonly<Record<string, string>> = {
  account_access: 'Account and sign-in',
  live: 'Live',
  messaging: 'Messages',
  other: 'Other',
  profile: 'Profile',
  safety: 'Safety',
  wallet: 'Coins and payments',
};

type StatusFilter = SupportTicketStatus | 'all';

export function Support() {
  const api = useApi();
  const [filter, setFilter] = useState<StatusFilter>('received');

  const load = useCallback(
    async () =>
      api.supportTickets({
        pageSize: supportPageSize,
        ...(filter === 'all' ? {} : { status: filter }),
      }),
    [api, filter],
  );
  const tickets = useResource<SupportTicketList>(load);
  const rows = tickets.value?.tickets ?? [];
  const [opened, setOpened] = useState<string | undefined>(undefined);
  /*
   * Whether this read hit the ceiling.
   *
   * A full page means the queue may be larger and this console has no way to
   * learn by how much, so it says "at least" rather than printing the page's
   * own length as the backlog. A number that makes an unbounded backlog look
   * bounded is the worst kind of wrong number on an operations screen, because
   * it looks exactly like the truth.
   */
  const capped = rows.length >= supportPageSize;

  return (
    <>
      <PageHeader
        eyebrow="Queues"
        lede="What people have asked VELORA for help with. Oldest first, because the one waiting longest is the one that needs answering."
        title="Support"
      />

      <QueueNav />

      <Panel testId="support-list">
        <PanelHead
          actions={
            <div className="a-row a-row--tight">
              {rows.length === 0 ? null : (
                <span className="a-caption a-quiet a-numeric">
                  {capped
                    ? `at least ${String(rows.length)} shown`
                    : `${String(rows.length)} shown`}
                </span>
              )}
              <Field label="Status">
                {(control) => (
                  <Select
                    {...control}
                    data-testid="support-filter"
                    onChange={(event) => {
                      setFilter(event.target.value as StatusFilter);
                    }}
                    value={filter}
                  >
                    <option value="all">Everything</option>
                    <option value="received">Received</option>
                    <option value="in_review">In review</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                  </Select>
                )}
              </Field>
            </div>
          }
          title="Tickets"
        />

        {tickets.error !== undefined && tickets.value === undefined ? (
          <PanelBody>
            <ErrorState
              body={tickets.error}
              onRetry={tickets.retryable ? tickets.reload : undefined}
              testId="support-list-failed"
            />
          </PanelBody>
        ) : tickets.loading && tickets.value === undefined ? (
          <PanelBody>
            <RowSkeleton rows={4} />
          </PanelBody>
        ) : rows.length === 0 ? (
          <PanelBody>
            <EmptyState
              body="Nobody is waiting for an answer in this state."
              icon="queue"
              testId="support-list-empty"
              title="Nothing here"
            />
          </PanelBody>
        ) : (
          <PanelBody flush>
            <Scroller label="Support tickets">
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">About</th>
                    <th scope="col">Summary</th>
                    <th scope="col">From</th>
                    <th scope="col">Status</th>
                    <th scope="col">Opened</th>
                    <th scope="col">
                      <span className="a-visually-hidden">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((ticket) => (
                    <tr
                      data-testid={`support-row-${ticket.reference}`}
                      key={ticket.id}
                    >
                      <td className="a-numeric">{ticket.reference}</td>
                      <td>
                        {categoryLabels[ticket.category] ??
                          humanState(ticket.category)}
                      </td>
                      <td>{ticket.subject}</td>
                      <td className="a-quiet a-numeric">
                        {shortId(ticket.ownerId)}
                      </td>
                      <td>
                        <Badge
                          tone={
                            ticket.status === 'resolved'
                              ? 'positive'
                              : 'neutral'
                          }
                        >
                          {statusLabels[ticket.status] ??
                            humanState(ticket.status)}
                        </Badge>
                      </td>
                      <td className="a-quiet">
                        {formatDateTime(ticket.createdAt)}
                      </td>
                      <td>
                        <Button
                          data-testid={`support-open-${ticket.reference}`}
                          onClick={() => {
                            setOpened(
                              opened === ticket.id ? undefined : ticket.id,
                            );
                          }}
                          size="sm"
                        >
                          {opened === ticket.id ? 'Close' : 'Open'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Scroller>
          </PanelBody>
        )}
      </Panel>

      {opened === undefined ? null : (
        <TicketDetail onChanged={tickets.reload} ticketId={opened} />
      )}
    </>
  );
}

function TicketDetail({
  onChanged,
  ticketId,
}: {
  readonly onChanged: () => void;
  readonly ticketId: string;
}) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const load = useCallback(
    async () => api.supportTicket(ticketId),
    [api, ticketId],
  );
  const detail = useResource<SupportTicketDetail>(load);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | undefined>(undefined);

  const ticket: SupportTicket | undefined = detail.value?.ticket;
  const events = detail.value?.events ?? [];

  const move = (status: SupportTicketStatus) => {
    run(async () => {
      const result = await api.updateSupportTicket({
        ...(note.trim().length === 0 ? {} : { note: note.trim() }),
        status,
        ticketId,
      });
      const failure = failureMessage(result, {
        conflict:
          'That is not a move this ticket can make from where it is. Nothing was recorded.',
      });
      setMessage(failure);
      if (failure === undefined) {
        setNote('');
        toast.show('Ticket updated.', 'positive');
      }
      detail.reload();
      onChanged();
    });
  };

  return (
    <Panel testId="support-detail">
      <PanelHead title={ticket === undefined ? 'Ticket' : ticket.reference} />
      {detail.error !== undefined && ticket === undefined ? (
        <PanelBody>
          <ErrorState
            body={detail.error}
            onRetry={detail.retryable ? detail.reload : undefined}
            testId="support-detail-failed"
          />
        </PanelBody>
      ) : ticket === undefined ? (
        <PanelBody>
          <RowSkeleton rows={3} />
        </PanelBody>
      ) : (
        <PanelBody>
          <div className="a-stack a-stack--4">
            <div>
              <p className="a-subheading">{ticket.subject}</p>
              <p className="a-caption a-quiet">
                {categoryLabels[ticket.category] ?? humanState(ticket.category)}{' '}
                · from {shortId(ticket.ownerId)} ·{' '}
                {formatDateTime(ticket.createdAt)}
              </p>
            </div>

            {/* What the person actually wrote, and the reason this screen
                exists. It is their account of their own problem rather than
                evidence about anybody else. */}
            <p className="a-wrap" data-testid="support-detail-description">
              {ticket.description}
            </p>

            <Scroller label="Ticket history">
              <Table>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">What</th>
                    <th scope="col">Who</th>
                    <th scope="col">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td className="a-quiet">
                        {formatDateTime(event.createdAt)}
                      </td>
                      <td>
                        {event.status === undefined
                          ? humanState(event.kind)
                          : `${humanState(event.kind)} → ${
                              statusLabels[event.status] ??
                              humanState(event.status)
                            }`}
                      </td>
                      <td className="a-quiet a-numeric">
                        {event.actorReference === undefined
                          ? '—'
                          : shortId(event.actorReference)}
                      </td>
                      <td className="a-wrap">{event.note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Scroller>

            <Field
              hint="Recorded on the ticket and never shown to the person who wrote it."
              label="Internal note"
              optional
            >
              {(control) => (
                <TextArea
                  {...control}
                  data-testid="support-note"
                  maxLength={1000}
                  onChange={(event) => {
                    setNote(event.target.value);
                  }}
                  rows={3}
                  value={note}
                />
              )}
            </Field>

            {message === undefined ? null : (
              <ErrorState body={message} testId="support-detail-error" />
            )}

            <div className="a-row a-row--tight">
              <Button
                data-testid="support-mark-in-review"
                disabled={busy}
                onClick={() => {
                  move('in_review');
                }}
                size="sm"
              >
                In review
              </Button>
              <Button
                data-testid="support-mark-resolved"
                disabled={busy}
                onClick={() => {
                  move('resolved');
                }}
                size="sm"
                tone="primary"
              >
                Resolved
              </Button>
              <Button
                data-testid="support-mark-closed"
                disabled={busy}
                onClick={() => {
                  move('closed');
                }}
                size="sm"
              >
                Closed
              </Button>
            </div>
          </div>
        </PanelBody>
      )}
    </Panel>
  );
}
