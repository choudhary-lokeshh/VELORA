'use client';

import Link from 'next/link';
import { useCallback } from 'react';

import type { AdminClub, AdminClubList } from '../api/contract';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Fact,
  Facts,
  Notice,
  PageHeader,
  Panel,
  PanelBody,
  PanelFoot,
  PanelHead,
  PanelSkeleton,
  Reference,
  RowSkeleton,
  Scroller,
  Table,
} from '../design/primitives';
import { useApi } from '../app/providers';
import {
  clubLifecycleLabels,
  formatDate,
  formatDateTime,
  humanState,
  membershipSourceLabels,
  plural,
  shortId,
} from './format';
import { useCollection, useResource } from './resource';

/**
 * The clubs creators sell, and who is in one — by membership, never by member.
 *
 * This screen exists to close a real dead end rather than to add a surface. The
 * console has always been able to revoke a club membership, and it asked an
 * operator to paste an identifier it could not show them: a capability that was
 * real in the API and unreachable in the product. A membership is now something
 * an operator can find, beside the club it belongs to and the creator who owns
 * it.
 *
 * **A membership is published by its own identifier and its state, and never by
 * who holds it.** A club that listed its members would be a console publishing
 * who pays whom, which is exactly the browsing surface over private material
 * this product refuses everywhere else. Knowing who holds a membership changes
 * nothing an operator may decide about it.
 *
 * The counts on the list are the club's own, from one grouped read over the
 * page. There is no revenue figure and no member total across clubs, because
 * neither is published and both would be this console inventing a business
 * fact.
 */

const clubPageSize = 25;

export function Clubs() {
  const api = useApi();

  const load = useCallback(
    async (cursor: string | undefined) => {
      const result = await api.clubs({ cursor, pageSize: clubPageSize });
      return result.kind === 'ok'
        ? {
            kind: 'ok' as const,
            value: {
              items: result.value.clubs,
              nextCursor: result.value.nextCursor,
            },
          }
        : result;
    },
    [api],
  );
  const clubs = useCollection<AdminClub>(load);

  return (
    <Panel testId="club-list">
      <PanelHead
        actions={
          clubs.items.length === 0 ? undefined : (
            <span className="a-caption a-quiet a-numeric">
              {plural(clubs.items.length, 'club loaded', 'clubs loaded')}
              {clubs.hasMore ? ', more to come' : ''}
            </span>
          )
        }
        lede="Newest first, with how many memberships each holds. No member appears anywhere."
        title="Clubs"
      />

      {clubs.error !== undefined && clubs.items.length === 0 ? (
        <PanelBody>
          <ErrorState
            body={clubs.error}
            onRetry={clubs.retryable ? clubs.reload : undefined}
            testId="club-list-failed"
          />
        </PanelBody>
      ) : clubs.loading && clubs.items.length === 0 ? (
        <PanelBody>
          <RowSkeleton rows={5} />
        </PanelBody>
      ) : clubs.items.length === 0 ? (
        <PanelBody>
          <EmptyState
            body="No creator has opened a club in this environment."
            testId="club-list-empty"
            title="No club"
          />
        </PanelBody>
      ) : (
        <PanelBody flush>
          <Scroller label="Clubs">
            <Table>
              <thead>
                <tr>
                  <th scope="col">Club</th>
                  <th scope="col">Creator</th>
                  <th scope="col">Lifecycle</th>
                  <th className="a-table__right" scope="col">
                    Members
                  </th>
                  <th className="a-table__right" scope="col">
                    Revoked
                  </th>
                  <th scope="col">Opened</th>
                </tr>
              </thead>
              <tbody>
                {clubs.items.map((club) => (
                  <ClubRow club={club} key={club.id} />
                ))}
              </tbody>
            </Table>
          </Scroller>
        </PanelBody>
      )}

      {clubs.hasMore ? (
        <PanelFoot>
          <Button
            block
            busy={clubs.loadingMore}
            data-testid="club-list-more"
            onClick={clubs.loadMore}
          >
            Load more
          </Button>
        </PanelFoot>
      ) : null}
    </Panel>
  );
}

function countOf(club: AdminClub, state: string): number {
  return club.memberships.find((row) => row.state === state)?.count ?? 0;
}

function ClubRow({ club }: { readonly club: AdminClub }) {
  return (
    <tr data-testid={`club-${club.id}`}>
      <td>
        <Link
          className="a-table__link"
          href={`/creators/clubs/${club.id}`}
          data-testid={`club-${club.id}-link`}
        >
          {club.name}
        </Link>
      </td>
      <td>
        {club.handle === undefined ? (
          <span className="a-mono a-quiet">{shortId(club.creatorId)}</span>
        ) : (
          <Link
            className="a-table__link a-mono"
            href={`/creators?selected=${club.creatorId}`}
          >
            @{club.handle}
          </Link>
        )}
      </td>
      <td>
        {clubLifecycleLabels[club.lifecycle] ?? humanState(club.lifecycle)}
      </td>
      <td className="a-table__right a-numeric">
        <span data-testid={`club-${club.id}-active`}>
          {countOf(club, 'active')}
        </span>
      </td>
      <td className="a-table__right a-numeric a-quiet">
        {countOf(club, 'revoked')}
      </td>
      <td className="a-numeric a-quiet">{formatDate(club.createdAt)}</td>
    </tr>
  );
}

/**
 * One club, and the memberships an operator may act on.
 *
 * The identifier of each membership is shown and copyable, because the one
 * membership operation the platform publishes takes one — and it is taken on
 * the creator's own screen, where it collects a reason and records an
 * enforcement. Putting the revocation control here as well would give the same
 * action two homes and two sets of words.
 */
export function ClubScreen({ clubId }: { readonly clubId: string }) {
  const api = useApi();
  const load = useCallback(async () => api.clubs({ clubId }), [api, clubId]);
  const state = useResource<AdminClubList>(load);
  const value = state.value;
  const club = value?.clubs[0];

  if (state.error !== undefined && value === undefined) {
    return (
      <>
        <PageHeader eyebrow="Clubs" title="Club" />
        <Panel>
          <PanelBody>
            <ErrorState
              body={state.error}
              onRetry={state.retryable ? state.reload : undefined}
              testId="club-failed"
            />
          </PanelBody>
        </Panel>
      </>
    );
  }

  if (value === undefined) {
    return (
      <>
        <PageHeader eyebrow="Clubs" title="Club" />
        <Panel testId="club-loading">
          <PanelBody>
            <PanelSkeleton rows={4} />
          </PanelBody>
        </Panel>
      </>
    );
  }

  if (club === undefined) {
    return (
      <>
        <PageHeader eyebrow="Clubs" title="Club" />
        <Panel>
          <PanelBody>
            <EmptyState
              body="No club with that identifier exists, or it has been removed."
              testId="club-missing"
              title="That club is not here"
            />
          </PanelBody>
        </Panel>
      </>
    );
  }

  const memberships = value.memberships ?? [];
  return (
    <>
      <PageHeader
        eyebrow="Clubs"
        lede={`${
          clubLifecycleLabels[club.lifecycle] ?? humanState(club.lifecycle)
        } · opened ${formatDate(club.createdAt)}`}
        title={club.name}
      />

      <Panel testId="club-record">
        <PanelHead
          lede="What PRIVATE CLUBS holds about this club. The description a creator wrote is not published to this console."
          title="The record"
        />
        <PanelBody>
          <Facts>
            <Fact
              term="Club"
              testId="club-id"
              value={<Reference value={club.id} />}
            />
            <Fact
              term="Creator"
              testId="club-creator"
              value={
                club.handle === undefined ? (
                  <Reference value={club.creatorId} />
                ) : (
                  <Link
                    className="a-mono"
                    href={`/creators?selected=${club.creatorId}`}
                  >
                    @{club.handle}
                  </Link>
                )
              }
            />
            <Fact
              term="Slug"
              value={<span className="a-mono">{club.slug}</span>}
            />
            <Fact
              term="Lifecycle"
              value={
                clubLifecycleLabels[club.lifecycle] ??
                humanState(club.lifecycle)
              }
            />
            <Fact
              term="Published"
              value={
                club.publishedAt === undefined ? (
                  <span className="a-quiet">Never</span>
                ) : (
                  <span className="a-numeric">
                    {formatDateTime(club.publishedAt)}
                  </span>
                )
              }
            />
            <Fact
              term="Closed"
              value={
                club.closedAt === undefined ? (
                  <span className="a-quiet">Open</span>
                ) : (
                  <span className="a-numeric">
                    {formatDateTime(club.closedAt)}
                  </span>
                )
              }
            />
          </Facts>
        </PanelBody>
      </Panel>

      <Panel testId="club-memberships">
        <PanelHead
          actions={
            memberships.length === 0 ? undefined : (
              <span className="a-caption a-quiet a-numeric">
                {plural(memberships.length, 'membership', 'memberships')}
              </span>
            )
          }
          lede="Each membership by its own identifier and state. Who holds one is not published, and does not change anything an operator may decide about it."
          title="Memberships"
        />
        {memberships.length === 0 ? (
          <PanelBody>
            <EmptyState
              body="Nobody has ever held a membership of this club."
              testId="club-memberships-empty"
              title="No membership"
            />
          </PanelBody>
        ) : (
          <PanelBody flush>
            <Scroller label="Memberships">
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Membership</th>
                    <th scope="col">State</th>
                    <th scope="col">How</th>
                    <th scope="col">Granted</th>
                    <th scope="col">Revoked</th>
                  </tr>
                </thead>
                <tbody>
                  {memberships.map((membership) => (
                    <tr
                      data-testid={`membership-${membership.id}`}
                      key={membership.id}
                    >
                      <td>
                        <Reference
                          short={shortId(membership.id)}
                          testId={`membership-${membership.id}-reference`}
                          value={membership.id}
                        />
                      </td>
                      <td>
                        {membership.state === 'active' ? (
                          <Badge icon="check" tone="positive">
                            Active
                          </Badge>
                        ) : (
                          <Badge icon="ban" tone="neutral">
                            {humanState(membership.state)}
                          </Badge>
                        )}
                      </td>
                      <td>
                        {membershipSourceLabels[membership.source] ??
                          humanState(membership.source)}
                      </td>
                      <td className="a-numeric a-quiet">
                        {formatDateTime(membership.grantedAt)}
                      </td>
                      <td className="a-numeric a-quiet">
                        {membership.revokedAt === undefined
                          ? '—'
                          : formatDateTime(membership.revokedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Scroller>
          </PanelBody>
        )}
      </Panel>

      <Notice
        icon="scale"
        testId="club-revocation-note"
        title="Revoking a membership"
      >
        Copy the membership identifier above and take the operation on the
        creator&apos;s own screen, where it collects a reason and records an
        enforcement against the creator it belongs to. It has one home rather
        than two, so there is one set of words for what it does and one record
        of who did it.{' '}
        <Link href={`/creators?selected=${club.creatorId}`}>
          Open this creator
        </Link>
        .
      </Notice>
    </>
  );
}
